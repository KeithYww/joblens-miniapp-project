import crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import type {
  ApiError,
  HrAnalysis,
  InterviewFeedbackRequest,
  LlmProviderResult,
  ReportFeedbackRequest,
  RiskReport,
  VisitorDataDeleteResult,
} from '../types';
import {
  containsHighSensitiveData,
  CaptchaRequestSchema,
  ClientErrorReportSchema,
  DetectRequestSchema,
  HrAnalysisRequestSchema,
  InterviewFeedbackRequestSchema,
  ReportFeedbackRequestSchema,
  ScreenshotExtractRequestSchema,
  VisitorIdSchema,
} from '../schemas';
import { isDbAvailable, prisma, runDbOperation } from '../db/prisma';
import { isRedisAvailable, redis } from '../db/redis';
import { createLlmProviderWithFallback, RuleBasedProvider } from '../services/llm';
import {
  checkRateLimit,
  incrementRateLimit,
  setCaptchaExempt,
  verifyCaptcha,
} from '../services/rateLimit';
import { startDataRetentionScheduler } from '../services/dataRetention';
import { extractJobFromScreenshots, ScreenshotExtractionTimeoutError, ScreenshotNoJobInformationError } from '../services/screenshotExtraction';
import {
  acquireAiConcurrency,
  getAiQuotaSnapshot,
  refundAiQuota,
  releaseAiConcurrency,
  reserveAiQuota,
  type AiQuotaDenialReason,
} from '../services/aiCostControl';
import {
  calculateOcrCacheKey,
  deleteCachedScreenshotExtraction,
  getCachedScreenshotExtraction,
  isScreenshotExtractionSafeToCache,
  setCachedScreenshotExtraction,
  runOcrSingleflight,
} from '../services/screenshotCache';
import {
  calculateOcrWriteHash,
  decodeV1Images,
  imageHashes,
  MAX_FIELDS,
  MAX_FIELD_BYTES,
  MAX_FIELD_NAME_BYTES,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_HEADER_PAIRS,
  MAX_MULTIPART_BODY_BYTES,
  MAX_PARTS,
  OCR_OPERATION_KEY,
  OcrUploadError,
  parseOcrMultipart,
  toProviderDataUrl,
  validateOcrImages,
  type OcrInput,
} from '../services/ocrInput';
import { LlmConfigurationError } from '../services/llm/common';
import { getOperationalMetrics, recordFrontendError } from '../services/operationalMetrics';
import { registerAdminRoutes } from './admin';

const llmProvider = createLlmProviderWithFallback();
const ruleProvider = new RuleBasedProvider();
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_CACHE_TTL_MS = 10 * MINUTE_MS;
// Bump the namespace so pre-change seven-day Redis entries are never reused.
const REPORT_CACHE_NAMESPACE = 'report:v2';
const REPORT_TTL_MS = 30 * DAY_MS;
const FEEDBACK_TTL_MS = 90 * DAY_MS;
const REPORT_CACHE_MAX = 500;
const REPORT_STORE_MAX = 1_000;
const HR_ANALYSIS_STORE_MAX = 2_000;
const FEEDBACK_STORE_MAX = 3_000;

interface TimedEntry<T> {
  value: T;
  ownerId: string;
  reportId?: string;
  inputHash?: string;
  expiresAt: number;
}

const reportCache = new Map<string, TimedEntry<RiskReport>>();
const reportStore = new Map<string, TimedEntry<RiskReport>>();
const hrAnalysisStore = new Map<string, TimedEntry<HrAnalysis>>();
const interviewFeedbackStore = new Map<string, TimedEntry<InterviewFeedbackRequest>>();
const reportFeedbackStore = new Map<string, TimedEntry<ReportFeedbackRequest>>();

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function buildErrorResponse(
  error: string,
  message: string,
  details?: { field: string; issue: string }[],
  captchaProvider?: string,
  retryAfter?: string
): ApiError {
  const response: ApiError = { error, message };
  if (details) response.details = details;
  if (captchaProvider) response.captcha_provider = captchaProvider;
  if (retryAfter) response.retry_after = retryAfter;
  return response;
}

function hasValidBearerToken(request: FastifyRequest, environmentVariable: 'MONITORING_TOKEN' | 'BACKUP_TOKEN'): boolean {
  const expected = process.env[environmentVariable]?.trim();
  const authorization = request.headers.authorization;
  if (!expected || !authorization?.startsWith('Bearer ')) return false;
  const received = authorization.slice('Bearer '.length).trim();
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function omitIpAddresses<T extends { ip_address: string | null }>(records: T[]): Omit<T, 'ip_address'>[] {
  return records.map(({ ip_address: _ipAddress, ...record }) => record);
}

function logInternalFailure(request: FastifyRequest, operation: string, error: unknown): void {
  request.log.error({
    operation,
    error_name: error instanceof Error ? error.name : 'UnknownError',
  }, `${operation} failed`);
}

function requireVisitorId(request: FastifyRequest, reply: FastifyReply): string | null {
  const raw = request.headers['x-visitor-id'];
  const parsed = VisitorIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) {
    void reply.status(400).send(buildErrorResponse(
      'INVALID_VISITOR_ID',
      '缺少有效的匿名访问标识。'
    ));
    return null;
  }
  return parsed.data;
}

class AiBusyError extends Error {
  constructor() {
    super('AI concurrency limit reached');
    this.name = 'AiBusyError';
  }
}

function setQuotaHeaders(reply: FastifyReply, remaining: number, resetAt: string): void {
  reply.headers({
    'x-joblens-quota-remaining': String(Math.max(0, remaining)),
    'x-joblens-quota-reset-at': resetAt,
  });
}

async function runControlledTextAnalysis(params: {
  visitorId: string;
  ip: string;
  run: () => Promise<LlmProviderResult>;
  fallback: () => Promise<LlmProviderResult>;
}): Promise<{ result: LlmProviderResult; source: 'model' | 'fallback'; remaining: number; resetAt: string; fallbackReason?: AiQuotaDenialReason }> {
  if (llmProvider.name === 'rule-based') {
    const quota = await getAiQuotaSnapshot(params.visitorId);
    return {
      result: await params.fallback(),
      source: 'fallback',
      remaining: quota.analysis.remaining,
      resetAt: quota.resetAt,
      fallbackReason: 'AI_DISABLED',
    };
  }
  const quota = await reserveAiQuota({ visitorId: params.visitorId, ip: params.ip, operation: 'analysis' });
  if (!quota.allowed) {
    return {
      result: await params.fallback(),
      source: 'fallback',
      remaining: quota.remaining,
      resetAt: quota.resetAt,
      fallbackReason: quota.reason,
    };
  }

  const lease = await acquireAiConcurrency('analysis');
  if (!lease) {
    await refundAiQuota(quota.reservation);
    throw new AiBusyError();
  }

  try {
    const result = await params.run();
    const source = result.provider.startsWith('fallback(') ? 'fallback' : 'model';
    return { result, source, remaining: quota.reservation.remaining, resetAt: quota.reservation.resetAt };
  } finally {
    await releaseAiConcurrency(lease);
  }
}

function aiQuotaErrorResponse(reason: AiQuotaDenialReason): { status: 429 | 503; message: string } {
  if (reason === 'USER_AI_QUOTA_EXCEEDED') return { status: 429, message: '今日 AI 使用次数已用完，请明日再试。' };
  if (reason === 'IP_AI_QUOTA_EXCEEDED') return { status: 429, message: '当前网络今日 AI 使用次数较多，请明日再试。' };
  if (reason === 'GLOBAL_AI_BUDGET_EXHAUSTED' || reason === 'AI_DISABLED') {
    return { status: 503, message: '今日 AI 服务额度已用完，请手动填写或明日再试。' };
  }
  return { status: 503, message: 'AI 费用控制服务暂时不可用，请稍后重试。' };
}

function setBoundedEntry<T>(
  store: Map<string, TimedEntry<T>>,
  key: string,
  entry: TimedEntry<T>,
  maxSize: number
): void {
  const now = Date.now();
  for (const [existingKey, existing] of store) {
    if (existing.expiresAt <= now) store.delete(existingKey);
  }
  if (store.has(key)) store.delete(key);
  while (store.size >= maxSize) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
  store.set(key, entry);
}

function getLiveEntry<T>(store: Map<string, TimedEntry<T>>, key: string): TimedEntry<T> | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
}

function calculateInputHash(
  input: {
    source_platform?: string;
    company_name?: string;
    job_title?: string;
    jd_text: string;
    hr_chat_text?: string;
    language?: 'zh-CN' | 'en-US';
  },
  ownerId: string
): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    owner_id: ownerId,
    source_platform: input.source_platform || '',
    company_name: input.company_name || '',
    job_title: input.job_title || '',
    jd_text: input.jd_text,
    hr_chat_text: input.hr_chat_text || '',
    language: input.language || 'zh-CN',
  })).digest('hex');
}

const englishReportText = new Map<string, string>([
  ['培训贷', 'a training loan'],
  ['贷款分期', 'loan installments'],
  ['扣身份证', 'retaining an identity card'],
  ['扣毕业证', 'retaining a diploma'],
  ['押金', 'a deposit'],
  ['保证金', 'a security deposit'],
  ['先交费', 'an upfront fee'],
  ['固定无责底薪', 'Guaranteed base salary without performance conditions'],
  ['劳动合同主体', 'Legal entity named in the employment contract'],
  ['社保缴纳主体', 'Legal entity responsible for social insurance'],
  ['是否有个人销售指标', 'Whether individual sales targets apply'],
  ['岗位信息不足，暂不作明确风险判断。', 'There is not enough job information to make a clear risk assessment.'],
  ['当前输入信息不足以生成明确风险结论。', 'The current input is insufficient to support a clear risk conclusion.'],
  ['信息不足以判断，建议补充岗位详情或 HR 聊天记录后重新检测。', 'There is not enough information to assess the role. Add job details or the HR conversation and run the check again.'],
  ['岗位信息不足，建议补充职责、薪资构成、公司主体和 HR 回复后重新检测。', 'Add responsibilities, compensation details, the employing entity, and the HR response before running the check again.'],
  ['建议先电话确认核心问题，不建议直接线下面试。', 'Confirm the key issues by phone before attending an in-person interview.'],
  ['该岗位风险较低，建议正常面试。', 'The role appears lower risk based on the available information; proceed with the normal interview process.'],
  ['管理岗包装销售岗', 'Sales role presented as management'],
  ['薪资不透明', 'Unclear compensation'],
  ['涉及贷款', 'Loan-related risk'],
  ['扣留证件风险', 'Document retention risk'],
  ['涉及收费', 'Fees required'],
  ['无薪试岗', 'Unpaid trial work'],
  ['拉亲友资源', 'Pressure to recruit personal contacts'],
  ['岗位职责与薪资不匹配', 'Responsibilities and compensation do not align'],
  ['疑似业务性质需确认', 'Business nature requires confirmation'],
  ['销售岗', 'Sales role'],
  ['销售/客户开发岗', 'Sales or business development role'],
  ['培训贷风险', 'Training-loan risk'],
  ['养老业务相关岗（需核实具体职责）', 'Pension-related role (specific responsibilities require confirmation)'],
  ['未明确说明薪资构成和销售指标', 'The compensation structure and sales targets are not stated clearly.'],
  ['未明确说明底薪和提成构成', 'The base salary and commission structure are not stated clearly.'],
  ['JD中提到培训费用，可能涉及培训贷', 'The posting mentions training fees, which may involve a training loan.'],
  ['JD中提到押金或保证金', 'The posting mentions a deposit or security payment.'],
  ['岗位名称为事业部辅助管理，但职责仅描述笼统的表单和日常管理流程', 'The title suggests business-unit management support, but the duties only describe vague form handling and routine processes.'],
  ['标注较高薪资与16薪，但要求大专及1-3年经验，未说明固定薪资和业务边界', 'The posting advertises high compensation and 16 salary payments with a low experience threshold, but does not define fixed pay or business boundaries.'],
  ['是否涉及保险或金融产品销售、客户开发、代理人招募', 'Whether the role involves insurance or financial-product sales, customer acquisition, or agent recruitment'],
  ['固定无责底薪、提成规则与个人业绩指标', 'Guaranteed base salary, commission rules, and individual performance targets'],
  ['招聘公司名称、劳动合同主体与社保缴纳主体', 'Recruiting company, employment-contract entity, and social-insurance entity'],
  ['该岗位是否需要销售保险或金融产品、开发客户或招募代理人？请明确写入 offer。', 'Does this role require selling insurance or financial products, acquiring customers, or recruiting agents? Please state this explicitly in the offer.'],
  ['30-60K 和 16 薪中，固定无责底薪、提成及个人业绩指标分别是多少？', 'For the advertised 30-60K compensation and 16 salary payments, what are the guaranteed base salary, commission, and individual performance targets?'],
  ['请提供招聘公司全称、劳动合同主体和社保缴纳主体。', 'Please provide the recruiting company name, employment-contract entity, and social-insurance entity.'],
  ['岗位的薪资、职责与业务边界信息不匹配。建议先书面确认是否涉及保险/金融产品销售、客户开发或代理人招募，以及固定无责底薪和合同主体，再决定是否面试。', 'The compensation, responsibilities, and business boundaries do not align. Before interviewing, obtain written confirmation about product sales, customer acquisition, agent recruitment, guaranteed base salary, and the contracting entity.'],
]);

export function localizeReportText(text: string): string {
  const exact = englishReportText.get(text);
  if (exact) return exact;
  const missingQuestion = text.match(/^(.+)是多少？是否可以提供书面说明？$/);
  if (missingQuestion) return `What is ${localizeReportText(missingQuestion[1])}? Can you provide it in writing?`;
  if (text.startsWith('岗位涉及')) return `The posting mentions "${text.slice(4)}".`;
  const explicitLoanEvidence = text.match(/^岗位文本明确提到(.+)，需要求职者承担相关费用。$/);
  if (explicitLoanEvidence) return `The posting explicitly mentions ${localizeReportText(explicitLoanEvidence[1])} and requires the candidate to bear related costs.`;
  const documentRetentionEvidence = text.match(/^岗位文本明确提到(.+)，存在证件原件被留存的风险。$/);
  if (documentRetentionEvidence) return `The posting explicitly mentions ${localizeReportText(documentRetentionEvidence[1])}, indicating that original identity or qualification documents may be retained.`;
  const upfrontFeeEvidence = text.match(/^岗位文本明确提到(.+)，入职前需要核实收费依据。$/);
  if (upfrontFeeEvidence) return `The posting explicitly mentions ${localizeReportText(upfrontFeeEvidence[1])}; verify the basis for any charge before accepting the role.`;
  const verificationEvidence = text.match(/^岗位文本明确提到(.+)，需要在接受岗位前核实具体安排。$/);
  if (verificationEvidence) return `The posting explicitly mentions ${localizeReportText(verificationEvidence[1])}; verify the exact arrangement before accepting the role.`;
  if (text.startsWith('岗位包含') && text.endsWith('等销售职责')) {
    return `The role includes sales duties such as ${text.slice(4, -5)}.`;
  }
  return text;
}

function localizeReportForResponse(report: RiskReport, language?: 'zh-CN' | 'en-US'): RiskReport {
  if (language !== 'en-US') return report;
  return {
    ...report,
    predicted_role: report.predicted_role ? localizeReportText(report.predicted_role) : null,
    risk_types: report.risk_types.map(localizeReportText),
    evidence: report.evidence.map(localizeReportText),
    missing_info: report.missing_info.map(localizeReportText),
    questions: report.questions.map(localizeReportText),
    recommendation: localizeReportText(report.recommendation),
    disclaimer: 'This result is for job-search decision support only and does not constitute legal advice.',
  };
}

function calculateWriteHash(ownerId: string, apiPath: string, body: unknown): string {
  const protectedBody = body && typeof body === 'object'
    ? { ...(body as Record<string, unknown>), captcha_token: undefined }
    : body;
  return crypto.createHash('sha256').update(JSON.stringify({ ownerId, apiPath, body: protectedBody })).digest('hex');
}

function reportHashCacheKey(hash: string): string {
  return `${REPORT_CACHE_NAMESPACE}:hash:${hash}`;
}

function reportIdCacheKey(reportId: string): string {
  return `${REPORT_CACHE_NAMESPACE}:id:${reportId}`;
}

async function getReportCache(hash: string, ownerId: string): Promise<RiskReport | null> {
  if (isRedisAvailable()) {
    try {
      const cached = await redis.get(reportHashCacheKey(hash));
      if (cached) return JSON.parse(cached) as RiskReport;
    } catch {
      // Redis reconnects in the background; bounded memory remains available.
    }
  }
  const entry = getLiveEntry(reportCache, hash);
  return entry?.ownerId === ownerId ? entry.value : null;
}

async function setReportCache(hash: string, report: RiskReport, ownerId: string): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await redis.multi()
        .set(reportHashCacheKey(hash), JSON.stringify(report), 'PX', REPORT_CACHE_TTL_MS)
        .set(reportIdCacheKey(report.report_id), hash, 'PX', REPORT_CACHE_TTL_MS)
        .exec();
    } catch {
      // Keep the bounded in-process copy below as a fallback.
    }
  }
  setBoundedEntry(reportCache, hash, {
    value: report,
    ownerId,
    inputHash: hash,
    expiresAt: Date.now() + REPORT_CACHE_TTL_MS,
  }, REPORT_CACHE_MAX);
}

async function deleteReportCache(hash?: string, reportId?: string): Promise<void> {
  let resolvedHash = hash;
  if (!resolvedHash && reportId && isRedisAvailable()) {
    try {
      resolvedHash = (await redis.get(reportIdCacheKey(reportId))) || undefined;
    } catch {
      // Continue with local cleanup.
    }
  }
  if (isRedisAvailable()) {
    try {
      const keys = [
        ...(resolvedHash ? [reportHashCacheKey(resolvedHash)] : []),
        ...(reportId ? [reportIdCacheKey(reportId)] : []),
      ];
      if (keys.length > 0) await redis.del(...keys);
    } catch {
      // Redis entries expire automatically if cleanup is temporarily unavailable.
    }
  }
  if (resolvedHash) reportCache.delete(resolvedHash);
}

function storeReport(report: RiskReport, ownerId: string, inputHash: string): void {
  setBoundedEntry(reportStore, report.report_id, {
    value: report,
    ownerId,
    inputHash,
    expiresAt: Date.now() + REPORT_TTL_MS,
  }, REPORT_STORE_MAX);
}

async function deleteMemoryReport(reportId: string, ownerId?: string, inputHash?: string): Promise<void> {
  const reportEntry = reportStore.get(reportId);
  if (!ownerId || !reportEntry || reportEntry.ownerId === ownerId) {
    reportStore.delete(reportId);
    await deleteReportCache(inputHash || reportEntry?.inputHash, reportId);
  }
  for (const [id, entry] of hrAnalysisStore) {
    if (entry.reportId === reportId && (!ownerId || entry.ownerId === ownerId)) hrAnalysisStore.delete(id);
  }
  for (const [id, entry] of reportFeedbackStore) {
    if (entry.reportId === reportId && (!ownerId || entry.ownerId === ownerId)) reportFeedbackStore.delete(id);
  }
  for (const [id, entry] of interviewFeedbackStore) {
    if (entry.reportId === reportId && (!ownerId || entry.ownerId === ownerId)) interviewFeedbackStore.delete(id);
  }
}

function toRiskReport(report: {
  report_id: string;
  overall_score: number;
  risk_level: string;
  confidence: string;
  predicted_role: string | null;
  risk_types: unknown;
  sub_scores: unknown;
  strong_risk_adjustment: number;
  evidence: unknown;
  missing_info: unknown;
  questions: unknown;
  recommendation: string;
  disclaimer: string;
  provider: string | null;
  created_at: Date;
}): RiskReport {
  return {
    report_id: report.report_id,
    analysis_source: report.provider === 'rule-based' || report.provider?.startsWith('fallback(') ? 'fallback' : 'model',
    overall_score: report.overall_score,
    risk_level: report.risk_level as RiskReport['risk_level'],
    confidence: report.confidence as RiskReport['confidence'],
    predicted_role: report.predicted_role,
    risk_types: report.risk_types as string[],
    sub_scores: JSON.parse(JSON.stringify(report.sub_scores)) as RiskReport['sub_scores'],
    strong_risk_adjustment: report.strong_risk_adjustment,
    evidence: report.evidence as string[],
    missing_info: report.missing_info as string[],
    questions: report.questions as string[],
    recommendation: report.recommendation,
    disclaimer: report.disclaimer,
    created_at: report.created_at.toISOString(),
  };
}

async function findOwnedReport(reportId: string, ownerId: string): Promise<{
  report: RiskReport;
  inputHash: string;
} | null> {
  const memory = getLiveEntry(reportStore, reportId);
  if (memory?.ownerId === ownerId) {
    return { report: memory.value, inputHash: memory.inputHash || '' };
  }
  if (!isDbAvailable()) return null;

  const report = await runDbOperation(() => prisma.jobReport.findFirst({
    where: { report_id: reportId, visitor_id: ownerId, is_deleted: false },
  }));
  if (!report) return null;
  const riskReport = toRiskReport(report);
  storeReport(riskReport, ownerId, report.input_hash);
  return { report: riskReport, inputHash: report.input_hash };
}

interface LogApiRequestParams {
  requestId: string;
  apiPath: string;
  method: string;
  visitorId?: string;
  ip?: string;
  userAgent?: string;
  httpStatus: number;
  errorCode?: string;
  errorMessage?: string;
  aiCalled?: boolean;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costEstimate?: number;
  rateLimited?: boolean;
  captchaRequired?: boolean;
  captchaPassed?: boolean;
}

async function logApiRequest(params: LogApiRequestParams): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    await runDbOperation(() => prisma.apiLog.create({
      data: {
        request_id: params.requestId,
        api_path: params.apiPath,
        method: params.method,
        visitor_id: params.visitorId,
        ip_address: params.ip,
        user_agent: params.userAgent,
        http_status: params.httpStatus,
        error_code: params.errorCode,
        error_message: params.errorMessage,
        ai_called: params.aiCalled || false,
        provider: params.provider,
        model: params.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        latency_ms: params.latencyMs,
        cost_estimate: params.costEstimate,
        rate_limited: params.rateLimited || false,
        captcha_required: params.captchaRequired || false,
        captcha_passed: params.captchaPassed || false,
        request_at: new Date(),
        response_at: new Date(),
      },
    }));
  } catch {
    // Request handling must not fail because audit storage is temporarily unavailable.
  }
}

async function enforceWriteProtection(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  requestId: string;
  visitorId: string;
  apiPath: string;
  operationKey?: string;
  captchaToken?: string;
  inputHash?: string;
}): Promise<boolean> {
  const { request, reply, requestId, visitorId, apiPath, operationKey = apiPath, captchaToken, inputHash } = params;
  await incrementRateLimit(request.ip, visitorId, operationKey, inputHash);
  const result = await checkRateLimit(request.ip, visitorId, operationKey, inputHash);
  if (result.blocked) {
    await logApiRequest({
      requestId, apiPath, method: request.method, visitorId, ip: request.ip,
      httpStatus: 429, errorCode: 'RATE_LIMITED', errorMessage: '请求超过频率限制', rateLimited: true,
    });
    await reply.status(429).send(buildErrorResponse(
      'RATE_LIMITED',
      result.message || '请求过于频繁，请稍后重试。',
      undefined,
      undefined,
      new Date(Date.now() + (result.retryAfter || 3600) * 1000).toISOString()
    ));
    return false;
  }
  if (result.requiresCaptcha) {
    if (!captchaToken) {
      await logApiRequest({
        requestId, apiPath, method: request.method, visitorId, ip: request.ip,
        httpStatus: 403, errorCode: 'CAPTCHA_REQUIRED', errorMessage: '需要验证码', captchaRequired: true,
      });
      await reply.status(403).send(buildErrorResponse(
        'CAPTCHA_REQUIRED', result.message || '请先完成验证。', undefined, 'turnstile'
      ));
      return false;
    }
    const captcha = await verifyCaptcha(captchaToken, request.ip);
    if (!captcha.success) {
      await logApiRequest({
        requestId, apiPath, method: request.method, visitorId, ip: request.ip,
        httpStatus: 403, errorCode: 'CAPTCHA_FAILED', errorMessage: '验证码校验失败', captchaRequired: true,
      });
      await reply.status(403).send(buildErrorResponse(
        'CAPTCHA_FAILED', captcha.reason || '验证码校验失败。'
      ));
      return false;
    }
    await setCaptchaExempt(visitorId);
  }
  return true;
}

async function rejectSensitiveData(params: {
  values: Array<string | undefined>;
  request: FastifyRequest;
  reply: FastifyReply;
  requestId: string;
  visitorId: string;
  apiPath: string;
}): Promise<boolean> {
  if (!containsHighSensitiveData(params.values)) return false;
  await logApiRequest({
    requestId: params.requestId,
    apiPath: params.apiPath,
    method: 'POST',
    visitorId: params.visitorId,
    ip: params.request.ip,
    httpStatus: 400,
    errorCode: 'SENSITIVE_DATA_DETECTED',
    errorMessage: '输入包含高敏个人标识',
  });
  await params.reply.status(400).send(buildErrorResponse(
    'SENSITIVE_DATA_DETECTED',
    '输入中包含身份证号、银行卡号或完整手机号，请删除后重试。'
  ));
  return true;
}

type ScreenshotExtraction = Awaited<ReturnType<typeof extractJobFromScreenshots>>;

class OcrRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: string,
    readonly remaining?: number,
    readonly resetAt?: string,
  ) {
    super(message);
    this.name = 'OcrRequestError';
  }
}

async function runOcrPipeline(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  requestId: string;
  visitorId: string;
  apiPath: string;
  input: OcrInput;
}): Promise<void> {
  const { request, reply, requestId, visitorId, apiPath, input } = params;
  const hashes = imageHashes(input.images);
  const language = input.language ?? 'zh-CN';
  const writeHash = calculateOcrWriteHash(visitorId, hashes, language);
  if (!await enforceWriteProtection({
    request,
    reply,
    requestId,
    visitorId,
    apiPath,
    operationKey: OCR_OPERATION_KEY,
    captchaToken: input.captchaToken,
    inputHash: writeHash,
  })) return;

  const cacheKey = calculateOcrCacheKey(visitorId, hashes, language);
  const cached = await getCachedScreenshotExtraction(cacheKey);
  if (cached) {
    if (!isScreenshotExtractionSafeToCache(cached.result)) {
      await deleteCachedScreenshotExtraction(cacheKey);
      throw new OcrRequestError(400, 'SENSITIVE_DATA_DETECTED', '截图识别结果包含身份证号、银行卡号或完整手机号，请打码后重新上传。');
    }
    const quota = await getAiQuotaSnapshot(visitorId);
    reply.headers({
      'x-joblens-analysis-source': 'cache',
      'x-joblens-ai-provider': cached.provider,
      'x-joblens-ai-model': cached.model,
    });
    setQuotaHeaders(reply, quota.ocr.remaining, quota.resetAt);
    await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, userAgent: request.headers['user-agent'], httpStatus: 200, aiCalled: false, provider: cached.provider, model: cached.model });
    await reply.send(cached.result);
    return;
  }

  const flight = await runOcrSingleflight(cacheKey, async () => {
    const quota = await reserveAiQuota({ visitorId, ip: request.ip, operation: 'ocr' });
    if (!quota.allowed) {
      const response = aiQuotaErrorResponse(quota.reason);
      throw new OcrRequestError(
        response.status,
        quota.reason,
        response.message,
        new Date(Date.now() + quota.retryAfter * 1_000).toISOString(),
        quota.remaining,
        quota.resetAt,
      );
    }

    const lease = await acquireAiConcurrency('ocr');
    if (!lease) {
      await refundAiQuota(quota.reservation);
      throw new OcrRequestError(429, 'AI_BUSY', '当前使用人数较多，请 10 秒后重试。', new Date(Date.now() + 10_000).toISOString());
    }

    try {
      let providerImages = input.images.map(toProviderDataUrl);
      let extraction: ScreenshotExtraction;
      try {
        extraction = await extractJobFromScreenshots(providerImages, input.language);
      } finally {
        providerImages = [];
      }
      if (!isScreenshotExtractionSafeToCache(extraction.result)) {
        throw new OcrRequestError(400, 'SENSITIVE_DATA_DETECTED', '截图识别结果包含身份证号、银行卡号或完整手机号，请打码后重新上传。');
      }
      await setCachedScreenshotExtraction(cacheKey, {
        result: extraction.result,
        model: extraction.model,
        provider: extraction.provider,
        createdAt: new Date().toISOString(),
      });
      return {
        extraction,
        remaining: quota.reservation.remaining,
        resetAt: quota.reservation.resetAt,
      };
    } catch (error) {
      if (error instanceof LlmConfigurationError) await refundAiQuota(quota.reservation);
      throw error;
    } finally {
      await releaseAiConcurrency(lease);
    }
  });

  const { extraction } = flight.value;
  let remaining = flight.value.remaining;
  let resetAt = flight.value.resetAt;
  if (!flight.leader) {
    const quota = await getAiQuotaSnapshot(visitorId);
    remaining = quota.ocr.remaining;
    resetAt = quota.resetAt;
  }
  reply.headers({
    'x-joblens-analysis-source': flight.leader ? 'model' : 'cache',
    'x-joblens-ai-provider': extraction.provider,
    'x-joblens-ai-model': extraction.model,
    'x-joblens-ai-latency-ms': String(extraction.latencyMs),
  });
  setQuotaHeaders(reply, remaining, resetAt);
  await logApiRequest({
    requestId,
    apiPath,
    method: 'POST',
    visitorId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    httpStatus: 200,
    aiCalled: flight.leader,
    provider: extraction.provider,
    model: extraction.model,
    latencyMs: extraction.latencyMs,
  });
  await reply.send(extraction.result);
}

async function handleOcrFailure(params: {
  error: unknown;
  request: FastifyRequest;
  reply: FastifyReply;
  requestId: string;
  visitorId: string;
  apiPath: string;
}): Promise<void> {
  const { error, request, reply, requestId, visitorId, apiPath } = params;
  if (error instanceof OcrUploadError) {
    await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: error.statusCode, errorCode: error.code, errorMessage: error.code });
    await reply.status(error.statusCode).send(buildErrorResponse(error.code, error.message));
    return;
  }
  if (error instanceof OcrRequestError) {
    if (error.remaining !== undefined && error.resetAt) setQuotaHeaders(reply, error.remaining, error.resetAt);
    await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: error.statusCode, errorCode: error.code, errorMessage: error.code, rateLimited: error.statusCode === 429 });
    await reply.status(error.statusCode).send(buildErrorResponse(error.code, error.message, undefined, undefined, error.retryAfter));
    return;
  }

  const timedOut = error instanceof ScreenshotExtractionTimeoutError;
  const noJobInformation = error instanceof ScreenshotNoJobInformationError;
  const httpStatus = timedOut ? 504 : noJobInformation ? 422 : 502;
  const errorCode = timedOut ? 'OCR_TIMEOUT' : noJobInformation ? 'NO_JOB_INFORMATION' : 'OCR_UNAVAILABLE';
  const errorMessage = timedOut ? '截图识别超时' : noJobInformation ? '截图中未找到招聘信息' : '截图识别服务暂时不可用';
  await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus, errorCode, errorMessage });
  if (!noJobInformation) logInternalFailure(request, 'screenshot_extraction', error);
  await reply.status(httpStatus).send(buildErrorResponse(errorCode, timedOut
    ? '截图识别超时，请重试或手动填写。'
    : noJobInformation
      ? '截图中未识别到可用的招聘信息，请上传包含岗位职责或任职要求的截图。'
      : '截图识别服务暂时不可用，请稍后重试或手动填写。'));
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      files: MAX_FILES,
      fileSize: MAX_FILE_BYTES,
      fields: MAX_FIELDS,
      parts: MAX_PARTS,
      fieldNameSize: MAX_FIELD_NAME_BYTES,
      fieldSize: MAX_FIELD_BYTES,
      headerPairs: MAX_HEADER_PAIRS,
    },
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' && request.method !== 'DELETE') return;
    const production = process.env.NODE_ENV === 'production';
    const databaseRequired = process.env.REQUIRE_DATABASE
      ? process.env.REQUIRE_DATABASE === 'true'
      : production;
    const redisRequired = process.env.REQUIRE_REDIS
      ? process.env.REQUIRE_REDIS === 'true'
      : production;
    const pathname = request.url.split('?')[0];
    const aiRouteCanFailClosed = pathname === '/api/reports/detect'
      || pathname === '/api/ocr/extract-job'
      || pathname === '/api/ocr/extract-job-v2'
      || pathname === '/api/hr-analysis'
      || /^\/api\/reports\/[^/]+\/hr-analysis$/.test(pathname);
    if ((databaseRequired && !isDbAvailable()) || (redisRequired && !isRedisAvailable() && !aiRouteCanFailClosed)) {
      return reply.status(503).send(buildErrorResponse(
        'DEPENDENCY_UNAVAILABLE',
        '服务依赖暂时不可用，请稍后重试。'
      ));
    }
  });

  await registerAdminRoutes(app);

  app.get('/api/internal/metrics', async (request, reply) => {
    if (!hasValidBearerToken(request, 'MONITORING_TOKEN')) {
      return reply.status(401).send(buildErrorResponse('UNAUTHORIZED', '未授权访问。'));
    }
    const rawWindow = (request.query as { window_minutes?: string }).window_minutes;
    const parsedWindow = rawWindow && /^\d+$/.test(rawWindow) ? Number(rawWindow) : undefined;
    const metrics = await getOperationalMetrics(parsedWindow);
    return reply.status(metrics.available ? 200 : 503).send(metrics);
  });

  app.get('/api/internal/backup', async (request, reply) => {
    if (!hasValidBearerToken(request, 'BACKUP_TOKEN')) {
      return reply.status(401).send(buildErrorResponse('UNAUTHORIZED', '未授权访问。'));
    }
    if (!isDbAvailable()) {
      return reply.status(503).send(buildErrorResponse('DEPENDENCY_UNAVAILABLE', '数据库暂时不可用。'));
    }

    try {
      const [jobReports, hrAnalyses, interviewFeedbacks, reportFeedbacks] = await runDbOperation(() =>
        prisma.$transaction([
          prisma.jobReport.findMany({ where: { is_deleted: false }, orderBy: { id: 'asc' } }),
          prisma.hrAnalysis.findMany({ where: { is_deleted: false }, orderBy: { id: 'asc' } }),
          prisma.interviewFeedback.findMany({ where: { is_deleted: false }, orderBy: { id: 'asc' } }),
          prisma.reportFeedback.findMany({ where: { is_deleted: false }, orderBy: { id: 'asc' } }),
        ])
      );
      const backupJobReports = omitIpAddresses(jobReports);
      const backupHrAnalyses = omitIpAddresses(hrAnalyses);
      const backupInterviewFeedbacks = omitIpAddresses(interviewFeedbacks);
      const backupReportFeedbacks = omitIpAddresses(reportFeedbacks);
      return reply.send({
        schema_version: 'joblens-backup-v1',
        generated_at: new Date().toISOString(),
        counts: {
          job_reports: backupJobReports.length,
          hr_analyses: backupHrAnalyses.length,
          interview_feedbacks: backupInterviewFeedbacks.length,
          report_feedbacks: backupReportFeedbacks.length,
        },
        data: {
          job_reports: backupJobReports,
          hr_analyses: backupHrAnalyses,
          interview_feedbacks: backupInterviewFeedbacks,
          report_feedbacks: backupReportFeedbacks,
        },
      });
    } catch (error) {
      logInternalFailure(request, 'create backup snapshot', error);
      return reply.status(503).send(buildErrorResponse('BACKUP_UNAVAILABLE', '备份快照暂时不可用。'));
    }
  });

  app.post('/api/client-errors', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const parsed = ClientErrorReportSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '错误报告格式无效。'));
    const inputHash = calculateWriteHash(visitorId, '/api/client-errors', {
      kind: parsed.data.kind,
      source: parsed.data.source,
      path: parsed.data.path,
    });
    const requestId = generateId('req');
    if (!await enforceWriteProtection({
      request,
      reply,
      requestId,
      visitorId,
      apiPath: '/api/client-errors',
      inputHash,
    })) return;
    await recordFrontendError();
    request.log.warn({
      event: 'client_error',
      kind: parsed.data.kind,
      path: parsed.data.path,
      source: parsed.data.source,
      message: containsHighSensitiveData([parsed.data.message]) ? '[redacted]' : parsed.data.message,
      line: parsed.data.line,
      column: parsed.data.column,
    }, 'frontend error reported');
    return reply.status(202).send({ status: 'accepted' });
  });

  app.get('/api/ai-quota', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    return reply.send(await getAiQuotaSnapshot(visitorId));
  });

  app.post('/api/reports/detect', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/reports/detect';
    const parsed = DetectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
      return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误', parsed.error.errors.map(error => ({ field: error.path.join('.'), issue: error.message }))));
    }
    if (await rejectSensitiveData({
      values: [
        parsed.data.source_platform,
        parsed.data.company_name,
        parsed.data.job_title,
        parsed.data.jd_text,
        parsed.data.hr_chat_text,
      ],
      request, reply, requestId, visitorId, apiPath,
    })) return;
    const totalLength = parsed.data.jd_text.length + (parsed.data.hr_chat_text?.length || 0);
    if (totalLength > 12_000) return reply.status(413).send(buildErrorResponse('PAYLOAD_TOO_LARGE', '文本总长度超过限制，请删减内容后重试。'));

    const inputHash = calculateInputHash(parsed.data, visitorId);
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;
    const cached = await getReportCache(inputHash, visitorId);
    if (cached) {
      const quota = await getAiQuotaSnapshot(visitorId);
      storeReport(cached, visitorId, inputHash);
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 200, aiCalled: false });
      reply.header('x-joblens-analysis-source', 'cache');
      setQuotaHeaders(reply, quota.analysis.remaining, quota.resetAt);
      return reply.send(localizeReportForResponse(cached, parsed.data.language));
    }

    try {
      const startedAt = Date.now();
      const controlled = await runControlledTextAnalysis({
        visitorId,
        ip: request.ip,
        run: () => llmProvider.analyzeJobRisk(parsed.data),
        fallback: () => ruleProvider.analyzeJobRisk(parsed.data),
      });
      const llmResult = controlled.result;
      const report = llmResult.parsedJson as RiskReport;
      report.report_id = generateId('rep');
      report.created_at = new Date().toISOString();
      const now = new Date();
      const source = controlled.source;
      report.analysis_source = source;

      reply.headers({
        'x-joblens-analysis-source': source,
        'x-joblens-ai-provider': llmResult.provider,
        'x-joblens-ai-model': llmResult.model,
        'x-joblens-ai-latency-ms': String(llmResult.latencyMs),
      });
      setQuotaHeaders(reply, controlled.remaining, controlled.resetAt);

      if (isDbAvailable()) {
        await runDbOperation(() => prisma.jobReport.create({
          data: {
            report_id: report.report_id,
            source_platform: parsed.data.source_platform,
            company_name: parsed.data.company_name,
            job_title: parsed.data.job_title,
            jd_text: parsed.data.jd_text,
            hr_chat_text: parsed.data.hr_chat_text,
            input_hash: inputHash,
            visitor_id: visitorId,
            ip_address: request.ip,
            overall_score: report.overall_score,
            risk_level: report.risk_level,
            confidence: report.confidence,
            predicted_role: report.predicted_role,
            risk_types: report.risk_types,
            sub_scores: JSON.parse(JSON.stringify(report.sub_scores)),
            strong_risk_adjustment: report.strong_risk_adjustment,
            evidence: report.evidence,
            missing_info: report.missing_info,
            questions: report.questions,
            recommendation: report.recommendation,
            disclaimer: report.disclaimer,
            analysis_status: 'completed',
            provider: llmResult.provider,
            model: llmResult.model,
            latency_ms: Date.now() - startedAt,
            input_tokens: llmResult.inputTokens,
            output_tokens: llmResult.outputTokens,
            cost_estimate: llmResult.costEstimate,
            source_retention_until: new Date(now.getTime() + 7 * DAY_MS),
            retention_until: new Date(now.getTime() + REPORT_TTL_MS),
          },
        }));
      }
      await setReportCache(inputHash, report, visitorId);
      storeReport(report, visitorId, inputHash);
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, userAgent: request.headers['user-agent'], httpStatus: 200, aiCalled: source === 'model', provider: llmResult.provider, model: llmResult.model });
      return reply.send(localizeReportForResponse(report, parsed.data.language));
    } catch (error) {
      if (error instanceof AiBusyError) {
        return reply.status(429).send(buildErrorResponse(
          'AI_BUSY',
          '当前使用人数较多，请 10 秒后重试。',
          undefined,
          undefined,
          new Date(Date.now() + 10_000).toISOString(),
        ));
      }
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: '报告生成失败' });
      logInternalFailure(request, 'report_generation', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.get('/api/capabilities', async (_request, reply) => {
    const configured = process.env.OCR_UPLOAD_MODE?.trim();
    const preferredMode = configured === 'multipart-v2' ? 'multipart-v2' : 'json-v1';
    reply.header('cache-control', 'no-store');
    return reply.send({ preferred_ocr_upload_mode: preferredMode });
  });

  app.post('/api/ocr/extract-job', { bodyLimit: 8_500_000 }, async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/ocr/extract-job';
    const parsed = ScreenshotExtractRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '截图参数格式错误' });
      return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '截图参数格式错误', parsed.error.errors.map(error => ({ field: error.path.join('.'), issue: error.message }))));
    }
    try {
      const images = decodeV1Images(parsed.data.images);
      await validateOcrImages(images);
      await runOcrPipeline({
        request,
        reply,
        requestId,
        visitorId,
        apiPath,
        input: {
          images,
          language: parsed.data.language,
          captchaToken: parsed.data.captcha_token,
        },
      });
    } catch (error) {
      await handleOcrFailure({ error, request, reply, requestId, visitorId, apiPath });
    }
  });

  app.post('/api/ocr/extract-job-v2', {
    bodyLimit: MAX_MULTIPART_BODY_BYTES,
  }, async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/ocr/extract-job-v2';
    try {
      const contentLength = request.headers['content-length'];
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_MULTIPART_BODY_BYTES) {
        throw new OcrUploadError('OCR_MULTIPART_BODY_TOO_LARGE');
      }
      const input = await parseOcrMultipart(request, app);
      await runOcrPipeline({ request, reply, requestId, visitorId, apiPath, input });
    } catch (error) {
      await handleOcrFailure({ error, request, reply, requestId, visitorId, apiPath });
    }
  });

  app.get('/api/reports/:id', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const reportId = (request.params as { id: string }).id;
    const language = (request.query as { language?: string }).language;
    if (language !== undefined && language !== 'zh-CN' && language !== 'en-US') {
      return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '不支持的语言。'));
    }
    try {
      const owned = await findOwnedReport(reportId, visitorId);
      if (!owned) return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
      return reply.send(localizeReportForResponse(owned.report, language));
    } catch (error) {
      logInternalFailure(request, 'report_lookup', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.delete('/api/reports/:id', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const reportId = (request.params as { id: string }).id;
    const requestId = generateId('req');
    const apiPath = '/api/reports/:id';
    const deleteRequest = CaptchaRequestSchema.safeParse(request.body || {});
    if (!deleteRequest.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
    const inputHash = calculateWriteHash(visitorId, apiPath, { reportId });
    if (!await enforceWriteProtection({
      request, reply, requestId, visitorId, apiPath,
      captchaToken: deleteRequest.data.captcha_token,
      inputHash,
    })) return;
    const owned = await findOwnedReport(reportId, visitorId);
    if (!owned) return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    const deletedAt = new Date();
    try {
      if (isDbAvailable()) {
        const result = await runDbOperation(() => prisma.$transaction(async tx => {
          const report = await tx.jobReport.updateMany({
            where: { report_id: reportId, visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          if (report.count !== 1) return false;
          await tx.hrAnalysis.updateMany({
            where: { report_id: reportId, visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          await tx.reportFeedback.updateMany({
            where: { report_id: reportId, visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          await tx.interviewFeedback.updateMany({
            where: { report_id: reportId, visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          return true;
        }));
        if (!result) return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
      }
      await deleteMemoryReport(reportId, visitorId, owned.inputHash);
      return reply.send({ status: 'deleted', message: '该报告及相关数据已删除。', deleted_at: deletedAt.toISOString() });
    } catch (error) {
      logInternalFailure(request, 'report_deletion', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '删除失败，请稍后重试。'));
    }
  });

  app.post('/api/reports/:id/hr-analysis', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const reportId = (request.params as { id: string }).id;
    const requestId = generateId('req');
    const apiPath = '/api/reports/:id/hr-analysis';
    const parsed = HrAnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
    const owned = await findOwnedReport(reportId, visitorId);
    if (!owned) return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    if (await rejectSensitiveData({ values: [parsed.data.user_question, parsed.data.hr_reply, parsed.data.jd_context], request, reply, requestId, visitorId, apiPath })) return;
    const inputHash = calculateWriteHash(visitorId, apiPath, parsed.data);
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;

    try {
      const input = { ...parsed.data, report_id: reportId };
      const controlled = await runControlledTextAnalysis({
        visitorId,
        ip: request.ip,
        run: () => llmProvider.analyzeHrReply(input),
        fallback: () => ruleProvider.analyzeHrReply(input),
      });
      const llmResult = controlled.result;
      const analysis = llmResult.parsedJson as HrAnalysis;
      analysis.hr_analysis_id = generateId('hra');
      analysis.report_id = reportId;
      analysis.created_at = new Date().toISOString();
      if (isDbAvailable()) {
        await runDbOperation(() => prisma.hrAnalysis.create({ data: {
          hr_analysis_id: analysis.hr_analysis_id,
          report_id: reportId,
          user_question: parsed.data.user_question,
          hr_reply: parsed.data.hr_reply,
          jd_context: parsed.data.jd_context,
          visitor_id: visitorId,
          ip_address: request.ip,
          avoidance_score: analysis.avoidance_score,
          risk_level: analysis.risk_level,
          analysis: analysis.analysis,
          next_questions: analysis.next_questions,
          analysis_status: 'completed',
          provider: llmResult.provider,
          model: llmResult.model,
          retention_until: new Date(Date.now() + REPORT_TTL_MS),
        } }));
      }
      setBoundedEntry(hrAnalysisStore, analysis.hr_analysis_id, { value: analysis, ownerId: visitorId, reportId, expiresAt: Date.now() + REPORT_TTL_MS }, HR_ANALYSIS_STORE_MAX);
      reply.header('x-joblens-analysis-source', controlled.source);
      setQuotaHeaders(reply, controlled.remaining, controlled.resetAt);
      return reply.send(analysis);
    } catch (error) {
      if (error instanceof AiBusyError) {
        return reply.status(429).send(buildErrorResponse('AI_BUSY', '当前使用人数较多，请 10 秒后重试。', undefined, undefined, new Date(Date.now() + 10_000).toISOString()));
      }
      logInternalFailure(request, 'linked_hr_analysis', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.post('/api/hr-analysis', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/hr-analysis';
    const parsed = HrAnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
    if (parsed.data.report_id && !await findOwnedReport(parsed.data.report_id, visitorId)) {
      return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    }
    if (await rejectSensitiveData({ values: [parsed.data.user_question, parsed.data.hr_reply, parsed.data.jd_context], request, reply, requestId, visitorId, apiPath })) return;
    const inputHash = calculateWriteHash(visitorId, apiPath, parsed.data);
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;

    try {
      const controlled = await runControlledTextAnalysis({
        visitorId,
        ip: request.ip,
        run: () => llmProvider.analyzeHrReply(parsed.data),
        fallback: () => ruleProvider.analyzeHrReply(parsed.data),
      });
      const llmResult = controlled.result;
      const analysis = llmResult.parsedJson as HrAnalysis;
      analysis.hr_analysis_id = generateId('hra');
      analysis.report_id = parsed.data.report_id;
      analysis.created_at = new Date().toISOString();
      if (isDbAvailable()) {
        await runDbOperation(() => prisma.hrAnalysis.create({ data: {
          hr_analysis_id: analysis.hr_analysis_id,
          report_id: parsed.data.report_id,
          user_question: parsed.data.user_question,
          hr_reply: parsed.data.hr_reply,
          jd_context: parsed.data.jd_context,
          visitor_id: visitorId,
          ip_address: request.ip,
          avoidance_score: analysis.avoidance_score,
          risk_level: analysis.risk_level,
          analysis: analysis.analysis,
          next_questions: analysis.next_questions,
          analysis_status: 'completed',
          provider: llmResult.provider,
          model: llmResult.model,
          retention_until: new Date(Date.now() + REPORT_TTL_MS),
        } }));
      }
      setBoundedEntry(hrAnalysisStore, analysis.hr_analysis_id, { value: analysis, ownerId: visitorId, reportId: parsed.data.report_id, expiresAt: Date.now() + REPORT_TTL_MS }, HR_ANALYSIS_STORE_MAX);
      reply.header('x-joblens-analysis-source', controlled.source);
      setQuotaHeaders(reply, controlled.remaining, controlled.resetAt);
      return reply.send(analysis);
    } catch (error) {
      if (error instanceof AiBusyError) {
        return reply.status(429).send(buildErrorResponse('AI_BUSY', '当前使用人数较多，请 10 秒后重试。', undefined, undefined, new Date(Date.now() + 10_000).toISOString()));
      }
      logInternalFailure(request, 'standalone_hr_analysis', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.post('/api/interview-feedbacks', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/interview-feedbacks';
    const parsed = InterviewFeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
    if (parsed.data.report_id && !await findOwnedReport(parsed.data.report_id, visitorId)) {
      return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    }
    if (await rejectSensitiveData({
      values: [
        parsed.data.company_name,
        parsed.data.job_title,
        parsed.data.source_platform,
        parsed.data.jd_claim,
        parsed.data.interview_actual,
      ],
      request, reply, requestId, visitorId, apiPath,
    })) return;
    const inputHash = calculateWriteHash(visitorId, apiPath, parsed.data);
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;
    const feedbackId = generateId('fb');
    try {
      if (isDbAvailable()) {
        await runDbOperation(() => prisma.interviewFeedback.create({ data: {
          feedback_id: feedbackId,
          report_id: parsed.data.report_id,
          company_name: parsed.data.company_name,
          job_title: parsed.data.job_title,
          source_platform: parsed.data.source_platform,
          jd_claim: parsed.data.jd_claim,
          interview_actual: parsed.data.interview_actual,
          involves_sales: parsed.data.involves_sales,
          involves_fee: parsed.data.involves_fee,
          involves_training_loan: parsed.data.involves_training_loan,
          involves_deposit: parsed.data.involves_deposit,
          subject_mismatch: parsed.data.subject_mismatch,
          recommend_to_others: parsed.data.recommend_to_others,
          visitor_id: visitorId,
          ip_address: request.ip,
          retention_until: new Date(Date.now() + FEEDBACK_TTL_MS),
        } }));
      }
      setBoundedEntry(interviewFeedbackStore, feedbackId, { value: parsed.data, ownerId: visitorId, reportId: parsed.data.report_id, expiresAt: Date.now() + FEEDBACK_TTL_MS }, FEEDBACK_STORE_MAX);
      return reply.send({ feedback_id: feedbackId, status: 'submitted', message: '已匿名提交，审核后将用于优化岗位风险判断。', created_at: new Date().toISOString() });
    } catch (error) {
      logInternalFailure(request, 'interview_feedback_submission', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '提交失败，请稍后重试。'));
    }
  });

  app.post('/api/report-feedbacks', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/report-feedbacks';
    const parsed = ReportFeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(buildErrorResponse(
        'VALIDATION_ERROR',
        '反馈内容或类型不符合要求。',
        parsed.error.errors.map(error => ({ field: error.path.join('.'), issue: error.message })),
      ));
    }
    if (!await findOwnedReport(parsed.data.report_id, visitorId)) {
      return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    }
    if (await rejectSensitiveData({ values: [parsed.data.content], request, reply, requestId, visitorId, apiPath })) return;
    const inputHash = calculateWriteHash(visitorId, apiPath, parsed.data);
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;
    const feedbackId = generateId('rfb');
    try {
      if (isDbAvailable()) {
        await runDbOperation(() => prisma.reportFeedback.create({ data: {
          feedback_id: feedbackId,
          report_id: parsed.data.report_id,
          feedback_type: parsed.data.feedback_type,
          content: parsed.data.content,
          visitor_id: visitorId,
          ip_address: request.ip,
          retention_until: new Date(Date.now() + FEEDBACK_TTL_MS),
        } }));
      }
      setBoundedEntry(reportFeedbackStore, feedbackId, { value: parsed.data, ownerId: visitorId, reportId: parsed.data.report_id, expiresAt: Date.now() + FEEDBACK_TTL_MS }, FEEDBACK_STORE_MAX);
      return reply.send({ feedback_id: feedbackId, status: 'submitted', message: '已收到反馈，我们会用于优化模型。', created_at: new Date().toISOString() });
    } catch (error) {
      logInternalFailure(request, 'report_feedback_submission', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '提交失败，请稍后重试。'));
    }
  });

  app.delete('/api/visitor-data', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/visitor-data';
    const deleteRequest = CaptchaRequestSchema.safeParse(request.body || {});
    if (!deleteRequest.success) return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
    if (!await enforceWriteProtection({
      request, reply, requestId, visitorId, apiPath,
      captchaToken: deleteRequest.data.captcha_token,
      inputHash: calculateWriteHash(visitorId, apiPath, {}),
    })) return;
    const deletedAt = new Date();
    const memoryReportIds = [...reportStore.entries()]
      .filter(([, entry]) => entry.ownerId === visitorId)
      .map(([reportId]) => reportId);
    let deleted: VisitorDataDeleteResult['deleted'] = {
      reports: 0,
      hr_analyses: 0,
      interview_feedbacks: 0,
      report_feedbacks: 0,
    };

    try {
      let reportIds = memoryReportIds;
      let reportHashes: Array<{ report_id: string; input_hash: string }> = [];
      if (isDbAvailable()) {
        reportHashes = await runDbOperation(() => prisma.jobReport.findMany({
          where: { visitor_id: visitorId, is_deleted: false },
          select: { report_id: true, input_hash: true },
        }));
        reportIds = [...new Set([...reportIds, ...reportHashes.map(report => report.report_id)])];
        deleted = await runDbOperation(() => prisma.$transaction(async tx => {
          const reports = await tx.jobReport.updateMany({
            where: { visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          const hrAnalyses = await tx.hrAnalysis.updateMany({
            where: {
              is_deleted: false,
              OR: [
                { visitor_id: visitorId },
                ...(reportIds.length > 0 ? [{ report_id: { in: reportIds } }] : []),
              ],
            },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          const interviewFeedbacks = await tx.interviewFeedback.updateMany({
            where: { visitor_id: visitorId, is_deleted: false },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          const reportFeedbacks = await tx.reportFeedback.updateMany({
            where: {
              is_deleted: false,
              OR: [
                { visitor_id: visitorId },
                ...(reportIds.length > 0 ? [{ report_id: { in: reportIds } }] : []),
              ],
            },
            data: { is_deleted: true, deleted_at: deletedAt },
          });
          await tx.apiLog.updateMany({
            where: { visitor_id: visitorId },
            data: { visitor_id: null, ip_address: null, user_agent: null },
          });
          await tx.securityEvent.updateMany({
            where: { visitor_id: visitorId },
            data: { visitor_id: null, ip_address: null, user_agent: null },
          });
          return {
            reports: reports.count,
            hr_analyses: hrAnalyses.count,
            interview_feedbacks: interviewFeedbacks.count,
            report_feedbacks: reportFeedbacks.count,
          };
        }));
      } else {
        deleted.reports = memoryReportIds.length;
        deleted.hr_analyses = [...hrAnalysisStore.values()].filter(entry => entry.ownerId === visitorId).length;
        deleted.interview_feedbacks = [...interviewFeedbackStore.values()].filter(entry => entry.ownerId === visitorId).length;
        deleted.report_feedbacks = [...reportFeedbackStore.values()].filter(entry => entry.ownerId === visitorId).length;
      }

      for (const reportId of reportIds) {
        const hash = reportHashes.find(report => report.report_id === reportId)?.input_hash;
        await deleteMemoryReport(reportId, visitorId, hash);
      }
      for (const [id, entry] of hrAnalysisStore) if (entry.ownerId === visitorId) hrAnalysisStore.delete(id);
      for (const [id, entry] of interviewFeedbackStore) if (entry.ownerId === visitorId) interviewFeedbackStore.delete(id);
      for (const [id, entry] of reportFeedbackStore) if (entry.ownerId === visitorId) reportFeedbackStore.delete(id);

      const response: VisitorDataDeleteResult = {
        status: 'deleted',
        message: '当前匿名访问标识关联的数据已删除。',
        deleted_at: deletedAt.toISOString(),
        deleted,
      };
      return reply.send(response);
    } catch (error) {
      logInternalFailure(request, 'visitor_data_deletion', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '删除失败，请稍后重试。'));
    }
  });

  const stopDataRetentionScheduler = startDataRetentionScheduler(async reportIds => {
    for (const reportId of reportIds) await deleteMemoryReport(reportId);
  });
  app.addHook('onClose', async () => stopDataRetentionScheduler());
}

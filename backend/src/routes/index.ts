import crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ApiError,
  HrAnalysis,
  InterviewFeedbackRequest,
  ReportFeedbackRequest,
  RiskReport,
  VisitorDataDeleteResult,
} from '../types';
import {
  containsHighSensitiveData,
  CaptchaRequestSchema,
  DetectRequestSchema,
  HrAnalysisRequestSchema,
  InterviewFeedbackRequestSchema,
  ReportFeedbackRequestSchema,
  ScreenshotExtractRequestSchema,
  VisitorIdSchema,
} from '../schemas';
import { isDbAvailable, prisma, runDbOperation } from '../db/prisma';
import { isRedisAvailable, redis } from '../db/redis';
import { createLlmProviderWithFallback } from '../services/llm';
import {
  checkRateLimit,
  incrementRateLimit,
  setCaptchaExempt,
  verifyCaptcha,
} from '../services/rateLimit';
import { startDataRetentionScheduler } from '../services/dataRetention';
import { extractJobFromScreenshots } from '../services/screenshotExtraction';

const llmProvider = createLlmProviderWithFallback();
const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_CACHE_TTL_MS = 7 * DAY_MS;
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

function localizeReportForResponse(report: RiskReport, language?: 'zh-CN' | 'en-US') {
  if (language !== 'en-US') return report;
  const riskLevels = { '低': 'Low', '中': 'Medium', '高': 'High', '极高': 'Critical' } as const;
  const confidences = { '低': 'Low', '中': 'Medium', '高': 'High' } as const;
  return {
    ...report,
    risk_level: riskLevels[report.risk_level],
    confidence: confidences[report.confidence],
    disclaimer: 'This result is for job-search decision support only and does not constitute legal advice.',
  };
}

function calculateWriteHash(ownerId: string, apiPath: string, body: unknown): string {
  const protectedBody = body && typeof body === 'object'
    ? { ...(body as Record<string, unknown>), captcha_token: undefined }
    : body;
  return crypto.createHash('sha256').update(JSON.stringify({ ownerId, apiPath, body: protectedBody })).digest('hex');
}

async function getReportCache(hash: string, ownerId: string): Promise<RiskReport | null> {
  if (isRedisAvailable()) {
    try {
      const cached = await redis.get(`report:hash:${hash}`);
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
        .set(`report:hash:${hash}`, JSON.stringify(report), 'PX', REPORT_CACHE_TTL_MS)
        .set(`report:id:${report.report_id}`, hash, 'PX', REPORT_CACHE_TTL_MS)
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
      resolvedHash = (await redis.get(`report:id:${reportId}`)) || undefined;
    } catch {
      // Continue with local cleanup.
    }
  }
  if (isRedisAvailable()) {
    try {
      const keys = [
        ...(resolvedHash ? [`report:hash:${resolvedHash}`] : []),
        ...(reportId ? [`report:id:${reportId}`] : []),
      ];
      if (keys.length > 0) await redis.del(...keys);
    } catch {
      // Redis keys retain their seven-day TTL if deletion is temporarily unavailable.
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
  created_at: Date;
}): RiskReport {
  return {
    report_id: report.report_id,
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
  captchaToken?: string;
  inputHash?: string;
}): Promise<boolean> {
  const { request, reply, requestId, visitorId, apiPath, captchaToken, inputHash } = params;
  await incrementRateLimit(request.ip, visitorId, apiPath, inputHash);
  const result = await checkRateLimit(request.ip, visitorId, apiPath, inputHash);
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

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST' && request.method !== 'DELETE') return;
    const production = process.env.NODE_ENV === 'production';
    const databaseRequired = process.env.REQUIRE_DATABASE
      ? process.env.REQUIRE_DATABASE === 'true'
      : production;
    const redisRequired = process.env.REQUIRE_REDIS
      ? process.env.REQUIRE_REDIS === 'true'
      : production;
    if ((databaseRequired && !isDbAvailable()) || (redisRequired && !isRedisAvailable())) {
      return reply.status(503).send(buildErrorResponse(
        'DEPENDENCY_UNAVAILABLE',
        '服务依赖暂时不可用，请稍后重试。'
      ));
    }
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
      storeReport(cached, visitorId, inputHash);
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 200, aiCalled: false });
      reply.header('x-joblens-analysis-source', 'cache');
      return reply.send(localizeReportForResponse(cached, parsed.data.language));
    }

    try {
      const startedAt = Date.now();
      const llmResult = await llmProvider.analyzeJobRisk(parsed.data);
      const report = llmResult.parsedJson as RiskReport;
      report.report_id = generateId('rep');
      report.created_at = new Date().toISOString();
      const now = new Date();
      const source = llmResult.provider.startsWith('fallback(') ? 'fallback' : 'model';

      reply.headers({
        'x-joblens-analysis-source': source,
        'x-joblens-ai-provider': llmResult.provider,
        'x-joblens-ai-model': llmResult.model,
        'x-joblens-ai-latency-ms': String(llmResult.latencyMs),
      });

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
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, userAgent: request.headers['user-agent'], httpStatus: 200, aiCalled: true, provider: llmResult.provider, model: llmResult.model });
      return reply.send(localizeReportForResponse(report, parsed.data.language));
    } catch (error) {
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: '报告生成失败' });
      logInternalFailure(request, 'report_generation', error);
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.post('/api/ocr/extract-job', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const requestId = generateId('req');
    const apiPath = '/api/ocr/extract-job';
    const parsed = ScreenshotExtractRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '截图参数格式错误' });
      return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '截图参数格式错误', parsed.error.errors.map(error => ({ field: error.path.join('.'), issue: error.message }))));
    }
    const inputHash = calculateWriteHash(visitorId, apiPath, { image_hashes: parsed.data.images.map(image => crypto.createHash('sha256').update(image).digest('hex')) });
    if (!await enforceWriteProtection({ request, reply, requestId, visitorId, apiPath, captchaToken: parsed.data.captcha_token, inputHash })) return;
    try {
      const extraction = await extractJobFromScreenshots(parsed.data.images, parsed.data.language);
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, userAgent: request.headers['user-agent'], httpStatus: 200, aiCalled: true, provider: extraction.provider, model: extraction.model, latencyMs: extraction.latencyMs });
      return reply.send(extraction.result);
    } catch (error) {
      await logApiRequest({ requestId, apiPath, method: 'POST', visitorId, ip: request.ip, httpStatus: 502, errorCode: 'OCR_UNAVAILABLE', errorMessage: '截图识别服务暂时不可用' });
      logInternalFailure(request, 'screenshot_extraction', error);
      return reply.status(502).send(buildErrorResponse('OCR_UNAVAILABLE', '截图识别服务暂时不可用，请稍后重试或手动填写。'));
    }
  });

  app.get('/api/reports/:id', async (request, reply) => {
    const visitorId = requireVisitorId(request, reply);
    if (!visitorId) return;
    const reportId = (request.params as { id: string }).id;
    try {
      const owned = await findOwnedReport(reportId, visitorId);
      if (!owned) return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
      return reply.send(owned.report);
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
      const llmResult = await llmProvider.analyzeHrReply({ ...parsed.data, report_id: reportId });
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
      return reply.send(analysis);
    } catch (error) {
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
      const llmResult = await llmProvider.analyzeHrReply(parsed.data);
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
      return reply.send(analysis);
    } catch (error) {
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

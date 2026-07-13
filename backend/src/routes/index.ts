import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RiskReport, HrAnalysis, ApiError } from '@/types';
import {
  DetectRequestSchema,
  HrAnalysisRequestSchema,
  InterviewFeedbackRequestSchema,
  ReportFeedbackRequestSchema,
} from '@/schemas';
import { prisma, isDbAvailable } from '@/db/prisma';
import { redis, isRedisAvailable } from '@/db/redis';
import { MockProvider } from '@/services/llm';
import {
  checkRateLimit,
  incrementRateLimit,
  setCaptchaExempt,
  verifyCaptcha,
} from '@/services/rateLimit';
import crypto from 'crypto';

const llmProvider = new MockProvider();

function generateReportId(): string {
  return `rep_${crypto.randomBytes(6).toString('hex')}`;
}

function generateHrAnalysisId(): string {
  return `hra_${crypto.randomBytes(6).toString('hex')}`;
}

function generateFeedbackId(): string {
  return `fb_${crypto.randomBytes(6).toString('hex')}`;
}

function generateReportFeedbackId(): string {
  return `rfb_${crypto.randomBytes(6).toString('hex')}`;
}

function generateRequestId(): string {
  return `req_${crypto.randomBytes(6).toString('hex')}`;
}

function calculateInputHash(jdText: string, hrChatText?: string): string {
  const input = `${jdText}${hrChatText || ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

const reportCache = new Map<string, RiskReport>();
const reportStore = new Map<string, RiskReport>();

async function getReportCache(hash: string): Promise<RiskReport | null> {
  if (isRedisAvailable()) {
    try {
      const cached = await redis.get(`report:hash:${hash}`);
      if (cached) return JSON.parse(cached) as RiskReport;
    } catch {
      // fallback
    }
  }
  return reportCache.get(hash) || null;
}

async function setReportCache(hash: string, report: RiskReport): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await redis.set(`report:hash:${hash}`, JSON.stringify(report));
      await redis.expire(`report:hash:${hash}`, 604800);
      return;
    } catch {
      // fallback
    }
  }
  reportCache.set(hash, report);
  setTimeout(() => reportCache.delete(hash), 604800 * 1000);
}

async function delReportCache(hash: string): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await redis.del(`report:hash:${hash}`);
    } catch {
      // fallback
    }
  }
  reportCache.delete(hash);
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
    await prisma.apiLog.create({
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
    });
  } catch {
    // ignore
  }
}

function buildErrorResponse(error: string, message: string, details?: { field: string; issue: string }[], captchaProvider?: string, retryAfter?: string): ApiError {
  const response: ApiError = { error, message };
  if (details) response.details = details;
  if (captchaProvider) response.captcha_provider = captchaProvider;
  if (retryAfter) response.retry_after = retryAfter;
  return response;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/reports/detect', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;
    const userAgent = request.headers['user-agent'] as string;

    try {
      const result = DetectRequestSchema.safeParse(request.body);
      if (!result.success) {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
        return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误', result.error.errors.map(e => ({ field: e.path.join('.'), issue: e.message }))));
      }

      const totalLength = result.data.jd_text.length + (result.data.hr_chat_text?.length || 0);
      if (totalLength > 12000) {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 413, errorCode: 'PAYLOAD_TOO_LARGE', errorMessage: '文本总长度超过限制' });
        return reply.status(413).send(buildErrorResponse('PAYLOAD_TOO_LARGE', '文本总长度超过限制，请删减内容后重试。'));
      }

      const inputHash = calculateInputHash(result.data.jd_text, result.data.hr_chat_text);

      const rateLimitResult = await checkRateLimit(ip, visitorId, '/api/reports/detect', inputHash);

      if (rateLimitResult.blocked) {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 429, errorCode: 'RATE_LIMITED', errorMessage: rateLimitResult.message || '', rateLimited: true });
        return reply.status(429).send(buildErrorResponse('RATE_LIMITED', rateLimitResult.message || '', undefined, undefined, new Date(Date.now() + (rateLimitResult.retryAfter || 3600) * 1000).toISOString()));
      }

      if (rateLimitResult.requiresCaptcha) {
        if (!result.data.captcha_token) {
          await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 403, errorCode: 'CAPTCHA_REQUIRED', errorMessage: rateLimitResult.message || '', captchaRequired: true });
          return reply.status(403).send(buildErrorResponse('CAPTCHA_REQUIRED', rateLimitResult.message || '', undefined, 'turnstile'));
        }

        const captchaResult = await verifyCaptcha(result.data.captcha_token);
        if (!captchaResult.success) {
          await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 403, errorCode: 'CAPTCHA_FAILED', errorMessage: captchaResult.reason || '验证码校验失败' });
          return reply.status(403).send(buildErrorResponse('CAPTCHA_FAILED', captchaResult.reason || '验证码校验失败'));
        }

        await setCaptchaExempt(visitorId);
      }

      await incrementRateLimit(ip, visitorId, '/api/reports/detect', inputHash);

      const cachedReport = await getReportCache(inputHash);
      if (cachedReport) {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 200, aiCalled: false });
        return reply.send(cachedReport);
      }

      const startTime = Date.now();
      const llmResult = await llmProvider.analyzeJobRisk({
        source_platform: result.data.source_platform,
        company_name: result.data.company_name,
        job_title: result.data.job_title,
        jd_text: result.data.jd_text,
        hr_chat_text: result.data.hr_chat_text,
      });
      const latencyMs = Date.now() - startTime;

      const validatedReport = (llmResult.parsedJson as RiskReport);
      validatedReport.report_id = generateReportId();
      validatedReport.created_at = new Date().toISOString();

      if (isDbAvailable()) {
        try {
          await prisma.jobReport.create({
            data: {
              report_id: validatedReport.report_id,
              source_platform: result.data.source_platform,
              company_name: result.data.company_name,
              job_title: result.data.job_title,
              jd_text: result.data.jd_text,
              hr_chat_text: result.data.hr_chat_text,
              input_hash: inputHash,
              visitor_id: visitorId,
              ip_address: ip,
              overall_score: validatedReport.overall_score,
              risk_level: validatedReport.risk_level,
              confidence: validatedReport.confidence,
              predicted_role: validatedReport.predicted_role,
              risk_types: validatedReport.risk_types,
              sub_scores: JSON.parse(JSON.stringify(validatedReport.sub_scores)) as any,
              strong_risk_adjustment: validatedReport.strong_risk_adjustment,
              evidence: validatedReport.evidence,
              missing_info: validatedReport.missing_info,
              questions: validatedReport.questions,
              recommendation: validatedReport.recommendation,
              disclaimer: validatedReport.disclaimer,
              analysis_status: 'completed',
              provider: llmResult.provider,
              model: llmResult.model,
              latency_ms: latencyMs,
              input_tokens: llmResult.inputTokens,
              output_tokens: llmResult.outputTokens,
              cost_estimate: llmResult.costEstimate,
            },
          });
        } catch {
          // ignore database error
        }
      }

      await setReportCache(inputHash, validatedReport);
      reportStore.set(validatedReport.report_id, validatedReport);

      try {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 200, aiCalled: true, provider: llmResult.provider, model: llmResult.model, inputTokens: llmResult.inputTokens, outputTokens: llmResult.outputTokens, latencyMs, costEstimate: llmResult.costEstimate });
      } catch {
        // ignore log error
      }

      return reply.send(validatedReport);
    } catch (err) {
      try {
        await logApiRequest({ requestId, apiPath: '/api/reports/detect', method: 'POST', visitorId, ip, userAgent, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      } catch {
        // ignore log error
      }
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.get('/api/reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;
    const params = request.params as { id: string };

    try {
      // Try memory store first (fast path, always works)
      const memReport = reportStore.get(params.id);
      if (memReport) {
        return reply.send(memReport);
      }

      // Try database
      if (isDbAvailable()) {
        const report = await prisma.jobReport.findUnique({
          where: { report_id: params.id, is_deleted: false },
        });

        if (report) {
          return reply.send({
            report_id: report.report_id,
            overall_score: report.overall_score,
            risk_level: report.risk_level,
            confidence: report.confidence,
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
          });
        }
      }

      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}`, method: 'GET', visitorId, ip, httpStatus: 404, errorCode: 'REPORT_NOT_FOUND', errorMessage: '报告不存在' });
      return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在或已删除。'));
    } catch (err) {
      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}`, method: 'GET', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.delete('/api/reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;
    const params = request.params as { id: string };

    try {
      const report = await prisma.jobReport.findUnique({
        where: { report_id: params.id },
      });

      if (!report) {
        await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}`, method: 'DELETE', visitorId, ip, httpStatus: 404, errorCode: 'REPORT_NOT_FOUND', errorMessage: '报告不存在' });
        return reply.status(404).send(buildErrorResponse('REPORT_NOT_FOUND', '报告不存在。'));
      }

      await prisma.jobReport.update({
        where: { report_id: params.id },
        data: { is_deleted: true, deleted_at: new Date() },
      });

      await delReportCache(report.input_hash);

      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}`, method: 'DELETE', visitorId, ip, httpStatus: 200 });

      return reply.send({
        status: 'deleted',
        message: '该报告及相关数据已删除。',
        deleted_at: new Date().toISOString(),
      });
    } catch (err) {
      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}`, method: 'DELETE', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '删除失败，请稍后重试。'));
    }
  });

  app.post('/api/reports/:id/hr-analysis', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;
    const params = request.params as { id: string };

    try {
      const result = HrAnalysisRequestSchema.safeParse(request.body);
      if (!result.success) {
        await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}/hr-analysis`, method: 'POST', visitorId, ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
        return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
      }

      const llmResult = await llmProvider.analyzeHrReply({
        report_id: params.id,
        user_question: result.data.user_question,
        hr_reply: result.data.hr_reply,
        jd_context: result.data.jd_context,
      });

      const validatedAnalysis = (llmResult.parsedJson as HrAnalysis);
      validatedAnalysis.hr_analysis_id = generateHrAnalysisId();
      validatedAnalysis.created_at = new Date().toISOString();

      await prisma.hrAnalysis.create({
        data: {
          hr_analysis_id: validatedAnalysis.hr_analysis_id,
          report_id: params.id,
          user_question: result.data.user_question,
          hr_reply: result.data.hr_reply,
          jd_context: result.data.jd_context,
          visitor_id: visitorId,
          ip_address: ip,
          avoidance_score: validatedAnalysis.avoidance_score,
          risk_level: validatedAnalysis.risk_level,
          analysis: validatedAnalysis.analysis,
          next_questions: validatedAnalysis.next_questions,
          analysis_status: 'completed',
          provider: llmResult.provider,
          model: llmResult.model,
        },
      });

      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}/hr-analysis`, method: 'POST', visitorId, ip, httpStatus: 200, aiCalled: true, provider: llmResult.provider, model: llmResult.model });

      return reply.send(validatedAnalysis);
    } catch (err) {
      await logApiRequest({ requestId, apiPath: `/api/reports/${params.id}/hr-analysis`, method: 'POST', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.post('/api/hr-analysis', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;

    try {
      const result = HrAnalysisRequestSchema.safeParse(request.body);
      if (!result.success) {
        await logApiRequest({ requestId, apiPath: '/api/hr-analysis', method: 'POST', visitorId, ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
        return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
      }

      const llmResult = await llmProvider.analyzeHrReply({
        user_question: result.data.user_question,
        hr_reply: result.data.hr_reply,
        jd_context: result.data.jd_context,
      });

      const validatedAnalysis = (llmResult.parsedJson as HrAnalysis);
      validatedAnalysis.hr_analysis_id = generateHrAnalysisId();
      validatedAnalysis.created_at = new Date().toISOString();

      await prisma.hrAnalysis.create({
        data: {
          hr_analysis_id: validatedAnalysis.hr_analysis_id,
          user_question: result.data.user_question,
          hr_reply: result.data.hr_reply,
          jd_context: result.data.jd_context,
          visitor_id: visitorId,
          ip_address: ip,
          avoidance_score: validatedAnalysis.avoidance_score,
          risk_level: validatedAnalysis.risk_level,
          analysis: validatedAnalysis.analysis,
          next_questions: validatedAnalysis.next_questions,
          analysis_status: 'completed',
          provider: llmResult.provider,
          model: llmResult.model,
        },
      });

      await logApiRequest({ requestId, apiPath: '/api/hr-analysis', method: 'POST', visitorId, ip, httpStatus: 200, aiCalled: true, provider: llmResult.provider, model: llmResult.model });

      return reply.send(validatedAnalysis);
    } catch (err) {
      await logApiRequest({ requestId, apiPath: '/api/hr-analysis', method: 'POST', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。'));
    }
  });

  app.post('/api/interview-feedbacks', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;

    try {
      const result = InterviewFeedbackRequestSchema.safeParse(request.body);
      if (!result.success) {
        await logApiRequest({ requestId, apiPath: '/api/interview-feedbacks', method: 'POST', visitorId, ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
        return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
      }

      const feedbackId = generateFeedbackId();

      await prisma.interviewFeedback.create({
        data: {
          feedback_id: feedbackId,
          report_id: result.data.report_id,
          company_name: result.data.company_name,
          job_title: result.data.job_title,
          source_platform: result.data.source_platform,
          jd_claim: result.data.jd_claim,
          interview_actual: result.data.interview_actual,
          involves_sales: result.data.involves_sales,
          involves_fee: result.data.involves_fee,
          involves_training_loan: result.data.involves_training_loan,
          involves_deposit: result.data.involves_deposit,
          subject_mismatch: result.data.subject_mismatch,
          recommend_to_others: result.data.recommend_to_others,
          visitor_id: visitorId,
          ip_address: ip,
        },
      });

      await logApiRequest({ requestId, apiPath: '/api/interview-feedbacks', method: 'POST', visitorId, ip, httpStatus: 200 });

      return reply.send({
        feedback_id: feedbackId,
        status: 'submitted',
        message: '已匿名提交，审核后将用于优化岗位风险判断。',
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      await logApiRequest({ requestId, apiPath: '/api/interview-feedbacks', method: 'POST', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '提交失败，请稍后重试。'));
    }
  });

  app.post('/api/report-feedbacks', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = generateRequestId();
    const visitorId = request.headers['x-visitor-id'] as string;
    const ip = request.ip;

    try {
      const result = ReportFeedbackRequestSchema.safeParse(request.body);
      if (!result.success) {
        await logApiRequest({ requestId, apiPath: '/api/report-feedbacks', method: 'POST', visitorId, ip, httpStatus: 400, errorCode: 'VALIDATION_ERROR', errorMessage: '参数格式错误' });
        return reply.status(400).send(buildErrorResponse('VALIDATION_ERROR', '参数格式错误'));
      }

      const feedbackId = generateReportFeedbackId();

      await prisma.reportFeedback.create({
        data: {
          feedback_id: feedbackId,
          report_id: result.data.report_id,
          feedback_type: result.data.feedback_type,
          content: result.data.content,
          visitor_id: visitorId,
          ip_address: ip,
        },
      });

      await logApiRequest({ requestId, apiPath: '/api/report-feedbacks', method: 'POST', visitorId, ip, httpStatus: 200 });

      return reply.send({
        feedback_id: feedbackId,
        status: 'submitted',
        message: '已收到反馈，我们会用于优化模型。',
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      await logApiRequest({ requestId, apiPath: '/api/report-feedbacks', method: 'POST', visitorId, ip, httpStatus: 500, errorCode: 'INTERNAL_ERROR', errorMessage: err instanceof Error ? err.message : '内部错误' });
      return reply.status(500).send(buildErrorResponse('INTERNAL_ERROR', '提交失败，请稍后重试。'));
    }
  });
}

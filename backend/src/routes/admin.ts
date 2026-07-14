import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDbHealth, isDbAvailable, prisma, runDbOperation } from '../db/prisma';
import { isRedisAvailable } from '../db/redis';
import { getGlobalAiBudgetUsage } from '../services/aiCostControl';

const DaysSchema = z.coerce.number().int().refine(value => [1, 7, 30].includes(value)).default(7);
const PageSchema = z.coerce.number().int().min(1).default(1);
const PageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);
const ReviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewer_note: z.string().trim().max(500).optional().default(''),
});

function authorized(request: FastifyRequest): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim();
  const authorization = request.headers.authorization;
  if (!expected || !authorization?.startsWith('Bearer ')) return false;
  const received = authorization.slice('Bearer '.length).trim();
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function startDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportSource(provider: string | null): 'model' | 'fallback' {
  return provider && provider !== 'rule-based' ? 'model' : 'fallback';
}

function reportDto(report: {
  report_id: string;
  source_platform: string | null;
  company_name: string | null;
  job_title: string | null;
  jd_text: string;
  hr_chat_text: string | null;
  overall_score: number;
  risk_level: string;
  confidence: string;
  predicted_role: string | null;
  risk_types: unknown;
  evidence: unknown;
  missing_info: unknown;
  questions: unknown;
  recommendation: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_estimate: unknown;
  created_at: Date;
}) {
  return {
    report_id: report.report_id,
    source_platform: report.source_platform,
    company_name: report.company_name,
    job_title: report.job_title,
    jd_text: report.jd_text,
    hr_chat_text: report.hr_chat_text,
    overall_score: report.overall_score,
    risk_level: report.risk_level,
    confidence: report.confidence,
    predicted_role: report.predicted_role,
    risk_types: report.risk_types,
    evidence: report.evidence,
    missing_info: report.missing_info,
    questions: report.questions,
    recommendation: report.recommendation,
    analysis_source: reportSource(report.provider),
    provider: report.provider,
    model: report.model,
    latency_ms: report.latency_ms,
    input_tokens: report.input_tokens,
    output_tokens: report.output_tokens,
    cost_estimate: numberValue(report.cost_estimate),
    created_at: report.created_at.toISOString(),
  };
}

const reportSelect = {
  report_id: true,
  source_platform: true,
  company_name: true,
  job_title: true,
  jd_text: true,
  hr_chat_text: true,
  overall_score: true,
  risk_level: true,
  confidence: true,
  predicted_role: true,
  risk_types: true,
  evidence: true,
  missing_info: true,
  questions: true,
  recommendation: true,
  provider: true,
  model: true,
  latency_ms: true,
  input_tokens: true,
  output_tokens: true,
  cost_estimate: true,
  created_at: true,
} as const;

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/admin/')) return;
    if (!authorized(request)) {
      request.log.warn({ event: 'admin_auth_failed', path: request.url.split('?')[0] }, 'admin authentication failed');
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: '管理凭据无效。' });
    }
  });

  app.get('/api/admin/overview', async (request, reply) => {
    const parsed = DaysSchema.safeParse((request.query as { days?: string }).days);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: '时间范围无效。' });
    if (!isDbAvailable()) return reply.status(503).send({ error: 'DEPENDENCY_UNAVAILABLE', message: '数据库暂时不可用。' });
    const days = parsed.data;
    const since = startDate(days);
    try {
      const [aggregate, modelCount, highRiskCount, pendingReportFeedback, pendingInterviewFeedback, riskGroups, modelGroups, trendRows, recentReports, aiBudget] = await Promise.all([
        runDbOperation(() => prisma.jobReport.aggregate({
          where: { is_deleted: false, created_at: { gte: since } },
          _count: { _all: true },
          _avg: { overall_score: true, latency_ms: true },
          _sum: { cost_estimate: true },
        })),
        runDbOperation(() => prisma.jobReport.count({ where: { is_deleted: false, created_at: { gte: since }, provider: { not: null, notIn: ['rule-based'] } } })),
        runDbOperation(() => prisma.jobReport.count({ where: { is_deleted: false, created_at: { gte: since }, risk_level: { in: ['高', '极高'] } } })),
        runDbOperation(() => prisma.reportFeedback.count({ where: { is_deleted: false, review_status: 'pending' } })),
        runDbOperation(() => prisma.interviewFeedback.count({ where: { is_deleted: false, review_status: 'pending' } })),
        runDbOperation(() => prisma.jobReport.groupBy({ by: ['risk_level'], where: { is_deleted: false, created_at: { gte: since } }, _count: { _all: true } })),
        runDbOperation(() => prisma.jobReport.groupBy({ by: ['provider', 'model'], where: { is_deleted: false, created_at: { gte: since } }, _count: { _all: true } })),
        runDbOperation(() => prisma.jobReport.findMany({ where: { is_deleted: false, created_at: { gte: since } }, select: { created_at: true, risk_level: true, provider: true } })),
        runDbOperation(() => prisma.jobReport.findMany({ where: { is_deleted: false }, orderBy: { created_at: 'desc' }, take: 8, select: reportSelect })),
        getGlobalAiBudgetUsage(),
      ]);
      const total = aggregate._count._all;
      const trend = new Map<string, { date: string; reports: number; model_calls: number; high_risk: number }>();
      for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
        trend.set(date, { date, reports: 0, model_calls: 0, high_risk: 0 });
      }
      for (const row of trendRows) {
        const bucket = trend.get(row.created_at.toISOString().slice(0, 10));
        if (!bucket) continue;
        bucket.reports += 1;
        if (reportSource(row.provider) === 'model') bucket.model_calls += 1;
        if (row.risk_level === '高' || row.risk_level === '极高') bucket.high_risk += 1;
      }
      return reply.send({
        days,
        generated_at: new Date().toISOString(),
        kpis: {
          reports: total,
          model_call_rate: total ? Number((modelCount / total).toFixed(4)) : 0,
          high_risk_rate: total ? Number((highRiskCount / total).toFixed(4)) : 0,
          average_risk_score: Number((aggregate._avg.overall_score || 0).toFixed(1)),
          estimated_cost: Number(numberValue(aggregate._sum.cost_estimate).toFixed(6)),
          average_latency_ms: Math.round(aggregate._avg.latency_ms || 0),
          pending_feedback: pendingReportFeedback + pendingInterviewFeedback,
        },
        trend: [...trend.values()],
        risk_distribution: riskGroups.map(group => ({ label: group.risk_level, count: group._count._all })),
        model_distribution: modelGroups.map(group => ({ provider: group.provider || 'unknown', model: group.model || 'unknown', count: group._count._all })),
        recent_reports: recentReports.map(reportDto),
        system: {
          database: getDbHealth().available,
          redis: isRedisAvailable(),
          ai_budget: aiBudget,
        },
      });
    } catch (error) {
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError' }, 'admin overview failed');
      return reply.status(503).send({ error: 'ADMIN_DATA_UNAVAILABLE', message: '管理数据暂时不可用。' });
    }
  });

  app.get('/api/admin/reports', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const pageResult = PageSchema.safeParse(query.page);
    const sizeResult = PageSizeSchema.safeParse(query.page_size);
    const riskResult = z.enum(['低', '中', '高', '极高']).optional().safeParse(query.risk_level || undefined);
    const sourceResult = z.enum(['model', 'fallback']).optional().safeParse(query.source || undefined);
    const searchResult = z.string().trim().max(100).optional().safeParse(query.query || undefined);
    if (!pageResult.success || !sizeResult.success || !riskResult.success || !sourceResult.success || !searchResult.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: '查询参数无效。' });
    }
    if (!isDbAvailable()) return reply.status(503).send({ error: 'DEPENDENCY_UNAVAILABLE', message: '数据库暂时不可用。' });
    const page = pageResult.data;
    const pageSize = sizeResult.data;
    const search = searchResult.data;
    const where = {
      is_deleted: false,
      ...(riskResult.data ? { risk_level: riskResult.data } : {}),
      ...(sourceResult.data === 'model' ? { provider: { not: null, notIn: ['rule-based'] } } : {}),
      ...(sourceResult.data === 'fallback' ? { OR: [{ provider: null }, { provider: 'rule-based' }] } : {}),
      ...(search ? {
        AND: [{ OR: [
          { report_id: { contains: search, mode: 'insensitive' as const } },
          { company_name: { contains: search, mode: 'insensitive' as const } },
          { job_title: { contains: search, mode: 'insensitive' as const } },
        ] }],
      } : {}),
    };
    try {
      const [total, reports] = await runDbOperation(() => prisma.$transaction([
        prisma.jobReport.count({ where }),
        prisma.jobReport.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: reportSelect }),
      ]));
      return reply.send({ page, page_size: pageSize, total, items: reports.map(reportDto) });
    } catch (error) {
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError' }, 'admin reports failed');
      return reply.status(503).send({ error: 'ADMIN_DATA_UNAVAILABLE', message: '报告数据暂时不可用。' });
    }
  });

  app.get('/api/admin/feedbacks', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const pageResult = PageSchema.safeParse(query.page);
    const sizeResult = PageSizeSchema.safeParse(query.page_size);
    const kindResult = z.enum(['all', 'report', 'interview']).default('all').safeParse(query.kind);
    const statusResult = z.enum(['all', 'pending', 'approved', 'rejected']).default('pending').safeParse(query.status);
    if (!pageResult.success || !sizeResult.success || !kindResult.success || !statusResult.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: '查询参数无效。' });
    }
    if (!isDbAvailable()) return reply.status(503).send({ error: 'DEPENDENCY_UNAVAILABLE', message: '数据库暂时不可用。' });
    const statusWhere = statusResult.data === 'all' ? {} : { review_status: statusResult.data };
    try {
      const [reportFeedbacks, interviewFeedbacks] = await Promise.all([
        kindResult.data === 'interview' ? Promise.resolve([]) : runDbOperation(() => prisma.reportFeedback.findMany({
          where: { is_deleted: false, ...statusWhere }, orderBy: { created_at: 'desc' },
        })),
        kindResult.data === 'report' ? Promise.resolve([]) : runDbOperation(() => prisma.interviewFeedback.findMany({
          where: { is_deleted: false, ...statusWhere }, orderBy: { created_at: 'desc' },
        })),
      ]);
      const reportIds = [...new Set([...reportFeedbacks, ...interviewFeedbacks].map(item => item.report_id).filter((id): id is string => Boolean(id)))];
      const reports = reportIds.length ? await runDbOperation(() => prisma.jobReport.findMany({
        where: { report_id: { in: reportIds } },
        select: { report_id: true, company_name: true, job_title: true, risk_level: true, overall_score: true },
      })) : [];
      const reportMap = new Map(reports.map(report => [report.report_id, report]));
      const items = [
        ...reportFeedbacks.map(feedback => ({
          kind: 'report' as const,
          id: feedback.feedback_id,
          report_id: feedback.report_id,
          company_name: reportMap.get(feedback.report_id)?.company_name || null,
          job_title: reportMap.get(feedback.report_id)?.job_title || null,
          risk_level: reportMap.get(feedback.report_id)?.risk_level || null,
          overall_score: reportMap.get(feedback.report_id)?.overall_score || null,
          title: feedback.feedback_type,
          content: feedback.content,
          tags: [feedback.feedback_type],
          review_status: feedback.review_status,
          reviewer_note: feedback.reviewer_note,
          created_at: feedback.created_at.toISOString(),
        })),
        ...interviewFeedbacks.map(feedback => ({
          kind: 'interview' as const,
          id: feedback.feedback_id,
          report_id: feedback.report_id,
          company_name: feedback.company_name,
          job_title: feedback.job_title,
          risk_level: feedback.report_id ? reportMap.get(feedback.report_id)?.risk_level || null : null,
          overall_score: feedback.report_id ? reportMap.get(feedback.report_id)?.overall_score || null : null,
          title: '面试结果反馈',
          content: `JD 描述：${feedback.jd_claim}\n面试实际：${feedback.interview_actual}`,
          tags: [
            ...(feedback.involves_sales ? ['涉及销售'] : []),
            ...(feedback.involves_fee ? ['涉及收费'] : []),
            ...(feedback.involves_training_loan ? ['培训贷款'] : []),
            ...(feedback.involves_deposit ? ['押金'] : []),
            ...(feedback.subject_mismatch ? ['主体不符'] : []),
            feedback.recommend_to_others,
          ],
          review_status: feedback.review_status,
          reviewer_note: feedback.reviewer_note,
          created_at: feedback.created_at.toISOString(),
        })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const page = pageResult.data;
      const pageSize = sizeResult.data;
      return reply.send({
        page,
        page_size: pageSize,
        total: items.length,
        items: items.slice((page - 1) * pageSize, page * pageSize),
      });
    } catch (error) {
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError' }, 'admin feedbacks failed');
      return reply.status(503).send({ error: 'ADMIN_DATA_UNAVAILABLE', message: '反馈数据暂时不可用。' });
    }
  });

  app.patch('/api/admin/feedbacks/:kind/:id', async (request, reply) => {
    const paramsResult = z.object({ kind: z.enum(['report', 'interview']), id: z.string().regex(/^(?:rfb|fb)_[a-z0-9]{12}$/) }).safeParse(request.params);
    const bodyResult = ReviewSchema.safeParse(request.body);
    if (!paramsResult.success || !bodyResult.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: '审核参数无效。' });
    if (!isDbAvailable()) return reply.status(503).send({ error: 'DEPENDENCY_UNAVAILABLE', message: '数据库暂时不可用。' });
    const reviewedAt = bodyResult.data.status === 'pending' ? null : new Date();
    try {
      const updated = await runDbOperation(() => prisma.$transaction(async tx => {
        const result = paramsResult.data.kind === 'report'
          ? await tx.reportFeedback.updateMany({
            where: { feedback_id: paramsResult.data.id, is_deleted: false },
            data: { review_status: bodyResult.data.status, reviewer_note: bodyResult.data.reviewer_note || null, reviewed_at: reviewedAt },
          })
          : await tx.interviewFeedback.updateMany({
            where: { feedback_id: paramsResult.data.id, is_deleted: false },
            data: { review_status: bodyResult.data.status, reviewer_note: bodyResult.data.reviewer_note || null, reviewed_at: reviewedAt },
          });
        if (result.count !== 1) return false;
        await tx.securityEvent.create({ data: {
          event_type: 'admin_feedback_review',
          severity: 'info',
          api_path: '/api/admin/feedbacks/:kind/:id',
          request_id: request.id,
          detail: { kind: paramsResult.data.kind, feedback_id: paramsResult.data.id, status: bodyResult.data.status },
          action_taken: 'feedback_reviewed',
        } });
        return true;
      }));
      if (!updated) return reply.status(404).send({ error: 'FEEDBACK_NOT_FOUND', message: '反馈不存在或已删除。' });
      return reply.send({ status: 'updated', reviewed_at: reviewedAt?.toISOString() || null });
    } catch (error) {
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError' }, 'admin feedback review failed');
      return reply.status(503).send({ error: 'ADMIN_UPDATE_FAILED', message: '审核更新失败，请稍后重试。' });
    }
  });

  app.get('/api/admin/security', async (request, reply) => {
    const parsed = DaysSchema.safeParse((request.query as { days?: string }).days);
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: '时间范围无效。' });
    if (!isDbAvailable()) return reply.status(503).send({ error: 'DEPENDENCY_UNAVAILABLE', message: '数据库暂时不可用。' });
    const since = startDate(parsed.data);
    try {
      const [logs, events] = await Promise.all([
        runDbOperation(() => prisma.apiLog.findMany({
          where: { created_at: { gte: since } },
          select: { http_status: true, ai_called: true, rate_limited: true, captcha_required: true, captcha_passed: true },
        })),
        runDbOperation(() => prisma.securityEvent.findMany({
          where: { created_at: { gte: since } }, orderBy: { created_at: 'desc' }, take: 50,
          select: { id: true, event_type: true, severity: true, api_path: true, action_taken: true, created_at: true },
        })),
      ]);
      const success = logs.filter(log => log.http_status < 400).length;
      return reply.send({
        days: parsed.data,
        api: {
          total: logs.length,
          success_rate: logs.length ? Number((success / logs.length).toFixed(4)) : 1,
          client_errors: logs.filter(log => log.http_status >= 400 && log.http_status < 500).length,
          server_errors: logs.filter(log => log.http_status >= 500).length,
          ai_calls: logs.filter(log => log.ai_called).length,
          rate_limited: logs.filter(log => log.rate_limited).length,
          captcha_required: logs.filter(log => log.captcha_required).length,
          captcha_passed: logs.filter(log => log.captcha_passed).length,
        },
        events: events.map(event => ({ ...event, created_at: event.created_at.toISOString() })),
      });
    } catch (error) {
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError' }, 'admin security failed');
      return reply.status(503).send({ error: 'ADMIN_DATA_UNAVAILABLE', message: '安全数据暂时不可用。' });
    }
  });
}

import { isDbAvailable, prisma, runDbOperation } from '../../db/prisma';

const SOFT_DELETE_GRACE_DAYS = 30;
const API_LOG_RETENTION_DAYS = 30;
const SECURITY_EVENT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DataRetentionCleanupResult {
  skipped: boolean;
  source_payloads_redacted: number;
  reports_soft_deleted: number;
  hr_analyses_soft_deleted: number;
  interview_feedbacks_soft_deleted: number;
  report_feedbacks_soft_deleted: number;
  records_hard_deleted: number;
  logs_deleted: number;
}

export async function cleanupExpiredData(
  now = new Date(),
  onReportsExpired?: (reportIds: string[]) => Promise<void>
): Promise<DataRetentionCleanupResult> {
  const emptyResult: DataRetentionCleanupResult = {
    skipped: true,
    source_payloads_redacted: 0,
    reports_soft_deleted: 0,
    hr_analyses_soft_deleted: 0,
    interview_feedbacks_soft_deleted: 0,
    report_feedbacks_soft_deleted: 0,
    records_hard_deleted: 0,
    logs_deleted: 0,
  };

  if (!isDbAvailable()) return emptyResult;

  const expiredReports = await runDbOperation(() => prisma.jobReport.findMany({
    where: { retention_until: { lte: now }, is_deleted: false },
    select: { report_id: true },
  }));
  const expiredReportIds = expiredReports.map(report => report.report_id);
  const hardDeleteBefore = new Date(now.getTime() - SOFT_DELETE_GRACE_DAYS * DAY_MS);
  const apiLogBefore = new Date(now.getTime() - API_LOG_RETENTION_DAYS * DAY_MS);
  const securityEventBefore = new Date(now.getTime() - SECURITY_EVENT_RETENTION_DAYS * DAY_MS);

  const result = await runDbOperation(() => prisma.$transaction(async tx => {
    const sourcePayloads = await tx.jobReport.updateMany({
      where: {
        source_retention_until: { lte: now },
        is_deleted: false,
      },
      data: {
        jd_text: '[expired]',
        hr_chat_text: null,
        source_retention_until: null,
      },
    });
    const reports = await tx.jobReport.updateMany({
      where: { retention_until: { lte: now }, is_deleted: false },
      data: { is_deleted: true, deleted_at: now },
    });
    const hrAnalyses = await tx.hrAnalysis.updateMany({
      where: {
        is_deleted: false,
        OR: [
          { retention_until: { lte: now } },
          ...(expiredReportIds.length > 0 ? [{ report_id: { in: expiredReportIds } }] : []),
        ],
      },
      data: { is_deleted: true, deleted_at: now },
    });
    const interviewFeedbacks = await tx.interviewFeedback.updateMany({
      where: { retention_until: { lte: now }, is_deleted: false },
      data: { is_deleted: true, deleted_at: now },
    });
    const reportFeedbacks = await tx.reportFeedback.updateMany({
      where: {
        is_deleted: false,
        OR: [
          { retention_until: { lte: now } },
          ...(expiredReportIds.length > 0 ? [{ report_id: { in: expiredReportIds } }] : []),
        ],
      },
      data: { is_deleted: true, deleted_at: now },
    });

    const hardDeletedHr = await tx.hrAnalysis.deleteMany({
      where: { is_deleted: true, deleted_at: { lte: hardDeleteBefore } },
    });
    const hardDeletedInterview = await tx.interviewFeedback.deleteMany({
      where: { is_deleted: true, deleted_at: { lte: hardDeleteBefore } },
    });
    const hardDeletedReportFeedback = await tx.reportFeedback.deleteMany({
      where: { is_deleted: true, deleted_at: { lte: hardDeleteBefore } },
    });
    const hardDeletedReports = await tx.jobReport.deleteMany({
      where: { is_deleted: true, deleted_at: { lte: hardDeleteBefore } },
    });
    const apiLogs = await tx.apiLog.deleteMany({ where: { created_at: { lte: apiLogBefore } } });
    const securityEvents = await tx.securityEvent.deleteMany({ where: { created_at: { lte: securityEventBefore } } });

    return {
      skipped: false,
      source_payloads_redacted: sourcePayloads.count,
      reports_soft_deleted: reports.count,
      hr_analyses_soft_deleted: hrAnalyses.count,
      interview_feedbacks_soft_deleted: interviewFeedbacks.count,
      report_feedbacks_soft_deleted: reportFeedbacks.count,
      records_hard_deleted: hardDeletedHr.count + hardDeletedInterview.count
        + hardDeletedReportFeedback.count + hardDeletedReports.count,
      logs_deleted: apiLogs.count + securityEvents.count,
    };
  }));

  if (expiredReportIds.length > 0 && onReportsExpired) {
    await onReportsExpired(expiredReportIds);
  }
  return result;
}

export function startDataRetentionScheduler(
  onReportsExpired?: (reportIds: string[]) => Promise<void>,
  intervalMs = retentionIntervalMs()
): () => void {
  const run = () => {
    void cleanupExpiredData(new Date(), onReportsExpired).catch(error => {
      console.error('Data retention cleanup failed:', error instanceof Error ? error.message : error);
    });
  };
  const initialTimer = setTimeout(run, 60_000);
  initialTimer.unref();
  const interval = setInterval(run, intervalMs);
  interval.unref();

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

function retentionIntervalMs(): number {
  const configured = Number(process.env.DATA_CLEANUP_INTERVAL_MS);
  return Number.isSafeInteger(configured) && configured >= 60_000
    ? configured
    : DAY_MS;
}

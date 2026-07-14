import { isRedisAvailable, redis } from '../db/redis';
import { getGlobalAiBudgetUsage } from './aiCostControl';

const NAMESPACE = 'ops-metrics:v1';
const BUCKET_TTL_SECONDS = 48 * 60 * 60;
const DEFAULT_WINDOW_MINUTES = 30;

type MetricName = 'total' | 'success' | 'client_error' | 'server_error' | 'frontend_error';

function minuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

function metricKey(bucket: number, metric: MetricName): string {
  return `${NAMESPACE}:${bucket}:${metric}`;
}

export async function recordApiResponse(statusCode: number, nowMs = Date.now()): Promise<void> {
  if (!isRedisAvailable()) return;
  const bucket = minuteBucket(nowMs);
  const metrics: MetricName[] = ['total'];
  if (statusCode >= 200 && statusCode < 400) metrics.push('success');
  if (statusCode >= 400 && statusCode < 500) metrics.push('client_error');
  if (statusCode >= 500) metrics.push('server_error');

  try {
    const transaction = redis.multi();
    for (const metric of metrics) {
      const key = metricKey(bucket, metric);
      transaction.incr(key);
      transaction.expire(key, BUCKET_TTL_SECONDS);
    }
    await transaction.exec();
  } catch {
    // Monitoring must never make a user request fail.
  }
}

export async function recordFrontendError(nowMs = Date.now()): Promise<void> {
  if (!isRedisAvailable()) return;
  const key = metricKey(minuteBucket(nowMs), 'frontend_error');
  try {
    await redis.multi().incr(key).expire(key, BUCKET_TTL_SECONDS).exec();
  } catch {
    // Best-effort telemetry only.
  }
}

function boundedWindowMinutes(value?: number): number {
  if (!Number.isSafeInteger(value)) return DEFAULT_WINDOW_MINUTES;
  return Math.min(120, Math.max(5, value!));
}

export async function getOperationalMetrics(windowMinutes?: number, nowMs = Date.now()) {
  const minutes = boundedWindowMinutes(windowMinutes);
  const aiBudget = await getGlobalAiBudgetUsage(nowMs);
  if (!isRedisAvailable()) {
    return {
      available: false,
      window_minutes: minutes,
      requests: { total: 0, success: 0, client_errors: 0, server_errors: 0, success_rate: null },
      frontend_errors: 0,
      ai_budget: aiBudget,
    };
  }

  const currentBucket = minuteBucket(nowMs);
  const metricNames: MetricName[] = ['total', 'success', 'client_error', 'server_error', 'frontend_error'];
  const keys: string[] = [];
  for (let offset = 0; offset < minutes; offset += 1) {
    for (const metric of metricNames) keys.push(metricKey(currentBucket - offset, metric));
  }

  try {
    const values = await redis.mget(...keys);
    const totals: Record<MetricName, number> = {
      total: 0,
      success: 0,
      client_error: 0,
      server_error: 0,
      frontend_error: 0,
    };
    values.forEach((value, index) => {
      totals[metricNames[index % metricNames.length]] += Number.parseInt(value || '0', 10) || 0;
    });
    return {
      available: true,
      window_minutes: minutes,
      requests: {
        total: totals.total,
        success: totals.success,
        client_errors: totals.client_error,
        server_errors: totals.server_error,
        success_rate: totals.total > 0 ? Number((totals.success / totals.total).toFixed(4)) : null,
      },
      frontend_errors: totals.frontend_error,
      ai_budget: aiBudget,
    };
  } catch {
    return {
      available: false,
      window_minutes: minutes,
      requests: { total: 0, success: 0, client_errors: 0, server_errors: 0, success_rate: null },
      frontend_errors: 0,
      ai_budget: aiBudget,
    };
  }
}

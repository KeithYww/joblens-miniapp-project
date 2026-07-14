import crypto from 'crypto';
import { isRedisAvailable, redis } from '../db/redis';

export type AiOperation = 'ocr' | 'analysis';
export type AiQuotaDenialReason =
  | 'AI_DISABLED'
  | 'USER_AI_QUOTA_EXCEEDED'
  | 'IP_AI_QUOTA_EXCEEDED'
  | 'GLOBAL_AI_BUDGET_EXHAUSTED'
  | 'AI_CONTROL_UNAVAILABLE';

interface AiCostConfig {
  enabled: boolean;
  dailyCreditLimit: number;
  visitorLimits: Record<AiOperation, number>;
  ipLimits: Record<AiOperation, number>;
  creditCosts: Record<AiOperation, number>;
  totalConcurrency: number;
  operationConcurrency: Record<AiOperation, number>;
  leaseMs: Record<AiOperation, number>;
}

export interface AiQuotaReservation {
  keys: [string, string, string];
  creditCost: number;
  operation: AiOperation;
  remaining: number;
  resetAt: string;
}

export type AiQuotaReservationResult =
  | { allowed: true; reservation: AiQuotaReservation }
  | { allowed: false; reason: AiQuotaDenialReason; remaining: number; resetAt: string; retryAfter: number };

export interface AiConcurrencyLease {
  token: string;
  operation: AiOperation;
}

export interface AiQuotaSnapshot {
  available: boolean;
  ocr: { remaining: number; limit: number };
  analysis: { remaining: number; limit: number };
  resetAt: string;
}

export interface GlobalAiBudgetUsage {
  available: boolean;
  used: number;
  limit: number;
  usage_ratio: number;
  reset_at: string;
}

const NAMESPACE = 'ai-cost:v1';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

const RESERVE_QUOTA_SCRIPT = `
local visitorCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local globalCredits = tonumber(redis.call('GET', KEYS[3]) or '0')
local visitorLimit = tonumber(ARGV[1])
local ipLimit = tonumber(ARGV[2])
local globalLimit = tonumber(ARGV[3])
local creditCost = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

if visitorCount + 1 > visitorLimit then return {2, math.max(0, visitorLimit - visitorCount)} end
if ipCount + 1 > ipLimit then return {3, math.max(0, visitorLimit - visitorCount)} end
if globalCredits + creditCost > globalLimit then return {4, math.max(0, visitorLimit - visitorCount)} end

local newVisitorCount = redis.call('INCRBY', KEYS[1], 1)
local newIpCount = redis.call('INCRBY', KEYS[2], 1)
redis.call('INCRBY', KEYS[3], creditCost)
if newVisitorCount == 1 then redis.call('PEXPIRE', KEYS[1], ttlMs) end
if newIpCount == 1 then redis.call('PEXPIRE', KEYS[2], ttlMs) end
if globalCredits == 0 then redis.call('PEXPIRE', KEYS[3], ttlMs) end
return {1, math.max(0, visitorLimit - newVisitorCount)}
`;

const REFUND_QUOTA_SCRIPT = `
local visitorCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local globalCredits = tonumber(redis.call('GET', KEYS[3]) or '0')
if visitorCount > 0 then redis.call('DECRBY', KEYS[1], 1) end
if ipCount > 0 then redis.call('DECRBY', KEYS[2], 1) end
if globalCredits > 0 then redis.call('DECRBY', KEYS[3], math.min(globalCredits, tonumber(ARGV[1]))) end
return 1
`;

const ACQUIRE_CONCURRENCY_SCRIPT = `
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local totalLimit = tonumber(ARGV[3])
local operationLimit = tonumber(ARGV[4])
local token = ARGV[5]
local keyTtlMs = tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= totalLimit then return 0 end
if redis.call('ZCARD', KEYS[2]) >= operationLimit then return 0 end
redis.call('ZADD', KEYS[1], expiresAt, token)
redis.call('ZADD', KEYS[2], expiresAt, token)
redis.call('PEXPIRE', KEYS[1], keyTtlMs)
redis.call('PEXPIRE', KEYS[2], keyTtlMs)
return 1
`;

const RELEASE_CONCURRENCY_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readEnabled(): boolean {
  const raw = process.env.AI_CALLS_ENABLED?.trim().toLowerCase();
  if (!raw || raw === 'true') return true;
  if (raw === 'false') return false;
  return false;
}

export function getAiCostConfig(): AiCostConfig {
  return {
    enabled: readEnabled(),
    dailyCreditLimit: boundedInteger('AI_DAILY_CREDIT_LIMIT', 300, 1, 1_000_000),
    visitorLimits: {
      ocr: boundedInteger('ANON_DAILY_OCR_LIMIT', 3, 1, 1_000),
      analysis: boundedInteger('ANON_DAILY_ANALYSIS_LIMIT', 3, 1, 1_000),
    },
    ipLimits: {
      ocr: boundedInteger('IP_DAILY_OCR_LIMIT', 20, 1, 100_000),
      analysis: boundedInteger('IP_DAILY_ANALYSIS_LIMIT', 30, 1, 100_000),
    },
    creditCosts: {
      ocr: boundedInteger('AI_OCR_CREDIT_COST', 3, 1, 1_000),
      analysis: boundedInteger('AI_ANALYSIS_CREDIT_COST', 1, 1, 1_000),
    },
    totalConcurrency: boundedInteger('AI_MAX_TOTAL_CONCURRENCY', 4, 1, 1_000),
    operationConcurrency: {
      ocr: boundedInteger('AI_MAX_OCR_CONCURRENCY', 2, 1, 1_000),
      analysis: boundedInteger('AI_MAX_ANALYSIS_CONCURRENCY', 3, 1, 1_000),
    },
    leaseMs: {
      ocr: boundedInteger('AI_OCR_LEASE_MS', 70_000, 10_000, 300_000),
      analysis: boundedInteger('AI_ANALYSIS_LEASE_MS', 130_000, 10_000, 300_000),
    },
  };
}

export function getShanghaiQuotaWindow(nowMs = Date.now()): { day: string; resetAt: string; ttlMs: number } {
  const shifted = new Date(nowMs + SHANGHAI_OFFSET_MS);
  const day = shifted.toISOString().slice(0, 10);
  shifted.setUTCHours(24, 0, 0, 0);
  const resetMs = shifted.getTime() - SHANGHAI_OFFSET_MS;
  return { day, resetAt: new Date(resetMs).toISOString(), ttlMs: Math.max(1_000, resetMs - nowMs) };
}

function hashKeyPart(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function quotaKeys(visitorId: string, ip: string, operation: AiOperation, day: string): [string, string, string] {
  return [
    `${NAMESPACE}:visitor:${hashKeyPart(visitorId)}:${operation}:${day}`,
    `${NAMESPACE}:ip:${hashKeyPart(ip)}:${operation}:${day}`,
    `${NAMESPACE}:global:credits:${day}`,
  ];
}

export async function getGlobalAiBudgetUsage(nowMs = Date.now()): Promise<GlobalAiBudgetUsage> {
  const window = getShanghaiQuotaWindow(nowMs);
  let limit = 0;
  try {
    limit = getAiCostConfig().dailyCreditLimit;
  } catch {
    return { available: false, used: 0, limit: 0, usage_ratio: 0, reset_at: window.resetAt };
  }
  if (!isRedisAvailable()) {
    return { available: false, used: 0, limit, usage_ratio: 0, reset_at: window.resetAt };
  }
  try {
    const used = Math.max(0, Number.parseInt(await redis.get(`${NAMESPACE}:global:credits:${window.day}`) || '0', 10) || 0);
    return {
      available: true,
      used,
      limit,
      usage_ratio: Number((used / limit).toFixed(4)),
      reset_at: window.resetAt,
    };
  } catch {
    return { available: false, used: 0, limit, usage_ratio: 0, reset_at: window.resetAt };
  }
}

function parseEvalArray(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('Invalid Redis quota response');
  return [Number(value[0]), Number(value[1])];
}

export async function reserveAiQuota(params: {
  visitorId: string;
  ip: string;
  operation: AiOperation;
  nowMs?: number;
}): Promise<AiQuotaReservationResult> {
  const window = getShanghaiQuotaWindow(params.nowMs);
  let config: AiCostConfig;
  try {
    config = getAiCostConfig();
  } catch {
    return { allowed: false, reason: 'AI_CONTROL_UNAVAILABLE', remaining: 0, resetAt: window.resetAt, retryAfter: Math.ceil(window.ttlMs / 1_000) };
  }
  const visitorLimit = config.visitorLimits[params.operation];
  if (!config.enabled) {
    return { allowed: false, reason: 'AI_DISABLED', remaining: visitorLimit, resetAt: window.resetAt, retryAfter: Math.ceil(window.ttlMs / 1_000) };
  }
  if (!isRedisAvailable()) {
    return { allowed: false, reason: 'AI_CONTROL_UNAVAILABLE', remaining: 0, resetAt: window.resetAt, retryAfter: 60 };
  }

  const keys = quotaKeys(params.visitorId, params.ip, params.operation, window.day);
  try {
    const raw = await redis.eval(
      RESERVE_QUOTA_SCRIPT,
      keys.length,
      ...keys,
      visitorLimit,
      config.ipLimits[params.operation],
      config.dailyCreditLimit,
      config.creditCosts[params.operation],
      window.ttlMs,
    );
    const [code, remaining] = parseEvalArray(raw);
    if (code === 1) {
      return {
        allowed: true,
        reservation: { keys, creditCost: config.creditCosts[params.operation], operation: params.operation, remaining, resetAt: window.resetAt },
      };
    }
    const reason: AiQuotaDenialReason = code === 2
      ? 'USER_AI_QUOTA_EXCEEDED'
      : code === 3
        ? 'IP_AI_QUOTA_EXCEEDED'
        : 'GLOBAL_AI_BUDGET_EXHAUSTED';
    return { allowed: false, reason, remaining, resetAt: window.resetAt, retryAfter: Math.ceil(window.ttlMs / 1_000) };
  } catch {
    return { allowed: false, reason: 'AI_CONTROL_UNAVAILABLE', remaining: 0, resetAt: window.resetAt, retryAfter: 60 };
  }
}

export async function refundAiQuota(reservation: AiQuotaReservation): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    await redis.eval(REFUND_QUOTA_SCRIPT, reservation.keys.length, ...reservation.keys, reservation.creditCost);
  } catch {
    // Failing closed may consume a reserved unit, but must never create extra budget.
  }
}

export async function acquireAiConcurrency(operation: AiOperation): Promise<AiConcurrencyLease | null> {
  if (!isRedisAvailable()) return null;
  const config = getAiCostConfig();
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const leaseMs = config.leaseMs[operation];
  const keys = [`${NAMESPACE}:concurrency:total`, `${NAMESPACE}:concurrency:${operation}`];
  try {
    const acquired = Number(await redis.eval(
      ACQUIRE_CONCURRENCY_SCRIPT,
      keys.length,
      ...keys,
      now,
      now + leaseMs,
      config.totalConcurrency,
      config.operationConcurrency[operation],
      token,
      leaseMs * 2,
    ));
    return acquired === 1 ? { token, operation } : null;
  } catch {
    return null;
  }
}

export async function releaseAiConcurrency(lease: AiConcurrencyLease): Promise<void> {
  if (!isRedisAvailable()) return;
  const keys = [`${NAMESPACE}:concurrency:total`, `${NAMESPACE}:concurrency:${lease.operation}`];
  try {
    await redis.eval(RELEASE_CONCURRENCY_SCRIPT, keys.length, ...keys, lease.token);
  } catch {
    // The lease has a TTL and will recover automatically.
  }
}

export async function getAiQuotaSnapshot(visitorId: string, nowMs = Date.now()): Promise<AiQuotaSnapshot> {
  const config = getAiCostConfig();
  const window = getShanghaiQuotaWindow(nowMs);
  const unavailable: AiQuotaSnapshot = {
    available: false,
    ocr: { remaining: 0, limit: config.visitorLimits.ocr },
    analysis: { remaining: 0, limit: config.visitorLimits.analysis },
    resetAt: window.resetAt,
  };
  if (!config.enabled || !isRedisAvailable()) return unavailable;
  try {
    const ocrKey = quotaKeys(visitorId, '', 'ocr', window.day)[0];
    const analysisKey = quotaKeys(visitorId, '', 'analysis', window.day)[0];
    const [ocrCountRaw, analysisCountRaw] = await redis.mget(ocrKey, analysisKey);
    const ocrCount = Number.parseInt(ocrCountRaw || '0', 10) || 0;
    const analysisCount = Number.parseInt(analysisCountRaw || '0', 10) || 0;
    return {
      available: true,
      ocr: { remaining: Math.max(0, config.visitorLimits.ocr - ocrCount), limit: config.visitorLimits.ocr },
      analysis: { remaining: Math.max(0, config.visitorLimits.analysis - analysisCount), limit: config.visitorLimits.analysis },
      resetAt: window.resetAt,
    };
  } catch {
    return unavailable;
  }
}

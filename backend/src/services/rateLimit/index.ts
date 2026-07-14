import { redis, isRedisAvailable } from '../../db/redis';
import crypto from 'crypto';
import net from 'net';

const RATE_LIMIT_CONFIG = {
  ip: {
    threshold: 5,
    thresholdHigh: 20,
    window: 600,
    windowHigh: 3600,
  },
  visitor: {
    threshold: 5,
    thresholdHigh: 30,
    window: 3600,
    windowHigh: 86400,
  },
  inputHash: {
    threshold: 2,
    window: 600,
  },
  captchaExempt: {
    duration: 1800,
  },
  blockDuration: {
    ip: 3600,
    visitor: 86400,
  },
};

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

const memoryCache = new Map<string, RateLimitEntry>();
const MAX_MEMORY_ENTRIES = 10_000;
const MAX_CAPTCHA_TOKEN_LENGTH = 2_048;
const RATE_LIMIT_NAMESPACE = 'ratelimit:v3';

function stableKeyPart(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 4_096) : '';
  return crypto.createHash('sha256').update(normalized || fallback).digest('hex');
}

function normalizeIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let candidate = value.trim();
  if (candidate.startsWith('[') && candidate.endsWith(']')) candidate = candidate.slice(1, -1);
  const zoneIndex = candidate.indexOf('%');
  if (zoneIndex !== -1) candidate = candidate.slice(0, zoneIndex);

  const version = net.isIP(candidate);
  if (version === 4) return candidate.split('.').map(part => Number(part)).join('.');
  if (version === 6) {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  }
  return undefined;
}

function rateLimitKeys(ip: string, visitorId: string, apiPath: string) {
  const ipPart = stableKeyPart(normalizeIp(ip), 'unknown-ip');
  const visitorPart = stableKeyPart(visitorId, `missing-visitor:${ipPart}`);
  const pathPart = stableKeyPart(apiPath, 'unknown-path');
  return { ipPart, visitorPart, pathPart };
}

function inputHashKey(inputHash: string): string {
  return `${RATE_LIMIT_NAMESPACE}:input_hash:${stableKeyPart(inputHash, 'missing-input-hash')}`;
}

function pruneMemoryCache(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
  while (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

function memGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.count.toString();
  }
  memoryCache.delete(key);
  return null;
}

function memSet(key: string, value: string, ttl: number): void {
  if (!memoryCache.has(key)) pruneMemoryCache();
  const parsedValue = Number.parseInt(value, 10);
  memoryCache.set(key, {
    count: Number.isFinite(parsedValue) ? parsedValue : 0,
    expiresAt: Date.now() + ttl * 1000,
  });
}

function memIncr(key: string, ttl: number): number {
  if (!memoryCache.has(key)) pruneMemoryCache();
  const entry = memoryCache.get(key);
  const isCurrent = Boolean(entry && entry.expiresAt > Date.now());
  const count = isCurrent ? entry!.count + 1 : 1;
  memoryCache.set(key, {
    count,
    expiresAt: isCurrent ? entry!.expiresAt : Date.now() + ttl * 1000,
  });
  return count;
}

async function kvGet(key: string): Promise<string | null> {
  if (isRedisAvailable()) {
    try {
      return await redis.get(key);
    } catch {
      return memGet(key);
    }
  }
  return memGet(key);
}

async function kvSet(key: string, value: string, ttl: number): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await redis.set(key, value, 'EX', ttl);
      return;
    } catch {
      // fallback to memory
    }
  }
  memSet(key, value, ttl);
}

async function kvIncr(key: string, ttl: number): Promise<number> {
  if (isRedisAvailable()) {
    try {
      const result = await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
        1,
        key,
        ttl
      );
      return Number(result);
    } catch {
      // fallback to memory
    }
  }
  return memIncr(key, ttl);
}

async function kvTtl(key: string): Promise<number> {
  if (isRedisAvailable()) {
    try {
      const ttl = await redis.ttl(key);
      return ttl > 0 ? ttl : 3600;
    } catch {
      // fallback
    }
  }
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }
  return 3600;
}

export interface RateLimitResult {
  allowed: boolean;
  requiresCaptcha: boolean;
  blocked: boolean;
  message?: string;
  retryAfter?: number;
}

function isCaptchaEnabled(): boolean {
  return process.env.CAPTCHA_MODE !== 'disabled';
}

export async function checkRateLimit(
  ip: string,
  visitorId: string,
  apiPath: string,
  inputHash?: string
): Promise<RateLimitResult> {
  const { ipPart, visitorPart, pathPart } = rateLimitKeys(ip, visitorId, apiPath);
  const ipKey = `${RATE_LIMIT_NAMESPACE}:ip:${ipPart}:${pathPart}`;
  const ipHighKey = `${RATE_LIMIT_NAMESPACE}:ip_high:${ipPart}:${pathPart}`;
  const visitorKey = `${RATE_LIMIT_NAMESPACE}:visitor:${visitorPart}:${pathPart}`;
  const visitorHighKey = `${RATE_LIMIT_NAMESPACE}:visitor_high:${visitorPart}:${pathPart}`;
  const exemptKey = `${RATE_LIMIT_NAMESPACE}:captcha_exempt:${visitorPart}`;
  const ipBlockKey = `${RATE_LIMIT_NAMESPACE}:blocked:ip:${ipPart}`;
  const visitorBlockKey = `${RATE_LIMIT_NAMESPACE}:blocked:visitor:${visitorPart}`;

  const [ipBlocked, visitorBlocked, exemptUntil] = await Promise.all([
    kvGet(ipBlockKey),
    kvGet(visitorBlockKey),
    kvGet(exemptKey),
  ]);

  if (ipBlocked) {
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: await kvTtl(ipBlockKey),
    };
  }

  if (visitorBlocked) {
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: await kvTtl(visitorBlockKey),
    };
  }

  const [ipCount, ipHighCount, visitorCount, visitorHighCount] = await Promise.all([
    kvGet(ipKey),
    kvGet(ipHighKey),
    kvGet(visitorKey),
    kvGet(visitorHighKey),
  ]);

  const ipNum = parseInt(ipCount || '0');
  const ipHighNum = parseInt(ipHighCount || '0');
  const visitorNum = parseInt(visitorCount || '0');
  const visitorHighNum = parseInt(visitorHighCount || '0');

  if (ipHighNum >= RATE_LIMIT_CONFIG.ip.thresholdHigh) {
    await kvSet(ipBlockKey, 'RATE_LIMIT_EXCEEDED', RATE_LIMIT_CONFIG.blockDuration.ip);
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: RATE_LIMIT_CONFIG.blockDuration.ip,
    };
  }

  if (visitorHighNum >= RATE_LIMIT_CONFIG.visitor.thresholdHigh) {
    await kvSet(visitorBlockKey, 'RATE_LIMIT_EXCEEDED', RATE_LIMIT_CONFIG.blockDuration.visitor);
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: RATE_LIMIT_CONFIG.blockDuration.visitor,
    };
  }

  if (exemptUntil && parseInt(exemptUntil) > Date.now()) {
    return { allowed: true, requiresCaptcha: false, blocked: false };
  }

  if (inputHash) {
    const hashKey = inputHashKey(inputHash);
    const hashCount = await kvGet(hashKey);
    if (hashCount && parseInt(hashCount) > RATE_LIMIT_CONFIG.inputHash.threshold) {
      if (!isCaptchaEnabled()) {
        return {
          allowed: false,
          requiresCaptcha: false,
          blocked: true,
          message: '相同内容请勿重复提交，请稍后再试。',
          retryAfter: await kvTtl(hashKey),
        };
      }
      return {
        allowed: false,
        requiresCaptcha: true,
        blocked: false,
        message: '相同输入重复提交，请先验证。',
      };
    }
  }

  if (ipNum >= RATE_LIMIT_CONFIG.ip.threshold || visitorNum >= RATE_LIMIT_CONFIG.visitor.threshold) {
    if (!isCaptchaEnabled()) {
      const [ipTtl, visitorTtl] = await Promise.all([kvTtl(ipKey), kvTtl(visitorKey)]);
      return {
        allowed: false,
        requiresCaptcha: false,
        blocked: true,
        message: '请求较频繁，请稍后再试。',
        retryAfter: Math.min(ipTtl, visitorTtl),
      };
    }
    return {
      allowed: false,
      requiresCaptcha: true,
      blocked: false,
      message: '请求较频繁，请先完成验证。',
    };
  }

  return { allowed: true, requiresCaptcha: false, blocked: false };
}

export async function incrementRateLimit(ip: string, visitorId: string, apiPath: string, inputHash?: string): Promise<void> {
  const { ipPart, visitorPart, pathPart } = rateLimitKeys(ip, visitorId, apiPath);
  const ipKey = `${RATE_LIMIT_NAMESPACE}:ip:${ipPart}:${pathPart}`;
  const ipHighKey = `${RATE_LIMIT_NAMESPACE}:ip_high:${ipPart}:${pathPart}`;
  const visitorKey = `${RATE_LIMIT_NAMESPACE}:visitor:${visitorPart}:${pathPart}`;
  const visitorHighKey = `${RATE_LIMIT_NAMESPACE}:visitor_high:${visitorPart}:${pathPart}`;

  await Promise.all([
    kvIncr(ipKey, RATE_LIMIT_CONFIG.ip.window),
    kvIncr(ipHighKey, RATE_LIMIT_CONFIG.ip.windowHigh),
    kvIncr(visitorKey, RATE_LIMIT_CONFIG.visitor.window),
    kvIncr(visitorHighKey, RATE_LIMIT_CONFIG.visitor.windowHigh),
  ]);

  if (inputHash) {
    const hashKey = inputHashKey(inputHash);
    await kvIncr(hashKey, RATE_LIMIT_CONFIG.inputHash.window);
  }
}

export async function setCaptchaExempt(visitorId: string): Promise<void> {
  if (typeof visitorId !== 'string' || visitorId.trim().length === 0) return;
  const exemptKey = `${RATE_LIMIT_NAMESPACE}:captcha_exempt:${stableKeyPart(visitorId, 'missing-visitor')}`;
  const exemptUntil = Date.now() + RATE_LIMIT_CONFIG.captchaExempt.duration * 1000;
  await kvSet(exemptKey, exemptUntil.toString(), RATE_LIMIT_CONFIG.captchaExempt.duration);
}

interface TurnstileResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

function captchaFailure(reason: string): { success: false; reason: string } {
  return { success: false, reason };
}

export async function verifyCaptcha(token: string, remoteIp?: string): Promise<{ success: boolean; reason?: string }> {
  const isProduction = process.env.NODE_ENV === 'production';
  const bypassEnabled = process.env.CAPTCHA_BYPASS === 'true';

  if (bypassEnabled && !isProduction) return { success: true };
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (normalizedToken.length === 0 || normalizedToken.length > MAX_CAPTCHA_TOKEN_LENGTH) {
    return captchaFailure('INVALID_TOKEN');
  }

  const normalizedRemoteIp = remoteIp === undefined ? undefined : normalizeIp(remoteIp);
  if (remoteIp !== undefined && !normalizedRemoteIp) return captchaFailure('INVALID_REMOTE_IP');

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return captchaFailure('CAPTCHA_NOT_CONFIGURED');

  const timeoutMs = Math.min(Math.max(Number.parseInt(process.env.TURNSTILE_TIMEOUT_MS || '5000', 10) || 5_000, 1_000), 15_000);
  const form = new URLSearchParams({ secret, response: normalizedToken });
  if (normalizedRemoteIp) form.set('remoteip', normalizedRemoteIp);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return captchaFailure('VERIFICATION_UNAVAILABLE');

    const result = await response.json() as TurnstileResponse;
    if (result.success !== true) {
      const errorCode = result['error-codes']?.[0];
      return captchaFailure(typeof errorCode === 'string' ? errorCode : 'VERIFICATION_FAILED');
    }

    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
    if (expectedHostname && result.hostname?.toLowerCase() !== expectedHostname.toLowerCase()) {
      return captchaFailure('HOSTNAME_MISMATCH');
    }
    const expectedAction = process.env.TURNSTILE_EXPECTED_ACTION?.trim();
    if (expectedAction && result.action !== expectedAction) return captchaFailure('ACTION_MISMATCH');

    return { success: true };
  } catch {
    return captchaFailure('VERIFICATION_UNAVAILABLE');
  }
}

import { redis, isRedisAvailable } from '../../db/redis';

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
    window: 3600,
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

function memGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.count.toString();
  }
  memoryCache.delete(key);
  return null;
}

function memSet(key: string, value: string, ttl: number): void {
  memoryCache.set(key, {
    count: parseInt(value),
    expiresAt: Date.now() + ttl * 1000,
  });
}

function memIncr(key: string, ttl: number): number {
  const entry = memoryCache.get(key);
  const count = entry && entry.expiresAt > Date.now() ? entry.count + 1 : 1;
  memoryCache.set(key, {
    count,
    expiresAt: Date.now() + ttl * 1000,
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
      await redis.set(key, value);
      await redis.expire(key, ttl);
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
      const result = await redis.incr(key);
      await redis.expire(key, ttl);
      return result;
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

export async function checkRateLimit(
  ip: string,
  visitorId: string,
  apiPath: string,
  inputHash?: string
): Promise<RateLimitResult> {
  const ipKey = `ratelimit:ip:${ip}:${apiPath}`;
  const visitorKey = `ratelimit:visitor:${visitorId}:${apiPath}`;
  const exemptKey = `captcha_exempt:${visitorId}`;
  const ipBlockKey = `blocked:ip:${ip}`;
  const visitorBlockKey = `blocked:visitor:${visitorId}`;

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

  if (exemptUntil && parseInt(exemptUntil) > Date.now()) {
    return { allowed: true, requiresCaptcha: false, blocked: false };
  }

  const [ipCount, visitorCount] = await Promise.all([
    kvGet(ipKey),
    kvGet(visitorKey),
  ]);

  const ipNum = parseInt(ipCount || '0');
  const visitorNum = parseInt(visitorCount || '0');

  if (ipNum >= RATE_LIMIT_CONFIG.ip.thresholdHigh) {
    await kvSet(ipBlockKey, 'RATE_LIMIT_EXCEEDED', RATE_LIMIT_CONFIG.blockDuration.ip);
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: RATE_LIMIT_CONFIG.blockDuration.ip,
    };
  }

  if (visitorNum >= RATE_LIMIT_CONFIG.visitor.thresholdHigh) {
    await kvSet(visitorBlockKey, 'RATE_LIMIT_EXCEEDED', RATE_LIMIT_CONFIG.blockDuration.visitor);
    return {
      allowed: false,
      requiresCaptcha: false,
      blocked: true,
      message: '检测次数较多，请稍后再试。',
      retryAfter: RATE_LIMIT_CONFIG.blockDuration.visitor,
    };
  }

  if (inputHash) {
    const hashKey = `ratelimit:input_hash:${inputHash}`;
    const hashCount = await kvGet(hashKey);
    if (hashCount && parseInt(hashCount) > RATE_LIMIT_CONFIG.inputHash.threshold) {
      return {
        allowed: false,
        requiresCaptcha: true,
        blocked: false,
        message: '相同输入重复提交，请先验证。',
      };
    }
  }

  if (ipNum >= RATE_LIMIT_CONFIG.ip.threshold || visitorNum >= RATE_LIMIT_CONFIG.visitor.threshold) {
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
  const ipKey = `ratelimit:ip:${ip}:${apiPath}`;
  const visitorKey = `ratelimit:visitor:${visitorId}:${apiPath}`;

  await Promise.all([
    kvIncr(ipKey, RATE_LIMIT_CONFIG.ip.window),
    kvIncr(visitorKey, RATE_LIMIT_CONFIG.visitor.window),
  ]);

  if (inputHash) {
    const hashKey = `ratelimit:input_hash:${inputHash}`;
    await kvIncr(hashKey, RATE_LIMIT_CONFIG.inputHash.window);
  }
}

export async function setCaptchaExempt(visitorId: string): Promise<void> {
  const exemptKey = `captcha_exempt:${visitorId}`;
  const exemptUntil = Date.now() + RATE_LIMIT_CONFIG.captchaExempt.duration * 1000;
  await kvSet(exemptKey, exemptUntil.toString(), RATE_LIMIT_CONFIG.captchaExempt.duration);
}

export async function verifyCaptcha(token: string): Promise<{ success: boolean; reason?: string }> {
  return Promise.resolve({ success: true });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireAiConcurrency,
  refundAiQuota,
  releaseAiConcurrency,
  reserveAiQuota,
} from '../src/services/aiCostControl';
import { initRedis, redis } from '../src/db/redis';

test('Redis atomically enforces quotas, refunds, and concurrency leases', { timeout: 20_000 }, async () => {
  const previous = {
    AI_CALLS_ENABLED: process.env.AI_CALLS_ENABLED,
    AI_DAILY_CREDIT_LIMIT: process.env.AI_DAILY_CREDIT_LIMIT,
    AI_OCR_CREDIT_COST: process.env.AI_OCR_CREDIT_COST,
    ANON_DAILY_OCR_LIMIT: process.env.ANON_DAILY_OCR_LIMIT,
    IP_DAILY_OCR_LIMIT: process.env.IP_DAILY_OCR_LIMIT,
    AI_MAX_TOTAL_CONCURRENCY: process.env.AI_MAX_TOTAL_CONCURRENCY,
    AI_MAX_OCR_CONCURRENCY: process.env.AI_MAX_OCR_CONCURRENCY,
  };
  Object.assign(process.env, {
    AI_CALLS_ENABLED: 'true',
    AI_DAILY_CREDIT_LIMIT: '9',
    AI_OCR_CREDIT_COST: '3',
    ANON_DAILY_OCR_LIMIT: '3',
    IP_DAILY_OCR_LIMIT: '20',
    AI_MAX_TOTAL_CONCURRENCY: '2',
    AI_MAX_OCR_CONCURRENCY: '1',
  });

  await initRedis();
  await redis.flushdb();
  try {
    const params = { visitorId: 'visitor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ip: '203.0.113.1', operation: 'ocr' as const };
    const first = await reserveAiQuota(params);
    const second = await reserveAiQuota(params);
    const third = await reserveAiQuota(params);
    const fourth = await reserveAiQuota(params);
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, true);
    assert.deepEqual(first.allowed && first.reservation.remaining, 2);
    assert.deepEqual(third.allowed && third.reservation.remaining, 0);
    assert.equal(fourth.allowed, false);
    assert.equal(!fourth.allowed && fourth.reason, 'USER_AI_QUOTA_EXCEEDED');

    if (!third.allowed) throw new Error('Expected the third reservation to succeed');
    await refundAiQuota(third.reservation);
    assert.equal((await reserveAiQuota(params)).allowed, true);

    const globalDenied = await reserveAiQuota({
      visitorId: 'visitor_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ip: '203.0.113.2',
      operation: 'ocr',
    });
    assert.equal(globalDenied.allowed, false);
    assert.equal(!globalDenied.allowed && globalDenied.reason, 'GLOBAL_AI_BUDGET_EXHAUSTED');

    const firstLease = await acquireAiConcurrency('ocr');
    assert.ok(firstLease);
    assert.equal(await acquireAiConcurrency('ocr'), null);
    await releaseAiConcurrency(firstLease);
    const nextLease = await acquireAiConcurrency('ocr');
    assert.ok(nextLease);
    await releaseAiConcurrency(nextLease);
  } finally {
    await redis.flushdb();
    await redis.quit();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

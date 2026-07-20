import assert from 'node:assert/strict';
import test from 'node:test';
import { getAiCostConfig, getShanghaiQuotaWindow } from './aiCostControl';
import { calculateOcrCacheKey } from './screenshotCache';
import { decodeV1Images, imageHashes } from './ocrInput';

const ONE_PIXEL_PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const ONE_PIXEL_PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAC';

test('quota windows reset at midnight in Asia/Shanghai', () => {
  const now = Date.parse('2026-07-15T15:59:30.000Z');
  const window = getShanghaiQuotaWindow(now);
  assert.equal(window.day, '2026-07-15');
  assert.equal(window.resetAt, '2026-07-15T16:00:00.000Z');
  assert.equal(window.ttlMs, 30_000);

  const next = getShanghaiQuotaWindow(Date.parse('2026-07-15T16:00:00.000Z'));
  assert.equal(next.day, '2026-07-16');
  assert.equal(next.resetAt, '2026-07-16T16:00:00.000Z');
});

test('AI cost control uses conservative P0 defaults', () => {
  const names = [
    'AI_DAILY_CREDIT_LIMIT',
    'ANON_DAILY_OCR_LIMIT',
    'ANON_DAILY_ANALYSIS_LIMIT',
    'IP_DAILY_OCR_LIMIT',
    'IP_DAILY_ANALYSIS_LIMIT',
    'AI_MAX_TOTAL_CONCURRENCY',
    'AI_MAX_OCR_CONCURRENCY',
    'AI_MAX_ANALYSIS_CONCURRENCY',
  ];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    const config = getAiCostConfig();
    assert.equal(config.dailyCreditLimit, 300);
    assert.deepEqual(config.visitorLimits, { ocr: 3, analysis: 3 });
    assert.deepEqual(config.ipLimits, { ocr: 20, analysis: 30 });
    assert.equal(config.totalConcurrency, 4);
    assert.deepEqual(config.operationConcurrency, { ocr: 2, analysis: 3 });
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('OCR cache keys are visitor-scoped and bind decoded image order, language, and model', () => {
  const previousModel = process.env.SILICONFLOW_VISION_MODEL;
  process.env.SILICONFLOW_VISION_MODEL = 'vision-a';
  try {
    const visitorA = 'visitor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const visitorB = 'visitor_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const hashes = imageHashes(decodeV1Images([ONE_PIXEL_PNG_A, ONE_PIXEL_PNG_B]));
    const reversed = imageHashes(decodeV1Images([ONE_PIXEL_PNG_B, ONE_PIXEL_PNG_A]));
    const base = calculateOcrCacheKey(visitorA, hashes, 'zh-CN');
    assert.equal(base, calculateOcrCacheKey(visitorA, hashes, 'zh-CN'));
    assert.notEqual(base, calculateOcrCacheKey(visitorB, hashes, 'zh-CN'));
    assert.notEqual(base, calculateOcrCacheKey(visitorA, reversed, 'zh-CN'));
    assert.notEqual(base, calculateOcrCacheKey(visitorA, hashes, 'en-US'));
    process.env.SILICONFLOW_VISION_MODEL = 'vision-b';
    assert.notEqual(base, calculateOcrCacheKey(visitorA, hashes, 'zh-CN'));
  } finally {
    if (previousModel === undefined) delete process.env.SILICONFLOW_VISION_MODEL;
    else process.env.SILICONFLOW_VISION_MODEL = previousModel;
  }
});

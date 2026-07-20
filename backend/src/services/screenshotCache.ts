import crypto from 'crypto';
import { z } from 'zod';
import { isRedisAvailable, redis } from '../db/redis';
import type { ScreenshotExtractResult } from '../types';
import { containsHighSensitiveData } from '../schemas';
import { getVisionModelName, OCR_PROMPT_VERSION } from './screenshotExtraction';

const NAMESPACE = 'ocr-cache:v2';
const cachedExtractionSchema = z.object({
  result: z.object({
    jd_text: z.string().trim().min(1).max(8_000),
    company_name: z.string().trim().max(80).optional(),
    job_title: z.string().trim().max(80).optional(),
    source_platform: z.string().trim().max(30).optional(),
    hr_chat_text: z.string().trim().max(8_000).optional(),
  }).strict(),
  model: z.string().min(1).max(200),
  provider: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
}).strict();

export interface CachedScreenshotExtraction {
  result: ScreenshotExtractResult;
  model: string;
  provider: string;
  createdAt: string;
}

export function isScreenshotExtractionSafeToCache(result: ScreenshotExtractResult): boolean {
  return !containsHighSensitiveData([
    result.jd_text,
    result.company_name,
    result.job_title,
    result.source_platform,
    result.hr_chat_text,
  ]);
}

function boundedCacheTtl(): number {
  const raw = process.env.OCR_CACHE_TTL_SECONDS?.trim();
  if (!raw) return 86_400;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 60 && value <= 604_800 ? value : 86_400;
}

function cacheSecret(): string {
  return process.env.OCR_CACHE_SECRET?.trim() || 'joblens-ocr-cache-v2';
}

export function calculateVisitorIdHash(visitorId: string): string {
  return crypto.createHmac('sha256', cacheSecret()).update(visitorId).digest('hex');
}

export function calculateOcrCacheKey(
  visitorId: string,
  imageHashes: string[],
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    visitorIdHash: calculateVisitorIdHash(visitorId),
    imageHashes,
    language,
    model: getVisionModelName(),
    promptVersion: OCR_PROMPT_VERSION,
  })).digest('hex');
  return `${NAMESPACE}:${digest}`;
}

const singleflight = new Map<string, Promise<unknown>>();

export async function runOcrSingleflight<T>(key: string, runLeader: () => Promise<T>): Promise<{
  value: T;
  leader: boolean;
}> {
  const existing = singleflight.get(key) as Promise<T> | undefined;
  if (existing) return { value: await existing, leader: false };

  const promise = runLeader();
  singleflight.set(key, promise);
  try {
    return { value: await promise, leader: true };
  } finally {
    if (singleflight.get(key) === promise) singleflight.delete(key);
  }
}

export async function getCachedScreenshotExtraction(key: string): Promise<CachedScreenshotExtraction | null> {
  if (!isRedisAvailable()) return null;
  try {
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = cachedExtractionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function setCachedScreenshotExtraction(key: string, value: CachedScreenshotExtraction): Promise<void> {
  if (!isRedisAvailable()) return;
  if (!isScreenshotExtractionSafeToCache(value.result)) return;
  const parsed = cachedExtractionSchema.safeParse(value);
  if (!parsed.success) return;
  try {
    await redis.set(key, JSON.stringify(parsed.data), 'EX', boundedCacheTtl());
  } catch {
    // A cache write failure must not fail an otherwise successful OCR request.
  }
}

export async function deleteCachedScreenshotExtraction(key: string): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    await redis.del(key);
  } catch {
    // A stale entry will expire naturally if deletion fails.
  }
}

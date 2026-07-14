import crypto from 'crypto';
import { z } from 'zod';
import { isRedisAvailable, redis } from '../db/redis';
import type { ScreenshotExtractResult } from '../types';
import { getVisionModelName, OCR_PROMPT_VERSION } from './screenshotExtraction';

const NAMESPACE = 'ocr-cache:v1';
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

function boundedCacheTtl(): number {
  const raw = process.env.OCR_CACHE_TTL_SECONDS?.trim();
  if (!raw) return 86_400;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 60 && value <= 604_800 ? value : 86_400;
}

function imageBytes(image: string): Buffer {
  const separator = image.indexOf(',');
  if (separator < 0) throw new Error('Invalid image data URL');
  return Buffer.from(image.slice(separator + 1), 'base64');
}

export function calculateOcrCacheKey(images: string[], language: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const imageHashes = images.map(image => crypto.createHash('sha256').update(imageBytes(image)).digest('hex'));
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    imageHashes,
    language,
    model: getVisionModelName(),
    promptVersion: OCR_PROMPT_VERSION,
  })).digest('hex');
  return `${NAMESPACE}:${digest}`;
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
  const parsed = cachedExtractionSchema.safeParse(value);
  if (!parsed.success) return;
  try {
    await redis.set(key, JSON.stringify(parsed.data), 'EX', boundedCacheTtl());
  } catch {
    // A cache write failure must not fail an otherwise successful OCR request.
  }
}

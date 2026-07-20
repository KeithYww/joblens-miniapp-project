import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';

export const OCR_OPERATION_KEY = 'ocr.extract-job';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 6 * 1024 * 1024;
export const MAX_MULTIPART_BODY_BYTES = MAX_TOTAL_FILE_BYTES + 128 * 1024;
export const MAX_FILES = 3;
export const MAX_FIELDS = 2;
export const MAX_PARTS = 5;
export const MAX_FIELD_NAME_BYTES = 32;
export const MAX_FIELD_BYTES = 4096;
export const MAX_HEADER_PAIRS = 16;
export const MAX_IMAGE_WIDTH = 16384;
export const MAX_IMAGE_HEIGHT = 16384;
export const MAX_PIXELS_PER_IMAGE = 20_000_000;
export const MAX_TOTAL_PIXELS = 40_000_000;

export type OcrLanguage = 'zh-CN' | 'en-US';
export type OcrImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface OcrImageInput {
  bytes: Buffer;
  mime: OcrImageMime;
}

export interface OcrInput {
  images: OcrImageInput[];
  language?: OcrLanguage;
  captchaToken?: string;
}

export type OcrUploadErrorCode =
  | 'OCR_INVALID_MULTIPART'
  | 'OCR_TOO_MANY_FILES'
  | 'OCR_UNSUPPORTED_IMAGE'
  | 'OCR_IMAGE_DIMENSIONS_EXCEEDED'
  | 'OCR_FIELD_TOO_LARGE'
  | 'OCR_FILE_TOO_LARGE'
  | 'OCR_TOTAL_SIZE_EXCEEDED'
  | 'OCR_MULTIPART_BODY_TOO_LARGE';

const ERROR_STATUS: Record<OcrUploadErrorCode, 400 | 413> = {
  OCR_INVALID_MULTIPART: 400,
  OCR_TOO_MANY_FILES: 400,
  OCR_UNSUPPORTED_IMAGE: 400,
  OCR_IMAGE_DIMENSIONS_EXCEEDED: 400,
  OCR_FIELD_TOO_LARGE: 400,
  OCR_FILE_TOO_LARGE: 413,
  OCR_TOTAL_SIZE_EXCEEDED: 413,
  OCR_MULTIPART_BODY_TOO_LARGE: 413,
};

const ERROR_MESSAGES: Record<OcrUploadErrorCode, string> = {
  OCR_INVALID_MULTIPART: '上传表单格式错误。',
  OCR_TOO_MANY_FILES: '最多只能上传 3 张图片。',
  OCR_UNSUPPORTED_IMAGE: '图片格式不受支持或文件已损坏。',
  OCR_IMAGE_DIMENSIONS_EXCEEDED: '图片尺寸或像素数超过限制。',
  OCR_FIELD_TOO_LARGE: '上传字段超过大小限制。',
  OCR_FILE_TOO_LARGE: '单张图片不能超过 2MB。',
  OCR_TOTAL_SIZE_EXCEEDED: '图片总大小不能超过 6MB。',
  OCR_MULTIPART_BODY_TOO_LARGE: '上传请求体超过大小限制。',
};

export class OcrUploadError extends Error {
  readonly statusCode: 400 | 413;

  constructor(readonly code: OcrUploadErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'OcrUploadError';
    this.statusCode = ERROR_STATUS[code];
  }
}

function declaredMime(value: string): OcrImageMime | null {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' ? value : null;
}

function magicMime(bytes: Buffer): OcrImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function imageHashes(images: OcrImageInput[]): string[] {
  return images.map(image => crypto.createHash('sha256').update(image.bytes).digest('hex'));
}

export function calculateOcrWriteHash(
  ownerId: string,
  hashes: string[],
  language: OcrLanguage = 'zh-CN',
): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    ownerId,
    operation: OCR_OPERATION_KEY,
    imageHashes: hashes,
    language,
  })).digest('hex');
}

export function toProviderDataUrl(image: OcrImageInput): string {
  return `data:${image.mime};base64,${image.bytes.toString('base64')}`;
}

export function decodeV1Images(dataUrls: string[]): OcrImageInput[] {
  return dataUrls.map(dataUrl => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new OcrUploadError('OCR_UNSUPPORTED_IMAGE');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_FILE_BYTES) throw new OcrUploadError('OCR_FILE_TOO_LARGE');
    return { bytes, mime: match[1] as OcrImageMime };
  });
}

export async function validateOcrImages(images: OcrImageInput[]): Promise<void> {
  if (images.length === 0) throw new OcrUploadError('OCR_INVALID_MULTIPART');
  if (images.length > MAX_FILES) throw new OcrUploadError('OCR_TOO_MANY_FILES');

  let totalBytes = 0;
  let totalPixels = 0;
  for (const image of images) {
    if (image.bytes.length > MAX_FILE_BYTES) throw new OcrUploadError('OCR_FILE_TOO_LARGE');
    totalBytes += image.bytes.length;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) throw new OcrUploadError('OCR_TOTAL_SIZE_EXCEEDED');
    if (magicMime(image.bytes) !== image.mime) throw new OcrUploadError('OCR_UNSUPPORTED_IMAGE');

    try {
      const decoder = sharp(image.bytes, { animated: true, failOn: 'error', limitInputPixels: false });
      const metadata = await decoder.metadata();
      if (metadata.format !== image.mime.slice('image/'.length) || (metadata.pages ?? 1) !== 1) {
        throw new OcrUploadError('OCR_UNSUPPORTED_IMAGE');
      }
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      const pixels = width * height;
      if (
        width < 1 || height < 1
        || width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT
        || !Number.isSafeInteger(pixels) || pixels > MAX_PIXELS_PER_IMAGE
      ) {
        throw new OcrUploadError('OCR_IMAGE_DIMENSIONS_EXCEEDED');
      }
      totalPixels += pixels;
      if (totalPixels > MAX_TOTAL_PIXELS) throw new OcrUploadError('OCR_IMAGE_DIMENSIONS_EXCEEDED');

      // Force the codec to decode pixels while keeping the decoded output bounded.
      await decoder.clone().resize(1, 1, { fit: 'fill' }).raw().toBuffer();
    } catch (error) {
      if (error instanceof OcrUploadError) throw error;
      throw new OcrUploadError('OCR_UNSUPPORTED_IMAGE');
    }
  }
}

async function readBoundedFile(
  stream: NodeJS.ReadableStream & { truncated?: boolean },
  runningTotal: { bytes: number },
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value)
        ? value
        : typeof value === 'string'
          ? Buffer.from(value)
          : Buffer.from(value as unknown as Uint8Array);
      size += chunk.length;
      runningTotal.bytes += chunk.length;
      if (size > MAX_FILE_BYTES || stream.truncated) throw new OcrUploadError('OCR_FILE_TOO_LARGE');
      if (runningTotal.bytes > MAX_TOTAL_FILE_BYTES) throw new OcrUploadError('OCR_TOTAL_SIZE_EXCEEDED');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof OcrUploadError) throw error;
    throw new OcrUploadError('OCR_INVALID_MULTIPART');
  }
  if (stream.truncated) throw new OcrUploadError('OCR_FILE_TOO_LARGE');
  return Buffer.concat(chunks, size);
}

function mapMultipartParserError(app: FastifyInstance, error: unknown): OcrUploadError {
  if (error instanceof OcrUploadError) return error;
  if (error instanceof app.multipartErrors.RequestFileTooLargeError) return new OcrUploadError('OCR_FILE_TOO_LARGE');
  if (error instanceof app.multipartErrors.FilesLimitError || error instanceof app.multipartErrors.PartsLimitError) {
    return new OcrUploadError('OCR_TOO_MANY_FILES');
  }
  if (error instanceof app.multipartErrors.FieldsLimitError) return new OcrUploadError('OCR_INVALID_MULTIPART');
  if ((error as { code?: string } | null)?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new OcrUploadError('OCR_MULTIPART_BODY_TOO_LARGE');
  }
  return new OcrUploadError('OCR_INVALID_MULTIPART');
}

export async function parseOcrMultipart(request: FastifyRequest, app: FastifyInstance): Promise<OcrInput> {
  if (!request.isMultipart()) throw new OcrUploadError('OCR_INVALID_MULTIPART');
  const images: OcrImageInput[] = [];
  const fields = new Map<string, string>();
  const runningTotal = { bytes: 0 };

  try {
    for await (const part of request.parts()) {
      if (Buffer.byteLength(part.fieldname) > MAX_FIELD_NAME_BYTES) throw new OcrUploadError('OCR_FIELD_TOO_LARGE');
      if (part.type === 'file') {
        if (part.fieldname !== 'images') throw new OcrUploadError('OCR_INVALID_MULTIPART');
        if (images.length >= MAX_FILES) throw new OcrUploadError('OCR_TOO_MANY_FILES');
        const mime = declaredMime(part.mimetype);
        if (!mime) throw new OcrUploadError('OCR_UNSUPPORTED_IMAGE');
        const bytes = await readBoundedFile(part.file, runningTotal);
        images.push({ bytes, mime });
        continue;
      }

      if (part.fieldname !== 'language' && part.fieldname !== 'captcha_token') {
        throw new OcrUploadError('OCR_INVALID_MULTIPART');
      }
      if (part.fieldnameTruncated || part.valueTruncated) throw new OcrUploadError('OCR_FIELD_TOO_LARGE');
      if (fields.has(part.fieldname) || typeof part.value !== 'string') throw new OcrUploadError('OCR_INVALID_MULTIPART');
      if (Buffer.byteLength(part.value) > MAX_FIELD_BYTES) throw new OcrUploadError('OCR_FIELD_TOO_LARGE');
      fields.set(part.fieldname, part.value);
    }
  } catch (error) {
    throw mapMultipartParserError(app, error);
  }

  const language = fields.get('language');
  if (language !== undefined && language !== 'zh-CN' && language !== 'en-US') {
    throw new OcrUploadError('OCR_INVALID_MULTIPART');
  }
  await validateOcrImages(images);
  return {
    images,
    language: language as OcrLanguage | undefined,
    captchaToken: fields.get('captcha_token'),
  };
}

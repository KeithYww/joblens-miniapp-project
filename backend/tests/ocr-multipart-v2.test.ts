import assert from 'node:assert/strict';
import test from 'node:test';
import fastify from 'fastify';
import sharp from 'sharp';
import { registerRoutes } from '../src/routes';
import {
  calculateOcrWriteHash,
  decodeV1Images,
  imageHashes,
  MAX_FIELD_BYTES,
  MAX_FILE_BYTES,
  MAX_MULTIPART_BODY_BYTES,
  OCR_OPERATION_KEY,
  validateOcrImages,
} from '../src/services/ocrInput';
import { calculateOcrCacheKey } from '../src/services/screenshotCache';

const VISITOR = 'visitor_0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

interface MultipartPart {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

function multipartPayload(parts: MultipartPart[], boundary = 'joblens-test-boundary'): { payload: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    const disposition = part.filename === undefined
      ? `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
      : `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`;
    chunks.push(Buffer.from(disposition), Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function makeApp() {
  const app = fastify({ logger: false });
  await registerRoutes(app);
  return app;
}

async function postV2(app: Awaited<ReturnType<typeof makeApp>>, parts: MultipartPart[]) {
  const body = multipartPayload(parts);
  return app.inject({
    method: 'POST',
    url: '/api/ocr/extract-job-v2',
    headers: { 'x-visitor-id': VISITOR, 'content-type': body.contentType },
    payload: body.payload,
  });
}

test('capabilities defaults to json-v1 and supports runtime multipart-v2 rollback mode', async () => {
  const previous = process.env.OCR_UPLOAD_MODE;
  const app = await makeApp();
  try {
    delete process.env.OCR_UPLOAD_MODE;
    const defaults = await app.inject({ method: 'GET', url: '/api/capabilities' });
    assert.equal(defaults.statusCode, 200);
    assert.equal(defaults.headers['cache-control'], 'no-store');
    assert.deepEqual(defaults.json(), { preferred_ocr_upload_mode: 'json-v1' });

    process.env.OCR_UPLOAD_MODE = 'multipart-v2';
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/capabilities' })).json(), {
      preferred_ocr_upload_mode: 'multipart-v2',
    });
    process.env.OCR_UPLOAD_MODE = 'invalid';
    assert.equal((await app.inject({ method: 'GET', url: '/api/capabilities' })).json().preferred_ocr_upload_mode, 'json-v1');
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.OCR_UPLOAD_MODE;
    else process.env.OCR_UPLOAD_MODE = previous;
  }
});

test('v1 and v2 use identical decoded-byte hashes, write hashes, and cache keys', () => {
  const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
  const v1Hashes = imageHashes(decodeV1Images([dataUrl]));
  const v2Hashes = imageHashes([{ bytes: PNG, mime: 'image/png' }]);
  assert.deepEqual(v1Hashes, v2Hashes);
  assert.equal(OCR_OPERATION_KEY, 'ocr.extract-job');
  assert.equal(calculateOcrWriteHash(VISITOR, v1Hashes), calculateOcrWriteHash(VISITOR, v2Hashes));
  assert.equal(calculateOcrCacheKey(VISITOR, v1Hashes), calculateOcrCacheKey(VISITOR, v2Hashes));
});

test('valid v1 and multipart v2 reach the same pre-provider AI control result', async () => {
  const previous = process.env.AI_CALLS_ENABLED;
  process.env.AI_CALLS_ENABLED = 'false';
  const app = await makeApp();
  try {
    const v1 = await app.inject({
      method: 'POST',
      url: '/api/ocr/extract-job',
      headers: { 'x-visitor-id': VISITOR },
      payload: { images: [`data:image/png;base64,${PNG.toString('base64')}`] },
    });
    const v2 = await postV2(app, [{ name: 'images', value: PNG, filename: 'screen.png', contentType: 'image/png' }]);
    assert.equal(v1.statusCode, 503);
    assert.equal(v2.statusCode, 503);
    assert.equal(v1.json().error, 'AI_DISABLED');
    assert.equal(v2.json().error, 'AI_DISABLED');
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.AI_CALLS_ENABLED;
    else process.env.AI_CALLS_ENABLED = previous;
  }
});

test('multipart rejects MIME forgery and malformed fields before AI', async () => {
  const app = await makeApp();
  try {
    const forged = await postV2(app, [{ name: 'images', value: PNG, filename: 'screen.jpg', contentType: 'image/jpeg' }]);
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error, 'OCR_UNSUPPORTED_IMAGE');

    const duplicate = await postV2(app, [
      { name: 'images', value: PNG, filename: 'screen.png', contentType: 'image/png' },
      { name: 'language', value: 'zh-CN' },
      { name: 'language', value: 'en-US' },
    ]);
    assert.equal(duplicate.statusCode, 400);
    assert.equal(duplicate.json().error, 'OCR_INVALID_MULTIPART');

    const unknown = await postV2(app, [
      { name: 'images', value: PNG, filename: 'screen.png', contentType: 'image/png' },
      { name: 'extra', value: 'not-allowed' },
    ]);
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error, 'OCR_INVALID_MULTIPART');
  } finally {
    await app.close();
  }
});

test('multipart maps file, field, and file-count boundaries to stable errors', { timeout: 30_000 }, async () => {
  const app = await makeApp();
  try {
    const oversized = Buffer.alloc(MAX_FILE_BYTES + 1, 0);
    PNG.copy(oversized);
    const fileResponse = await postV2(app, [{ name: 'images', value: oversized, filename: 'large.png', contentType: 'image/png' }]);
    assert.equal(fileResponse.statusCode, 413);
    assert.equal(fileResponse.json().error, 'OCR_FILE_TOO_LARGE');

    const fieldResponse = await postV2(app, [
      { name: 'images', value: PNG, filename: 'screen.png', contentType: 'image/png' },
      { name: 'captcha_token', value: 'x'.repeat(MAX_FIELD_BYTES + 1) },
    ]);
    assert.equal(fieldResponse.statusCode, 400);
    assert.equal(fieldResponse.json().error, 'OCR_FIELD_TOO_LARGE');

    const fourFiles = await postV2(app, Array.from({ length: 4 }, (_, index) => ({
      name: 'images', value: PNG, filename: `screen-${index}.png`, contentType: 'image/png',
    })));
    assert.equal(fourFiles.statusCode, 400);
    assert.equal(fourFiles.json().error, 'OCR_TOO_MANY_FILES');
  } finally {
    await app.close();
  }
});

test('multipart body limit and truncated streams have distinct stable errors', async () => {
  const app = await makeApp();
  try {
    const boundary = 'joblens-body-limit';
    const oversizedBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="captcha_token"\r\n\r\n`),
      Buffer.alloc(MAX_MULTIPART_BODY_BYTES, 120),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/ocr/extract-job-v2',
      headers: { 'x-visitor-id': VISITOR, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: oversizedBody,
    });
    assert.equal(tooLarge.statusCode, 413);
    assert.equal(tooLarge.json().error, 'OCR_MULTIPART_BODY_TOO_LARGE');

    const truncatedBoundary = 'joblens-truncated';
    const truncated = await app.inject({
      method: 'POST',
      url: '/api/ocr/extract-job-v2',
      headers: { 'x-visitor-id': VISITOR, 'content-type': `multipart/form-data; boundary=${truncatedBoundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${truncatedBoundary}\r\nContent-Disposition: form-data; name="images"; filename="screen.png"\r\nContent-Type: image/png\r\n\r\n`),
        PNG,
      ]),
    });
    assert.equal(truncated.statusCode, 400);
    assert.equal(truncated.json().error, 'OCR_INVALID_MULTIPART');
  } finally {
    await app.close();
  }
});

test('image dimensions are validated before provider use', { timeout: 30_000 }, async () => {
  const tooWide = await sharp({
    create: { width: 16_385, height: 1, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  await assert.rejects(
    validateOcrImages([{ bytes: tooWide, mime: 'image/png' }]),
    (error: unknown) => (error as { code?: string }).code === 'OCR_IMAGE_DIMENSIONS_EXCEEDED',
  );
});

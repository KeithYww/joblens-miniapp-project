import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from './index';
import { requestJson } from './request';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function abortableFetch() {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
}

describe('requestJson', () => {
  it('classifies caller cancellation', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const controller = new AbortController();
    const request = requestJson('/slow', { signal: controller.signal, timeoutMs: 10_000 });

    controller.abort();

    await expect(request).rejects.toMatchObject({
      kind: 'cancelled',
      code: 'CLIENT_CANCELLED',
    });
  });

  it('classifies a request timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortableFetch());
    const request = requestJson('/slow', { timeoutMs: 25 });
    const rejection = expect(request).rejects.toMatchObject({
      kind: 'timeout',
      code: 'CLIENT_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it('classifies invalid JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'X-Request-Id': 'req-test' },
    })));

    await expect(requestJson('/broken')).rejects.toMatchObject({
      kind: 'decode',
      code: 'INVALID_RESPONSE',
      status: 502,
      requestId: 'req-test',
    });
  });
});

describe('OCR multipart client', () => {
  it('lets the browser create the multipart boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jd_text: 'Test role' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.ocr.extractJobV2({
      images: [new File(['image'], 'job.png', { type: 'image/png' })],
      language: 'en-US',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(new Headers(init.headers).get('X-Visitor-Id')).toMatch(/^visitor_[a-f0-9]{32}$/);
  });

  it('keeps structured client errors for API callers', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const controller = new AbortController();
    const request = api.capabilities.get({ signal: controller.signal });
    controller.abort();

    const error = await request.catch(value => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'CLIENT_CANCELLED' });
  });
});

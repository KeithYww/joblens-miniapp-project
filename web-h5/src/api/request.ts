export type ApiErrorKind = 'cancelled' | 'timeout' | 'network' | 'http' | 'decode';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export interface ClientApiErrorDetails {
  kind: ApiErrorKind;
  code: string;
  message: string;
  status?: number;
  retryAfter?: string;
  requestId?: string;
  body?: unknown;
}

export class ClientApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly status?: number;
  readonly retryAfter?: string;
  readonly requestId?: string;
  readonly body?: unknown;

  constructor(details: ClientApiErrorDetails) {
    super(details.message);
    this.name = 'ClientApiError';
    this.kind = details.kind;
    this.code = details.code;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
    this.requestId = details.requestId;
    this.body = details.body;
  }
}

type ErrorFactory = (details: ClientApiErrorDetails) => ClientApiError;

const DEFAULT_ERROR_FACTORY: ErrorFactory = (details) => new ClientApiError(details);

function errorMetadata(response?: Response) {
  return {
    status: response?.status,
    retryAfter: response?.headers.get('Retry-After') ?? undefined,
    requestId: response?.headers.get('X-Request-Id') ?? undefined,
  };
}

export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
  createError: ErrorFactory = DEFAULT_ERROR_FACTORY,
): Promise<T> {
  const { timeoutMs, signal: externalSignal, ...requestInit } = options;
  const controller = new AbortController();
  let abortKind: 'cancelled' | 'timeout' | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abort = (kind: 'cancelled' | 'timeout') => {
    if (abortKind !== undefined) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = () => abort('cancelled');

  try {
    if (externalSignal?.aborted) {
      abort('cancelled');
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }
    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => abort('timeout'), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...requestInit, signal: controller.signal });
    } catch {
      if (abortKind === 'cancelled') {
        throw createError({
          kind: 'cancelled',
          code: 'CLIENT_CANCELLED',
          message: '请求已取消。',
        });
      }
      if (abortKind === 'timeout') {
        throw createError({
          kind: 'timeout',
          code: 'CLIENT_TIMEOUT',
          message: '请求超时，请重试或手动填写。',
        });
      }
      throw createError({
        kind: 'network',
        code: 'NETWORK_ERROR',
        message: '暂时无法连接服务，请检查网络后重试。',
      });
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      const metadata = errorMetadata(response);
      if (abortKind === 'cancelled') {
        throw createError({
          kind: 'cancelled',
          code: 'CLIENT_CANCELLED',
          message: '请求已取消。',
          ...metadata,
        });
      }
      if (abortKind === 'timeout') {
        throw createError({
          kind: 'timeout',
          code: 'CLIENT_TIMEOUT',
          message: '请求超时，请重试或手动填写。',
          ...metadata,
        });
      }
      throw createError({
        kind: 'network',
        code: 'NETWORK_ERROR',
        message: '读取服务响应失败，请重试。',
        ...metadata,
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw createError({
        kind: 'decode',
        code: 'INVALID_RESPONSE',
        message: response.ok ? '服务响应格式异常。' : `服务暂时不可用（${response.status}）。`,
        ...errorMetadata(response),
      });
    }

    if (!response.ok) {
      const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
      throw createError({
        kind: 'http',
        code: typeof record.error === 'string' ? record.error : 'HTTP_ERROR',
        message: typeof record.message === 'string' ? record.message : '服务暂时不可用。',
        ...errorMetadata(response),
        retryAfter: typeof record.retry_after === 'string'
          ? record.retry_after
          : response.headers.get('Retry-After') ?? undefined,
        body,
      });
    }

    return body as T;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

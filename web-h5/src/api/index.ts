import type {
  RiskReport,
  HrAnalysis,
  DetectRequest,
  HrAnalysisRequest,
  InterviewFeedbackRequest,
  ReportFeedbackRequest,
  ScreenshotExtractRequest,
  ScreenshotExtractResult,
  AiQuotaSnapshot,
  ApiError,
  ClientErrorReport,
  ApiCapabilities,
  ScreenshotExtractV2Request,
} from '@/types';
import {
  ClientApiError,
  requestJson,
  type ClientApiErrorDetails,
} from './request';

export type { ApiErrorKind } from './request';

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const CUSTOM_API_URL_KEY = 'custom_api_base_url';

function getApiBaseUrl(): string {
  const customUrl = localStorage.getItem(CUSTOM_API_URL_KEY);
  if (customUrl && customUrl.trim()) {
    return customUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  }
  const configuredApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';
  return configuredApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');
}

let API_BASE_URL = getApiBaseUrl();

export function setApiBaseUrl(url: string) {
  if (url && url.trim()) {
    localStorage.setItem(CUSTOM_API_URL_KEY, url.trim());
  } else {
    localStorage.removeItem(CUSTOM_API_URL_KEY);
  }
  API_BASE_URL = getApiBaseUrl();
}

export function getStoredApiBaseUrl(): string {
  return localStorage.getItem(CUSTOM_API_URL_KEY) || '';
}

export class ApiRequestError extends ClientApiError {
  readonly captchaProvider?: string;

  constructor(error: ApiError | ClientApiErrorDetails) {
    const structured = 'kind' in error
      ? error
      : {
          kind: 'http' as const,
          code: error.error,
          message: error.message || '请求失败',
          retryAfter: error.retry_after,
          body: error,
        };
    super(structured);
    this.name = 'ApiRequestError';
    const body = structured.body as Partial<ApiError> | undefined;
    this.captchaProvider = body?.captcha_provider;
  }
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getVisitorId(): string {
  let visitorId = localStorage.getItem('visitor_id');
  if (!visitorId || !/^visitor_(?:[a-f0-9]{12}|[a-f0-9]{32})$/.test(visitorId)) {
    visitorId = `visitor_${generateUUID().replace(/-/g, '')}`;
    localStorage.setItem('visitor_id', visitorId);
  }
  return visitorId;
}

async function fetchApi<T>(
  path: string,
  options: RequestInit = {},
  requestOptions: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('X-Visitor-Id', getVisitorId());
  const timeoutMs = requestOptions.timeoutMs
    ?? (options.method && options.method !== 'GET' ? 30_000 : 15_000);
  return requestJson<T>(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    signal: requestOptions.signal,
    timeoutMs,
  }, (details) => new ApiRequestError(details));
}

export const api = {
  monitoring: {
    reportClientError: async (data: ClientErrorReport, options?: ApiRequestOptions): Promise<void> => {
      await fetchApi('/api/client-errors', {
        method: 'POST',
        body: JSON.stringify(data),
      }, { ...options, timeoutMs: options?.timeoutMs ?? 5_000 });
    },
  },
  quota: {
    get: async (options?: ApiRequestOptions): Promise<AiQuotaSnapshot> => fetchApi('/api/ai-quota', {}, options),
  },
  capabilities: {
    get: async (options?: ApiRequestOptions): Promise<ApiCapabilities> => fetchApi('/api/capabilities', {}, options),
  },
  ocr: {
    extractJob: async (data: ScreenshotExtractRequest, options?: ApiRequestOptions): Promise<ScreenshotExtractResult> => {
      return fetchApi('/api/ocr/extract-job', {
        method: 'POST',
        body: JSON.stringify(data),
      }, { ...options, timeoutMs: options?.timeoutMs ?? 70_000 });
    },
    extractJobV2: async (data: ScreenshotExtractV2Request, options?: ApiRequestOptions): Promise<ScreenshotExtractResult> => {
      const form = new FormData();
      data.images.forEach((image) => form.append('images', image));
      if (data.language) form.append('language', data.language);
      if (data.captcha_token) form.append('captcha_token', data.captcha_token);
      return fetchApi('/api/ocr/extract-job-v2', {
        method: 'POST',
        body: form,
      }, { ...options, timeoutMs: options?.timeoutMs ?? 70_000 });
    },
  },
  reports: {
    detect: async (data: DetectRequest, options?: ApiRequestOptions): Promise<RiskReport> => {
      return fetchApi('/api/reports/detect', {
        method: 'POST',
        body: JSON.stringify(data),
      }, { ...options, timeoutMs: options?.timeoutMs ?? 75_000 });
    },
    get: async (id: string, language?: 'zh-CN' | 'en-US', options?: ApiRequestOptions): Promise<RiskReport> => {
      const query = language ? `?language=${encodeURIComponent(language)}` : '';
      return fetchApi(`/api/reports/${id}${query}`, {}, options);
    },
    delete: async (id: string, captchaToken?: string, options?: ApiRequestOptions): Promise<{ status: string; message: string; deleted_at: string }> => {
      return fetchApi(`/api/reports/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ captcha_token: captchaToken || undefined }),
      }, options);
    },
    hrAnalysis: async (
      reportId: string,
      data: Omit<HrAnalysisRequest, 'report_id'>,
      options?: ApiRequestOptions,
    ): Promise<HrAnalysis> => {
      return fetchApi(`/api/reports/${reportId}/hr-analysis`, {
        method: 'POST',
        body: JSON.stringify({ ...data, report_id: reportId }),
      }, options);
    },
  },
  hrAnalysis: {
    analyze: async (data: HrAnalysisRequest, options?: ApiRequestOptions): Promise<HrAnalysis> => {
      return fetchApi('/api/hr-analysis', {
        method: 'POST',
        body: JSON.stringify(data),
      }, options);
    },
  },
  feedbacks: {
    interview: async (data: InterviewFeedbackRequest, options?: ApiRequestOptions): Promise<{
      feedback_id: string;
      status: string;
      message: string;
      created_at: string;
    }> => {
      return fetchApi('/api/interview-feedbacks', {
        method: 'POST',
        body: JSON.stringify(data),
      }, options);
    },
    report: async (data: ReportFeedbackRequest, options?: ApiRequestOptions): Promise<{
      feedback_id: string;
      status: string;
      message: string;
      created_at: string;
    }> => {
      return fetchApi('/api/report-feedbacks', {
        method: 'POST',
        body: JSON.stringify(data),
      }, options);
    },
  },
  visitorData: {
    deleteAll: async (captchaToken?: string, options?: ApiRequestOptions): Promise<{ status: string; message: string; deleted_at: string }> => {
      return fetchApi('/api/visitor-data', {
        method: 'DELETE',
        body: JSON.stringify({ captcha_token: captchaToken || undefined }),
      }, options);
    },
  },
};

export { getVisitorId };

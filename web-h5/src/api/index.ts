import type {
  RiskReport,
  HrAnalysis,
  DetectRequest,
  HrAnalysisRequest,
  InterviewFeedbackRequest,
  ReportFeedbackRequest,
  ScreenshotExtractRequest,
  ScreenshotExtractResult,
  ApiError,
} from '@/types';

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');

export class ApiRequestError extends Error {
  readonly code: string;
  readonly captchaProvider?: string;
  readonly retryAfter?: string;

  constructor(error: ApiError) {
    super(error.message || '请求失败');
    this.name = 'ApiRequestError';
    this.code = error.error;
    this.captchaProvider = error.captcha_provider;
    this.retryAfter = error.retry_after;
  }
}

function getVisitorId(): string {
  let visitorId = localStorage.getItem('visitor_id');
  if (!visitorId || !/^visitor_(?:[a-f0-9]{12}|[a-f0-9]{32})$/.test(visitorId)) {
    visitorId = `visitor_${crypto.randomUUID().replace(/-/g, '')}`;
    localStorage.setItem('visitor_id', visitorId);
  }
  return visitorId;
}

async function fetchApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Visitor-Id', getVisitorId());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  let data: T | ApiError;
  try {
    data = await response.json() as T | ApiError;
  } catch {
    throw new ApiRequestError({
      error: 'INVALID_RESPONSE',
      message: response.ok ? '服务响应格式异常。' : `服务暂时不可用（${response.status}）。`,
    });
  }

  if (!response.ok) {
    throw new ApiRequestError(data as ApiError);
  }

  return data as T;
}

export const api = {
  ocr: {
    extractJob: async (data: ScreenshotExtractRequest): Promise<ScreenshotExtractResult> => {
      return fetchApi('/api/ocr/extract-job', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  reports: {
    detect: async (data: DetectRequest): Promise<RiskReport> => {
      return fetchApi('/api/reports/detect', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    get: async (id: string): Promise<RiskReport> => {
      return fetchApi(`/api/reports/${id}`);
    },
    delete: async (id: string, captchaToken?: string): Promise<{ status: string; message: string; deleted_at: string }> => {
      return fetchApi(`/api/reports/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ captcha_token: captchaToken || undefined }),
      });
    },
    hrAnalysis: async (
      reportId: string,
      data: Omit<HrAnalysisRequest, 'report_id'>
    ): Promise<HrAnalysis> => {
      return fetchApi(`/api/reports/${reportId}/hr-analysis`, {
        method: 'POST',
        body: JSON.stringify({ ...data, report_id: reportId }),
      });
    },
  },
  hrAnalysis: {
    analyze: async (data: HrAnalysisRequest): Promise<HrAnalysis> => {
      return fetchApi('/api/hr-analysis', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  feedbacks: {
    interview: async (data: InterviewFeedbackRequest): Promise<{
      feedback_id: string;
      status: string;
      message: string;
      created_at: string;
    }> => {
      return fetchApi('/api/interview-feedbacks', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    report: async (data: ReportFeedbackRequest): Promise<{
      feedback_id: string;
      status: string;
      message: string;
      created_at: string;
    }> => {
      return fetchApi('/api/report-feedbacks', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  visitorData: {
    deleteAll: async (captchaToken?: string): Promise<{ status: string; message: string; deleted_at: string }> => {
      return fetchApi('/api/visitor-data', {
        method: 'DELETE',
        body: JSON.stringify({ captcha_token: captchaToken || undefined }),
      });
    },
  },
};

export { getVisitorId };

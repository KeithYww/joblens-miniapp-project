import type {
  RiskReport,
  HrAnalysis,
  DetectRequest,
  HrAnalysisRequest,
  InterviewFeedbackRequest,
  ReportFeedbackRequest,
  ApiError,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function getVisitorId(): string {
  let visitorId = localStorage.getItem('visitor_id');
  if (!visitorId) {
    visitorId = `visitor_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
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

  const data = await response.json();

  if (!response.ok) {
    throw data as ApiError;
  }

  return data;
}

export const api = {
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
    delete: async (id: string): Promise<{ status: string; message: string; deleted_at: string }> => {
      return fetchApi(`/api/reports/${id}`, {
        method: 'DELETE',
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
};

export { getVisitorId };

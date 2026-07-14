const configuredApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');

export class AdminApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export interface AdminReport {
  report_id: string;
  source_platform: string | null;
  company_name: string | null;
  job_title: string | null;
  jd_text: string;
  hr_chat_text: string | null;
  overall_score: number;
  risk_level: string;
  confidence: string;
  predicted_role: string | null;
  risk_types: string[];
  evidence: string[];
  missing_info: string[];
  questions: string[];
  recommendation: string;
  analysis_source: 'model' | 'fallback';
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_estimate: number;
  created_at: string;
}

export interface AdminOverview {
  days: number;
  generated_at: string;
  kpis: {
    reports: number;
    model_call_rate: number;
    high_risk_rate: number;
    average_risk_score: number;
    estimated_cost: number;
    average_latency_ms: number;
    pending_feedback: number;
  };
  trend: Array<{ date: string; reports: number; model_calls: number; high_risk: number }>;
  risk_distribution: Array<{ label: string; count: number }>;
  model_distribution: Array<{ provider: string; model: string; count: number }>;
  recent_reports: AdminReport[];
  system: {
    database: boolean;
    redis: boolean;
    ai_budget: { available: boolean; used: number; limit: number; usage_ratio: number; reset_at: string };
  };
}

export interface AdminFeedback {
  kind: 'report' | 'interview';
  id: string;
  report_id: string | null;
  company_name: string | null;
  job_title: string | null;
  risk_level: string | null;
  overall_score: number | null;
  title: string;
  content: string;
  tags: string[];
  review_status: string;
  reviewer_note: string | null;
  created_at: string;
}

export interface AdminSecurity {
  days: number;
  api: {
    total: number;
    success_rate: number;
    client_errors: number;
    server_errors: number;
    ai_calls: number;
    rate_limited: number;
    captcha_required: number;
    captcha_passed: number;
  };
  events: Array<{
    id: string;
    event_type: string;
    severity: string;
    api_path: string | null;
    action_taken: string | null;
    created_at: string;
  }>;
}

interface Page<T> {
  page: number;
  page_size: number;
  total: number;
  items: T[];
}

async function request<T>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError(response.status, '服务响应格式异常。');
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'message' in body && typeof body.message === 'string'
      ? body.message
      : '管理服务暂时不可用。';
    throw new AdminApiError(response.status, message);
  }
  return body as T;
}

export const adminApi = {
  overview: (token: string, days: number) => request<AdminOverview>(token, `/api/admin/overview?days=${days}`),
  reports: (token: string, params: URLSearchParams) => request<Page<AdminReport>>(token, `/api/admin/reports?${params}`),
  feedbacks: (token: string, params: URLSearchParams) => request<Page<AdminFeedback>>(token, `/api/admin/feedbacks?${params}`),
  reviewFeedback: (token: string, kind: AdminFeedback['kind'], id: string, status: string, reviewerNote: string) => request<{ status: string; reviewed_at: string | null }>(
    token,
    `/api/admin/feedbacks/${kind}/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status, reviewer_note: reviewerNote }) },
  ),
  security: (token: string, days: number) => request<AdminSecurity>(token, `/api/admin/security?days=${days}`),
};

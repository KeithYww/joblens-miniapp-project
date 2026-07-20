import { ClientApiError, requestJson, type ClientApiErrorDetails } from './request';

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');

export class AdminApiError extends ClientApiError {
  declare readonly status: number;

  constructor(status: number, message: string);
  constructor(details: ClientApiErrorDetails);
  constructor(statusOrDetails: number | ClientApiErrorDetails, message?: string) {
    const details = typeof statusOrDetails === 'number'
      ? { kind: 'http' as const, code: 'HTTP_ERROR', status: statusOrDetails, message: message || '管理服务暂时不可用。' }
      : statusOrDetails;
    super(details);
    this.name = 'AdminApiError';
    this.status = details.status ?? 0;
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

export interface AdminRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(token: string, path: string, options: RequestInit = {}, requestOptions: AdminRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  return requestJson<T>(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    signal: requestOptions.signal,
    timeoutMs: requestOptions.timeoutMs ?? 15_000,
  }, (details) => new AdminApiError(details));
}

export const adminApi = {
  overview: (token: string, days: number, options?: AdminRequestOptions) => request<AdminOverview>(token, `/api/admin/overview?days=${days}`, {}, options),
  reports: (token: string, params: URLSearchParams, options?: AdminRequestOptions) => request<Page<AdminReport>>(token, `/api/admin/reports?${params}`, {}, options),
  feedbacks: (token: string, params: URLSearchParams, options?: AdminRequestOptions) => request<Page<AdminFeedback>>(token, `/api/admin/feedbacks?${params}`, {}, options),
  reviewFeedback: (token: string, kind: AdminFeedback['kind'], id: string, status: string, reviewerNote: string, requestOptions?: AdminRequestOptions) => request<{ status: string; reviewed_at: string | null }>(
    token,
    `/api/admin/feedbacks/${kind}/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status, reviewer_note: reviewerNote }) },
    requestOptions,
  ),
  security: (token: string, days: number, options?: AdminRequestOptions) => request<AdminSecurity>(token, `/api/admin/security?days=${days}`, {}, options),
};

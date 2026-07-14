export type RiskLevel = '低' | '中' | '高' | '极高';
export type Confidence = '高' | '中' | '低';
export type SubScoreStatus = 'available' | 'missing' | 'insufficient';

export interface SubScore {
  score: number | null;
  weight: number;
  status: SubScoreStatus;
}

export interface SubScores {
  jd_risk: SubScore;
  hr_risk: SubScore;
  company_risk: SubScore;
  feedback_risk: SubScore;
}

export interface RiskReport {
  report_id: string;
  overall_score: number;
  risk_level: RiskLevel;
  confidence: Confidence;
  predicted_role: string | null;
  risk_types: string[];
  sub_scores: SubScores;
  strong_risk_adjustment: number;
  evidence: string[];
  missing_info: string[];
  questions: string[];
  recommendation: string;
  disclaimer: string;
  created_at: string;
}

export interface HrAnalysis {
  hr_analysis_id: string;
  report_id?: string;
  avoidance_score: number;
  risk_level: RiskLevel;
  analysis: string;
  next_questions: string[];
  created_at: string;
}

export interface DetectRequest {
  source_platform?: string;
  company_name?: string;
  job_title?: string;
  jd_text: string;
  hr_chat_text?: string;
  captcha_token?: string;
}

export interface ScreenshotExtractRequest {
  images: string[];
  language?: 'zh-CN' | 'en-US';
  captcha_token?: string;
}

export interface ScreenshotExtractResult {
  jd_text: string;
  company_name?: string;
  job_title?: string;
  source_platform?: string;
  hr_chat_text?: string;
}

export interface HrAnalysisRequest {
  report_id?: string;
  user_question: string;
  hr_reply: string;
  jd_context?: string;
  captcha_token?: string;
}

export interface InterviewFeedbackRequest {
  report_id?: string;
  company_name: string;
  job_title: string;
  source_platform?: string;
  jd_claim: string;
  interview_actual: string;
  involves_sales: boolean;
  involves_fee: boolean;
  involves_training_loan: boolean;
  involves_deposit: boolean;
  subject_mismatch: boolean;
  recommend_to_others: '推荐' | '中立' | '不推荐';
  captcha_token?: string;
}

export interface ReportFeedbackRequest {
  report_id: string;
  feedback_type: '判断不准' | '证据不足' | '表达不当' | '其他';
  content: string;
  captcha_token?: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: { field: string; issue: string }[];
  captcha_provider?: string;
  retry_after?: string;
}

export interface VisitorDataDeleteResult {
  status: 'deleted';
  message: string;
  deleted_at: string;
  deleted: {
    reports: number;
    hr_analyses: number;
    interview_feedbacks: number;
    report_feedbacks: number;
  };
}

export interface LlmProviderResult {
  rawText: string;
  parsedJson: unknown;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  costEstimate?: number;
}

export interface CaptchaVerifyResult {
  success: boolean;
  reason?: string;
  score?: number;
}

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
  analysis_source?: 'model' | 'fallback';
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
  language?: 'zh-CN' | 'en-US';
}

export interface ScreenshotExtractRequest {
  images: string[];
  language?: 'zh-CN' | 'en-US';
  captcha_token?: string;
}

export type ScreenshotMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ScreenshotAsset {
  id: string;
  file: File | Blob;
  name: string;
  mime: ScreenshotMime;
  originalBytes: number;
  uploadBytes: number;
  width?: number;
  height?: number;
}

export interface ScreenshotExtractV2Request {
  images: File[];
  language?: 'zh-CN' | 'en-US';
  captcha_token?: string;
}

export interface ApiCapabilities {
  preferred_ocr_upload_mode: 'json-v1' | 'multipart-v2';
}

export interface ScreenshotExtractResult {
  jd_text: string;
  company_name?: string;
  job_title?: string;
  source_platform?: string;
  hr_chat_text?: string;
}

export interface AiQuotaSnapshot {
  available: boolean;
  ocr: { remaining: number; limit: number };
  analysis: { remaining: number; limit: number };
  resetAt: string;
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

export interface ClientErrorReport {
  kind: 'error' | 'unhandled_rejection';
  message: string;
  source?: string;
  path: string;
  line?: number;
  column?: number;
}

import { z } from 'zod';

const RiskLevelSchema = z.enum(['低', '中', '高', '极高']);
const ConfidenceSchema = z.enum(['高', '中', '低']);
const SubScoreStatusSchema = z.enum(['available', 'missing', 'insufficient']);

const SubScoreSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  status: SubScoreStatusSchema,
});

const SubScoresSchema = z.object({
  jd_risk: SubScoreSchema,
  hr_risk: SubScoreSchema,
  company_risk: SubScoreSchema,
  feedback_risk: SubScoreSchema,
});

export const RiskReportSchema = z.object({
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/),
  overall_score: z.number().min(0).max(100),
  risk_level: RiskLevelSchema,
  confidence: ConfidenceSchema,
  predicted_role: z.string().max(100).nullable(),
  risk_types: z.array(z.string().max(50)).min(0).max(10),
  sub_scores: SubScoresSchema,
  strong_risk_adjustment: z.number().min(0).max(20),
  evidence: z.array(z.string().min(10).max(200)),
  missing_info: z.array(z.string().max(100)),
  questions: z.array(z.string().min(10).max(100)),
  recommendation: z.string().min(10).max(200),
  disclaimer: z.literal('本结果仅供求职决策参考，不构成法律认定。'),
  created_at: z.string().datetime(),
});

export const HrAnalysisSchema = z.object({
  hr_analysis_id: z.string().regex(/^hra_[a-z0-9]{12}$/),
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/).optional(),
  avoidance_score: z.number().min(0).max(100),
  risk_level: RiskLevelSchema,
  analysis: z.string().min(10).max(500),
  next_questions: z.array(z.string().min(10).max(100)),
  created_at: z.string().datetime(),
});

export const DetectRequestSchema = z.object({
  source_platform: z.string().max(30).optional(),
  company_name: z.string().max(80).optional(),
  job_title: z.string().max(80).optional(),
  jd_text: z.string().min(50).max(8000),
  hr_chat_text: z.string().max(8000).optional(),
  captcha_token: z.string().optional(),
});

export const HrAnalysisRequestSchema = z.object({
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/).optional(),
  user_question: z.string().min(10).max(500),
  hr_reply: z.string().min(10).max(2000),
  jd_context: z.string().max(2000).optional(),
  captcha_token: z.string().optional(),
});

export const InterviewFeedbackRequestSchema = z.object({
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/).optional(),
  company_name: z.string().min(1).max(80),
  job_title: z.string().min(1).max(80),
  source_platform: z.string().max(30).optional(),
  jd_claim: z.string().min(10).max(500),
  interview_actual: z.string().min(10).max(2000),
  involves_sales: z.boolean(),
  involves_fee: z.boolean(),
  involves_training_loan: z.boolean(),
  involves_deposit: z.boolean(),
  subject_mismatch: z.boolean(),
  recommend_to_others: z.enum(['推荐', '中立', '不推荐']),
  captcha_token: z.string().optional(),
});

export const ReportFeedbackRequestSchema = z.object({
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/),
  feedback_type: z.enum(['判断不准', '证据不足', '表达不当', '其他']),
  content: z.string().min(10).max(2000),
  captcha_token: z.string().optional(),
});

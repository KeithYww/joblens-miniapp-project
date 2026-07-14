import { z } from 'zod';

const RiskLevelSchema = z.enum(['低', '中', '高', '极高']);
const ConfidenceSchema = z.enum(['高', '中', '低']);
const SubScoreStatusSchema = z.enum(['available', 'missing', 'insufficient']);

export const VisitorIdSchema = z.string().regex(
  /^visitor_(?:[a-f0-9]{12}|[a-f0-9]{32})$/,
  'X-Visitor-Id 格式无效'
);

const MAINLAND_MOBILE_PATTERN = /(^|\D)1[3-9]\d{9}(?!\d)/;
const ID_CARD_PATTERN = /(^|\D)(\d{17}[\dXx]|\d{15})(?!\d)/g;
const LONG_NUMBER_PATTERN = /(?:\d[ -]?){15,18}\d/g;

function isValidMainlandIdCard(candidate: string): boolean {
  if (/^\d{15}$/.test(candidate)) return true;
  if (!/^\d{17}[\dXx]$/.test(candidate)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = candidate.slice(0, 17).split('').reduce(
    (total, digit, index) => total + Number(digit) * weights[index],
    0
  );
  return checks[sum % 11] === candidate[17].toUpperCase();
}

function passesLuhn(candidate: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    let digit = Number(candidate[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function containsHighSensitiveData(values: Array<string | undefined>): boolean {
  return values.some(value => {
    if (!value) return false;
    if (MAINLAND_MOBILE_PATTERN.test(value)) return true;

    ID_CARD_PATTERN.lastIndex = 0;
    for (const match of value.matchAll(ID_CARD_PATTERN)) {
      if (isValidMainlandIdCard(match[2])) return true;
    }

    LONG_NUMBER_PATTERN.lastIndex = 0;
    for (const match of value.matchAll(LONG_NUMBER_PATTERN)) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 16 && digits.length <= 19 && passesLuhn(digits)) return true;
    }
    return false;
  });
}

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
  language: z.enum(['zh-CN', 'en-US']).optional(),
});

const ImageDataUrlSchema = z.string()
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, '仅支持 PNG、JPEG 或 WebP 图片')
  .max(2_800_000, '单张图片不能超过 2MB');

export const ScreenshotExtractRequestSchema = z.object({
  images: z.array(ImageDataUrlSchema).min(1).max(3),
  language: z.enum(['zh-CN', 'en-US']).optional(),
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
  content: z.string().trim().min(10, '反馈内容至少需要 10 个字符').max(2000, '反馈内容不能超过 2000 个字符'),
  captcha_token: z.string().optional(),
});

export const CaptchaRequestSchema = z.object({
  captcha_token: z.string().max(2048).optional(),
});

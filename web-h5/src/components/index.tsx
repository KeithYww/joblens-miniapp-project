import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle, AlertCircle, Info, Copy } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { RiskLevel, Confidence } from '@/types';

function normalizeRiskLevel(level: RiskLevel | string): RiskLevel {
  return ({ Low: '低', Medium: '中', High: '高', Critical: '极高' } as Record<string, RiskLevel>)[level] || level as RiskLevel;
}

function normalizeConfidence(confidence: Confidence | string): Confidence {
  return ({ Low: '低', Medium: '中', High: '高' } as Record<string, Confidence>)[confidence] || confidence as Confidence;
}

export function RiskScoreCard({
  score,
  riskLevel,
  confidence,
  predictedRole,
}: {
  score: number;
  riskLevel: RiskLevel;
  confidence: Confidence;
  predictedRole: string | null;
}) {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const normalizedRiskLevel = normalizeRiskLevel(riskLevel);
  const normalizedConfidence = normalizeConfidence(confidence);

  const getScoreColor = (level: RiskLevel | string) => {
    switch (normalizeRiskLevel(level)) {
      case '低':
        return 'text-success-600';
      case '中':
        return 'text-warning-600';
      case '高':
        return 'text-danger-600';
      case '极高':
        return 'text-danger-700';
      default:
        return 'text-gray-600';
    }
  };

  const getScoreBg = (level: RiskLevel | string) => {
    switch (normalizeRiskLevel(level)) {
      case '低':
        return 'bg-success-50';
      case '中':
        return 'bg-warning-50';
      case '高':
        return 'bg-danger-50';
      case '极高':
        return 'bg-danger-100';
      default:
        return 'bg-gray-50';
    }
  };

  const getLevelText = (level: RiskLevel) => {
    switch (normalizeRiskLevel(level)) {
      case '低':
        return isEnglish ? 'Low risk' : '风险较低';
      case '中':
        return isEnglish ? 'Medium risk' : '风险中等';
      case '高':
        return isEnglish ? 'High risk' : '风险较高';
      case '极高':
        return isEnglish ? 'Critical risk' : '风险极高';
      default:
        return isEnglish ? 'Unknown' : '未知';
    }
  };

  const getConfidenceIcon = () => {
    switch (normalizedConfidence) {
      case '高':
        return <CheckCircle className="w-4 h-4 text-success-600" />;
      case '中':
        return <Info className="w-4 h-4 text-warning-600" />;
      case '低':
        return <AlertCircle className="w-4 h-4 text-danger-600" />;
      default:
        return <Info className="w-4 h-4 text-gray-600" />;
    }
  };

  const getConfidenceText = () => {
    switch (normalizedConfidence) {
      case '高':
        return isEnglish ? 'High confidence' : '置信度高';
      case '中':
        return isEnglish ? 'Medium confidence' : '置信度中等';
      case '低':
        return isEnglish ? 'Low confidence; add more details' : '信息不足，建议补充';
      default:
        return isEnglish ? 'Unknown confidence' : '置信度未知';
    }
  };

  return (
    <div className={`rounded-2xl p-6 ${getScoreBg(normalizedRiskLevel)}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={`w-6 h-6 ${getScoreColor(normalizedRiskLevel)}`} />
            <span className={`font-semibold ${getScoreColor(normalizedRiskLevel)}`}>
              {getLevelText(normalizedRiskLevel)}
            </span>
          </div>
          <div className="text-5xl font-bold tracking-tight">
            <span className={getScoreColor(normalizedRiskLevel)}>{score}</span>
            <span className="text-lg text-gray-500 font-normal">/100</span>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 text-sm text-gray-600">
            {getConfidenceIcon()}
            <span>{getConfidenceText()}</span>
          </div>
          {predictedRole && (
            <div className="mt-2 text-sm text-gray-500">
              {isEnglish ? 'Predicted role' : '预测岗位'}: <span className="font-medium text-gray-700">{predictedRole}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EvidenceList({ evidence }: { evidence: string[] }) {
  const { locale } = useI18n();
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-danger-500" />
        {locale === 'en-US' ? 'Risk evidence' : '风险证据'}
      </h3>
      <ul className="space-y-3">
        {evidence.map((item, index) => (
          <li
            key={index}
            className="flex items-start gap-3 text-sm text-gray-600"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-danger-100 text-danger-600 flex items-center justify-center text-xs font-medium">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MissingInfoList({ missingInfo }: { missingInfo: string[] }) {
  const { locale } = useI18n();
  if (missingInfo.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <Info className="w-4 h-4 text-warning-500" />
        {locale === 'en-US' ? 'Missing information' : '缺失信息'}
      </h3>
      <ul className="space-y-2">
        {missingInfo.map((item, index) => (
          <li
            key={index}
            className="flex items-center gap-2 text-sm text-gray-600"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionCard({ questions }: { questions: string[] }) {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyFailedIndex, setCopyFailedIndex] = useState<number | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const copyToClipboard = useCallback(async (text: string, index: number) => {
    setCopyFailedIndex(null);

    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          copyTextWithSelection(text);
        }
      } else {
        copyTextWithSelection(text);
      }

      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      setCopiedIndex(null);
      setCopyFailedIndex(index);
    }
  }, []);

  if (questions.length === 0) {
    return null;
  }

  const displayQuestions = showAllQuestions ? questions : questions.slice(0, 3);
  const moreCount = questions.length - 3;

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-primary-500" />
        {isEnglish ? 'Questions to ask' : '建议追问'}
      </h3>
      <div className="space-y-3">
        {displayQuestions.map((question, index) => (
          <div
            key={index}
            className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-medium">
              {index + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm text-gray-700">{question}</p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(question, index)}
              aria-label={isEnglish ? `Copy question ${index + 1}` : `复制第 ${index + 1} 个问题`}
              className="inline-flex min-w-16 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              {copiedIndex === index ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedIndex === index ? (isEnglish ? 'Copied' : '已复制') : (isEnglish ? 'Copy' : '复制')}
            </button>
            {copyFailedIndex === index && (
              <span className="sr-only" role="alert">
                {isEnglish ? 'Copy failed. Please select and copy the question manually.' : '复制失败，请长按问题文字手动复制。'}
              </span>
            )}
          </div>
        ))}
      </div>
      {copyFailedIndex !== null && (
        <p className="mt-3 text-xs text-danger-600" role="alert">
          {isEnglish ? 'Copy failed. Please select and copy the question manually.' : '复制失败，请长按问题文字手动复制。'}
        </p>
      )}
      {moreCount > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setShowAllQuestions(value => !value)}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            {showAllQuestions
              ? (isEnglish ? 'Show fewer questions' : '收起追问')
              : (isEnglish ? `Show more questions (${moreCount})` : `展开更多追问 (${moreCount})`)}
          </button>
        </div>
      )}
    </div>
  );
}

function copyTextWithSelection(text: string) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);

  try {
    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) {
      throw new Error('Copy command was rejected');
    }
  } finally {
    textArea.remove();
  }
}

export function DisclaimerBanner() {
  const { locale } = useI18n();
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
      <p className="text-xs text-gray-500 text-center">
        {locale === 'en-US'
          ? 'This result is for job-search decision support only and does not constitute a legal determination or final employment advice.'
          : '本结果仅供求职决策参考，不构成法律认定或最终就业建议。'}
      </p>
    </div>
  );
}

export function TextInputPanel({
  label,
  placeholder,
  value,
  onChange,
  maxLength,
  required = false,
  warning,
  locale = 'zh-CN',
  inputId,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  required?: boolean;
  warning?: string;
  locale?: 'zh-CN' | 'en-US';
  inputId?: string;
}) {
  const charCount = value.length;
  const isWarning = Boolean(maxLength && charCount >= maxLength * 0.8 && charCount <= maxLength);
  const isError = Boolean(maxLength && charCount > maxLength);
  const hasIssue = isError || Boolean(warning);
  const messageId = inputId ? `${inputId}-message` : undefined;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-danger-500 ml-1">*</span>}
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={hasIssue}
        aria-describedby={hasIssue ? messageId : undefined}
        className={`w-full h-32 p-4 rounded-xl border resize-none transition-colors ${
          hasIssue
            ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-200'
            : 'border-gray-200 focus:border-primary-500 focus:ring-primary-200'
        } focus:outline-none focus:ring-2`}
      />
      {maxLength && (
        <div className="flex items-start justify-between gap-3">
          <div
            id={messageId}
            className="min-h-4 text-xs text-danger-600"
            role={hasIssue ? 'alert' : undefined}
          >
            {warning || (isError
              ? (locale === 'en-US'
                ? `Remove ${charCount - maxLength} characters before submitting.`
                : `已超出 ${charCount - maxLength} 字，请删减后再提交。`)
              : '')}
          </div>
          <div
          className={`text-xs ${
            isError ? 'text-danger-500' : isWarning ? 'text-warning-500' : 'text-gray-400'
          }`}
          >
            {charCount}/{maxLength} {locale === 'en-US' ? 'characters' : '字'}
          </div>
        </div>
      )}
    </div>
  );
}

export function FeedbackForm({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (data: { type: string; content: string }) => Promise<void>;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const [type, setType] = useState<string>('判断不准');
  const [content, setContent] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const trimmedContentLength = content.trim().length;
  const contentTooShort = content.length > 0 && trimmedContentLength < 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmedContentLength < 10) {
      setSubmitError(isEnglish ? 'Please provide at least 10 characters of detail.' : '请至少填写 10 个字符的详细说明。');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({ type, content });
      setSubmitted(true);
      setContent('');
    } catch (err) {
      setSubmitError(!isEnglish && err instanceof Error ? err.message : (isEnglish ? 'Submission failed. Please try again later.' : '提交失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl bg-success-50 border border-success-200 p-5 text-center">
        <CheckCircle className="w-8 h-8 text-success-600 mx-auto mb-2" />
        <p className="text-sm text-success-700">
          {isEnglish ? 'Feedback received. We will use it to improve the model.' : '已收到反馈，我们会用于优化模型。'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          {isEnglish ? 'Feedback type' : '反馈类型'}
        </label>
        <div className="flex flex-wrap gap-2">
          {([
            { value: '判断不准', label: isEnglish ? 'Incorrect assessment' : '判断不准' },
            { value: '证据不足', label: isEnglish ? 'Insufficient evidence' : '证据不足' },
            { value: '表达不当', label: isEnglish ? 'Unclear wording' : '表达不当' },
            { value: '其他', label: isEnglish ? 'Other' : '其他' },
          ] as const).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setType(item.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                type === item.value
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          {isEnglish ? 'Details' : '详细说明'}
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isEnglish ? 'Describe what you believe is wrong with the report...' : '请描述您认为报告中存在的问题...'}
          className="w-full h-24 p-4 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2 resize-none"
          maxLength={2000}
        />
        <div className={`text-xs mt-1 ${contentTooShort ? 'text-danger-500' : 'text-gray-400'}`}>
          {content.length}/2000 {isEnglish ? 'characters' : '字'}
          {contentTooShort ? (isEnglish ? '; at least 10 characters required' : '，至少需要 10 个字符') : ''}
        </div>
      </div>
      {submitError && (
        <p className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">{submitError}</p>
      )}
      <button
        type="submit"
        disabled={trimmedContentLength < 10 || submitting || disabled}
        className="w-full py-3 rounded-xl font-medium gradient-primary text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? (isEnglish ? 'Submitting...' : '提交中...') : (isEnglish ? 'Submit feedback' : '提交反馈')}
      </button>
    </form>
  );
}

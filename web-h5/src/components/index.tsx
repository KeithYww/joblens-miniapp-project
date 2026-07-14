import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle, AlertCircle, Info } from 'lucide-react';
import type { RiskLevel, Confidence } from '@/types';

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
  const getScoreColor = (level: RiskLevel) => {
    switch (level) {
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

  const getScoreBg = (level: RiskLevel) => {
    switch (level) {
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
    switch (level) {
      case '低':
        return '风险较低';
      case '中':
        return '风险中等';
      case '高':
        return '风险较高';
      case '极高':
        return '风险极高';
      default:
        return '未知';
    }
  };

  const getConfidenceIcon = () => {
    switch (confidence) {
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
    switch (confidence) {
      case '高':
        return '置信度高';
      case '中':
        return '置信度中等';
      case '低':
        return '信息不足，建议补充';
      default:
        return '置信度未知';
    }
  };

  return (
    <div className={`rounded-2xl p-6 ${getScoreBg(riskLevel)}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={`w-6 h-6 ${getScoreColor(riskLevel)}`} />
            <span className={`font-semibold ${getScoreColor(riskLevel)}`}>
              {getLevelText(riskLevel)}
            </span>
          </div>
          <div className="text-5xl font-bold tracking-tight">
            <span className={getScoreColor(riskLevel)}>{score}</span>
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
              预测岗位: <span className="font-medium text-gray-700">{predictedRole}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EvidenceList({ evidence }: { evidence: string[] }) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-danger-500" />
        风险证据
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
  if (missingInfo.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <Info className="w-4 h-4 text-warning-500" />
        缺失信息
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
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const copyToClipboard = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      console.error('复制失败');
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
        建议追问
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
              onClick={() => copyToClipboard(question, index)}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors"
            >
              {copiedIndex === index ? '已复制' : '复制'}
            </button>
          </div>
        ))}
      </div>
      {moreCount > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setShowAllQuestions(value => !value)}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            {showAllQuestions ? '收起追问' : `展开更多追问 (${moreCount})`}
          </button>
        </div>
      )}
    </div>
  );
}

export function DisclaimerBanner() {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
      <p className="text-xs text-gray-500 text-center">
        本结果仅供求职决策参考，不构成法律认定或最终就业建议。
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
      setSubmitError('请至少填写 10 个字符的详细说明。');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({ type, content });
      setSubmitted(true);
      setContent('');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl bg-success-50 border border-success-200 p-5 text-center">
        <CheckCircle className="w-8 h-8 text-success-600 mx-auto mb-2" />
        <p className="text-sm text-success-700">
          已收到反馈，我们会用于优化模型。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          反馈类型
        </label>
        <div className="flex flex-wrap gap-2">
          {(['判断不准', '证据不足', '表达不当', '其他'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                type === item
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          详细说明
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="请描述您认为报告中存在的问题..."
          className="w-full h-24 p-4 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2 resize-none"
          maxLength={2000}
        />
        <div className={`text-xs mt-1 ${contentTooShort ? 'text-danger-500' : 'text-gray-400'}`}>
          {content.length}/2000 字{contentTooShort ? '，至少需要 10 个字符' : ''}
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
        {submitting ? '提交中...' : '提交反馈'}
      </button>
    </form>
  );
}

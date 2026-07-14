import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
import {
  RiskScoreCard,
  EvidenceList,
  MissingInfoList,
  QuestionCard,
  DisclaimerBanner,
  FeedbackForm,
} from '@/components';
import { TurnstileChallenge } from '@/components/TurnstileChallenge';
import { api, ApiRequestError } from '@/api';
import type { ReportFeedbackRequest, RiskReport } from '@/types';

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<RiskReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [deleteCaptchaRequired, setDeleteCaptchaRequired] = useState(false);
  const [deleteCaptchaToken, setDeleteCaptchaToken] = useState('');
  const [deleteCaptchaResetSignal, setDeleteCaptchaResetSignal] = useState(0);

  const loadReport = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await api.reports.get(id);
      setReport(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '获取报告失败';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleDelete = useCallback(async () => {
    if (!id || !window.confirm('确定删除该报告及相关数据？删除后无法恢复。')) {
      return;
    }
    setIsDeleting(true);
    setActionError('');
    try {
      await api.reports.delete(id, deleteCaptchaToken || undefined);
      window.location.href = '/';
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CAPTCHA_REQUIRED') {
        setDeleteCaptchaRequired(true);
        setActionError('删除请求较频繁，请完成验证后重试。');
      } else if (err instanceof ApiRequestError && err.code === 'CAPTCHA_FAILED') {
        setDeleteCaptchaRequired(true);
        setDeleteCaptchaToken('');
        setDeleteCaptchaResetSignal(value => value + 1);
        setActionError('验证已失效，请重新完成验证。');
      } else {
        setActionError(err instanceof Error ? err.message : '删除失败');
      }
    } finally {
      setIsDeleting(false);
    }
  }, [deleteCaptchaToken, id]);

  const handleFeedback = useCallback(async (data: { type: string; content: string }) => {
    if (!id) return;
    try {
      await api.feedbacks.report({
        report_id: id,
        feedback_type: data.type as ReportFeedbackRequest['feedback_type'],
        content: data.content,
        captcha_token: captchaToken || undefined,
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
      } else if (err instanceof ApiRequestError && err.code === 'CAPTCHA_FAILED') {
        setCaptchaRequired(true);
        setCaptchaToken('');
        setCaptchaResetSignal(value => value + 1);
      }
      throw err;
    }
  }, [captchaToken, id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载报告中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-danger-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">报告获取失败</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={loadReport}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>
            <Link
              to="/"
              className="px-4 py-2 rounded-lg gradient-primary text-white hover:opacity-90"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">报告不存在</h2>
          <Link
            to="/"
            className="inline-block mt-4 px-4 py-2 rounded-lg gradient-primary text-white"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-gray-700 hover:text-primary-600"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">返回首页</span>
          </Link>
          <span className="text-lg font-bold text-gray-800">风险报告</span>
          <button
            onClick={handleDelete}
            disabled={isDeleting || (deleteCaptchaRequired && !deleteCaptchaToken)}
            className="flex items-center gap-1 text-sm text-danger-600 hover:text-danger-700 disabled:opacity-50"
          >
            {isDeleting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>删除</span>
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {actionError && (
          <div className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">
            {actionError}
          </div>
        )}
        {deleteCaptchaRequired && (
          <div className="rounded-xl bg-white border border-gray-100 p-4">
            <TurnstileChallenge
              onVerify={setDeleteCaptchaToken}
              resetSignal={deleteCaptchaResetSignal}
            />
          </div>
        )}
        {report.confidence === '低' && (
          <div className="rounded-xl bg-warning-50 border border-warning-200 p-4">
            <p className="text-sm text-warning-700">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              信息不足，建议补充岗位详情或 HR 聊天记录后重新检测。
            </p>
          </div>
        )}

        <RiskScoreCard
          score={report.overall_score}
          riskLevel={report.risk_level}
          confidence={report.confidence}
          predictedRole={report.predicted_role}
        />

        {report.recommendation && (
          <div className="rounded-xl bg-white border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">建议</h3>
            <p className="text-sm text-gray-600">{report.recommendation}</p>
          </div>
        )}

        {report.risk_types.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">风险类型</h3>
            <div className="flex flex-wrap gap-2">
              {report.risk_types.map((type, index) => (
                <span
                  key={index}
                  className="px-3 py-1 rounded-full text-xs font-medium bg-danger-100 text-danger-700"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>
        )}

        <EvidenceList evidence={report.evidence} />

        <MissingInfoList missingInfo={report.missing_info} />

        <QuestionCard questions={report.questions} />

        <DisclaimerBanner />

        <div className="rounded-xl bg-white border border-gray-100 p-5">
          <button
            onClick={() => setShowFeedback(!showFeedback)}
            className="text-sm font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-2"
          >
            {showFeedback ? '收起反馈' : '报告纠错反馈'}
          </button>
          {showFeedback && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              {captchaRequired && (
                <div className="mb-4">
                  <TurnstileChallenge
                    onVerify={setCaptchaToken}
                    resetSignal={captchaResetSignal}
                  />
                </div>
              )}
              <FeedbackForm
                onSubmit={handleFeedback}
                disabled={captchaRequired && !captchaToken}
              />
            </div>
          )}
        </div>
      </main>

      <footer className="mt-8 py-6 border-t border-gray-100 bg-white">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-gray-400">
            本结果基于您提供的信息生成，不构成法律认定或最终就业建议。
          </p>
        </div>
      </footer>
    </div>
  );
}

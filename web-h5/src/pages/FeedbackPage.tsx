import { useState, useCallback } from 'react';
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '@/api';
import { TurnstileChallenge } from '@/components/TurnstileChallenge';
import type { InterviewFeedbackRequest } from '@/types';

export function FeedbackPage() {
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [sourcePlatform, setSourcePlatform] = useState('');
  const [jdClaim, setJdClaim] = useState('');
  const [interviewActual, setInterviewActual] = useState('');
  const [involvesSales, setInvolvesSales] = useState(false);
  const [involvesFee, setInvolvesFee] = useState(false);
  const [involvesTrainingLoan, setInvolvesTrainingLoan] = useState(false);
  const [involvesDeposit, setInvolvesDeposit] = useState(false);
  const [subjectMismatch, setSubjectMismatch] = useState(false);
  const [recommendToOthers, setRecommendToOthers] = useState<'推荐' | '中立' | '不推荐'>('中立');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const handleSubmit = useCallback(async () => {
    if (!companyName.trim() || !jobTitle.trim() || !jdClaim.trim() || !interviewActual.trim()) {
      setError('请填写必填字段');
      return;
    }

    setError('');
    setIsLoading(true);

    const data: InterviewFeedbackRequest = {
      company_name: companyName,
      job_title: jobTitle,
      source_platform: sourcePlatform || undefined,
      jd_claim: jdClaim,
      interview_actual: interviewActual,
      involves_sales: involvesSales,
      involves_fee: involvesFee,
      involves_training_loan: involvesTrainingLoan,
      involves_deposit: involvesDeposit,
      subject_mismatch: subjectMismatch,
      recommend_to_others: recommendToOthers,
      captcha_token: captchaToken || undefined,
    };

    try {
      await api.feedbacks.interview(data);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        setError('请求较频繁，请完成验证后再次提交。');
      } else if (err instanceof ApiRequestError && err.code === 'CAPTCHA_FAILED') {
        setCaptchaRequired(true);
        setCaptchaToken('');
        setCaptchaResetSignal(value => value + 1);
        setError('验证已失效，请重新完成验证。');
      } else {
        setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    companyName,
    jobTitle,
    sourcePlatform,
    jdClaim,
    interviewActual,
    involvesSales,
    involvesFee,
    involvesTrainingLoan,
    involvesDeposit,
    subjectMismatch,
    recommendToOthers,
    captchaToken,
  ]);

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-success-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">反馈提交成功</h2>
          <p className="text-gray-500 mb-6">
            已匿名提交，审核后将用于优化岗位风险判断。
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/"
              className="px-6 py-3 rounded-xl gradient-primary text-white hover:opacity-90"
            >
              返回首页
            </Link>
          </div>
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
          <span className="text-lg font-bold text-gray-800">面试反馈</span>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div className="bg-warning-50 rounded-lg p-4">
            <p className="text-sm text-warning-700">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              感谢您的反馈！您的反馈将帮助我们优化风险检测模型。所有反馈均为匿名提交。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                公司名称 <span className="text-danger-500">*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="如：某某科技"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
                maxLength={80}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                岗位名称 <span className="text-danger-500">*</span>
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="如：储备主管"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
                maxLength={80}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              招聘平台（选填）
            </label>
            <input
              type="text"
              value={sourcePlatform}
              onChange={(e) => setSourcePlatform(e.target.value)}
              placeholder="如：BOSS直聘"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
              maxLength={30}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              JD 声称的内容 <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={jdClaim}
              onChange={(e) => setJdClaim(e.target.value)}
              placeholder="如：管理岗，负责团队管理..."
              className="w-full h-20 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2 resize-none"
              maxLength={500}
            />
            <div className="text-xs text-gray-400 mt-1">{jdClaim.length}/500 字</div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              实际面试内容 <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={interviewActual}
              onChange={(e) => setInterviewActual(e.target.value)}
              placeholder="如：实际要求开发客户并销售保险产品..."
              className="w-full h-24 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2 resize-none"
              maxLength={2000}
            />
            <div className="text-xs text-gray-400 mt-1">{interviewActual.length}/2000 字</div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-3 block">
              风险标记
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '涉及销售', value: involvesSales, setter: setInvolvesSales },
                { label: '涉及收费', value: involvesFee, setter: setInvolvesFee },
                { label: '涉及培训贷', value: involvesTrainingLoan, setter: setInvolvesTrainingLoan },
                { label: '涉及押金', value: involvesDeposit, setter: setInvolvesDeposit },
                { label: '实际工作与JD不符', value: subjectMismatch, setter: setSubjectMismatch },
              ].map((item) => (
                <label
                  key={item.label}
                  className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                    item.value
                      ? 'border-danger-500 bg-danger-50 text-danger-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={(e) => item.setter(e.target.checked)}
                    className="hidden"
                  />
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      item.value ? 'border-danger-500 bg-danger-500' : 'border-gray-300'
                    }`}
                  >
                    {item.value && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-3 block">
              是否推荐给他人
            </label>
            <div className="flex gap-3">
              {(['推荐', '中立', '不推荐'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRecommendToOthers(option)}
                  className={`flex-1 py-3 rounded-xl font-medium transition-colors ${
                    recommendToOthers === option
                      ? 'gradient-primary text-white'
                      : 'border border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">
              {error}
            </div>
          )}

          {captchaRequired && (
            <TurnstileChallenge
              onVerify={setCaptchaToken}
              onError={() => setError('验证加载失败，请刷新页面后重试。')}
              resetSignal={captchaResetSignal}
            />
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || (captchaRequired && !captchaToken)}
            className="w-full py-4 rounded-xl font-semibold gradient-primary text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline mr-2" />
                <span>提交中...</span>
              </>
            ) : (
              '提交反馈'
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

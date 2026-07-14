import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, FileText, MessageSquare, ImageUp, X, CheckCircle } from 'lucide-react';
import { TextInputPanel } from '@/components';
import { TurnstileChallenge } from '@/components/TurnstileChallenge';
import { api, ApiRequestError } from '@/api';
import type { DetectRequest } from '@/types';
import { LanguageSwitcher, useI18n } from '@/i18n';

export function HomePage() {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const isEnglish = locale === 'en-US';
  const [sourcePlatform, setSourcePlatform] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [hrChatText, setHrChatText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [screenshots, setScreenshots] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState('');
  const [extractProgress, setExtractProgress] = useState(0);

  useEffect(() => {
    if (!isExtracting) return;
    const timer = window.setInterval(() => {
      setExtractProgress(current => {
        if (current < 45) return Math.min(45, current + 7);
        if (current < 75) return Math.min(75, current + 3);
        return Math.min(90, current + 1);
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [isExtracting]);

  const handleScreenshotSelection = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length + screenshots.length > 3) {
      setError(isEnglish ? 'You can upload up to 3 screenshots.' : '最多上传 3 张截图。');
      return;
    }
    if (selected.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      setError(isEnglish ? 'Use PNG, JPEG, or WebP screenshots smaller than 2MB each.' : '请上传单张不超过 2MB 的 PNG、JPEG 或 WebP 截图。');
      return;
    }
    const encoded = await Promise.all(selected.map(file => new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    })));
    setScreenshots(current => [...current, ...encoded]);
    setExtractStatus('');
    setError('');
  }, [screenshots.length, isEnglish]);

  const handleExtractScreenshots = useCallback(async () => {
    if (screenshots.length === 0) return;
    setIsExtracting(true);
    setExtractProgress(12);
    setError('');
    setExtractStatus('');
    try {
      const result = await api.ocr.extractJob({ images: screenshots.map(item => item.dataUrl), language: locale });
      setExtractProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, 250));
      setJdText(result.jd_text);
      if (!companyName && result.company_name) setCompanyName(result.company_name);
      if (!jobTitle && result.job_title) setJobTitle(result.job_title);
      if (!sourcePlatform && result.source_platform) setSourcePlatform(result.source_platform);
      if (!hrChatText && result.hr_chat_text) setHrChatText(result.hr_chat_text);
      setExtractStatus(isEnglish ? 'Text extracted. Review and edit the fields below before analyzing.' : '已提取岗位信息，请在下方确认和编辑后再开始检测。');
    } catch (err) {
      setExtractProgress(0);
      setError(err instanceof Error ? err.message : (isEnglish ? 'Screenshot extraction failed. Please try again later.' : '截图识别失败，请稍后重试。'));
    } finally {
      setIsExtracting(false);
    }
  }, [screenshots, locale, companyName, jobTitle, sourcePlatform, hrChatText, isEnglish]);

  const extractProgressLabel = extractProgress < 45
    ? (isEnglish ? 'Preparing screenshots...' : '正在准备截图...')
    : extractProgress < 75
      ? (isEnglish ? 'Reading job information...' : '正在识别岗位信息...')
      : extractProgress < 100
        ? (isEnglish ? 'Organizing extracted content...' : '正在整理识别结果...')
        : (isEnglish ? 'Extraction complete' : '识别完成');

  const handleSubmit = useCallback(async () => {
    if (!jdText.trim()) {
      setError('请填写 JD 文本内容');
      return;
    }

    if (jdText.length < 50) {
      setError('JD 文本内容过短，请至少提供 50 字');
      return;
    }

    setError('');
    setIsLoading(true);

    const data: DetectRequest = {
      source_platform: sourcePlatform || undefined,
      company_name: companyName || undefined,
      job_title: jobTitle || undefined,
      jd_text: jdText,
      hr_chat_text: hrChatText || undefined,
      captcha_token: captchaToken || undefined,
      language: locale,
    };

    try {
      const report = await api.reports.detect(data);
      navigate(`/report/${report.report_id}`);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        setError('请求较频繁，请完成验证后再次检测。');
      } else if (err instanceof ApiRequestError && err.code === 'CAPTCHA_FAILED') {
        setCaptchaRequired(true);
        setCaptchaToken('');
        setCaptchaResetSignal(value => value + 1);
        setError('验证已失效，请重新完成验证。');
      } else {
        setError(err instanceof Error ? err.message : '检测失败，请稍后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [sourcePlatform, companyName, jobTitle, jdText, hrChatText, captchaToken, locale, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-warning-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-800">{t('brand')}</span>
          </div>
          <nav className="flex items-center gap-4">
            <a href="/privacy" className="text-sm text-gray-600 hover:text-primary-600">
              {t('privacy')}
            </a>
            <a href="/disclaimer" className="text-sm text-gray-600 hover:text-primary-600">
              {t('disclaimer')}
            </a>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-3">
            {isEnglish ? 'Job Risk Analysis' : '岗位风险智能检测'}
          </h1>
          <p className="text-gray-500">
            {isEnglish ? 'Paste a job description and recruiter conversation to identify potential risks.' : '粘贴岗位 JD 和 HR 聊天记录，智能识别潜在风险'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <section className="border border-primary-100 bg-primary-50/40 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <ImageUp className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-gray-800">{isEnglish ? 'Import job screenshots' : '上传岗位截图识别'}</h2>
                <p className="mt-1 text-xs text-gray-600">{isEnglish ? 'Upload up to 3 job-detail or recruiter-chat screenshots. Review the extracted text before analysis.' : '可上传岗位详情或 HR 聊天截图，最多 3 张。识别后请确认并编辑内容。'}</p>
                <p className="mt-1 text-xs text-gray-500">{isEnglish ? 'Do not upload IDs, bank cards, or full phone numbers.' : '请勿上传身份证、银行卡、完整手机号等敏感信息。'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50">
                    <ImageUp className="w-4 h-4" />
                    {isEnglish ? 'Choose screenshots' : '选择截图'}
                    <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => void handleScreenshotSelection(event.target.files)} />
                  </label>
                  {screenshots.length > 0 && <button type="button" onClick={() => void handleExtractScreenshots()} disabled={isExtracting} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {isExtracting ? (isEnglish ? 'Extracting...' : '识别中...') : (isEnglish ? 'Extract text' : '识别截图')}
                  </button>}
                </div>
                {screenshots.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{screenshots.map((item, index) => <div key={`${item.name}-${index}`} className="flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-gray-700 border border-gray-200"><span className="max-w-40 truncate">{item.name}</span><button type="button" aria-label={isEnglish ? `Remove ${item.name}` : `移除 ${item.name}`} onClick={() => setScreenshots(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-gray-500 hover:text-danger-600"><X className="w-3.5 h-3.5" /></button></div>)}</div>}
                {isExtracting && <div className="mt-4" aria-live="polite">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-primary-700">
                    <span>{extractProgressLabel}</span>
                    <span>{extractProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-primary-100" role="progressbar" aria-label={extractProgressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={extractProgress}>
                    <div className="h-full rounded-full bg-primary-600 transition-all duration-500 ease-out" style={{ width: `${extractProgress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{isEnglish ? 'This can take up to a minute for multiple screenshots.' : '多张截图通常需要几十秒，请保持当前页面打开。'}</p>
                </div>}
                {extractStatus && <p className="mt-3 flex items-center gap-1.5 text-sm text-success-700"><CheckCircle className="w-4 h-4" />{extractStatus}</p>}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {isEnglish ? 'Hiring platform (optional)' : '招聘平台（选填）'}
              </label>
              <input
                type="text"
                value={sourcePlatform}
                onChange={(e) => setSourcePlatform(e.target.value)}
                placeholder={isEnglish ? 'e.g. LinkedIn' : '如：BOSS直聘'}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
                maxLength={30}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {isEnglish ? 'Company (optional)' : '公司名称（选填）'}
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={isEnglish ? 'e.g. Acme Technology' : '如：某某科技'}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
                maxLength={80}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              {isEnglish ? 'Job title (optional)' : '岗位名称（选填）'}
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder={isEnglish ? 'e.g. Frontend Engineer' : '如：储备主管'}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary-500 focus:ring-primary-200 focus:outline-none focus:ring-2"
              maxLength={80}
            />
          </div>

          <TextInputPanel
            label={isEnglish ? 'Job description' : '岗位 JD'}
            placeholder={isEnglish ? 'Paste responsibilities, qualifications, compensation, and other details...' : '请粘贴岗位描述、职责、要求、薪资等信息...'}
            value={jdText}
            onChange={setJdText}
            maxLength={8000}
            required
          />

          <TextInputPanel
            label={isEnglish ? 'Recruiter conversation (optional)' : 'HR 聊天记录（选填）'}
            placeholder={isEnglish ? 'Paste your conversation with the recruiter...' : '请粘贴您与 HR 的聊天记录...'}
            value={hrChatText}
            onChange={setHrChatText}
            maxLength={8000}
          />

          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
            <p>
              <strong className="text-gray-600">{isEnglish ? 'Privacy notice: ' : '隐私提示：'}</strong>
              {isEnglish ? 'Do not upload IDs, bank cards, or full phone numbers. Results are for job-search decisions only and are not legal advice.' : '请勿上传身份证、银行卡、完整手机号等敏感信息。检测结果仅供求职决策参考，不构成法律认定。'}
            </p>
          </div>

          {error && (
            <div className="text-sm text-danger-600 bg-danger-50 rounded-lg p-3">
              {error}
            </div>
          )}

          {captchaRequired && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="captcha-dialog-title">
              <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="captcha-dialog-title" className="text-base font-semibold text-gray-900">完成安全验证</h2>
                    <p className="mt-1 text-sm text-gray-600">验证后可继续提交本次检测。</p>
                  </div>
                  <button type="button" onClick={() => setCaptchaRequired(false)} aria-label="关闭验证窗口" className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <TurnstileChallenge
                  onVerify={setCaptchaToken}
                  onError={() => setError('验证加载失败，请刷新页面后重试。')}
                  resetSignal={captchaResetSignal}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || (captchaRequired && !captchaToken)}
            className="w-full py-4 rounded-xl font-semibold gradient-primary text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-lg"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{isEnglish ? 'Analyzing...' : '检测中...'}</span>
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                <span>{isEnglish ? 'Analyze job' : '开始检测'}</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-2">
              <ShieldCheck className="w-5 h-5 text-primary-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">{isEnglish ? 'Risk signals' : '风险识别'}</h3>
            <p className="text-xs text-gray-500 mt-1">{isEnglish ? 'Spot job risks early' : '智能检测岗位风险'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-warning-100 flex items-center justify-center mx-auto mb-2">
              <MessageSquare className="w-5 h-5 text-warning-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">{isEnglish ? 'Questions to ask' : '追问建议'}</h3>
            <p className="text-xs text-gray-500 mt-1">{isEnglish ? 'Generate key follow-ups' : '生成关键追问问题'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-2">
              <FileText className="w-5 h-5 text-success-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">{isEnglish ? 'Interview feedback' : '面试反馈'}</h3>
            <p className="text-xs text-gray-500 mt-1">{isEnglish ? 'Share outcomes anonymously' : '匿名反馈面试结果'}</p>
          </div>
        </div>
      </main>

      <footer className="mt-12 py-6 border-t border-gray-100">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-gray-400">
            {isEnglish ? 'JobLens - helping candidates identify job risks' : '职镜 JobLens - 帮助求职者识别岗位风险'}
          </p>
        </div>
      </footer>
    </div>
  );
}

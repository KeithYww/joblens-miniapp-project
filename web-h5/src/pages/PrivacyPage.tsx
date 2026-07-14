import { useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '@/api';
import { TurnstileChallenge } from '@/components/TurnstileChallenge';
import { LanguageSwitcher, useI18n } from '@/i18n';

export function PrivacyPage() {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const [deleteStatus, setDeleteStatus] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const handleDeleteAll = async () => {
    if (!window.confirm(isEnglish
      ? 'Delete all data associated with this browser identifier? This cannot be undone.'
      : '确定删除当前浏览器标识关联的全部数据？此操作无法撤销。')) return;
    setIsDeleting(true);
    setDeleteStatus('');
    try {
      const result = await api.visitorData.deleteAll(captchaToken || undefined);
      setDeleteStatus(result.message);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        setDeleteStatus(isEnglish ? 'Too many deletion requests. Complete verification and try again.' : '删除请求较频繁，请完成验证后重试。');
      } else if (err instanceof ApiRequestError && err.code === 'CAPTCHA_FAILED') {
        setCaptchaRequired(true);
        setCaptchaToken('');
        setCaptchaResetSignal(value => value + 1);
        setDeleteStatus(isEnglish ? 'Verification expired. Please complete it again.' : '验证已失效，请重新完成验证。');
      } else {
        setDeleteStatus(err instanceof Error ? err.message : (isEnglish ? 'Deletion failed. Please try again later.' : '删除失败，请稍后重试。'));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-gray-700 hover:text-primary-600"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{isEnglish ? 'Back to home' : '返回首页'}</span>
          </Link>
          <span className="text-lg font-bold text-gray-800">{isEnglish ? 'Privacy' : '隐私说明'}</span>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h1 className="text-xl font-bold text-gray-800">{isEnglish ? 'Privacy Policy' : '隐私政策'}</h1>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Data Collection' : '数据收集'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish
                ? 'JobLens collects the job information you submit, including job descriptions, HR chat records, company names, and job titles. This information is used only to generate risk reports.'
                : 'JobLens 会收集您提交的岗位信息，包括但不限于 JD 文本、HR 聊天记录、公司名称和岗位名称。这些信息仅用于生成风险报告，不会用于其他目的。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Data Retention' : '数据存储'}</h2>
            <ul className="text-sm text-gray-600 leading-relaxed space-y-2">
              <li>{isEnglish ? 'Job descriptions and HR chat records: retained for 7 days, then automatically deleted.' : 'JD 原文和 HR 聊天记录：保留 7 天，之后自动删除'}</li>
              <li>{isEnglish ? 'Report results: retained for 30 days, then automatically deleted.' : '报告结果：保留 30 天，之后自动删除'}</li>
              <li>{isEnglish ? 'Interview feedback: retained for 90 days to improve the model, then automatically deleted.' : '面试反馈：保留 90 天，用于优化模型，之后自动删除'}</li>
              <li>{isEnglish ? 'API logs: retained for 30 days for monitoring and auditing, without raw sensitive text.' : 'API 日志：保留 30 天，用于监控和审计，不含敏感原文'}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Third-Party Services' : '第三方服务'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'The job information and HR chat records you submit are sent to a third-party AI service to generate risk reports. We select paid services with clear privacy boundaries to protect your data.' : '您提交的岗位信息和 HR 聊天记录会被发送至第三方大模型服务用于生成风险报告。我们选择隐私边界清晰的付费服务，确保您的数据安全。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Your Deletion Rights' : '删除权利'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'You can delete your data at any time:' : '您可以随时删除您的数据：'}
            </p>
            <ul className="text-sm text-gray-600 leading-relaxed space-y-2 mt-2">
              <li>{isEnglish ? 'Delete an individual report from its report page.' : '在报告页点击"删除本次检测记录"删除单条报告'}</li>
              <li>{isEnglish ? 'Delete all data from this privacy page.' : '在隐私页点击"一键删除所有数据"删除所有数据'}</li>
              <li>{isEnglish ? 'All related data is physically deleted within 30 days.' : '删除后 30 天内物理删除所有相关数据'}</li>
            </ul>
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={isDeleting || (captchaRequired && !captchaToken)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-danger-200 text-danger-700 hover:bg-danger-50 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {isDeleting ? (isEnglish ? 'Deleting...' : '删除中...') : (isEnglish ? 'Delete all my data' : '删除我的全部数据')}
            </button>
            {deleteStatus && <p className="mt-3 text-sm text-gray-600">{deleteStatus}</p>}
            {captchaRequired && (
              <div className="mt-4">
                <TurnstileChallenge
                  onVerify={setCaptchaToken}
                  resetSignal={captchaResetSignal}
                />
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Sensitive Information Protection' : '敏感信息保护'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'We prohibit submitting sensitive information such as identity card numbers, bank card numbers, or complete phone numbers. The system detects and blocks such information, and logs do not include your original text.' : '我们禁止提交身份证号、银行卡号、完整手机号等敏感信息。系统会检测并拦截此类信息。日志记录不包含您的原始文本内容。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Anonymous Access' : '匿名访问'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'JobLens does not require sign-in. It uses an anonymous visitor identifier (visitor_id). Clearing browser storage generates a new identifier and removes access to historical records.' : 'JobLens 不需要用户登录，使用匿名访问标识（visitor_id）来识别用户。如果您清除浏览器缓存，visitor_id 会重新生成，历史记录将会丢失。'}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

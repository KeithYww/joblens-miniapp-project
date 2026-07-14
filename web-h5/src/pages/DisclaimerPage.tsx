import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher, useI18n } from '@/i18n';

export function DisclaimerPage() {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
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
          <span className="text-lg font-bold text-gray-800">{isEnglish ? 'Disclaimer' : '免责声明'}</span>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h1 className="text-xl font-bold text-gray-800">{isEnglish ? 'Disclaimer' : '免责声明'}</h1>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Nature of Risk Reports' : '风险报告的性质'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'JobLens risk reports are AI-generated analyses based on the job information you provide. They are for job-search decision support only and do not constitute legal conclusions or final employment advice.' : 'JobLens 提供的风险报告是基于您提供的岗位信息通过 AI 模型生成的分析结果，仅供求职决策参考，不构成法律认定或最终就业建议。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Information Accuracy' : '信息准确性'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'Report accuracy depends on the completeness and accuracy of the information you provide. Incomplete or inaccurate information may lead to biased results.' : '报告的准确性依赖于您提供的信息的完整性和真实性。如果您提供的信息不完整或不准确，报告结果可能存在偏差。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'AI Model Limitations' : 'AI 模型限制'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'AI models may produce false positives or false negatives. We continuously improve the model but cannot guarantee 100% accuracy. Make final decisions using your own judgment and information from other sources.' : 'AI 模型可能存在误判或漏判的情况。我们会持续优化模型，但无法保证 100% 的准确性。建议您结合自身判断和其他渠道信息做出最终决策。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Not Legal Advice' : '不构成法律意见'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'JobLens risk reports do not constitute legal advice or legal determinations of any kind. Consult a qualified lawyer if you need legal advice.' : 'JobLens 的风险报告不构成任何形式的法律意见或法律认定。如果您需要法律建议，请咨询专业律师。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Use at Your Own Risk' : '使用风险'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'You use JobLens at your own risk. We are not responsible for any direct or indirect losses arising from use of this service.' : '使用 JobLens 服务的风险由您自行承担。我们不对因使用本服务而产生的任何直接或间接损失负责。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Company Information' : '公司信息'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'JobLens does not provide company registry lookups or guarantee the authenticity of company information. Verify company information through official sources.' : 'JobLens 不提供公司工商信息查询服务，也不保证公司信息的真实性。建议您自行通过官方渠道核实公司信息。'}
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{isEnglish ? 'Service Changes' : '服务变更'}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEnglish ? 'JobLens reserves the right to change or discontinue the service at any time without prior notice.' : 'JobLens 保留随时变更或终止服务的权利，无需提前通知。'}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

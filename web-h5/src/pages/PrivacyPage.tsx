import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function PrivacyPage() {
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
          <span className="text-lg font-bold text-gray-800">隐私说明</span>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h1 className="text-xl font-bold text-gray-800">隐私政策</h1>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">数据收集</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              JobLens 会收集您提交的岗位信息，包括但不限于 JD 文本、HR 聊天记录、公司名称和岗位名称。这些信息仅用于生成风险报告，不会用于其他目的。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">数据存储</h2>
            <ul className="text-sm text-gray-600 leading-relaxed space-y-2">
              <li>JD 原文和 HR 聊天记录：保留 7 天，之后自动删除</li>
              <li>报告结果：保留 30 天，之后自动删除</li>
              <li>面试反馈：保留 90 天，用于优化模型，之后自动删除</li>
              <li>API 日志：保留 30 天，用于监控和审计，不含敏感原文</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">第三方服务</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              您提交的岗位信息和 HR 聊天记录会被发送至第三方大模型服务用于生成风险报告。我们选择隐私边界清晰的付费服务，确保您的数据安全。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">删除权利</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              您可以随时删除您的数据：
            </p>
            <ul className="text-sm text-gray-600 leading-relaxed space-y-2 mt-2">
              <li>在报告页点击"删除本次检测记录"删除单条报告</li>
              <li>在隐私页点击"一键删除所有数据"删除所有数据</li>
              <li>删除后 30 天内物理删除所有相关数据</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">敏感信息保护</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              我们禁止提交身份证号、银行卡号、完整手机号等敏感信息。系统会检测并拦截此类信息。日志记录不包含您的原始文本内容。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">匿名访问</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              JobLens 不需要用户登录，使用匿名访问标识（visitor_id）来识别用户。如果您清除浏览器缓存，visitor_id 会重新生成，历史记录将会丢失。
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

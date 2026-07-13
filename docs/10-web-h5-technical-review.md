# 10 Web/H5 首版需求技术评审

评审日期：2026-07-13

## 评审范围

本评审基于 `joblens-miniapp-project` 现有文档完成，重点覆盖 Web/H5 首版需求的技术可行性、前后端实现方案、成本风险和后续技术文档结构。

主要依据：

- `README.md`
- `docs/01-project-brief.md`
- `docs/02-mvp-scope.md`
- `docs/03-risk-score-model.md`
- `docs/04-data-model.md`
- `docs/05-api-spec.md`
- `docs/06-web-h5-pages.md`
- `docs/07-launch-check.md`
- `docs/08-screenshot-ocr-research.md`
- `docs/09-free-ocr-options.md`
- `design/UI/01-ui-design-spec.md`
- `design/UI/02-page-flow.md`
- `design/UI/03-component-spec.md`

## 总体评审结论

Web/H5 首版具备较高技术可行性，建议按“文本粘贴检测 + HR 回复分析 + 风险报告 + 追问复制 + 匿名反馈”的主路径上线。截图 OCR、工商自动查询、公司风险库、公开分享页和社区能力不应阻塞 MVP。

首版工程的关键不在页面复杂度，而在 AI 风险分析结果的稳定性、证据可解释性、隐私边界和失败兜底。只要把模型输出协议、规则校验、数据留存和高风险文案边界提前固定，前后端可以较快进入实现。

建议首版技术策略：

| 方向 | 建议 |
|---|---|
| 前端形态 | Web/H5 响应式单页应用，移动端优先，桌面端兼容 |
| 前端框架 | Vite + React + TypeScript；如需要 SEO 内容页，可后续迁移 Next.js |
| 后端形态 | 轻量 HTTP API 或 Serverless API，先同步返回报告，后续再拆异步任务 |
| AI 分析 | 大模型结构化输出 + 规则引擎二次校验 + 风险分归一化 |
| 数据库 | 首版保留 `users`、`job_reports`、`interview_feedbacks`、`report_feedbacks`、`risk_terms` 核心表 |
| OCR | MVP 不接入；P1 做统一 OCR Provider 接口，自建 RapidOCR / PaddleOCR 优先，云厂商兜底 |
| 合规 | 默认匿名、原文不公开、报告不作法律定性、所有高风险结论必须绑定证据 |

## 技术可行性评审

### P0 主路径可行性

现有 P0 范围清晰，工程复杂度可控。首页、检测页、报告页、追问卡片页、反馈页、隐私说明和免责声明均属于常规 Web/H5 页面，难点集中在接口协议和 AI 输出质量。

| 功能 | 可行性 | 技术判断 | 首版建议 |
|---|---|---|---|
| JD 文本检测 | 高 | 文本输入、接口调用、报告渲染均为常规能力 | 必做 |
| HR 回复分析 | 高 | 可复用检测接口，也可单独调用 `analyzeHrReply` | 必做，但需明确是否允许无 JD 单独分析 |
| 风险报告页 | 高 | 页面复杂度中等，核心依赖稳定 JSON | 必做 |
| 追问卡片 | 高 | 复制能力需处理 H5 权限失败 | 必做 |
| 匿名反馈 | 高 | 普通表单提交，需审核状态字段 | 必做 |
| 隐私说明与免责声明 | 高 | 静态页面，需在检测前和报告页露出 | 必做 |
| 检测历史 | 中 | 需要匿名 token 和本地/服务端记录 | 可做极简版或延后 |
| 分享报告页 | 中 | 有传播价值，但企业投诉风险更高 | 建议首版只分享追问问题，不分享负面定性 |
| 截图 OCR | 中 | 上传与 OCR 可做，但会增加隐私、成本和失败状态 | P1 |
| 工商 API | 中低 | 接入成本、合规解释和误伤风险较高 | 暂缓 |

### 需求一致性问题

现有文档整体一致，但有几处需要在开发前收口：

| 问题 | 影响 | 建议处理 |
|---|---|---|
| `docs/06-web-h5-pages.md` 使用 `/detect` 等 Web 路由，`design/UI/02-page-flow.md` 使用 `/pages/index/index` 等小程序路由 | 前端路由实现口径不一致 | Web/H5 首版统一使用 `/`、`/detect`、`/report/:id`、`/ask-card/:id`、`/feedback`、`/privacy`、`/disclaimer` |
| HR 回复分析入口存在，但检测页要求 JD 文本必填 | 用户只想分析 HR 回复时会被阻塞 | 增加 `mode=jd` / `mode=hr`，HR 模式下允许 `jd_text` 为空，但必须填写 `hr_chat_text` 或 `hr_reply` |
| 风险模型包含工商和用户反馈权重，但 MVP 暂不接工商 API，冷启动也缺少反馈 | 如果直接按标准公式，分数会被缺失数据扭曲 | 使用有效权重归一化；缺失项显示“暂未接入/暂无样本”，不计 0 分 |
| API 草案包含 OCR 和企业申诉，但 MVP 范围未要求完整实现 | 容易扩大首版范围 | 首版保留接口设计，不进入主链路；企业申诉可先用邮箱或简单表单 |
| 报告高风险表达与合规边界依赖模型自觉 | 模型可能输出“诈骗”“黑公司”等高风险词 | 后端增加敏感表达过滤和结论降级规则 |

### AI 能力可行性

大模型可以完成 JD 风险识别、HR 回避判断、证据抽取和追问生成，但不能直接把模型回答当成最终报告。首版必须引入固定 JSON Schema、规则校验和异常兜底。

建议把 AI 分析拆成四层：

```text
用户输入
  ↓
输入预处理：长度限制、敏感信息提示、文本清洗
  ↓
大模型结构化分析：输出风险类型、证据、缺失信息、追问问题、子分建议
  ↓
规则引擎校验：无证据不得高风险、缺失权重归一化、强风险修正项封顶
  ↓
报告生成：保存结构化结果，前端按固定字段渲染
```

AI 输出需要满足三个条件：

1. 字段稳定，前端不解析自然语言。
2. 每个高风险信号必须有证据片段。
3. 置信度受输入长度、HR 信息、工商信息、反馈样本影响，不能只按模型语气判断。

推荐补充统一响应结构：

```json
{
  "report_id": "rep_xxx",
  "overall_score": 78,
  "risk_level": "高",
  "confidence": "中",
  "predicted_role": "销售/客户开发岗",
  "risk_types": ["管理岗包装销售岗", "薪资不透明"],
  "sub_scores": {
    "jd_risk": { "score": 82, "weight": 0.35, "status": "available" },
    "hr_risk": { "score": 75, "weight": 0.20, "status": "available" },
    "company_risk": { "score": null, "weight": 0.25, "status": "missing" },
    "feedback_risk": { "score": null, "weight": 0.20, "status": "missing" }
  },
  "strong_risk_adjustment": 8,
  "evidence": [
    {
      "risk_type": "标题职责偏差",
      "quote": "管理人才、市场实践、业绩分解",
      "explanation": "岗位标题偏管理，但职责包含销售转化相关表达。",
      "related_question": "这个岗位前 1-3 个月是否有个人销售指标？"
    }
  ],
  "missing_info": ["固定无责底薪", "劳动合同主体"],
  "questions": [
    "这个岗位前 1-3 个月是否有个人销售指标？",
    "劳动合同签署主体是哪家公司？"
  ],
  "recommendation": "建议先电话确认核心问题，不建议直接线下面试",
  "disclaimer": "本结果仅供求职决策参考，不构成法律认定。"
}
```

## 前端实现方案

### 技术选型

首版推荐使用 Vite + React + TypeScript，理由是启动快、工程简单、H5 兼容性好，适合从现有 HTML 原型转工程。当前产品不依赖强 SEO、服务端渲染或复杂权限后台，Next.js 的收益暂时不明显。

建议栈：

| 模块 | 建议 |
|---|---|
| 构建工具 | Vite |
| UI 框架 | React + TypeScript |
| 路由 | React Router |
| 请求 | fetch 封装或 TanStack Query |
| 表单 | React Hook Form 或轻量自控表单 |
| 状态 | 首版使用 URL + 接口数据 + 少量本地状态，不引入复杂全局状态 |
| 样式 | CSS Modules / Tailwind CSS 二选一；需映射现有设计 Token |
| 埋点 | 自研轻量 `trackEvent` 封装，后端落库或接第三方统计 |

如团队更熟悉 Vue，也可使用 Vite + Vue 3 + TypeScript。技术路线不应成为风险，关键是把 API 类型、组件边界和错误状态写清楚。

### 路由与页面组织

Web/H5 首版统一路由：

| 路由 | 页面 | 数据依赖 |
|---|---|---|
| `/` | 首页 | 无 |
| `/detect` | 岗位检测 / HR 分析 | `detectJobRisk`、`analyzeHrReply` |
| `/report/:id` | 风险报告 | `getReport`、`submitReportFeedback` |
| `/ask-card/:id` | 追问卡片 | `getReport` |
| `/feedback` | 面试反馈 | `submitInterviewFeedback` |
| `/privacy` | 隐私说明 | 静态内容 |
| `/disclaimer` | 免责声明 | 静态内容 |

建议 `/detect` 支持查询参数：

```text
/detect?mode=jd
/detect?mode=hr
/detect?report_id=rep_xxx&mode=hr
```

这样首页“分析 HR 回复”和追问卡片“继续分析 HR 回复”可以进入同一页面，但默认展开不同输入区。

### 组件拆分

优先复用 `design/UI/03-component-spec.md` 中的业务组件，形成前端组件库：

```text
src/
  components/
    AppHeader.tsx
    BottomActionBar.tsx
    Button.tsx
    TextareaField.tsx
    TagSelect.tsx
    PrivacyNotice.tsx
    DisclaimerBlock.tsx
    RiskBadge.tsx
    RiskSummaryCard.tsx
    EvidenceCard.tsx
    MissingInfoCard.tsx
    QuestionCard.tsx
    SubScoreBars.tsx
    Toast.tsx
  pages/
    HomePage.tsx
    DetectPage.tsx
    ReportPage.tsx
    AskCardPage.tsx
    FeedbackPage.tsx
    PrivacyPage.tsx
    DisclaimerPage.tsx
  services/
    api.ts
    report.ts
    feedback.ts
    tracking.ts
  types/
    report.ts
    feedback.ts
```

报告页模块顺序应保持为“风险摘要 → 命中证据 → 缺失信息 → 追问问题 → 子分说明 → 免责声明和纠错入口”，宽屏可以并排展示，但不改变阅读顺序。

### H5 兼容处理

| 场景 | 实现要求 |
|---|---|
| 微信内置浏览器 | 避免依赖新浏览器特性；复制失败时提供手动复制文本 |
| iOS Safari | 固定底部操作栏使用 `env(safe-area-inset-bottom)` |
| 长文本输入 | `textarea` 自动增高与最大高度滚动结合，提交失败保留内容 |
| 网络波动 | 接口失败后保留表单，提示重试和复制原文 |
| 重复提交 | 分析中禁用按钮，后端也按匿名 token 做限流 |
| 小屏适配 | 360px 宽度不得横向滚动；按钮高度不低于 48px |

### 前端校验

首版前端不需要判断岗位风险，但需要做基础校验：

| 字段 | 校验建议 |
|---|---|
| `jd_text` | JD 模式必填；少于 50 字可提交但提示置信度可能偏低；建议上限 12000 字 |
| `hr_chat_text` | HR 模式必填；建议上限 12000 字 |
| `company_name` | 可选；建议上限 80 字 |
| `job_title` | 可选；建议上限 80 字 |
| 反馈长文本 | 建议上限 3000 字 |
| 敏感信息 | 前端用正则提示手机号、身份证号、银行卡号等，不强制拦截 |

## 后端实现方案

### 服务分层

首版后端建议按业务能力分层，而不是把模型调用、分数计算和数据写入混在一个函数里。

```text
API Controller
  ↓
Application Service
  ↓
Domain Modules
  ├─ risk-analysis：AI 分析与规则校验
  ├─ scoring：权重归一化与等级计算
  ├─ report：报告保存与读取
  ├─ feedback：面试反馈与报告纠错
  ├─ moderation：敏感表达过滤和合规文案约束
  └─ tracking：行为事件与接口日志
  ↓
Infrastructure
  ├─ database
  ├─ llm-provider
  ├─ object-storage
  └─ ocr-provider（P1）
```

### API 收口

首版建议实现 5 个 P0 API：

| API | 用途 | 首版状态 |
|---|---|---|
| `POST /api/reports/detect` | JD 风险检测，可带 HR 聊天内容 | P0 |
| `POST /api/reports/:id/hr-analysis` | 对已有报告追加 HR 回复分析 | P0 |
| `GET /api/reports/:id` | 获取报告详情 | P0 |
| `POST /api/interview-feedbacks` | 提交匿名面试反馈 | P0 |
| `POST /api/report-feedbacks` | 提交报告纠错 | P0 |

P1/P2 API 预留：

| API | 用途 | 建议阶段 |
|---|---|---|
| `POST /api/ocr/extract-job` | 上传截图并提取岗位信息 | P1 |
| `POST /api/enterprise-appeals` | 企业申诉 | P1，可先用表单或邮箱 |
| `GET /api/reports/recent` | 最近检测历史 | 可选 |

### 风险分计算

后端必须实现有效权重归一化，不能把缺失数据当作低风险。

```text
最终风险分 =
Σ（已有子分 × 子模型权重）÷ Σ（已有子模型权重）
+ 强风险修正项
```

等级计算：

| 分数 | 等级 |
|---:|---|
| 0-30 | 低 |
| 31-60 | 中 |
| 61-80 | 高 |
| 81-100 | 极高 |

强风险修正项需要封顶，最终总分不超过 100。若模型输出高风险但 `evidence` 为空，后端应降级为“信息不足”，并要求补充证据。

### 数据模型调整建议

现有数据模型基本可用，建议补充以下字段：

| 表 | 字段 | 说明 |
|---|---|---|
| `job_reports` | `input_hash` | 输入文本哈希，用于去重、限流和排查，不代替原文 |
| `job_reports` | `analysis_status` | `success` / `failed` / `partial` |
| `job_reports` | `model_version` | 记录模型和 Prompt 版本，便于回归 |
| `job_reports` | `schema_version` | 报告 JSON 结构版本 |
| `job_reports` | `retention_until` | 原文保留截止时间 |
| `job_reports` | `is_deleted` | 用户删除记录后软删除 |
| `interview_feedbacks` | `reviewed_at` | 审核时间 |
| `report_feedbacks` | `review_status` | 是否已处理 |
| 新表 `events` | 行为埋点 | 检测完成率、复制率、反馈率等指标需要事件表支持 |
| 新表 `api_logs` | 接口日志 | 记录失败原因、耗时、模型异常，不记录完整敏感原文 |

### 隐私与安全

首版会处理 JD、聊天记录、公司名称和面试反馈，虽不一定包含强实名信息，但用户可能粘贴手机号、微信号、身份证号或聊天昵称。后端需要默认按敏感文本处理。

最低要求：

| 方向 | 要求 |
|---|---|
| 匿名标识 | 前端生成匿名 token，后端映射 `user_id`；不强制登录 |
| 数据传输 | 全站 HTTPS |
| 原文展示 | JD 和聊天原文不公开展示；报告只展示必要证据片段 |
| 日志 | 接口日志不写完整 JD、聊天记录和模型 Prompt |
| 删除 | 隐私说明中提供删除路径，后端支持软删除 |
| 限流 | 按匿名 token、IP、设备指纹中的可用项做基础限流 |
| 供应商调用 | 如接大模型或 OCR 云服务，需在隐私说明中说明用途和边界 |
| 文案治理 | 输出前过滤“诈骗公司、黑名单、实锤、违法”等高风险表达 |

## 成本与工期评估

以下为技术专家视角的粗略估算，实际成本取决于团队熟练度、设计还原要求、AI 服务选型和上线环境。

### 人力工期

| 范围 | 角色 | 估算 |
|---|---|---:|
| Web/H5 P0 页面与组件 | 前端 1 人 | 5-8 人日 |
| API、数据库、匿名用户、反馈 | 后端 1 人 | 4-7 人日 |
| AI 分析协议、Prompt、规则校验 | 后端/AI 1 人 | 4-8 人日 |
| 隐私、免责声明、敏感词和删除机制 | 前后端协作 | 2-4 人日 |
| 埋点、限流、日志和错误兜底 | 前后端协作 | 2-4 人日 |
| 测试样本、回归和灰度修复 | QA/产品/技术 | 4-7 人日 |

若已有成熟后端模板和大模型调用封装，P0 可按 2-3 周完成内测版本；若需要从零搭建部署、数据库、监控和合规文案，建议预留 3-4 周。

### 外部服务成本

| 成本项 | 首版判断 |
|---|---|
| 大模型调用 | P0 主要变量成本；建议限制文本长度、缓存重复输入、对异常重试设上限 |
| 数据库和 API 服务 | 早期低成本，可用轻量云服务或 Serverless |
| 对象存储 | MVP 不做 OCR 时基本不需要；P1 上传截图后需要 |
| OCR | MVP 不计入；P1 自建 OCR 需要服务器成本，云 OCR 需要按次费用 |
| 日志与监控 | 建议使用基础云日志或轻量自建，不应省略 |

OCR 成本可沿用现有文档判断：MVP 不强依赖 OCR；P1 优先后端自建 RapidOCR / PaddleOCR，云 OCR 作为低置信度兜底。

## 主要风险与应对

| 风险 | 概率 | 影响 | 应对方案 |
|---|---|---|---|
| AI 输出字段不稳定，前端无法渲染 | 中 | 高 | 固定 JSON Schema，后端做 schema 校验和默认值补齐 |
| 无证据高风险，造成误伤和投诉 | 中 | 高 | 后端强制证据校验；无证据降级为信息不足 |
| 正常销售岗被误判为包装岗 | 中 | 高 | 样本集中加入正常销售岗位；报告表达改为“需确认”而非定性 |
| 用户输入敏感信息 | 高 | 中高 | 前端提示、后端日志脱敏、原文不公开、支持删除 |
| AI 调用慢或失败 | 中 | 中 | 8 秒以上提示仍在分析；超时保留输入；后端设置重试和友好错误 |
| 成本被高频调用放大 | 中 | 中 | 匿名 token + IP 限流；输入哈希缓存；限制单次文本长度 |
| 分享页引发企业投诉 | 中 | 中高 | 首版不公开企业负面报告；只分享追问问题或用户自用链接 |
| OCR 识别错误影响报告 | 中 | 中 | P1 必须进入确认页，不允许 OCR 后直接出报告 |
| 文档范围过宽导致开发膨胀 | 中 | 中 | P0 只做主路径；OCR、工商、企业申诉、历史记录明确延后 |

## 阶段建议

### MVP 第 1 版

目标是验证用户是否愿意粘贴真实岗位信息，并认可报告和追问问题的价值。

范围：

- Web/H5 响应式主路径
- JD 文本检测
- HR 回复分析
- 风险报告
- 追问复制
- 匿名反馈
- 误判反馈
- 隐私说明和免责声明
- 基础埋点、日志、限流

不进入：

- 截图 OCR
- 工商 API
- 公司黑名单
- 社区广场
- 付费会员
- 公开企业负面分享页

### MVP 第 2 版

目标是降低移动端输入成本，并提升冷启动样本积累。

范围：

- 单图/三图上传
- OCR Provider 接口
- 自建 RapidOCR / PaddleOCR 验证
- 云 OCR 兜底
- OCR 结果确认页
- 更多反馈结构化字段
- 简单检测历史

### Beta 阶段

目标是提升报告质量、降低误判、准备规模化增长。

范围：

- 样本评测集和 bad case 回归
- 风险词典后台维护
- 企业申诉流程
- 分享追问卡片
- 报告质量反馈闭环
- OCR 多图合并和隐私脱敏

## 建议的技术文档结构

现有 `docs/` 已覆盖产品简报、MVP 范围、评分模型、数据模型、API 草案、页面说明、上线检查和 OCR 方案。建议继续补齐工程实现所需文档，避免开发时反复口头确认。

建议结构：

```text
docs/
  01-project-brief.md
  02-mvp-scope.md
  03-risk-score-model.md
  04-data-model.md
  05-api-spec.md
  06-web-h5-pages.md
  07-launch-check.md
  08-screenshot-ocr-research.md
  09-free-ocr-options.md
  10-web-h5-technical-review.md
  11-frontend-architecture.md
  12-backend-architecture.md
  13-ai-output-schema.md
  14-privacy-security-design.md
  15-analytics-events.md
  16-test-samples-and-evaluation.md
  17-deployment-and-ops.md
```

各新增文档建议内容：

| 文档 | 内容 |
|---|---|
| `11-frontend-architecture.md` | 技术栈、目录结构、路由、组件、状态管理、H5 兼容规则、错误状态 |
| `12-backend-architecture.md` | API 分层、服务模块、数据库访问、限流、日志、模型调用、错误码 |
| `13-ai-output-schema.md` | JSON Schema、Prompt 输入输出、分数计算、规则校验、降级策略 |
| `14-privacy-security-design.md` | 匿名 token、数据保留、脱敏、删除、日志策略、供应商调用边界 |
| `15-analytics-events.md` | 检测完成率、追问复制率、反馈提交率、二次检测率所需事件 |
| `16-test-samples-and-evaluation.md` | 50-100 条样本分类、评测维度、bad case 记录、上线门槛 |
| `17-deployment-and-ops.md` | 环境变量、部署流程、监控、告警、回滚、成本观察 |

## 开发前需要确认的决策

| 决策 | 建议默认值 |
|---|---|
| 前端框架 | Vite + React + TypeScript |
| 是否首版做 OCR | 否，P1 |
| 是否首版接工商 API | 否 |
| HR 回复分析是否允许无 JD | 允许，但报告置信度降低 |
| 是否强制登录 | 否，匿名 token |
| 是否保留 JD 和聊天原文 | 可短期保留；隐私说明中写明用途和删除路径 |
| 是否公开报告 | 首版不公开企业负面报告 |
| 是否做企业申诉 | 首版提供邮箱或简单表单入口即可 |
| 是否做检测历史 | 可选；若做，仅本地最近记录或匿名最近报告 |

## 最终建议

JobLens Web/H5 首版应保持小而完整：先把“粘贴岗位信息 → 生成可解释报告 → 复制追问问题 → 匿名反馈”的路径做稳。技术实现上，页面不是主要风险，AI 输出稳定、证据约束、隐私处理、限流和样本回归才是上线质量的关键。

若团队资源有限，建议优先交付 P0 主路径和 `13-ai-output-schema.md`、`14-privacy-security-design.md` 两份工程文档。OCR、工商、公开分享和企业申诉可以保留接口设计，但不进入首版开发主线。

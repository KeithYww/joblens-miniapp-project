# 18 开发前专家评审汇总

评审日期：2026-07-13

## 评审结论

开发、测试、产品三个视角的结论一致：JobLens Web/H5 MVP 技术方向可行，可以进入工程实现准备，但不建议直接按全部文档一次性开发。当前最稳妥的路径是先冻结 P0 API、AI 输出 Schema、数据模型、隐私策略和样本回归标准，再做一个端到端垂直切片。

建议的第一阶段目标：

```text
检测页
  ↓
POST /api/reports/detect
  ↓
AI Risk Engine
  ↓
Schema 校验 + 规则修正
  ↓
报告入库
  ↓
报告页展示
```

这个闭环跑通后，再补匿名反馈、HR 追加分析、限流验证码、成本监控和上线检查。

## 开发专家评审

### 可行性判断

当前 Web/H5 前端选型、BFF/API Server 架构和 AI 风险引擎分层是合理的。`Vite + React + TypeScript` 适合工具型 H5，后端使用 Node.js/Fastify 或 NestJS 与 PostgreSQL 也能支撑首版需求。

AI 风险引擎采用“大模型结构化分析 + 规则引擎校验 + 评分公式计算”的方向正确。OCR、工商 API、公司黑名单、社区和会员系统不应进入 P0。

### 主要问题

| 问题 | 影响 | 建议 |
|---|---|---|
| API 路径命名不一致 | 前后端可能按不同文档实现 | 开发前冻结 API Contract |
| 输入长度口径不一致 | 前端允许提交但后端拒绝，或成本估算失真 | 统一为总长度上限，单字段只做提示 |
| 数据模型缺工程字段 | 无法做缓存、回归、删除、成本追踪 | 补 `input_hash`、`model_version`、`schema_version` 等字段 |
| AI 输出只有示例 JSON | 前端渲染和后端校验不稳定 | 定义 Zod / JSON Schema / TypeScript 类型 |
| HR 分析关系不清 | 无 JD 场景和已有报告场景混淆 | 支持有报告追加和无报告独立分析两种模式 |

### 开发优先级

P0 必须先做：

- 冻结 API 协议。
- 定义 `RiskReport`、`EvidenceItem`、`SubScore`、`ApiError` 等类型。
- 实现 AI 风险引擎最小闭环。
- 做报告页最小渲染。
- 建立 50 条以上测试样本。
- 落地隐私与日志策略。

P0.5 紧随其后：

- IP、visitor_id、input_hash 限流。
- 验证码触发和服务端校验。
- 匿名反馈和报告纠错。
- AI 调用成本与质量监控。

## 测试专家评审

### 测试范围

P0 必测范围包括：

- `POST /api/reports/detect`
- `GET /api/reports/:id`
- `POST /api/reports/:id/hr-analysis`
- `POST /api/interview-feedbacks`
- `POST /api/report-feedbacks`
- AI 输出 JSON 合法性
- 高风险证据约束
- 敏感词过滤
- 限流、验证码、重复提交识别
- 日志脱敏
- 免责声明与隐私说明

OCR 仍建议放在 P1。若进入 P1，必须测试图片数量、大小、格式、识别失败兜底、确认页、原图删除和截图隐私保护。

### 质量门槛

| 维度 | 门槛 |
|---|---|
| API | P0 API 全部具备参数校验、错误码、日志和限流 |
| AI 输出 | JSON Schema 校验覆盖 100% |
| 高风险报告 | 必须至少有 1 条证据 |
| 无证据高风险 | 必须降级为“信息不足” |
| 样本回归 | 至少 50-100 条脱敏真实岗位样本 |
| 限流验证码 | 所有高成本接口具备服务端限流和验证码校验 |
| 隐私 | 日志不得记录完整 JD、聊天记录、手机号、身份证等敏感信息 |

### 关键缺口

- 当前 `web-h5/` 和 `backend/` 仍为空目录，无法执行真实接口测试。
- API Contract 未冻结。
- AI 输出 Schema 未形成独立工程文件。
- 限流缺少 Redis key 设计、窗口算法、封禁策略和验证码通过后的豁免时长。
- 测试样本集尚未落地。

## 产品专家评审

### 范围判断

MVP 继续坚持“小而完整”：只验证用户是否愿意粘贴真实岗位信息、是否认可报告证据、是否复制追问、是否愿意反馈结果。

P0 保留：

- JD 文本检测
- HR 回复分析
- 风险报告
- 追问复制
- 报告纠错轻反馈
- 面试后匿名反馈轻量版
- 隐私说明、免责声明、删除入口
- 限流、验证码、敏感信息提示
- 基础埋点

P0 不做：

- OCR
- 工商 API
- 公开报告分享
- 公司黑名单
- 社区广场
- 企业申诉完整流程
- 检测历史服务端化
- 复杂样本库后台

### 体验风险

| 风险 | 建议 |
|---|---|
| HR 分析入口要求 JD 必填 | `/detect?mode=hr` 允许无 JD，但只输出 HR 回避分析 |
| 风险分制造定性压力 | 首屏优先展示建议、证据和待确认问题，弱化分数 |
| 追问数量过多 | 默认展示 3 个关键问题，展开显示更多 |
| 反馈表单太重 | P0 拆成报告轻反馈和面试后轻反馈 |
| 删除路径不闭环 | 报告页提供“删除本次检测记录”入口 |
| 验证码影响首检 | 首次低频检测不主动展示验证码 |

### 报告表达建议

报告页应强调“确认关键信息”，避免像最终裁决。

推荐表达：

```text
建议先确认 3 个关键信息，再决定是否继续面试。
```

不推荐表达：

```text
该岗位高风险，不建议面试。
```

缺失信息需要直接转成追问，例如：

```text
缺失：固定无责底薪
追问：请问这个岗位固定无责底薪是多少？是否写入劳动合同或 offer？
```

## 统一整改项

### 开发前必须收口

| 优先级 | 项目 | 说明 |
|---|---|---|
| P0 | API Contract | 统一接口路径、请求体、响应体、错误码 |
| P0 | AI 输出 Schema | 定义字段类型、枚举、必填项、默认值、版本号 |
| P0 | 数据库 Schema | 补齐报告、反馈、日志、事件、成本追踪字段 |
| P0 | 输入长度策略 | 统一 JD 和 HR 文本总长度限制 |
| P0 | 隐私策略 | 明确原文是否保存、保存多久、如何删除 |
| P0 | 样本回归集 | 建立 50-100 条脱敏岗位样本 |
| P0 | 报告表达规则 | 禁止法律定性和攻击性表达 |
| P0 | 限流验证码 | 明确 Redis key、窗口、阈值、错误码和豁免时间 |

### API 建议冻结版本

建议 P0 使用以下接口：

```text
POST /api/reports/detect
GET /api/reports/:id
POST /api/reports/:id/hr-analysis
POST /api/hr-analysis
POST /api/interview-feedbacks
POST /api/report-feedbacks
DELETE /api/reports/:id
```

P1 预留：

```text
POST /api/ocr/extract-job
POST /api/enterprise-appeals
GET /api/reports/recent
```

### 数据字段补充

`job_reports` 建议补充：

```text
input_hash
analysis_status
provider
model
model_version
prompt_version
schema_version
latency_ms
input_tokens
output_tokens
cost_estimate
retention_until
is_deleted
deleted_at
```

新增表建议：

```text
events
api_logs
security_events
```

## 第一阶段开发切片

建议第一阶段不要追求完整 UI 和全部功能，先验证工程闭环：

```text
Vite React 检测页
  ↓
POST /api/reports/detect
  ↓
MockProvider 或单一 LLM Provider
  ↓
Zod Schema 校验
  ↓
规则引擎修正
  ↓
PostgreSQL 保存报告
  ↓
GET /api/reports/:id
  ↓
报告页渲染
```

验收标准：

- 50 条样本都能稳定返回报告。
- 无 JSON 渲染失败。
- 高风险报告都有证据。
- 正常销售岗不被直接定性为包装岗。
- 日志不包含完整 JD 或聊天原文。
- 重复输入能通过 `input_hash` 识别。
- 错误响应能被前端统一处理。

## 最终建议

JobLens 现在可以进入工程实现准备，但第一步不是写页面，而是冻结工程契约：

```text
API Contract
AI Output Schema
Database Schema
Privacy Policy
Evaluation Samples
Rate Limit Rules
```

这些收口后，再进入前后端垂直切片开发。这样能避免页面先做完、接口频繁变、模型输出不稳定、隐私和限流后补的返工风险。

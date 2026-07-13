# 19 API Contract - P0 冻结版本

冻结日期：2026-07-13
版本：v1.0.0

## 说明

本文档冻结 JobLens Web/H5 MVP P0 阶段的所有 API 掏口定义。所有前后端开发必须严格按照此契约实现，不得擅自更改路径、字段名、数据类型或错误码。

后续如果需要调整，必须：
1. 在本文档中明确记录变更版本和原因
2. 前后端同步修改并完成回归测试
3. 更新 API 版本号

## 基础约定

### 请求头

所有请求建议携带以下匿名访问标识：

```text
X-Visitor-Id: visitor_xxx
Content-Type: application/json
```

`visitor_id` 由前端生成并持久化到 localStorage，用于限流和缓存识别。如果用户清除浏览器数据，visitor_id 会重新生成，这是可接受的。

### 验证码机制

当后端检测到高频请求或可疑行为时，返回 `CAPTCHA_REQUIRED` 错误。前端完成验证码验证后，在原请求体中附加 `captcha_token` 字段重试：

```json
{
  "captcha_token": "captcha_response_token_from_provider",
  // 其他业务字段...
}
```

后端必须调用验证码 Provider 的服务端校验接口，不能信任前端传递的本地状态。

### 输入长度策略

统一采用总长度上限策略：

| 维度 | 限制 | 说明 |
|---|---:|---|
| JD 文本 | 50-8000 字 | 前端提示建议 50 字以上，后端强制上限 8000 字 |
| HR 聊天文本 | 0-8000 字 | 选填，上限 8000 字 |
| 公司名称 | 0-80 字 | 选填，上限 80 字 |
| 岗位名称 | 0-80 字 | 选填，上限 80 字 |
| JD + HR 总长度 | ≤12000 字 | 后端统一校验，前端提示但不强制 |
| 反馈内容 | 50-2000 字 | 单个反馈字段上限 |

前端只做友好提示，后端做强制校验并返回 `VALIDATION_ERROR`。

### 时间戳格式

所有时间字段统一使用 ISO 8601 格式：

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

示例：

```text
2026-07-13T10:30:00.000Z
```

## P0 API 接口列表

### 1. POST /api/reports/detect

岗位风险检测主接口。

#### 请求体

```json
{
  "source_platform": "BOSS直聘",
  "company_name": "某某公司",
  "job_title": "储备主管",
  "jd_text": "岗位职责...",
  "hr_chat_text": "可选，HR聊天内容...",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

字段说明：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| source_platform | string | 否 | 枚举或自由文本，≤30 字 | 招聘来源平台 |
| company_name | string | 否 | ≤80 字 | 公司名称 |
| job_title | string | 否 | ≤80 字 | 岗位名称 |
| jd_text | string | 是 | 50-8000 字 | JD 文本内容 |
| hr_chat_text | string | 否 | 0-8000 字 | HR 聊天记录 |
| captcha_token | string | 否 | 验证码 Provider 校验 | 仅在后端要求验证码时必填 |

后端额外校验：
- `jd_text` + `hr_chat_text` 总长度 ≤ 12000 字
- 文本中不得包含身份证号、完整手机号、银行卡号等敏感信息（前端提示，后端可选拦截）

#### 响应体 - 成功

```json
{
  "report_id": "rep_abc123def456",
  "overall_score": 78,
  "risk_level": "高",
  "confidence": "中",
  "predicted_role": "销售/客户开发岗",
  "risk_types": ["管理岗包装销售岗", "薪资不透明"],
  "sub_scores": {
    "jd_risk": {
      "score": 82,
      "weight": 0.35,
      "status": "available"
    },
    "hr_risk": {
      "score": 75,
      "weight": 0.20,
      "status": "available"
    },
    "company_risk": {
      "score": null,
      "weight": 0.25,
      "status": "missing"
    },
    "feedback_risk": {
      "score": null,
      "weight": 0.20,
      "status": "missing"
    }
  },
  "strong_risk_adjustment": 8,
  "evidence": [
    "JD中出现"管理人才、实作期、市场实践、业绩分解"组合",
    "HR未正面回答是否有个人销售指标"
  ],
  "missing_info": [
    "固定无责底薪",
    "是否有个人销售指标",
    "劳动合同主体",
    "社保缴纳主体"
  ],
  "questions": [
    "这个岗位前 1-3 个月是否有个人销售指标？",
    "是否需要自己开发客户或销售保险产品？",
    "固定无责底薪是多少？",
    "劳动合同签署主体是哪家公司？"
  ],
  "recommendation": "建议先电话确认核心问题，不建议直接线下面试",
  "disclaimer": "本结果仅供求职决策参考，不构成法律认定。",
  "created_at": "2026-07-13T10:30:00.000Z"
}
```

#### 响应体 - 错误

见通用错误码章节。

---

### 2. GET /api/reports/:id

获取已生成的风险报告详情。

#### 路径参数

- `id`: 报告 ID，格式为 `rep_` 开头的字符串

#### 请求头

```text
X-Visitor-Id: visitor_xxx
```

#### 响应体 - 成功

返回完整的报告结构，同 `POST /api/reports/detect` 成功响应。

#### 响应体 - 错误

见通用错误码章节。

---

### 3. POST /api/reports/:id/hr-analysis

追加 HR 回复分析。基于已有报告，分析用户追加的 HR 回复是否回避关键问题。

#### 路径参数

- `id`: 报告 ID

#### 请求体

```json
{
  "user_question": "是否需要自己开发客户？",
  "hr_reply": "具体到公司会详细介绍，我们主要是培养管理人才。",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

字段说明：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| user_question | string | 是 | 10-500 字 | 用户提问内容 |
| hr_reply | string | 是 | 10-2000 字 | HR 回复内容 |
| captcha_token | string | 否 | 验证码 Provider 校验 | 仅在后端要求验证码时必填 |

#### 响应体 - 成功

```json
{
  "hr_analysis_id": "hra_xyz789",
  "report_id": "rep_abc123def456",
  "avoidance_score": 86,
  "risk_level": "高",
  "analysis": "HR未正面回答是否需要个人开发客户，使用"到公司详细介绍"和"培养管理人才"替代明确说明。",
  "next_questions": [
    "是否有个人销售指标？",
    "客户来源由公司提供，还是需要自己开发？",
    "如果不做销售，这个岗位是否仍然成立？"
  ],
  "created_at": "2026-07-13T11:00:00.000Z"
}
```

---

### 4. POST /api/hr-analysis

独立 HR 分析接口（无报告场景）。用户只提供 HR 聊天片段，不需要已有报告。

#### 请求体

```json
{
  "source_platform": "BOSS直聘",
  "company_name": "可选",
  "job_title": "可选",
  "user_question": "是否需要自己开发客户？",
  "hr_reply": "具体到公司会详细介绍，我们主要是培养管理人才。",
  "jd_context": "可选，JD片段用于辅助判断",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

字段说明：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| user_question | string | 是 | 10-500 字 | 用户提问 |
| hr_reply | string | 是 | 10-2000 字 | HR 回复 |
| jd_context | string | 否 | 0-2000 字 | JD片段辅助判断 |
| 其他字段 | 同上 | 否 | 同基础约定 | 可选背景信息 |

#### 响应体 - 成功

```json
{
  "hr_analysis_id": "hra_xyz789",
  "avoidance_score": 86,
  "risk_level": "高",
  "analysis": "HR未正面回答是否需要个人开发客户。",
  "next_questions": [
    "是否有个人销售指标？",
    "客户来源由公司提供，还是需要自己开发？"
  ],
  "created_at": "2026-07-13T11:00:00.000Z"
}
```

---

### 5. POST /api/interview-feedbacks

提交面试后匿名反馈。

#### 请求体

```json
{
  "report_id": "可选，rep_abc123def456",
  "company_name": "某某公司",
  "job_title": "储备主管",
  "source_platform": "BOSS直聘",
  "jd_claim": "管理岗，负责团队管理",
  "interview_actual": "实际要求开发客户并销售保险产品",
  "involves_sales": true,
  "involves_fee": false,
  "involves_training_loan": false,
  "involves_deposit": false,
  "subject_mismatch": false,
  "recommend_to_others": "不推荐",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

字段说明：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| report_id | string | 否 | 报告 ID 格式 | 关联的报告 ID，可选 |
| company_name | string | 是 | ≤80 字 | 公司名称 |
| job_title | string | 是 | ≤80 字 | 岗位名称 |
| source_platform | string | 否 | ≤30 字 | 招聘平台 |
| jd_claim | string | 是 | 10-500 字 | JD 声称的内容 |
| interview_actual | string | 是 | 10-2000 字 | 实际面试内容 |
| involves_sales | boolean | 是 | true/false | 是否涉及销售 |
| involves_fee | boolean | 是 | true/false | 是否涉及收费 |
| involves_training_loan | boolean | 是 | true/false | 是否涉及培训贷 |
| involves_deposit | boolean | 是 | true/false | 是否涉及押金 |
| subject_mismatch | boolean | 是 | true/false | 实际工作是否与 JD 严重不符 |
| recommend_to_others | string | 是 | 枚举："推荐"、"中立"、"不推荐" | 是否推荐其他人 |
| captcha_token | string | 否 | 验证码校验 | 后端要求时必填 |

#### 响应体 - 成功

```json
{
  "feedback_id": "fb_xyz789",
  "status": "submitted",
  "message": "已匿名提交，审核后将用于优化岗位风险判断。",
  "created_at": "2026-07-13T12:00:00.000Z"
}
```

---

### 6. POST /api/report-feedbacks

报告纠错轻反馈。用户认为报告判断不准或证据不充分时提交。

#### 请求体

```json
{
  "report_id": "rep_abc123def456",
  "feedback_type": "判断不准",
  "content": "这个岗位实际是正常销售岗，JD里已经写清楚了。",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

字段说明：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| report_id | string | 是 | 报告 ID 格式 | 关联的报告 |
| feedback_type | string | 是 | 枚举："判断不准"、"证据不足"、"表达不当"、"其他" | 反馈类型 |
| content | string | 是 | 10-2000 字 | 反馈详细内容 |
| captcha_token | string | 否 | 验证码校验 | 后端要求时必填 |

#### 响应体 - 成功

```json
{
  "feedback_id": "rfb_xyz789",
  "status": "submitted",
  "message": "已收到反馈，我们会用于优化模型。",
  "created_at": "2026-07-13T12:30:00.000Z"
}
```

---

### 7. DELETE /api/reports/:id

删除报告及关联数据。用户隐私保护入口。

#### 路径参数

- `id`: 报告 ID

#### 请求头

```text
X-Visitor-Id: visitor_xxx
```

#### 响应体 - 成功

```json
{
  "status": "deleted",
  "message": "该报告及相关数据已删除。",
  "deleted_at": "2026-07-13T13:00:00.000Z"
}
```

#### 响应体 - 错误

见通用错误码。

---

## P1 预留接口

以下接口不在 P0 实现范围内，但提前预留接口定义：

### POST /api/ocr/extract-job

岗位截图 OCR 识别。P1 实现。

### POST /api/enterprise-appeals

企业申诉入口。P1/P2 实现。

### GET /api/reports/recent

用户最近检测历史。P1 实现，服务端化历史记录。

---

## 通用错误码

所有接口使用统一的错误码体系。后端返回错误时，HTTP 状态码和业务错误码必须一致。

| 错误码 | HTTP 状态 | 说明 | 前端处理建议 |
|---|---:|---|---|
| VALIDATION_ERROR | 400 | 参数格式错误、文本过长、缺少必填项 | 标出问题字段，保留用户输入，提示修正 |
| CAPTCHA_REQUIRED | 403 | 请求较频繁或可疑，需要验证码 | 展示验证码组件，验证通过后携带 captcha_token 重试 |
| CAPTCHA_FAILED | 403 | 验证码校验失败 | 提示刷新验证码重新尝试，不清空用户输入 |
| RATE_LIMITED | 429 | 超过频次限制 | 提示稍后再试，展示限制说明 |
| PAYLOAD_TOO_LARGE | 413 | 文本总长度超过 12000 字或图片过大 | 提示压缩或删减内容 |
| REPORT_NOT_FOUND | 404 | 报告不存在或已删除 | 提示报告不存在，返回首页 |
| AI_PROVIDER_ERROR | 502 | 大模型服务异常 | 提示服务暂时不可用，允许保留输入后重试 |
| INTERNAL_ERROR | 500 | 服务端未知错误 | 展示友好错误提示，建议稍后再试 |

### 错误响应格式

```json
{
  "error": "VALIDATION_ERROR",
  "message": "JD 文本长度必须在 50-8000 字之间。",
  "details": [
    {
      "field": "jd_text",
      "issue": "文本长度 12 字，低于最小限制 50 字"
    }
  ]
}
```

验证码错误示例：

```json
{
  "error": "CAPTCHA_REQUIRED",
  "message": "请求较频繁，请先完成验证。",
  "captcha_provider": "turnstile"
}
```

限流错误示例：

```json
{
  "error": "RATE_LIMITED",
  "message": "检测次数较多，请稍后再试。",
  "retry_after": "2026-07-13T14:00:00.000Z"
}
```

---

## API 版本管理

当前冻结版本：`v1.0.0`

后续如果需要调整接口，必须遵循以下流程：

1. 创建新版本文档，如 `docs/19-api-contract-v1.1.md`
2. 在新版本文档中明确记录：
   - 变更内容
   - 变更原因
   - 影响范围
   - 迁移方案
3. 前后端同步修改并完成回归测试
4. 更新 README.md 和相关文档中的 API 版本说明

---

## 前端实现要点

1. 所有请求必须携带 `X-Visitor-Id` 头
2. 输入长度只做友好提示，不强制拦截（后端做强制校验）
3. 验证码逻辑：收到 `CAPTCHA_REQUIRED` 后展示验证码组件，成功后携带 `captcha_token` 重试原请求
4. 错误统一处理：根据错误码展示对应提示，保留用户输入
5. 报告页渲染：严格按照 Schema 渲染，缺失字段展示默认文案

---

## 后端实现要点

1. 所有接口必须做参数校验、Schema 校验、错误码规范返回
2. 验证码校验必须调用 Provider 服务端接口，不能信任前端
3. 限流逻辑必须在 Redis 中记录 IP、visitor_id、input_hash 频次
4. 高风险报告必须至少有 1 条证据，否则降级为"信息不足"
5. 日志不得记录完整 JD、HR 聊天原文、手机号、身份证等敏感信息
6. 所有响应必须包含 `created_at` 时间戳字段

---

## 变更记录

| 版本 | 日期 | 变更内容 | 变更原因 |
|---|---|---|---|
| v1.0.0 | 2026-07-13 | 初始冻结版本 | P0 MVP 开发启动 |
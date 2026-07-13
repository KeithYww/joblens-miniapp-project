# 05 API 草案

## 说明

首版建议使用Web/H5 + 后端 API。这里的 API 可以理解为后端函数接口，也可以迁移为传统后端 HTTP API。

所有高成本写接口都要支持限流和验证码校验。前端每次请求建议带上匿名访问标识，后端根据 IP、`visitor_id`、`input_hash` 和行为频率判断是否要求验证码。

推荐请求头：

```text
X-Visitor-Id: visitor_xxx
```

当后端要求验证码时，前端完成验证后在请求体中附加：

```json
{
  "captcha_token": "captcha_response_token"
}
```

后端必须服务端校验 `captcha_token`，不能信任前端本地状态。

## detectJobRisk

岗位风险检测。

### 请求

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

### 响应

```json
{
  "report_id": "rep_001",
  "overall_score": 78,
  "risk_level": "高",
  "confidence": "中",
  "predicted_role": "销售/客户开发岗",
  "risk_types": ["管理岗包装销售岗", "薪资不透明"],
  "sub_scores": {
    "jd_risk": { "score": 82, "weight": 0.35 },
    "hr_risk": { "score": 75, "weight": 0.20 },
    "company_risk": { "score": null, "weight": 0.25, "status": "missing" },
    "feedback_risk": { "score": null, "weight": 0.20, "status": "missing" }
  },
  "strong_risk_adjustment": 8,
  "evidence": [
    "JD中出现“管理人才、实作期、市场实践、业绩分解”组合",
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
  "disclaimer": "本结果仅供求职决策参考，不构成法律认定。"
}
```

## analyzeHrReply

分析 HR 回复是否回避关键问题。

### 请求

```json
{
  "report_id": "rep_001",
  "user_question": "是否需要自己开发客户？",
  "hr_reply": "具体到公司会详细介绍，我们主要是培养管理人才。",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

### 响应

```json
{
  "avoidance_score": 86,
  "risk_level": "高",
  "analysis": "HR未正面回答是否需要个人开发客户，使用“到公司详细介绍”和“培养管理人才”替代明确说明。",
  "next_questions": [
    "是否有个人销售指标？",
    "客户来源由公司提供，还是需要自己开发？",
    "如果不做销售，这个岗位是否仍然成立？"
  ]
}
```

## submitInterviewFeedback

提交匿名面试反馈。

### 请求

```json
{
  "report_id": "rep_001",
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
  "is_public": true,
  "captcha_token": "可选，后端要求验证码时必填"
}
```

### 响应

```json
{
  "feedback_id": "fb_001",
  "status": "submitted",
  "message": "已匿名提交，审核后将用于优化岗位风险判断。"
}
```

## submitReportFeedback

报告纠错。

### 请求

```json
{
  "report_id": "rep_001",
  "feedback_type": "判断不准",
  "content": "这个岗位实际是正常销售岗，JD里已经写清楚了。",
  "captcha_token": "可选，后端要求验证码时必填"
}
```

### 响应

```json
{
  "status": "submitted",
  "message": "已收到反馈，我们会用于优化模型。"
}
```

## getReport

获取报告详情。

### 请求

```json
{
  "report_id": "rep_001"
}
```

### 响应

返回 `detectJobRisk` 的报告结构。

## extractJobFromImage

上传岗位截图并提取岗位信息。

### 请求

```json
{
  "image_file_ids": [
    "cloud://joblens/images/ocr_001.jpg",
    "cloud://joblens/images/ocr_002.jpg"
  ],
  "image_type": "job_page",
  "source_platform": "BOSS直聘",
  "captcha_token": "P1 上传接口建议默认必填"
}
```

### 响应

```json
{
  "ocr_task_id": "ocr_001",
  "status": "success",
  "raw_ocr_text": "岗位名称：储备主管\\n薪资：8-12K...",
  "structured_job": {
    "company_name": "某某公司",
    "job_title": "储备主管",
    "salary_range": "8-12K",
    "location": "上海",
    "experience_requirement": "经验不限",
    "education_requirement": "大专",
    "job_responsibilities": "协助团队管理、市场实践、业绩跟进...",
    "job_requirements": "沟通能力强，抗压能力强...",
    "benefits": "五险一金，绩效奖金",
    "hr_chat_text": ""
  },
  "confidence": "中",
  "need_user_confirm": true,
  "warnings": [
    "截图内容可能不完整，建议用户确认岗位职责和薪资是否识别准确。"
  ]
}
```

### 处理规则

- 支持 1-3 张图片。
- 单张图片建议不超过 5MB。
- OCR 后必须进入用户确认页，不能直接生成最终报告。
- 图片原图默认短期保存，识别完成后可删除或自动过期。
- 不公开展示用户上传的原图和完整聊天截图。

## createEnterpriseAppeal

企业申诉入口。

### 请求

```json
{
  "company_name": "某某公司",
  "contact_name": "张三",
  "contact_info": "email@example.com",
  "appeal_content": "该岗位描述与报告判断不一致，请复核。",
  "proof_files": [],
  "captcha_token": "建议必填"
}
```

### 响应

```json
{
  "appeal_id": "ap_001",
  "status": "submitted"
}
```

## 通用错误码

| 错误码 | HTTP 状态 | 说明 | 前端处理 |
|---|---:|---|---|
| `VALIDATION_ERROR` | 400 | 参数格式错误或文本过长 | 标出问题字段，保留输入 |
| `CAPTCHA_REQUIRED` | 403 | 请求较频繁，需要验证码 | 展示验证码，验证后重试 |
| `CAPTCHA_FAILED` | 403 | 验证码校验失败 | 提示刷新验证 |
| `RATE_LIMITED` | 429 | 超过频次限制 | 提示稍后再试 |
| `PAYLOAD_TOO_LARGE` | 413 | 文本或图片过大 | 提示压缩或删减内容 |
| `AI_PROVIDER_ERROR` | 502 | 大模型服务异常 | 保留输入，允许重试 |
| `INTERNAL_ERROR` | 500 | 服务端未知错误 | 展示友好错误提示 |

示例：

```json
{
  "error": "CAPTCHA_REQUIRED",
  "message": "请求较频繁，请先完成验证。",
  "captcha_provider": "turnstile"
}
```

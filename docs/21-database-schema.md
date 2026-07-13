# 21 Database Schema - P0 冻结版本

冻结日期：2026-07-13
版本：v1.0.0

## 说明

本文档冻结 JobLens Web/H5 MVP P0 阶段所有数据库表结构定义。所有后端开发必须严格按照此 Schema 创建表、索引、约束和触发器。

数据库选择：
- PostgreSQL 12+ 作为主数据库
- Redis 6+ 作为缓存和限流存储

ORM 工具：
- Prisma（推荐）
- 或 Sequelize / TypeORM

## P0 核心表

### 1. job_reports - 岗位风险报告表

主报告表，存储岗位检测的核心结果。

#### Prisma Schema

```prisma
model JobReport {
  id                String   @id @default(cuid()) @db.VarChar(50)
  report_id         String   @unique @db.VarChar(50) // 格式: rep_[a-z0-9]{12}
  
  // 输入信息
  source_platform   String?  @db.VarChar(30)
  company_name      String?  @db.VarChar(80)
  job_title         String?  @db.VarChar(80)
  jd_text           String   @db.Text
  hr_chat_text      String?  @db.Text
  
  // 输入处理信息
  input_hash        String   @db.VarChar(64) // SHA-256 hash of (jd_text + hr_chat_text)
  visitor_id        String?  @db.VarChar(50)
  ip_address        String?  @db.VarChar(45) // IPv4 or IPv6
  
  // 报告结果
  overall_score     Int      // 0-100
  risk_level        String   @db.VarChar(10) // 低、中、高、极高
  confidence        String   @db.VarChar(10) // 高、中、低
  predicted_role    String?  @db.VarChar(100)
  risk_types        Json     // array of strings
  sub_scores        Json     // SubScores object
  strong_risk_adjustment Int @default(0) // 0-20
  
  evidence          Json     // array of strings
  missing_info      Json     // array of strings
  questions         Json     // array of strings
  recommendation    String   @db.VarChar(200)
  disclaimer        String   @db.VarChar(100)
  
  // AI 调用信息
  analysis_status   String   @default("pending") @db.VarChar(20) // pending, processing, completed, failed
  provider          String?  @db.VarChar(50) // deepseek, siliconflow, gemini, groq, mock
  model             String?  @db.VarChar(50)
  model_version     String?  @db.VarChar(20)
  prompt_version    String?  @db.VarChar(20) // v1.0
  schema_version    String   @default("v1.0.0") @db.VarChar(20)
  
  // 性能与成本
  latency_ms        Int?
  input_tokens      Int?
  output_tokens     Int?
  cost_estimate     Decimal? @db.Decimal(10, 6) // 单位: 元
  
  // 隐私与删除
  retention_until   DateTime? // 数据保留截止时间
  is_deleted        Boolean  @default(false)
  deleted_at        DateTime?
  
  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt
  
  @@index([report_id])
  @@index([input_hash])
  @@index([visitor_id])
  @@index([created_at])
  @@index([is_deleted])
  @@map("job_reports")
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | cuid | 是 | 内部主键 |
| report_id | string(50) | 是 | 外部业务 ID，格式 `rep_[a-z0-9]{12}` |
| source_platform | string(30) | 否 | 招聘来源平台 |
| company_name | string(80) | 否 | 公司名称 |
| job_title | string(80) | 否 | 岗位名称 |
| jd_text | text | 是 | JD 文本，原文存储但日志脱敏 |
| hr_chat_text | text | 否 | HR 聊天记录，原文存储但日志脱敏 |
| input_hash | string(64) | 是 | SHA-256 哈希，用于重复检测识别 |
| visitor_id | string(50) | 否 | 前端匿名访问标识 |
| ip_address | string(45) | 否 | 用户 IP，用于限流和安全日志 |
| overall_score | int | 是 | 综合风险分 0-100 |
| risk_level | string(10) | 是 | 风险等级：低/中/高/极高 |
| confidence | string(10) | 是 | 置信度：高/中/低 |
| predicted_role | string(100) | 否 | 预测实际岗位类型 |
| risk_types | json | 是 | 风险类型数组 |
| sub_scores | json | 是 | 子评分对象 |
| strong_risk_adjustment | int | 是 | 强风险修正值 |
| evidence | json | 是 | 证据数组 |
| missing_info | json | 是 | 缺失信息数组 |
| questions | json | 是 | 追问问题数组 |
| recommendation | string(200) | 是 | 建议文案 |
| disclaimer | string(100) | 是 | 固定免责声明 |
| analysis_status | string(20) | 是 | 分析状态：pending/processing/completed/failed |
| provider | string(50) | 否 | AI Provider 名称 |
| model | string(50) | 否 | 模型名称 |
| model_version | string(20) | 否 | 模型版本 |
| prompt_version | string(20) | 否 | Prompt 版本 |
| schema_version | string(20) | 是 | AI Output Schema 版本 |
| latency_ms | int | 否 | AI 调用耗时 ms |
| input_tokens | int | 否 | 输入 token 数 |
| output_tokens | int | 否 | 输出 token 数 |
| cost_estimate | decimal(10,6) | 否 | 成本估算，单位元 |
| retention_until | timestamp | 否 | 数据保留截止时间 |
| is_deleted | boolean | 是 | 是否已删除 |
| deleted_at | timestamp | 否 | 删除时间 |
| created_at | timestamp | 是 | 创建时间 |
| updated_at | timestamp | 是 | 更新时间 |

#### 索引说明

- `report_id`: 业务查询主索引
- `input_hash`: 重复检测识别索引
- `visitor_id`: 用户历史查询索引
- `created_at`: 时间范围查询索引
- `is_deleted`: 已删除数据过滤索引

---

### 2. hr_analyses - HR 回复分析表

存储 HR 回复追加分析和独立 HR 分析结果。

#### Prisma Schema

```prisma
model HrAnalysis {
  id              String   @id @default(cuid()) @db.VarChar(50)
  hr_analysis_id  String   @unique @db.VarChar(50) // 格式: hra_[a-z0-9]{12}
  report_id       String?  @db.VarChar(50) // 关联报告 ID，可选
  
  // 输入信息
  user_question   String   @db.VarChar(500)
  hr_reply        String   @db.VarChar(2000)
  jd_context      String?  @db.VarChar(2000) // JD片段辅助判断
  
  visitor_id      String?  @db.VarChar(50)
  ip_address      String?  @db.VarChar(45)
  
  // 分析结果
  avoidance_score Int      // 0-100
  risk_level      String   @db.VarChar(10)
  analysis        String   @db.VarChar(500)
  next_questions  Json     // array of strings
  
  // AI 调用信息
  analysis_status String   @default("pending") @db.VarChar(20)
  provider        String?  @db.VarChar(50)
  model           String?  @db.VarChar(50)
  model_version   String?  @db.VarChar(20)
  prompt_version  String?  @db.VarChar(20)
  schema_version  String   @default("v1.0.0") @db.VarChar(20)
  
  latency_ms      Int?
  input_tokens    Int?
  output_tokens   Int?
  cost_estimate   Decimal? @db.Decimal(10, 6)
  
  retention_until DateTime?
  is_deleted      Boolean  @default(false)
  deleted_at      DateTime?
  
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  
  @@index([hr_analysis_id])
  @@index([report_id])
  @@index([visitor_id])
  @@index([created_at])
  @@map("hr_analyses")
}
```

---

### 3. interview_feedbacks - 面试反馈表

存储面试后匿名反馈。

#### Prisma Schema

```prisma
model InterviewFeedback {
  id              String   @id @default(cuid()) @db.VarChar(50)
  feedback_id     String   @unique @db.VarChar(50) // 格式: fb_[a-z0-9]{12}
  report_id       String?  @db.VarChar(50) // 关联报告 ID，可选
  
  // 基础信息
  company_name    String   @db.VarChar(80)
  job_title       String   @db.VarChar(80)
  source_platform String?  @db.VarChar(30)
  
  // 反馈内容
  jd_claim        String   @db.VarChar(500) // JD声称内容
  interview_actual String  @db.VarChar(2000) // 实际面试内容
  
  // 风险标记
  involves_sales         Boolean
  involves_fee           Boolean
  involves_training_loan Boolean
  involves_deposit       Boolean
  subject_mismatch       Boolean
  
  // 推荐
  recommend_to_others String @db.VarChar(10) // 推荐、中立、不推荐
  
  // 元信息
  visitor_id      String?  @db.VarChar(50)
  ip_address      String?  @db.VarChar(45)
  
  // 审核与状态
  review_status   String   @default("pending") @db.VarChar(20) // pending, approved, rejected
  reviewed_at     DateTime?
  reviewer_note   String?  @db.VarChar(500)
  
  retention_until DateTime?
  is_deleted      Boolean  @default(false)
  deleted_at      DateTime?
  
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  
  @@index([feedback_id])
  @@index([report_id])
  @@index([company_name])
  @@index([created_at])
  @@map("interview_feedbacks")
}
```

---

### 4. report_feedbacks - 报告纠错反馈表

存储用户对报告判断的纠错反馈。

#### Prisma Schema

```prisma
model ReportFeedback {
  id            String   @id @default(cuid()) @db.VarChar(50)
  feedback_id   String   @unique @db.VarChar(50) // 格式: rfb_[a-z0-9]{12}
  report_id     String   @db.VarChar(50)
  
  feedback_type String   @db.VarChar(30) // 判断不准、证据不足、表达不当、其他
  content       String   @db.VarChar(2000)
  
  visitor_id    String?  @db.VarChar(50)
  ip_address    String?  @db.VarChar(45)
  
  review_status String   @default("pending") @db.VarChar(20)
  reviewed_at   DateTime?
  reviewer_note String?  @db.VarChar(500)
  
  retention_until DateTime?
  is_deleted    Boolean  @default(false)
  deleted_at    DateTime?
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@index([feedback_id])
  @@index([report_id])
  @@index([created_at])
  @@map("report_feedbacks")
}
```

---

### 5. api_logs - API调用日志表

记录所有 API 调用日志，用于监控、审计和成本统计。

#### Prisma Schema

```prisma
model ApiLog {
  id              String   @id @default(cuid()) @db.VarChar(50)
  
  // 请求信息
  request_id      String   @unique @db.VarChar(50) // 格式: req_[a-z0-9]{12}
  api_path        String   @db.VarChar(100) // /api/reports/detect
  method          String   @db.VarChar(10) // POST, GET, DELETE
  
  visitor_id      String?  @db.VarChar(50)
  ip_address      String?  @db.VarChar(45)
  user_agent      String?  @db.VarChar(200)
  
  // 响应信息
  http_status     Int      // 200, 400, 429, 500
  error_code      String?  @db.VarChar(30) // VALIDATION_ERROR, RATE_LIMITED
  error_message   String?  @db.VarChar(500)
  
  // AI 调用信息
  ai_called       Boolean  @default(false)
  provider        String?  @db.VarChar(50)
  model           String?  @db.VarChar(50)
  input_tokens    Int?
  output_tokens   Int?
  latency_ms      Int?
  cost_estimate   Decimal? @db.Decimal(10, 6)
  
  // 限流信息
  rate_limited    Boolean  @default(false)
  captcha_required Boolean @default(false)
  captcha_passed   Boolean @default(false)
  
  // 时间戳
  request_at      DateTime @default(now())
  response_at     DateTime?
  
  created_at      DateTime @default(now())
  
  @@index([request_id])
  @@index([api_path])
  @@index([visitor_id])
  @@index([ip_address])
  @@index([request_at])
  @@index([http_status])
  @@map("api_logs")
}
```

**关键约束：**
- 日志不得记录完整 JD、HR 聊天原文、手机号、身份证等敏感信息
- 只记录必要的元信息和脱敏后的关键字段

---

### 6. security_events - 安全事件表

记录异常行为、限流命中、验证码失败等安全事件。

#### Prisma Schema

```prisma
model SecurityEvent {
  id            String   @id @default(cuid()) @db.VarChar(50)
  
  event_type    String   @db.VarChar(30) // rate_limit_hit, captcha_failed, suspicious_input, ip_blocked
  severity      String   @db.VarChar(10) // low, medium, high, critical
  
  visitor_id    String?  @db.VarChar(50)
  ip_address    String?  @db.VarChar(45)
  user_agent    String?  @db.VarChar(200)
  
  api_path      String?  @db.VarChar(100)
  request_id    String?  @db.VarChar(50)
  
  detail        Json?    // 详细事件信息
  
  action_taken  String?  @db.VarChar(50) // captcha_required, request_blocked, ip_banned
  
  created_at    DateTime @default(now())
  
  @@index([event_type])
  @@index([visitor_id])
  @@index([ip_address])
  @@index([created_at])
  @@map("security_events")
}
```

---

## Redis 数据结构

### 1. 限流计数器

```text
Key格式:
ratelimit:ip:{ip_address}:{api_path}          # IP维度限流计数
ratelimit:visitor:{visitor_id}:{api_path}     # Visitor维度限流计数
ratelimit:input_hash:{input_hash}             # 重复输入限流计数

数据类型: String (计数器)
过期时间: 根据限流窗口设置（10分钟、1小时、1天）

示例:
ratelimit:ip:192.168.1.1:/api/reports/detect  → "5" (10分钟内检测5次)
TTL: 600秒
```

### 2. 验证码豁免状态

```text
Key格式:
captcha_exempt:{visitor_id}                   # 验证码豁免状态
captcha_exempt:{ip_address}                   # IP维度豁免状态

数据类型: String (豁免过期时间戳)
过期时间: 豁免时长（如30分钟）

示例:
captcha_exempt:visitor_abc123                 → "1783922400" (豁免截止时间戳)
TTL: 1800秒
```

### 3. 临时封禁状态

```text
Key格式:
blocked:ip:{ip_address}                       # IP临时封禁
blocked:visitor:{visitor_id}                  # Visitor临时封禁

数据类型: String (封禁原因)
过期时间: 封禁时长（如1小时）

示例:
blocked:ip:192.168.1.1                        → "RATE_LIMIT_EXCEEDED"
TTL: 3600秒
```

### 4. 报告缓存

```text
Key格式:
report:{report_id}                            # 报告详情缓存
report:hash:{input_hash}                      # 基于输入hash的缓存

数据类型: String (JSON序列化报告)
过期时间: 报告保留时长（如7天）

示例:
report:rep_abc123def456                       → "{...}" (完整报告JSON)
TTL: 604800秒
```

---

## P1 预留表

以下表不在 P0 实现范围，但提前预留 Schema 定义：

### 1. ocr_tasks - OCR识别任务表

```prisma
model OcrTask {
  id            String   @id @default(cuid())
  ocr_task_id   String   @unique
  report_id     String?
  
  image_urls    Json     // 图片URL列表
  ocr_provider  String?
  
  raw_ocr_text  String?  @db.Text
  structured_job Json?
  
  confidence    String?
  need_user_confirm Boolean @default(true)
  
  status        String   @default("pending")
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@map("ocr_tasks")
}
```

### 2. company_snapshots - 公司快照表

```prisma
model CompanySnapshot {
  id            String   @id @default(cuid())
  company_name  String   @unique
  
  // 工商信息（P1 通过API获取）
  registration_status String?
  registration_date   DateTime?
  legal_representative String?
  
  // 用户反馈汇总
  feedback_count      Int @default(0)
  negative_rate       Decimal?
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@map("company_snapshots")
}
```

### 3. enterprise_appeals - 企业申诉表

```prisma
model EnterpriseAppeal {
  id            String   @id @default(cuid())
  appeal_id     String   @unique
  
  company_name  String
  contact_name  String
  contact_info  String
  
  appeal_content String @db.Text
  proof_files   Json?
  
  status        String   @default("pending")
  reviewed_at   DateTime?
  reviewer_note String?
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@map("enterprise_appeals")
}
```

---

## 数据迁移策略

P0 阶段数据模型相对简单，后续如果需要调整表结构：

1. 创建新版 Prisma Schema
2. 使用 Prisma Migrate 生成迁移文件
3. 在测试环境验证迁移脚本
4. 生产环境执行迁移（建议低流量时段）
5. 更新文档中的 Schema 版本号

---

## 隐私与删除策略

所有表必须包含以下隐私相关字段：

| 字段 | 用途 |
|---|---|
| retention_until | 数据保留截止时间，过期后自动标记删除 |
| is_deleted | 软删除标记 |
| deleted_at | 删除时间戳 |

删除策略：
- 用户主动删除：立即设置 `is_deleted=true`，`deleted_at=now()`
- 自动过期：每日定时任务检查 `retention_until`，过期数据标记删除
- 真实删除：`is_deleted=true` 的数据在 30 天后物理删除

---

## 后端实现要点

1. 所有表必须创建对应的 Prisma model
2. 所有表必须包含必要的索引
3. 所有表必须包含隐私删除相关字段
4. 日志表不得记录敏感原文
5. Redis Key 必须设置合理的 TTL
6. 所有表必须记录 `created_at` 和 `updated_at`

---

## 版本管理

当前冻结版本：`v1.0.0`

后续如果需要调整 Schema，必须：
1. 创建新版 Prisma Schema
2. 生成迁移文件并测试
3. 更新文档版本号
4. 同步前后端类型定义

---

## 变更记录

| 版本 | 日期 | 变更内容 | 变更原因 |
|---|---|---|---|
| v1.0.0 | 2026-07-13 | 初始冻结版本 | P0 MVP 开发启动 |
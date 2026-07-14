# JobLens 面试反馈闭环 P0 技术设计与联合评审

版本：v1.0

日期：2026-07-15

状态：产品负责人 / 技术专家联合评审通过，待开发

关联需求：`32-interview-feedback-loop-prd.md`

## 1. 现状评估

现有实现已经具备：

- `POST /api/interview-feedbacks`、Zod 参数校验和 Turnstile/写保护。
- `InterviewFeedback` 持久化、visitor/IP 元信息和审核状态。
- 报告所有权校验、敏感信息检查和 90 天保留策略。
- 风险报告中的 `feedback_risk` 子分占位。

主要缺口：

- `report_id` 可选，首页入口无法保证反馈与原始输入一致。
- 风险字段是若干布尔值，缺少否认样本、证据等级和经历阶段。
- 没有反馈内容指纹、独立性簇、质量状态和权重明细。
- 没有风险标签聚合表、版本化快照和风险引擎查询入口。
- 当前写保护用于防重复请求，不能代替长期数据去重和质量治理。

## 2. 技术原则

1. 原始反馈、质量评估和聚合快照分层存储。
2. P0 权重完全使用确定性规则，输入相同则输出相同。
3. 在线报告只读取已生成快照，不在模型调用链中扫描反馈明细。
4. 所有聚合结果记录算法版本，支持离线复算和回滚。
5. Redis 只用于限流和短期互斥，PostgreSQL 是反馈及聚合事实源。
6. 质量服务失败时 fail closed：反馈可落为 `pending`，不得带权进入分析。

## 3. 数据模型

### 3.1 InterviewFeedback 扩展

建议新增字段：

```prisma
experience_stage      String   @db.VarChar(30)
consistency           String   @db.VarChar(30)
interview_date        DateTime?
risk_tags             Json
risk_denials          Json
evidence_level        String   @db.VarChar(30)
feedback_source       String   @db.VarChar(30)
invitation_id         String?  @db.VarChar(50)

content_hash          String   @db.VarChar(64)
job_fingerprint       String   @db.VarChar(64)
independence_hash     String   @db.VarChar(64)

quality_status        String   @default("pending") @db.VarChar(20)
quality_reasons       Json
match_score           Decimal? @db.Decimal(5, 4)
freshness_score       Decimal? @db.Decimal(5, 4)
independence_score    Decimal? @db.Decimal(5, 4)
anti_abuse_score      Decimal? @db.Decimal(5, 4)
completeness_score    Decimal? @db.Decimal(5, 4)
evidence_score        Decimal? @db.Decimal(5, 4)
reporter_score        Decimal? @db.Decimal(5, 4)
consistency_score     Decimal? @db.Decimal(5, 4)
sampling_score        Decimal? @db.Decimal(5, 4)
final_weight          Decimal? @db.Decimal(5, 4)
weight_rule_version   String?  @db.VarChar(30)
weighted_at           DateTime?

@@index([job_fingerprint, quality_status])
@@index([content_hash])
@@index([independence_hash, created_at])
@@index([feedback_source, created_at])
```

`ip_address` 不用于长期明文聚类。新增 `independence_hash` 应由服务端使用 HMAC 生成，输入可包含 visitor 和截断网络标识，密钥通过环境变量管理；原始 IP 仍按当前保留策略删除。

### 3.2 聚合快照

```prisma
model FeedbackRiskAggregate {
  id                    String   @id @default(cuid())
  job_fingerprint       String   @db.VarChar(64)
  risk_tag              String   @db.VarChar(50)
  independent_reporters Int
  effective_sample_size Decimal  @db.Decimal(8, 4)
  positive_weight       Decimal  @db.Decimal(8, 4)
  negative_weight       Decimal  @db.Decimal(8, 4)
  confidence            Decimal  @db.Decimal(5, 4)
  disagreement          Decimal? @db.Decimal(5, 4)
  prompted_weight       Decimal  @db.Decimal(8, 4)
  prompted_effective_n  Decimal  @db.Decimal(8, 4)
  prompted_share        Decimal  @db.Decimal(5, 4)
  response_quality      Decimal  @db.Decimal(5, 4)
  sampling_quality      Decimal  @db.Decimal(5, 4)
  adjusted_confidence   Decimal  @db.Decimal(5, 4)
  evidence_level        String   @db.VarChar(20)
  signal_status         String   @db.VarChar(20)
  weight_rule_version   String   @db.VarChar(30)
  aggregate_version     String   @db.VarChar(30)
  source_max_created_at DateTime
  calculated_at         DateTime @default(now())

  @@unique([job_fingerprint, risk_tag, aggregate_version])
  @@index([job_fingerprint, signal_status])
  @@map("feedback_risk_aggregates")
}
```

采用不可变版本快照或事务内 upsert 均可。P0 推荐每个算法版本保留一份当前快照，旧版本保留用于审计，报告只读取配置指定的活动版本。

### 3.3 中性邀请记录

```prisma
model FeedbackInvitation {
  id              String    @id @default(cuid())
  invitation_id   String    @unique @db.VarChar(50)
  report_id       String    @db.VarChar(50)
  visitor_id_hash String    @db.VarChar(64)
  cohort          String    @db.VarChar(30)
  shown_at        DateTime
  responded_at    DateTime?
  response_state  String?   @db.VarChar(30)
  created_at      DateTime  @default(now())

  @@unique([report_id, visitor_id_hash])
  @@index([cohort, shown_at])
  @@map("feedback_invitations")
}
```

邀请资格和抽样比例由服务端稳定哈希决定，不能由前端随意声明 `neutral_prompt`。服务端只在有效 `invitation_id` 属于当前 visitor 和报告时授予采样来源系数 1.0。

## 4. 岗位指纹与去重

### 4.1 岗位指纹

优先复用报告的稳定输入信息：

```text
job_fingerprint = SHA-256(
  normalize(company_name)
  + normalize(job_title)
  + normalize(jd_text)
  + source_platform
)
```

P0 不尝试跨不同 JD 文本合并同一公司岗位，避免低成本模糊匹配产生误伤。相同报告输入哈希和报告缓存产生的报告应映射到相同岗位指纹。

### 4.2 内容指纹

```text
content_hash = SHA-256(
  normalized(interview_actual)
  + sorted(risk_tags)
  + consistency
  + evidence_level
)
```

规范化只处理空白、大小写、全半角和常见标点，不做会改变事实含义的激进分词删除。

### 4.3 独立性

P0 的“独立用户”是风控近似值，不宣称等同真实自然人：

- 相同 visitor：同一岗位只计一个主样本，后续作为更新或否认记录。
- 不同 visitor 但相同 HMAC 网络簇、相同内容哈希：后续样本降权。
- 同一证据哈希：只允许第一条进入证据加权。
- IP 只能作为降权信号，不能单独判定无效，避免学校、公司和家庭网络误伤。

## 5. 质量与权重服务

新增 `feedbackQuality.ts`，保持纯函数核心：

```typescript
type FeedbackWeightInput = {
  hardGate: 0 | 1;
  match: number;
  freshness: number;
  independence: number;
  antiAbuse: number;
  sampling: number;
  completeness: number;
  evidence: number;
  reporter: number;
  consistency: number;
};

type FeedbackWeightResult = FeedbackWeightInput & {
  finalWeight: number;
  reasons: string[];
  ruleVersion: 'feedback-weight-v1';
};
```

实现要求：

- 所有分量先 clamp 到 `[0, 1]`。
- 使用 Decimal 或整数万分位计算和持久化，避免不同运行时浮点漂移。
- 硬过滤原因使用稳定错误码，不直接保存面向用户的文案。
- 规则版本由代码常量定义，禁止通过请求参数传入。
- 任何必需分量缺失时保持 `pending`，不得默认按 0.5 入聚合。
- P0 没有证据上传与核验，`evidence` 最高只能取 0.6；请求声称存在材料不能突破上限。
- `sampling` 由服务端邀请记录决定：有效中性邀请为 1.0，报告页主动提交为 0.7，未匹配入口为 0。
- `reporter` 只使用已完成质量判定的历史反馈，待审核反馈不进入分母。
- `consistency` 由稳定规则表计算，例如同一标签同时出现在支持和否认集合时直接硬过滤，不调用大模型判断真假。

### 5.1 反作弊分量

P0 使用已有能力组合，不新增大模型调用：

- Turnstile 结果。
- visitor、HMAC 网络簇的提交频率。
- 同岗位内容哈希重复率。
- 同一风险标签的短时间集中度。
- user-agent 异常只作为弱信号。

建议将 `abuse_score` 计算为有上限的规则加和，再得到 `A = 1 - abuse_score`。每条规则必须有固定测试和最大扣分，禁止因单一 IP 直接置零。

## 6. 聚合服务

新增 `feedbackAggregation.ts`：

1. 查询目标 `job_fingerprint` 下 `quality_status=accepted` 且未删除的反馈。
2. 每个 visitor/独立簇对同一风险标签只保留一条主样本；冲突更新按最新有效反馈处理。
3. 分别计算支持权重、否认权重、有效样本量、原始置信度和争议度。
4. 单独计算中性邀请样本的权重、有效样本量、占比，以及同邀请批次近 30 天响应率形成的采样质量，并将置信度向 0.5 收缩。
5. 按 PRD 阈值映射 `signal_status`。
6. 在事务内写入活动版本快照。

触发方式：

- 反馈提交：同步完成轻量硬过滤，异步或提交后任务执行聚合。
- 审核通过、拒绝、撤回和删除：必须触发复算。
- 定时任务：每日扫描 `source_max_created_at` 落后的岗位，修复漏算。

当前 Render 免费实例和项目架构没有独立队列。P0 可采用数据库 outbox 表加定时轮询；若开发成本需要进一步收缩，可先在提交事务完成后执行有超时的聚合，并保留每日全量修复任务。不能只依赖进程内异步 Promise。

未响应邀请只用于计算响应率和评估采样质量，绝不能自动写入 `risk_denials`。主动反馈可以增加事件证据，但只有满足中性邀请样本门槛的聚合状态才能进入 `supported/strong`。

响应率按邀请 `cohort` 和交互版本计算，避免把不同文案、入口和时间窗口混在一起。目标响应率作为有界配置读取，初始值 20%；配置异常时质量服务 fail closed，不生成 supported/strong 快照。

## 7. 接口调整

### 7.1 提交反馈

```text
POST /api/reports/:reportId/interview-feedbacks
```

P0 新接口要求报告归当前 visitor 所有；旧 `/api/interview-feedbacks` 暂时保留，但提交结果固定为 `unmatched`，不进入聚合。

请求新增：

```json
{
  "experience_stage": "INTERVIEWED",
  "consistency": "COMPLETELY_DIFFERENT",
  "interview_date": "2026-07-14",
  "risk_tags": ["DISGUISED_SALES"],
  "risk_denials": ["FEE_REQUIRED"],
  "evidence_level": "DETAILED_ACCOUNT",
  "invitation_id": "fbi_xxxxxxxxxxxx",
  "interview_actual": "面试方明确说明需要开发客户..."
}
```

枚举在接口层使用稳定英文编码，前端负责中英文展示，避免数据库写入中文枚举造成国际化和迁移问题。

响应：

```json
{
  "feedback_id": "fb_xxxxxxxxxxxx",
  "status": "pending_review",
  "included_in_aggregation": false,
  "created_at": "ISO-8601"
}
```

### 7.2 报告读取

`GET /api/reports/:id` 增加可选字段：

```json
{
  "feedback_signal": {
    "status": "supported",
    "independent_reporters": 4,
    "effective_sample_size": 3.2,
    "prompted_effective_sample_size": 2.1,
    "top_risks": [],
    "evidence_level": "medium",
    "calculated_at": "ISO-8601"
  }
}
```

只返回达到 `emerging` 以上的聚合信号，不返回内部权重、反作弊原因或原始反馈。

## 8. 风险引擎接入

接入顺序：

```text
validate report input
-> calculate job fingerprint
-> load active feedback aggregate snapshot
-> invoke model with aggregate summary
-> deterministic output guard
-> calculate feedback_risk and final score
-> persist report with aggregate version
```

关键约束：

- 聚合信号由后端确定性代码换算 `feedback_risk`，模型只能解释，不能自行改样本数或置信度。
- `emerging` 不计入分数，只生成追问。
- 以 `adjusted_confidence` 而不是原始反馈者内部置信度判定 supported/strong。
- `supported` 的 `feedback_risk` 上限为 60。
- `strong` 才允许 `feedback_risk` 高于 60。
- `disputed` 不加分，并在 `missing_info/questions` 中增加核实问题。
- 报告保存 `feedback_aggregate_version` 和 `feedback_weight_rule_version`。
- 无聚合快照时继续动态权重归一化，不能把缺失反馈当作 0 分。

## 9. 迁移与兼容

1. 新字段先全部允许为空，部署 Schema 后再发布新接口。
2. 历史反馈标记为 `legacy_unmatched`，不自动赋权。
3. 能关联有效 `report_id` 的历史数据可离线回填岗位指纹，但仍保持 `pending`，经新规则复算后才可进入聚合。
4. 旧前端和旧接口在一个发布周期内保持可用。
5. 新报告字段保持可选，避免旧缓存和历史报告解析失败。
6. 发布稳定后再考虑将新接口字段改为数据库非空约束。

## 10. 测试设计

单元测试：

- 权重公式固定样例、边界、clamp 和版本号。
- 邀请来源不可由客户端伪造，重复曝光保持幂等。
- 未响应邀请不生成否认样本。
- 全主动差评只能达到 emerging，不能达到 supported。
- 中性邀请有效样本不足时置信度正确向 0.5 收缩。
- 时间衰减在 0、30、180、365 天的结果。
- 新用户和历史用户可信度先验。
- 重复内容、同 visitor、同网络簇的独立性降权。
- 支持、否认、争议和有效样本量公式。
- 每个状态阈值的上下边界。

集成测试：

- 未关联反馈不能进入聚合。
- 非报告所有者不能提交关联反馈。
- 同 visitor 重复提交不会增加独立样本数。
- 审核拒绝、撤回和隐私删除会降低或删除聚合信号。
- 聚合任务重复执行结果幂等。
- 数据库或质量服务失败时反馈保持 pending。
- 中英文枚举映射一致。

风险引擎回归：

- 无反馈时结果与当前版本一致。
- emerging 只增加追问，不改变分数。
- supported/strong 按上限影响 `feedback_risk`。
- disputed 不产生高风险修正。
- 单条高证据反馈不能单独提高风险等级。
- 缓存键包含活动聚合版本，旧的 10 分钟报告缓存不会隐藏新信号。

## 11. 监控与回滚

监控：

- 各质量状态数量和转换率。
- 邀请曝光、响应率、正负向完成率和退出率。
- 聚合延迟、失败率、重复执行次数。
- 每个状态的岗位数和风险标签分布。
- 单 visitor、网络簇对有效权重的贡献集中度。
- 聚合接入前后报告风险等级变化率。

回滚开关：

```env
FEEDBACK_AGGREGATION_ENABLED=false
FEEDBACK_RISK_INJECTION_ENABLED=false
FEEDBACK_WEIGHT_RULE_VERSION=feedback-weight-v1
FEEDBACK_AGGREGATE_VERSION=feedback-aggregate-v1
```

关闭注入后仍可收集和审核反馈，但风险分析忽略聚合快照。不得通过删库回滚。

## 12. 联合评审记录

### 12.1 技术专家意见

结论：有条件通过。

必须修改项：

- 不能使用明文 IP 作为长期独立性标识，改为可轮换密钥的 HMAC 派生值。
- 聚合必须以 PostgreSQL 为事实源并具备幂等复算，不能依赖单实例内存任务。
- 风险引擎使用确定性聚合分，模型只负责解释。
- 报告缓存必须感知聚合版本，否则新反馈在缓存期内不会生效。
- 历史反馈不得自动获得默认权重。
- P0 未核验附件时证据分必须封顶，强风险反馈只能生成核实建议。

评审后以上事项已纳入方案。

### 12.2 产品负责人意见

结论：通过。

范围决议：

- P0 聚焦“原报告 -> 面试反馈 -> 原岗位风险分析”闭环。
- 增加固定比例中性邀请和一键“基本一致”路径，降低只有差评进入系统的偏差。
- 主动差评可以提示事件存在，但不能直接形成发生率或多数人结论。
- 首页独立反馈可以继续收集，但不承诺自动影响风险判断。
- 主观推荐只做体验指标，不参与风险分。
- 前端展示独立样本数和证据等级，不展示内部权重公式和反作弊原因。
- 不上线公司黑名单、评论广场和原始证据公开页面。

### 12.3 最终决议

联合评审通过，可以开发，开发顺序如下：

1. 数据库迁移、稳定枚举和权重纯函数。
2. 报告关联反馈接口与前端表单。
3. 质量评估、聚合快照和幂等复算。
4. 风险引擎只读接入与报告展示。
5. 回归测试、灰度开关、线上指标验证。

上线门槛：全部 P0 验收用例通过；单条反馈无法改变风险等级；删除/撤回可复算；功能开关能在不删除数据的情况下停用风险注入。

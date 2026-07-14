# JobLens AI 成本控制 P0 技术设计

版本：v1.0

日期：2026-07-15

状态：技术评审通过

## 1. 范围

本文实现 `30-ai-cost-control-prd.md` 冻结的五项能力：

1. 每日全站模型积分。
2. 模型全站与分类并发上限。
3. OCR 图片跨 visitor 内容哈希。
4. OCR 成功结果 Redis 缓存。
5. 匿名 visitor 每日 3 次 OCR、3 次文本分析，并增加 IP 聚合上限。

## 2. 组件设计

新增 `backend/src/services/aiCostControl.ts`，负责：

- 读取并校验环境变量。
- 计算北京时间日桶、重置时间与 TTL。
- 使用 Redis Lua 原子预占/退还 visitor、IP 和全站额度。
- 使用 Redis Sorted Set 租约实现跨实例并发信号量。
- 将 Redis 故障转换为 fail-closed 的业务错误。

新增 OCR 缓存能力到截图识别服务：

- 对 Base64 解码后的图片字节计算 SHA-256。
- 缓存键包含图片顺序、语言、模型和 Prompt 版本。
- Redis 只存校验后的结构化提取结果，不存图片。

路由调用顺序：

```text
validate
  -> existing short-window protection
  -> cache lookup
  -> reserve daily quota
  -> acquire concurrency lease
  -> invoke provider
  -> release lease
  -> persist/cache response
```

OCR 为了让跨 visitor 缓存真正免模型额度，缓存查询放在每日额度之前。现有短窗口保护仍保留，用于限制 HTTP 滥用；其计数不等于 AI 配额。

## 3. Redis 数据结构

### 3.1 每日额度

```text
ai-cost:v1:visitor:{sha256(visitor)}:{operation}:{yyyy-mm-dd}
ai-cost:v1:ip:{sha256(ip)}:{operation}:{yyyy-mm-dd}
ai-cost:v1:global:credits:{yyyy-mm-dd}
```

`operation` 为 `ocr` 或 `analysis`。三个 Key 通过单个 Lua 脚本执行检查和 `INCRBY`，避免并发穿透。只在 Key 首次创建时设置到下一次北京时间零点的 TTL。

Lua 返回：

```text
1  reserved
2  visitor quota exceeded
3  IP quota exceeded
4  global budget exceeded
```

退还使用独立 Lua 脚本，将三个计数减到不低于零。只有以下情况退还：

- 未获取并发槽。
- AI 配置在请求发出前即失败。
- 代码在调用 Provider 前发生内部错误。

模型请求一旦发出，超时、供应商错误和非法输出均不退还。

### 3.2 并发租约

```text
ai-cost:v1:concurrency:total
ai-cost:v1:concurrency:{operation}
```

两个 Key 均为 Sorted Set：

- member：随机 lease token。
- score：租约到期毫秒时间戳。

获取租约的 Lua 脚本先删除过期 member，再检查 total 与 operation 数量，最后同时写入两个集合。释放时从两个集合删除 token。OCR 租约默认 70 秒，文本分析默认 130 秒。

相比普通计数器，租约可在实例崩溃后自动恢复，不会永久占用并发槽。

### 3.3 OCR 缓存

```text
ocr-cache:v1:{sha256(orderedImageHashes, language, model, promptVersion)}
```

TTL 默认 86400 秒。缓存 Value 包含：

```json
{
  "result": {},
  "model": "Qwen/Qwen3-VL-8B-Instruct",
  "provider": "siliconflow",
  "createdAt": "ISO-8601"
}
```

不写入模型原始响应、图片、visitor、IP 或调用 Token。

## 4. 控制流程

统一执行器 `executeControlledAi` 接收：

- `operation`
- `visitorId`
- `ip`
- `run` 付费 Provider 回调
- 可选 `fallback` 规则 Provider 回调

返回 Provider 结果和控制元数据：

```typescript
{
  value,
  source: 'model' | 'fallback',
  quotaRemaining,
  resetAt,
  fallbackReason?
}
```

策略：

- AI 总开关关闭、每日额度耗尽或 Redis 不可用：有 fallback 的文本分析返回规则结果；OCR 返回结构化错误。
- 并发已满：统一返回 `AI_BUSY`，预占额度立即退还。
- Provider 主模型失败并进入现有规则 Provider：计为已发起模型调用，不退额度。
- `LlmConfigurationError`：视为调用前失败，退还额度。

## 5. 接口与前端

新增只读接口：

```text
GET /api/ai-quota
```

返回当前 visitor 的 OCR/分析剩余额度与重置时间，不返回 IP 和全站剩余额度。

所有 AI 响应增加：

```text
x-joblens-quota-remaining
x-joblens-quota-reset-at
x-joblens-analysis-source
```

前端首页初始化时读取用户配额，并在 OCR 或分析完成后刷新。配额错误和繁忙错误使用独立中英文文案；规则降级继续进入报告页，由来源标识区分。

## 6. 安全与隐私

- visitor、IP 和图片内容只以 SHA-256 形式进入 Redis Key。
- Redis 不可用时不回退到进程内额度，避免多实例或重启导致预算失效。
- 缓存键不可用于恢复图片内容，缓存值不包含原图。
- CORS 仅向允许来源开放；配额接口只返回当前 visitor 数据。
- 日志记录错误码与计数事件，不记录图片或 OCR 文本。
- 图片缓存必须设置 TTL，禁止永久保存。

## 7. 配置

```env
AI_CALLS_ENABLED=true
AI_DAILY_CREDIT_LIMIT=300
AI_OCR_CREDIT_COST=3
AI_ANALYSIS_CREDIT_COST=1
ANON_DAILY_OCR_LIMIT=3
ANON_DAILY_ANALYSIS_LIMIT=3
IP_DAILY_OCR_LIMIT=20
IP_DAILY_ANALYSIS_LIMIT=30
AI_MAX_TOTAL_CONCURRENCY=4
AI_MAX_OCR_CONCURRENCY=2
AI_MAX_ANALYSIS_CONCURRENCY=3
OCR_CACHE_TTL_SECONDS=86400
```

所有数值使用有界整数解析。非法配置在首次使用时 fail closed，并写安全日志。

## 8. 测试设计

单元测试：

- 北京时间日桶、零点 TTL 与重置时间。
- 环境变量边界。
- Lua 返回码到业务错误的映射。
- 额度预占与退还控制流。
- 并发失败时退还额度。
- OCR 哈希跨 visitor 一致、图片顺序或语言变化时不一致。
- OCR 缓存只接受 Schema 已校验结果。

路由测试：

- 第 4 次调用的降级/拒绝行为。
- 缓存命中不调用 Provider。
- Redis 不可用时 OCR fail closed、文本分析规则降级。
- 响应头与错误码。

回归测试：

- 现有 19 项后端测试。
- 后端 TypeScript 构建。
- 前端构建和 lint。
- 生产 OCR、岗位分析与缓存命中 smoke test。

## 9. 技术评审结论

评审结论：通过，可以开发。

通过理由：

- 额度预占和并发租约均由 Redis 原子脚本控制，不存在明显并发穿透。
- 缓存键剥离 visitor，同时绑定模型和 Prompt 版本，兼顾复用与失效。
- Redis 故障时付费能力 fail closed，最大费用仍然有边界。
- 现有规则 Provider 被保留为文本分析降级路径。
- P0 不引入队列、账户和新基础设施，符合最低成本目标。

评审遗留项：当前匿名 visitor 仍可被用户重置；IP 聚合只能提高绕过成本，不能替代后续登录或边缘防护。

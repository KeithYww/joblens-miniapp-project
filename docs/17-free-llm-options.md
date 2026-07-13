# 17 免费/低成本大模型调用方案

调研日期：2026-07-13

## 结论

JobLens 可以在开发和小规模内测阶段使用免费大模型额度，但不建议把免费额度作为正式生产主链路。原因不是能力不够，而是免费层通常存在限流、稳定性、服务条款和数据隐私边界问题。

推荐策略：

```text
开发/演示：免费额度优先
小规模内测：免费额度 + 低价付费模型兜底
公开 MVP：低价付费模型主链路 + 免费模型只做降级或非敏感测试
```

## 可选方案对比

| 方案 | 是否有免费/低成本能力 | 适合场景 | 主要限制 | JobLens 建议 |
|---|---|---|---|---|
| Gemini API Free tier | 有免费层，部分模型输入/输出 token 免费 | 原型、开发、少量测试 | 免费层内容会用于改进 Google 产品；存在 RPM/TPM/RPD 限流 | 可用于开发和非敏感样本测试，不建议直接处理真实用户聊天记录 |
| Groq Free Plan | 有明确 Free Plan 限额 | 高速文本分析、结构化输出测试 | 按组织维度限 RPM/RPD/TPM/TPD；高峰期和免费限额不适合生产承诺 | 可作为开发/内测备用 Provider |
| SiliconFlow | 价格页显示部分模型免费，且有较低价模型 | 国内访问、中文模型测试、低成本多模型路由 | 免费模型能力和稳定性需实测；具体限额需以控制台为准 | 适合作为国内优先候选，优先测试低价中文模型 |
| DeepSeek API | 官方价格较低，但不是免费主张 | 中文语义分析、正式 MVP 低成本主链路 | 需要充值/余额，价格可能变化 | 适合作为正式 MVP 的低价主 Provider 或兜底 Provider |
| OpenRouter | 支持模型路由和 fallback | 多模型容灾、统一入口 | 免费模型需逐个核对，且中间层会增加依赖 | 可作为工程路由参考，不建议首版过早依赖 |

## 官方信息摘要

### Gemini API

Gemini API 官方价格页显示有免费层，适用于刚开始使用 Gemini API 的开发者和小型项目；免费层包含对特定模型的有限访问权限，输入和输出 token 免费，但免费层内容会用于改进 Google 产品。付费层提供更高速率限制，且内容不会用于改进 Google 产品。

速率限制方面，Gemini 官方文档说明限制通常按 RPM、TPM、RPD 三个维度衡量，且不同模型和项目层级限制不同，需要在 AI Studio 查看实际限额。

判断：Gemini 免费层适合开发验证，不适合直接承载 JobLens 的真实用户敏感文本。

### Groq

Groq 官方 Rate Limits 页面列出 Free Plan Limits，并说明限流维度包括 RPM、RPD、TPM、TPD 等，且限制按组织维度生效。页面示例中，`llama-3.1-8b-instant`、`llama-3.3-70b-versatile`、`qwen/qwen3-32b` 等模型都有免费计划限额。

判断：Groq 免费计划适合快速验证结构化输出、Prompt 和规则引擎，但免费限额不适合作为生产 SLA。

### SiliconFlow

硅基流动官方价格页按模型展示输入、输出和缓存价格，其中部分对话、OCR、Embedding、语音模型显示为免费，也有多款人民币计价的低价对话模型。

判断：对国内 Web/H5 产品更友好，适合 JobLens 做国内低成本 Provider 候选。上线前需要实测中文 JD 风险识别、JSON 输出稳定性、限流和延迟。

### DeepSeek API

DeepSeek 官方价格页显示按百万 tokens 计费。当前页面列出 `deepseek-v4-flash` 和 `deepseek-v4-pro`，支持 JSON Output、Tool Calls 等能力，其中 `deepseek-v4-flash` 的缓存未命中输入价格为 1 元/百万 tokens、输出价格为 2 元/百万 tokens。

判断：DeepSeek 更适合正式 MVP 的低成本主链路，而不是免费开发额度。它的优势是中文能力和价格可控。

### OpenRouter

OpenRouter 官方文档显示支持 Auto Router 和 `models` fallback 参数，请求失败、限流或供应商不可用时可自动尝试备用模型，并按最终使用的模型计费。

判断：OpenRouter 更像统一路由层，而不是“免费模型来源”。首版可以借鉴其路由设计，但直接接入会增加依赖和调试复杂度。

## 推荐架构

后端不要把某一家模型写死，应抽象统一 Provider 接口：

```text
RiskAnalysisService
  ↓
LLMProvider
  ├─ DeepSeekProvider
  ├─ SiliconFlowProvider
  ├─ GeminiProvider
  ├─ GroqProvider
  └─ MockProvider
```

Provider 统一输出：

```ts
type LlmProviderResult = {
  rawText: string;
  parsedJson: unknown;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  costEstimate?: number;
};
```

## MVP 推荐

### 开发阶段

- 使用 `MockProvider` 固定样例，避免每次调试都消耗 token。
- 用 Gemini Free / Groq Free / SiliconFlow 免费模型测试 Prompt。
- 所有真实 JD 和聊天记录先做脱敏样本，不直接提交用户隐私文本到免费层。

### 内测阶段

- 主 Provider：DeepSeek 或 SiliconFlow 低价中文模型。
- 备用 Provider：Groq / Gemini / SiliconFlow 其他模型。
- 每次请求限制输入长度，建议单次输入上限 12000 字。
- 对相同输入做 `input_hash` 缓存，避免重复计费。

### 公开 MVP

- 使用低价付费模型承载主链路。
- 免费模型只用于非敏感演示、开发环境或服务降级。
- 隐私说明中明确写明：用户提交的 JD、聊天记录和公司名称可能会被发送至第三方大模型服务用于生成风险报告。
- 允许用户删除报告，日志不保存完整 JD 和聊天原文。

## 成本粗算

以一次检测消耗约 4000 输入 tokens + 1200 输出 tokens 估算：

| 模型价格示例 | 单次估算成本 |
|---|---:|
| DeepSeek `deepseek-v4-flash`，输入 1 元/百万 tokens，输出 2 元/百万 tokens | 约 0.0064 元/次 |
| SiliconFlow 低价模型，输入 1 元/百万 tokens，输出 2 元/百万 tokens | 约 0.0064 元/次 |
| SiliconFlow 中档模型，输入 4 元/百万 tokens，输出 6 元/百万 tokens | 约 0.0232 元/次 |

实际费用会受 Prompt 长度、思考模式、重试次数、缓存命中和模型价格变化影响。工程上必须记录 `input_tokens`、`output_tokens`、`provider`、`model`、`latency_ms` 和 `cost_estimate`。

## 成本控制

- 输入长度限制：JD + HR 聊天总长度先限制在 12000 字以内。
- 输出长度限制：强制 JSON Schema，减少模型自由发挥。
- 缓存：对同一输入哈希缓存报告。
- 限流：匿名 token + IP 组合限流。
- 重试上限：同一请求最多重试 1 次，避免失败风暴。
- 分层模型：简单 JD 用低价模型，复杂/争议样本再切更强模型。
- 离线评测：用 50-100 条样本集中评测，不在调 Prompt 时频繁调用生产模型。

## 风险边界

免费大模型 API 不是没有成本，只是把成本转移到了限流、隐私、稳定性和服务条款上。JobLens 处理的是求职者真实 JD、HR 聊天和面试反馈，首版可以“免费启动”，但不能“免费生产”。

## 资料来源

- Gemini API Pricing：<https://ai.google.dev/gemini-api/docs/pricing>
- Gemini API Rate Limits：<https://ai.google.dev/gemini-api/docs/rate-limits>
- Groq Rate Limits：<https://console.groq.com/docs/rate-limits>
- SiliconFlow Pricing：<https://siliconflow.cn/pricing>
- DeepSeek 模型与价格：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>
- OpenRouter Model Routing：<https://openrouter.ai/docs/features/model-routing>

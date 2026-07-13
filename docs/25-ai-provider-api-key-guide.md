# 25 AI Provider API Key 配置指南

本文档引导你如何获取并配置大模型 API Key，让 JobLens 后端从 MockProvider 切换到真实大模型。

## 目录

- [1. 为什么需要配置 API Key](#1-为什么需要配置-api-key)
- [2. 推荐方案：SiliconFlow](#2-推荐方案siliconflow)
  - [2.1 为什么选择 SiliconFlow](#21-为什么选择-siliconflow)
  - [2.2 注册并获取 API Key](#22-注册并获取-api-key)
  - [2.3 选择模型](#23-选择模型)
- [3. 配置步骤](#3-配置步骤)
- [4. 验证配置](#4-验证配置)
- [5. 切换回 Mock 模式](#5-切换回-mock-模式)
- [6. 常见问题](#6-常见问题)
- [7. 其他可选 Provider](#7-其他可选-provider)

---

## 1. 为什么需要配置 API Key

JobLens 当前默认使用 `MockProvider`，通过预设的关键词规则生成风险报告，**不调用真实大模型**。

配置 API Key 后，可以：
- 调用真实大模型进行语义分析
- 识别更复杂的风险信号
- 生成更准确的报告内容
- 支持更长的 JD 文本分析

---

## 2. 推荐方案：SiliconFlow

### 2.1 为什么选择 SiliconFlow

| 优势 | 说明 |
|------|------|
| 国内访问稳定 | 部署在国内，网络延迟低 |
| 免费额度 | 新用户有免费 token 额度 |
| 多模型支持 | DeepSeek、Qwen、Llama 等 |
| 中文能力强 | DeepSeek 和 Qwen 对中文 JD 理解准确 |
| 价格便宜 | 部分模型低至 1元/百万 tokens |

### 2.2 注册并获取 API Key

**步骤 1：访问官网**

打开 [https://siliconflow.cn](https://siliconflow.cn)

**步骤 2：注册账号**

- 点击右上角"注册"
- 支持手机号或邮箱注册
- 完成实名认证（如需要）

**步骤 3：创建 API Key**

1. 登录后进入控制台
2. 点击左侧菜单「API 密钥」
3. 点击「新建 API Key」
4. 复制生成的 API Key（格式类似 `sk-xxxxxxxxxxxxxxxx`）

**步骤 4：充值（可选）**

- 免费额度通常足够开发测试
- 正式使用建议充值 10-50 元

### 2.3 选择模型

推荐模型（按优先级）：

| 模型 | 适用场景 | 价格 |
|------|----------|------|
| `deepseek-chat` | 中文 JD 分析（推荐） | 1元/百万 tokens |
| `qwen-2-7b-chat` | 备选中文模型 | 免费 |
| `llama-3-8b-chat` | 英文 JD 为主 | 免费 |

---

## 3. 配置步骤

**步骤 1：进入后端目录**

```bash
cd backend
```

**步骤 2：编辑 .env 文件**

打开 [.env](file:///Users/mac/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a547e5b3cb19b499e28ee71/backend/.env) 文件：

```env
# 修改以下配置
AI_PROVIDER=siliconflow
SILICONFLOW_API_KEY=sk-你的实际API密钥
SILICONFLOW_MODEL=deepseek-chat
```

**配置示例：**

```env
DATABASE_URL="postgres://postgres:postgres@localhost:5432/joblens"
REDIS_URL="redis://localhost:6379"
PORT=3000
NODE_ENV=development
AI_PROVIDER=siliconflow
SILICONFLOW_API_KEY=sk-abc123def456ghi789jkl
SILICONFLOW_MODEL=deepseek-chat
```

**步骤 3：重启后端服务**

```bash
# 停止当前运行的服务（Ctrl+C）
# 重新启动
npm run dev
```

启动时会看到：
```
Server running on http://localhost:3000
```

---

## 4. 验证配置

**方法 1：通过 API 测试**

```bash
curl -X POST http://localhost:3000/api/reports/detect \
  -H "Content-Type: application/json" \
  -H "x-visitor-id: test-user" \
  -d '{
    "jd_text": "招聘储备干部，无责任底薪5000，晋升空间大，提供系统培训。要求大专以上学历，有销售经验优先。"
  }'
```

**成功响应特征：**
- `provider: "siliconflow"`（而不是 `"mock"`）
- `model: "deepseek-chat"`
- `evidence` 字段包含具体、针对性的证据描述
- `overall_score` 由大模型动态计算

**方法 2：查看后端日志**

观察控制台输出：
- ✅ `SiliconFlow API success` - 配置成功
- ❌ `SiliconFlow API error` - 配置有问题

---

## 5. 切换回 Mock 模式

如果遇到问题想回到 Mock 模式：

```env
AI_PROVIDER=mock
```

或者临时在启动时指定：

```bash
AI_PROVIDER=mock npm run dev
```

Mock 模式特点：
- 无需 API Key
- 响应速度快
- 结果基于关键词规则
- 适合调试和离线开发

---

## 6. 常见问题

### Q1：API Key 无效

**错误信息：** `401 Unauthorized`

**解决方法：**
- 检查 API Key 是否完整复制（不要有空格）
- 确认账号是否完成实名认证
- 确认 API Key 未被删除或禁用

### Q2：请求超时

**错误信息：** `timeout of 60000ms exceeded`

**解决方法：**
- 检查网络连接
- 确认能访问 `https://api.siliconflow.cn`
- 临时切换到 Mock 模式：`AI_PROVIDER=mock`

### Q3：JSON 解析失败

**错误信息：** `No JSON found in response`

**解决方法：**
- 这是大模型输出不规范导致
- 系统会自动返回降级报告
- 不影响主流程
- 可尝试切换其他模型

### Q4：免费额度用完了

**解决方法：**
- SiliconFlow 控制台查看额度使用情况
- 充值小额费用（10 元起）
- 切换到更便宜的模型

### Q5：API Key 泄露了

**解决方法：**
- 立即在 SiliconFlow 控制台删除该 Key
- 创建新的 API Key
- 不要将 `.env` 文件提交到 Git

---

## 7. 其他可选 Provider

如果需要使用其他大模型，可以扩展 [createLlmProvider](file:///Users/mac/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a547e5b3cb19b499e28ee71/backend/src/services/llm/index.ts#L333-L343) 工厂函数。

### 7.1 DeepSeek（官方 API）

**特点：** 价格低，中文能力强

**配置：**
```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-你的密钥
```

参考价格：1元/百万 tokens（输入）

### 7.2 Gemini（Google）

**特点：** 有免费层，多模态

**配置：**
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=你的密钥
```

**注意：** 免费层数据可能用于训练 Google 产品，**不建议处理真实用户数据**。

### 7.3 Groq

**特点：** 推理速度极快

**配置：**
```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_你的密钥
```

适合做结构化输出测试和 Prompt 调试。

---

## 配置清单

完成配置后，确认以下事项：

- [ ] 已注册 SiliconFlow 账号
- [ ] 已获取 API Key
- [ ] 已编辑 `backend/.env` 文件
- [ ] `AI_PROVIDER=siliconflow`（不要有空格）
- [ ] `SILICONFLOW_API_KEY` 已填写完整
- [ ] 已重启后端服务
- [ ] 已通过 curl 测试 API 正常返回
- [ ] 响应中 `provider` 字段为 `siliconflow`

---

## 相关文档

- [17-free-llm-options.md](file:///Users/mac/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a547e5b3cb19b499e28ee71/docs/17-free-llm-options.md) - 免费大模型调研
- [20-ai-output-schema.md](file:///Users/mac/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a547e5b3cb19b499e28ee71/docs/20-ai-output-schema.md) - AI 输出 Schema
- [15-ai-risk-engine.md](file:///Users/mac/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a547e5b3cb19b499e28ee71/docs/15-ai-risk-engine.md) - AI 风险引擎设计

---

**最后更新：** 2026-07-13

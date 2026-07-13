# 24 Rate Limit & Captcha Rules - P0 冻结版本

冻结日期：2026-07-13
版本：v1.0.0

## 说明

本文档冻结 JobLens Web/H5 MVP P0 阶段所有限流与验证码策略。所有前后端开发必须严格按照本策略实现请求限制、验证码触发和服务端校验。

AI 调用有成本,必须限制滥用。限流分三层处理:

```text
正常请求 → 直接处理
可疑请求 → 要求验证码
高风险请求 → 拒绝并记录安全日志
```

---

## 限流维度与阈值

### 1. IP 维度限流

| 时间窗口 | 阈值 | 动作 | Redis Key |
|---|---:|---|---|
| 10 分钟 | ≤5 次 | 正常处理 | `ratelimit:ip:{ip}:{api_path}` |
| 10 分钟 | 6-10 次 | 要求验证码 | 同上，设置 `captcha_exempt:{ip}` 过期 |
| 1 小时 | >20 次 | 拒绝请求，返回 RATE_LIMITED | `blocked:ip:{ip}` |

**Redis Key 示例:**
```text
ratelimit:ip:192.168.1.1:/api/reports/detect  → "5" (10分钟内检测5次)
TTL: 600秒

captcha_exempt:192.168.1.1                   → "1783922400" (豁免截止时间戳)
TTL: 1800秒

blocked:ip:192.168.1.1                       → "RATE_LIMIT_EXCEEDED"
TTL: 3600秒
```

---

### 2. Visitor 维度限流

| 时间窗口 | 阈值 | 动作 | Redis Key |
|---|---:|---|---|
| 1 小时 | ≤5 次 | 正常处理 | `ratelimit:visitor:{visitor_id}:{api_path}` |
| 1 小时 | 6-10 次 | 要求验证码 | 同上，设置 `captcha_exempt:{visitor_id}` 过期 |
| 1 天 | >30 次 | 拒绝请求，返回 RATE_LIMITED | `blocked:visitor:{visitor_id}` |

**Redis Key 示例:**
```text
ratelimit:visitor:visitor_abc123:/api/reports/detect  → "5" (1小时内检测5次)
TTL: 3600秒

captcha_exempt:visitor_abc123                       → "1783922400" (豁免截止时间戳)
TTL: 1800秒

blocked:visitor:visitor_abc123                      → "RATE_LIMIT_EXCEEDED"
TTL: 86400秒
```

---

### 3. Input Hash 维度限流

防止相同输入高频重复提交（可能是恶意刷接口或缓存失效）。

| 时间窗口 | 阈值 | 动作 | Redis Key |
|---|---:|---|---|
| 1 小时 | ≤2 次 | 正常处理（优先返回缓存） | `ratelimit:input_hash:{hash}` |
| 1 小时 | >2 次 | 直接返回缓存或要求验证码 | 同上 |

**处理逻辑:**
```typescript
// 检查 input_hash 缓存
const cachedReport = await redis.get(`report:hash:${inputHash}`);

if (cachedReport) {
  // 直接返回缓存，不消耗 AI 资源
  return cachedReport;
}

// 检查 input_hash 限流计数
const hashCount = await redis.get(`ratelimit:input_hash:${inputHash}`);

if (hashCount && parseInt(hashCount) > 2) {
  // 要求验证码
  return { error: 'CAPTCHA_REQUIRED', message: '相同输入重复提交，请先验证。' };
}

// 正常处理
await redis.incr(`ratelimit:input_hash:${inputHash}`);
await redis.expire(`ratelimit:input_hash:${inputHash}`, 3600);
```

---

### 4. 接口级别限流

不同接口有不同的限流阈值:

| 接口 | IP 阈值（10分钟） | Visitor 阈值（1小时） | 说明 |
|---|---:|---:|---|
| POST /api/reports/detect | 5 次 | 5 次 | 主检测接口，成本最高 |
| POST /api/reports/:id/hr-analysis | 5 次 | 5 次 | HR 分析接口，成本中等 |
| POST /api/hr-analysis | 5 次 | 5 次 | 独立 HR 分析接口 |
| POST /api/interview-feedbacks | 10 次 | 10 次 | 反馈接口，成本较低 |
| POST /api/report-feedbacks | 10 次 | 10 次 | 报告纠错接口 |
| DELETE /api/reports/:id | 20 次 | 20 次 | 删除接口，成本最低 |
| GET /api/reports/:id | 20 次 | 20 次 | 查询接口，成本最低 |

---

## 验证码触发策略

### 1. 验证码触发条件

以下情况触发验证码要求:

| 触发条件 | 说明 | 返回错误码 |
|---|---|---|
| IP 10 分钟内请求 6-10 次 | IP 维度高频请求 | `CAPTCHA_REQUIRED` |
| Visitor 1 小时内请求 6-10 次 | Visitor 维度高频请求 | `CAPTCHA_REQUIRED` |
| Input Hash 1 小时内重复提交 >2 次 | 相同输入重复提交 | `CAPTCHA_REQUIRED` |
| User-Agent 缺失或异常 | 可疑请求特征 | `CAPTCHA_REQUIRED` |
| Referer 异常或缺失 | 可疑请求来源 | `CAPTCHA_REQUIRED` |
| 反馈接口短时间大量提交 | 可能刷反馈 | `CAPTCHA_REQUIRED` |

### 2. 验证码豁免机制

用户完成验证码验证后，可获得短期豁免:

| 豁免维度 | 豁免时长 | Redis Key |
|---|---:|---|
| Visitor 维度 | 30 分钟 | `captcha_exempt:{visitor_id}` |
| IP 维度 | 30 分钟 | `captcha_exempt:{ip}` |

豁免期内，该 visitor 或 IP 的所有请求不再要求验证码。

**豁免逻辑:**
```typescript
// 检查是否已豁免
const exemptUntil = await redis.get(`captcha_exempt:${visitorId}`);

if (exemptUntil && parseInt(exemptUntil) > Date.now()) {
  // 已豁免，直接处理请求
  return processRequest();
}

// 未豁免，检查是否需要验证码
const ipCount = await redis.get(`ratelimit:ip:${ip}:${apiPath}`);
const visitorCount = await redis.get(`ratelimit:visitor:${visitorId}:${apiPath}`);

if ((ipCount && parseInt(ipCount) > 5) || (visitorCount && parseInt(visitorCount) > 5)) {
  // 需要验证码
  return { error: 'CAPTCHA_REQUIRED', message: '请求较频繁，请先完成验证。' };
}
```

---

## 验证码 Provider 选择

### 1. 推荐 Provider

| Provider | 优势 | 劣势 | 推荐场景 |
|---|---|---|---|
| Cloudflare Turnstile | 免费、用户打扰低、Web/H5兼容好 | 国内访问可能不稳定 | Web/H5 首版优先 |
| hCaptcha | 可用性成熟、隐私友好 | 部分用户体验一般 | 国际访问场景 |
| reCAPTCHA | Google 产品、成熟度高 | 国内访问不稳定、隐私争议 | 不推荐国内用户 |
| 国内云验证码 | 国内访问稳定、合规性好 | 可能产生费用 | 国内生产环境兜底 |

**首版建议:**
- 优先使用 Cloudflare Turnstile（免费）
- 国内生产环境可切换为阿里云/腾讯云验证码（付费但稳定）

### 2. Provider 接口抽象

后端必须抽象统一验证码 Provider 接口:

```typescript
interface CaptchaProvider {
  name: string; // 'turnstile' | 'hcaptcha' | 'recaptcha' | 'aliyun' | 'tencent'
  
  verify(input: {
    token: string;        // 前端提交的验证码 token
    remoteIp?: string;    // 用户 IP
    action?: string;      // 操作类型: 'detect' | 'hr_analysis' | 'feedback'
  }): Promise<{
    success: boolean;
    reason?: string;      // 失败原因
    score?: number;       // 风险评分（0-1）
  }>;
}
```

### 3. 服务端校验要求

**禁止信任前端本地状态。** 后端必须调用 Provider 服务端校验接口:

```typescript
// 错误示例 - 不要这样做
if (request.body.captcha_verified === true) {
  // 前端传来的布尔值不可信
  return processRequest();
}

// 正确示例 - 必须调用服务端校验
const captchaResult = await captchaProvider.verify({
  token: request.body.captcha_token,
  remoteIp: request.ip,
  action: 'detect',
});

if (!captchaResult.success) {
  return { error: 'CAPTCHA_FAILED', message: '验证失败，请刷新后重试。' };
}

// 验证成功，设置豁免状态
await redis.set(`captcha_exempt:${visitorId}`, Date.now() + 1800);
await redis.expire(`captcha_exempt:${visitorId}`, 1800);

return processRequest();
```

---

## 限流错误响应

### 1. CAPTCHA_REQUIRED

```json
{
  "error": "CAPTCHA_REQUIRED",
  "message": "请求较频繁，请先完成验证。",
  "captcha_provider": "turnstile"
}
```

前端处理:
- 展示验证码组件（Turnstile/hCaptcha 等）
- 用户完成验证后获得 `captcha_token`
- 携带 `captcha_token` 重试原请求

---

### 2. CAPTCHA_FAILED

```json
{
  "error": "CAPTCHA_FAILED",
  "message": "验证失败，请刷新后重试。"
}
```

前端处理:
- 提示用户刷新验证码重新尝试
- **不清空用户输入**

---

### 3. RATE_LIMITED

```json
{
  "error": "RATE_LIMITED",
  "message": "检测次数较多，请稍后再试。",
  "retry_after": "2026-07-13T14:00:00.000Z"
}
```

前端处理:
- 提示用户稍后再试
- 展示 `retry_after` 时间（转换为本地时间）
- 引导用户返回首页或稍后重试

---

## 安全事件记录

### 1. 必须记录的安全事件

| 事件类型 | 说明 | 严重等级 | 记录内容 |
|---|---|---|---|
| rate_limit_hit | 触发限流 | medium | visitor_id, ip, api_path, 请求计数 |
| captcha_required | 要求验证码 | low | visitor_id, ip, api_path |
| captcha_failed | 验证码校验失败 | medium | visitor_id, ip, 验证码 Provider |
| suspicious_input | 可疑输入（如包含身份证号） | high | visitor_id, ip, 输入哈希 |
| ip_blocked | IP 被封禁 | high | ip, 封禁原因, 封禁时长 |
| visitor_blocked | Visitor 被封禁 | high | visitor_id, 封禁原因 |
| repeat_input | 相同输入高频重复 | medium | input_hash, visitor_id, ip |

### 2. 安全事件记录示例

```typescript
// 记录限流命中事件
await prisma.securityEvent.create({
  data: {
    event_type: 'rate_limit_hit',
    severity: 'medium',
    visitor_id: visitorId,
    ip_address: ip,
    api_path: apiPath,
    detail: {
      ip_count: ipCount,
      visitor_count: visitorCount,
      window: '10min',
    },
    action_taken: 'captcha_required',
  },
});
```

---

## 前端实现要点

### 1. 验证码组件集成

```typescript
// 使用 Cloudflare Turnstile 示例
import { Turnstile } from '@marsref/turnstile-react';

function CaptchaGate({ onSuccess, onClose }) {
  return (
    <Turnstile
      siteKey="your-site-key"
      onSuccess={(token) => {
        onSuccess(token);
        onClose();
      }}
      onError={(error) => {
        console.error('验证失败:', error);
      }}
      options={{
        theme: 'light',
        size: 'normal',
      }}
    />
  );
}
```

### 2. 请求流程处理

```typescript
async function submitDetection(data: DetectionInput) {
  try {
    const response = await api.post('/api/reports/detect', data);
    return response;
  } catch (error) {
    if (error.error === 'CAPTCHA_REQUIRED') {
      // 展示验证码
      const token = await showCaptcha(error.captcha_provider);
      // 重试请求
      return api.post('/api/reports/detect', {
        ...data,
        captcha_token: token,
      });
    }
    throw error;
  }
}
```

### 3. 首次低频检测策略

**首次低频检测不主动展示验证码，减少用户流失:**

```typescript
// 前端不要主动判断是否需要验证码
// 只根据后端返回的 CAPTCHA_REQUIRED 展示验证码

// 错误示例 - 不要这样做
if (localStorage.getItem('detection_count') > 3) {
  // 主动展示验证码
  showCaptcha();
}

// 正确示例 - 根据后端返回展示
async function submitDetection(data) {
  const response = await api.post('/api/reports/detect', data);
  if (response.error === 'CAPTCHA_REQUIRED') {
    // 后端要求才展示
    await showCaptcha();
  }
}
```

---

## 后端实现要点

### 1. 限流中间件

```typescript
// 限流中间件示例
async function rateLimitMiddleware(req, res, next) {
  const ip = req.ip;
  const visitorId = req.headers['x-visitor-id'];
  const apiPath = req.path;

  // 检查是否已豁免验证码
  const exemptUntil = await redis.get(`captcha_exempt:${visitorId}`);
  if (exemptUntil && parseInt(exemptUntil) > Date.now()) {
    return next();
  }

  // 检查是否被封禁
  const blocked = await redis.get(`blocked:ip:${ip}`);
  if (blocked) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: '检测次数较多，请稍后再试。',
      retry_after: await redis.ttl(`blocked:ip:${ip}`),
    });
  }

  // 检查 IP 限流计数
  const ipCount = await redis.get(`ratelimit:ip:${ip}:${apiPath}`);
  if (ipCount && parseInt(ipCount) > 20) {
    // 封禁 IP
    await redis.set(`blocked:ip:${ip}`, 'RATE_LIMIT_EXCEEDED');
    await redis.expire(`blocked:ip:${ip}`, 3600);
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: '检测次数较多，请稍后再试。',
      retry_after: Date.now() + 3600000,
    });
  }

  if (ipCount && parseInt(ipCount) > 5) {
    // 要求验证码
    if (!req.body.captcha_token) {
      return res.status(403).json({
        error: 'CAPTCHA_REQUIRED',
        message: '请求较频繁，请先完成验证。',
        captcha_provider: 'turnstile',
      });
    }
  }

  // 增加 IP 限流计数
  await redis.incr(`ratelimit:ip:${ip}:${apiPath}`);
  await redis.expire(`ratelimit:ip:${ip}:${apiPath}`, 600);

  return next();
}
```

### 2. 验证码校验流程

```typescript
async function verifyCaptcha(req, res, next) {
  if (!req.body.captcha_token) {
    return next();
  }

  const captchaResult = await captchaProvider.verify({
    token: req.body.captcha_token,
    remoteIp: req.ip,
    action: req.path.includes('detect') ? 'detect' : 'feedback',
  });

  if (!captchaResult.success) {
    // 记录验证失败事件
    await prisma.securityEvent.create({
      data: {
        event_type: 'captcha_failed',
        severity: 'medium',
        visitor_id: req.headers['x-visitor-id'],
        ip_address: req.ip,
        detail: { reason: captchaResult.reason },
      },
    });

    return res.status(403).json({
      error: 'CAPTCHA_FAILED',
      message: '验证失败，请刷新后重试。',
    });
  }

  // 设置豁免状态
  const visitorId = req.headers['x-visitor-id'];
  await redis.set(`captcha_exempt:${visitorId}`, Date.now() + 1800000);
  await redis.expire(`captcha_exempt:${visitorId}`, 1800);

  return next();
}
```

---

## 版本管理

当前冻结版本：`v1.0.0`

后续如果需要调整限流策略，必须：
1. 更新限流阈值和窗口
2. 更新验证码触发条件
3. 更新 Redis Key 设计
4. 运行回归测试验证
5. 更新文档版本号

---

## 变更记录

| 版本 | 日期 | 变更内容 | 变更原因 |
|---|---|---|---|
| v1.0.0 | 2026-07-13 | 初始冻结版本 | P0 MVP 开发启动 |
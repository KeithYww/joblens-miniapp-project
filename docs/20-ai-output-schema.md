# 20 AI Output Schema - P0 冻结版本

冻结日期：2026-07-13
版本：v1.0.0

## 说明

本文档冻结 JobLens Web/H5 MVP P0 阶段所有 AI 模型输出结构化数据 Schema。所有大模型 Provider、规则引擎、前后端开发必须严格按照此 Schema 生成、校验和渲染数据。

后端必须实现：
1. JSON Schema 严格校验
2. Zod/TypeScript 类型定义
3. 规则引擎修正
4. 敏感表达过滤
5. 高风险证据校验

## Schema 定义

### 1. RiskReport - 岗位风险报告

完整岗位风险检测报告的输出结构。

#### TypeScript 类型定义

```typescript
type RiskLevel = '低' | '中' | '高' | '极高';
type Confidence = '高' | '中' | '低';
type SubScoreStatus = 'available' | 'missing' | 'insufficient';

interface SubScore {
  score: number | null;  // 0-100，null 表示数据不足
  weight: number;  // 0-1，权重值
  status: SubScoreStatus;
}

interface SubScores {
  jd_risk: SubScore;
  hr_risk: SubScore;
  company_risk: SubScore;
  feedback_risk: SubScore;
}

interface RiskReport {
  report_id: string;  // 格式: rep_[a-z0-9]{12}
  overall_score: number;  // 0-100
  risk_level: RiskLevel;
  confidence: Confidence;
  predicted_role: string | null;  // 预测的实际岗位类型
  risk_types: string[];  // 命中的风险类型列表
  sub_scores: SubScores;
  strong_risk_adjustment: number;  // 强风险修正值，0-20
  evidence: string[];  // 证据列表，每条 10-200 字
  missing_info: string[];  // 缺失信息列表
  questions: string[];  // 追问问题列表，每条 10-100 字
  recommendation: string;  // 建议，10-200 字
  disclaimer: string;  // 固定免责声明
  created_at: string;  // ISO 8601 时间戳
}
```

#### Zod Schema 定义

```typescript
import { z } from 'zod';

const RiskLevelSchema = z.enum(['低', '中', '高', '极高']);
const ConfidenceSchema = z.enum(['高', '中', '低']);
const SubScoreStatusSchema = z.enum(['available', 'missing', 'insufficient']);

const SubScoreSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  status: SubScoreStatusSchema,
});

const SubScoresSchema = z.object({
  jd_risk: SubScoreSchema,
  hr_risk: SubScoreSchema,
  company_risk: SubScoreSchema,
  feedback_risk: SubScoreSchema,
});

const RiskReportSchema = z.object({
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/),
  overall_score: z.number().min(0).max(100),
  risk_level: RiskLevelSchema,
  confidence: ConfidenceSchema,
  predicted_role: z.string().max(100).nullable(),
  risk_types: z.array(z.string().max(50)).min(0).max(10),
  sub_scores: SubScoresSchema,
  strong_risk_adjustment: z.number().min(0).max(20),
  evidence: z.array(z.string().min(10).max(200)),
  missing_info: z.array(z.string().max(100)),
  questions: z.array(z.string().min(10).max(100)),
  recommendation: z.string().min(10).max(200),
  disclaimer: z.literal('本结果仅供求职决策参考，不构成法律认定。'),
  created_at: z.string().datetime(),
});
```

#### JSON Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RiskReport",
  "type": "object",
  "required": [
    "report_id",
    "overall_score",
    "risk_level",
    "confidence",
    "risk_types",
    "sub_scores",
    "strong_risk_adjustment",
    "evidence",
    "missing_info",
    "questions",
    "recommendation",
    "disclaimer",
    "created_at"
  ],
  "properties": {
    "report_id": {
      "type": "string",
      "pattern": "^rep_[a-z0-9]{12}$"
    },
    "overall_score": {
      "type": "number",
      "minimum": 0,
      "maximum": 100
    },
    "risk_level": {
      "type": "string",
      "enum": ["低", "中", "高", "极高"]
    },
    "confidence": {
      "type": "string",
      "enum": ["高", "中", "低"]
    },
    "predicted_role": {
      "type": ["string", "null"],
      "maxLength": 100
    },
    "risk_types": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 50
      },
      "minItems": 0,
      "maxItems": 10
    },
    "sub_scores": {
      "type": "object",
      "required": ["jd_risk", "hr_risk", "company_risk", "feedback_risk"],
      "properties": {
        "jd_risk": {
          "$ref": "#/definitions/SubScore"
        },
        "hr_risk": {
          "$ref": "#/definitions/SubScore"
        },
        "company_risk": {
          "$ref": "#/definitions/SubScore"
        },
        "feedback_risk": {
          "$ref": "#/definitions/SubScore"
        }
      }
    },
    "strong_risk_adjustment": {
      "type": "number",
      "minimum": 0,
      "maximum": 20
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 10,
        "maxLength": 200
      }
    },
    "missing_info": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 100
      }
    },
    "questions": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 10,
        "maxLength": 100
      }
    },
    "recommendation": {
      "type": "string",
      "minLength": 10,
      "maxLength": 200
    },
    "disclaimer": {
      "type": "string",
      "const": "本结果仅供求职决策参考，不构成法律认定。"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "definitions": {
    "SubScore": {
      "type": "object",
      "required": ["score", "weight", "status"],
      "properties": {
        "score": {
          "type": ["number", "null"],
          "minimum": 0,
          "maximum": 100
        },
        "weight": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "status": {
          "type": "string",
          "enum": ["available", "missing", "insufficient"]
        }
      }
    }
  }
}
```

#### 字段校验规则

| 字段 | 校验规则 | 强制修正 |
|---|---|---|
| overall_score | 0-100 整数 | 超出范围强制修正为边界值 |
| risk_level | 枚举：低/中/高/极高 | 根据 overall_score 自动映射：≤30→低，31-60→中，61-80→高，81-100→极高 |
| confidence | 枚举：高/中/低 | 根据 sub_scores 可用数量自动判定 |
| predicted_role | ≤100 字 | 避免法律定性表达，如"骗子岗" |
| risk_types | 最多 10 条 | 每条 ≤50 字 |
| evidence | 高风险报告必须 ≥1 条 | 高风险但无证据时降级为"信息不足" |
| missing_info | 自动转换为追问 | 格式："缺失：xxx" → "追问：xxx是多少？" |
| questions | 每条 10-100 字 | 数量建议 3-5 条，可展开显示更多 |
| recommendation | 10-200 字 | 禁止"不建议面试"等绝对表达，改为"建议先确认..." |
| disclaimer | 固定文案 | 必须包含，后端强制填充 |

---

### 2. HrAnalysis - HR 回复分析

HR 回复回避分析输出结构。

#### TypeScript 类型定义

```typescript
interface HrAnalysis {
  hr_analysis_id: string;  // 格式: hra_[a-z0-9]{12}
  report_id?: string;  // 关联报告 ID，可选
  avoidance_score: number;  // 0-100，回避程度
  risk_level: RiskLevel;
  analysis: string;  // 分析说明，10-500 字
  next_questions: string[];  // 下一轮追问，每条 10-100 字
  created_at: string;  // ISO 8601
}
```

#### Zod Schema 定义

```typescript
const HrAnalysisSchema = z.object({
  hr_analysis_id: z.string().regex(/^hra_[a-z0-9]{12}$/),
  report_id: z.string().regex(/^rep_[a-z0-9]{12}$/).optional(),
  avoidance_score: z.number().min(0).max(100),
  risk_level: RiskLevelSchema,
  analysis: z.string().min(10).max(500),
  next_questions: z.array(z.string().min(10).max(100)),
  created_at: z.string().datetime(),
});
```

#### 字段校验规则

| 字段 | 校验规则 | 强制修正 |
|---|---|---|
| avoidance_score | 0-100 整数 | 超出范围修正为边界值 |
| risk_level | 根据分数映射 | ≤30→低，31-60→中，61-80→高，81-100→极高 |
| analysis | 10-500 字 | 禁止攻击性表达如"HR骗子" |
| next_questions | 每条 10-100 字 | 建议生成 2-3 条追问 |

---

### 3. 强风险修正规则

后端规则引擎必须对 AI 输出进行强制修正。

#### 强风险词映射

| 强风险词 | 强风险类型 | 修正规则 |
|---|---|---|
| 押金 | 涉及收费 | overall_score 必须 ≥60，evidence 必须包含"岗位涉及押金" |
| 保证金 | 涉及收费 | 同上 |
| 培训贷 | 涉及贷款 | overall_score 必须 ≥70，evidence 必须包含具体贷款表述 |
| 贷款分期 | 涉及贷款 | 同上 |
| 扣身份证 | 涉及违法 | overall_score 必须 ≥80，evidence 必须包含具体表述 |
| 扣毕业证 | 涉及违法 | 同上 |
| 先交费 | 涉及收费 | overall_score 必须 ≥60 |
| 拉亲友资源 | 涉及传销特征 | overall_score 必须 ≥70 |
| 无薪试岗 | 涉及违法 | overall_score 必须 ≥75 |

#### 反误伤规则

以下场景不应直接判定高风险：

| 场景 | 强风险词存在 | 修正规则 |
|---|---|---|
| JD 明确写销售，薪资和指标清楚 | 销售相关词 | 不因"销售"二字判高风险，predicted_role 可为"销售岗" |
| 初创公司成立短，JD 清晰无收费无回避 | 公司风险词 | company_risk.status 设为 "insufficient"，不强行提高 overall_score |
| HR 回复简短但正面回答核心问题 | HR 回避词 | hr_risk.score 不应高于 50 |
| 用户只提供很短 JD（<100 字） | 多种风险词 | confidence 设为 "低"，overall_score 不超过 60 |

---

### 4. 敏感表达过滤

AI 输出中不得出现以下敏感表达，后端必须强制替换：

| 禁止表达 | 替换表达 | 原因 |
|---|---|---|
| 骗子、诈骗、欺诈 | 信息不透明、需要确认 | 避免法律定性 |
| 黑公司、烂公司 | 公司信息不完整、建议核实工商 | 避免攻击性表达 |
| 实锤、铁证 | 存在明显信号 | 避免过度自信 |
| 肯定是、绝对是 | 可能是、建议确认 | 避免绝对化表达 |
| 拉人头、传销 | 存在类似特征、建议核实业务模式 | 避免法律定性 |
| 洗脑、PUA | 培训方式存疑、建议了解培训内容 | 避免攻击性表达 |

---

### 5. 高风险证据校验

高风险报告（overall_score ≥60）必须至少有 1 条 evidence。

如果 AI 输出高风险但 evidence 为空：

```typescript
if (report.overall_score >= 60 && report.evidence.length === 0) {
  // 强制降级
  report.overall_score = 45;
  report.risk_level = '中';
  report.confidence = '低';
  report.recommendation = '信息不足以判断，建议补充岗位详情或 HR 聊天记录后重新检测。';
  report.evidence.push('当前输入信息不足以生成明确风险结论。');
}
```

---

### 6. 置信度自动判定

后端根据 sub_scores 可用数量自动判定置信度：

```typescript
function calculateConfidence(subScores: SubScores): Confidence {
  const availableCount = Object.values(subScores)
    .filter(s => s.status === 'available').length;
  
  if (availableCount >= 3) return '高';
  if (availableCount >= 2) return '中';
  return '低';
}
```

---

### 7. 缺失信息转追问

后端必须将 missing_info 自动转换为 questions：

```typescript
function convertMissingToQuestions(missingInfo: string[]): string[] {
  return missingInfo.map(info => {
    const question = `${info}是多少？是否可以提供书面说明？`;
    return question.substring(0, 100);  // 截断超长问题
  });
}
```

---

## Prompt 输出要求

大模型 Prompt 必须明确要求：

```text
你必须输出合法 JSON，不得输出 Markdown。
字段类型和枚举必须严格遵守 Schema。
每个风险结论必须有证据支撑。
缺少信息时输出 missing_info，不要编造。
不得使用法律定性表达，如"骗子、黑公司、实锤"。
高风险报告必须至少有 1 条 evidence。
```

---

## 后端校验流程

```text
AI Provider 返回文本
  ↓
JSON 解析
  ↓
Zod Schema 校验
  ↓
字段修正（分数范围、枚举映射）
  ↓
强风险词检测与修正
  ↓
高风险证据校验
  ↓
敏感表达过滤
  ↓
缺失信息转追问
  ↓
置信度自动判定
  ↓
落库与返回
```

校验失败时：
- 可重试 1 次
- 仍失败则返回兜底报告（overall_score: 45, risk_level: '中', evidence: ['AI 服务异常，请稍后重试']）

---

## Provider 输出要求

所有 LLM Provider 必须统一输出：

```typescript
interface LlmProviderResult {
  rawText: string;  // 模型原始输出
  parsedJson: unknown;  // 解析后的 JSON
  model: string;  // 使用的模型名称
  provider: string;  // Provider 名称
  inputTokens?: number;  // 输入 token 数
  outputTokens?: number;  // 输出 token 数
  latencyMs: number;  // 响应耗时 ms
  costEstimate?: number;  // 成本估算，单位：元
}
```

---

## 前端渲染规则

前端必须严格按照 Schema 渲染，不得自行编造字段：

| 场景 | 渲染规则 |
|---|---|
| sub_scores.score 为 null | 展示"数据不足"，不展示分数 |
| evidence 为空数组 | 不展示证据模块，或在缺失信息中说明 |
| predicted_role 为 null | 不展示预测岗位 |
| confidence 为低 | 在报告页顶部标注"信息不足，建议补充" |
| risk_level 为极高 | 使用红色标注，但不使用"禁止"等绝对表达 |

---

## 版本管理

当前冻结版本：`v1.0.0`

后续如果需要调整 Schema，必须：
1. 创建新版本 Schema，如 `v1.1.0`
2. 在数据库中记录 `schema_version` 字段
3. 前后端同步修改并完成回归测试
4. 更新文档和版本号

---

## 变更记录

| 版本 | 日期 | 变更内容 | 变更原因 |
|---|---|---|---|
| v1.0.0 | 2026-07-13 | 初始冻结版本 | P0 MVP 开发启动 |
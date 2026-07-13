# 14 后端实现方案

## 推荐方案

首版推荐：

```text
Node.js + Fastify/NestJS + PostgreSQL + Prisma
```

如果团队更熟悉 Python，也可以使用：

```text
Python FastAPI + PostgreSQL + SQLAlchemy
```

## 后端职责

后端不只是透传 AI，还要负责：

- 参数校验
- 限流
- Prompt 组装
- AI 输出 schema 校验
- 风险规则二次校验
- 强风险修正
- 报告落库
- 反馈落库
- 敏感词过滤
- 错误兜底
- 日志与成本统计

## API 模块

| 模块 | 接口 |
|---|---|
| 报告 | `POST /api/reports/detect`、`GET /api/reports/:id` |
| HR 分析 | `POST /api/hr/analyze` |
| 反馈 | `POST /api/feedbacks` |
| 纠错 | `POST /api/reports/:id/feedback` |
| OCR | `POST /api/ocr/extract`，P1 |
| 企业申诉 | `POST /api/appeals`，P1/P2 |

## 后端目录建议

```text
backend/
├── src/
│   ├── app.ts
│   ├── routes/
│   │   ├── reports.ts
│   │   ├── hr.ts
│   │   ├── feedbacks.ts
│   │   ├── ocr.ts
│   │   └── appeals.ts
│   ├── services/
│   │   ├── ai-risk-engine/
│   │   ├── scoring/
│   │   ├── ocr/
│   │   └── moderation/
│   ├── repositories/
│   ├── schemas/
│   ├── middlewares/
│   └── utils/
├── prisma/
│   └── schema.prisma
└── package.json
```

## 核心数据表

首版必须实现：

- `job_reports`
- `interview_feedbacks`
- `report_feedbacks`
- `risk_terms`

可以后置：

- `company_snapshots`
- `ocr_tasks`
- `enterprise_appeals`
- `users`

首版可不登录，用户标识可以使用匿名 `visitor_id`。如果用户清除浏览器缓存，历史记录丢失是可接受的。

## 限流策略

AI 调用有成本，必须限制滥用。

建议：

| 维度 | 限制 |
|---|---|
| IP | 每小时 20 次检测 |
| visitor_id | 每天 30 次检测 |
| 单次 JD 文本 | 最大 8000 字 |
| 单次 HR 文本 | 最大 8000 字 |
| OCR 图片 | P1 单次最多 3 张 |

异常时返回：

```json
{
  "error": "RATE_LIMITED",
  "message": "检测次数较多，请稍后再试。"
}
```

## AI 输出校验

后端必须定义 JSON Schema。模型返回后执行：

1. JSON 解析
2. 字段完整性校验
3. 分数范围校验
4. 风险等级映射校验
5. 高风险证据校验
6. 敏感词替换
7. 落库

如果失败：

- 可重试一次
- 仍失败则返回兜底报告
- 记录错误日志

## 规则引擎

规则引擎用于补足大模型的不稳定性。

强制规则：

- 出现押金、保证金、培训贷、扣证件，必须提高风险分
- 高风险结论必须至少有一条证据
- 没有 HR 聊天记录时，不能说“HR 回避”
- 没有工商数据时，不能说“公司主体异常”
- 正常销售岗不能因为“销售”二字直接判定为包装岗位

## OCR Provider 设计

P1 实现统一接口：

```ts
interface OcrProvider {
  extract(input: OcrInput): Promise<OcrResult>
}
```

Provider：

- `SelfHostedRapidOcrProvider`
- `SelfHostedPaddleOcrProvider`
- `CloudOcrFallbackProvider`

策略：

```text
自建 OCR 成功 → 返回
自建 OCR 失败或低置信度 → 云 OCR 兜底
全部失败 → 提示用户粘贴文本
```

## 日志与监控

必须记录：

- API 调用次数
- AI 调用耗时
- AI 调用失败
- JSON 解析失败
- OCR 识别失败
- 用户误判反馈
- 强风险命中次数

不要记录：

- 用户身份证号
- 银行卡
- 完整手机号
- 未脱敏的公开反馈内容

## 后端开发成本

| 范围 | 工期 |
|---|---:|
| API 骨架 + 数据库 | 3-5 天 |
| AI 风险检测接口 | 3-5 天 |
| 规则引擎与评分 | 3-5 天 |
| 反馈与纠错 | 2-3 天 |
| 日志、限流、错误兜底 | 2-4 天 |
| P1 OCR 服务 | 1-2 周 |

首版后端预计 2-3 周可以完成。若加入 OCR，整体增加 1-2 周。

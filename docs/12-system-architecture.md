# 12 总体系统架构

## 架构结论

Web/H5 首版建议采用轻量 BFF 架构：

```text
浏览器 Web/H5
  ↓
API Server / BFF
  ↓
AI Risk Engine
  ↓
Database
```

P1 OCR 增强后扩展为：

```text
浏览器上传截图
  ↓
API Server
  ↓
OCR Provider
  ↓
字段结构化服务
  ↓
AI Risk Engine
```

## 推荐技术栈

| 层级 | 推荐 | 备选 |
|---|---|---|
| 前端 | Vite + React + TypeScript | Next.js、Vue |
| UI | CSS Modules / Tailwind CSS | UnoCSS |
| 后端 | Node.js + Fastify / NestJS | Python FastAPI |
| 数据库 | PostgreSQL | MySQL、Supabase |
| ORM | Prisma | Drizzle、TypeORM |
| AI 调用 | 统一 LLM Provider 接口 | 直接调用单一模型 |
| OCR | P1 自建 RapidOCR / PaddleOCR | 云厂商 OCR 兜底 |
| 部署 | Vercel/Cloudflare Pages + API Server | 单服务器 Docker Compose |

## 模块划分

### Web/H5 Client

负责：

- 页面渲染
- 表单输入
- 图片上传入口
- 报告展示
- 追问复制
- 用户反馈提交
- 隐私与免责声明展示

不负责：

- 最终风险判断
- AI Prompt 组装
- 工商查询
- OCR 模型运行

### API Server

负责：

- 请求校验
- 限流
- 调用 AI 风险引擎
- 调用 OCR Provider
- 保存报告
- 保存反馈
- 返回结构化结果
- 日志与异常处理

### AI Risk Engine

负责：

- 组装提示词
- 调用大模型
- 校验 JSON 输出
- 根据规则引擎修正分数
- 生成证据、缺失信息、追问问题

### Database

首版核心表：

- `users`
- `job_reports`
- `interview_feedbacks`
- `report_feedbacks`
- `risk_terms`

P1 扩展表：

- `company_snapshots`
- `ocr_tasks`
- `enterprise_appeals`

## 首版请求链路

### 岗位检测链路

```text
用户粘贴 JD
  ↓
前端校验文本长度
  ↓
POST /api/reports/detect
  ↓
后端限流与参数校验
  ↓
AI Risk Engine 生成结构化分析
  ↓
规则引擎二次校验
  ↓
写入 job_reports
  ↓
返回风险报告
```

### HR 回复分析链路

```text
用户粘贴 HR 回复
  ↓
POST /api/hr/analyze
  ↓
结合原报告上下文
  ↓
判断是否回避核心问题
  ↓
返回下一轮追问
```

### 面试反馈链路

```text
用户填写反馈
  ↓
POST /api/feedbacks
  ↓
敏感词过滤
  ↓
写入 interview_feedbacks
  ↓
进入待审核状态
```

## P1 OCR 链路

```text
用户上传截图
  ↓
前端压缩与大小校验
  ↓
POST /api/ocr/extract
  ↓
后端保存临时图片
  ↓
自建 OCR 识别
  ↓
低置信度时云 OCR 兜底
  ↓
大模型结构化岗位字段
  ↓
返回用户确认页
```

## 关键架构原则

- 前端不保存敏感原文到本地持久存储
- 后端不公开展示用户聊天原文
- OCR 图片默认短期保存
- AI 输出必须经过 schema 校验
- 风险分必须保留子分和证据
- 强风险信号由规则引擎兜底
- 首版不引入复杂微服务

## 技术可行性结论

Web/H5 首版技术可行性高。核心难点不是页面开发，而是 AI 输出稳定性、风险解释可信度和数据合规边界。建议先用单体后端或 Serverless API 快速上线，等 OCR、工商查询和反馈库规模起来后再拆服务。

# 职镜 JobLens Web/H5 工程项目

`职镜 JobLens` 是一款面向求职者的岗位风险检测 Web/H5 工具。第一版聚焦"岗位信息是否透明、JD 是否存在包装、HR 是否回避关键问题、是否需要继续面试前追问"，暂不做全网岗位库、企业黑名单、复杂社区和付费会员。

## 在线体验（需要翻墙）

- [https://joblens-miniapp.vercel.app](https://joblens-miniapp.vercel.app)

## 🚀 项目状态

- **项目阶段**：MVP 完成（可部署上线）
- **首发端**：Web + H5
- **核心输入**：岗位 JD、HR 聊天记录、公司名称
- **核心输出**：风险分、风险等级、命中证据、缺失信息、追问问题、面试建议
- **AI 能力**：支持 SiliconFlow / QwenCloud 大模型，自动降级到规则引擎

## 推荐首版范围

首版只保留一条主路径：

用户粘贴岗位信息 → 系统生成风险报告 → 用户复制追问问题 → 用户面试后匿名反馈。

必须做：

- JD 文本检测
- HR 回复分析
- 风险报告页
- 追问卡片
- 匿名反馈页
- 隐私说明与免责声明

已实现增强：

- 上传岗位截图识别与确认编辑（1-3 张 PNG/JPEG/WebP，单张最大 2MB）

后续增强：

- 自建 OCR 服务
- Web/H5 分享报告页

暂缓做：

- 工商 API 自动查询
- 全网岗位抓取
- 公司黑名单
- 社区广场
- 付费会员

## 目录说明

```text
joblens-miniapp-project/
├── README.md
├── docs/
│   ├── research-prd-html/        # 已归档的 HTML 调研与 PRD 文档
│   ├── 01-project-brief.md       # 项目简报
│   ├── 02-mvp-scope.md           # MVP 范围
│   ├── 03-risk-score-model.md    # 风险评分模型
│   ├── 04-data-model.md          # 数据模型
│   ├── 05-api-spec.md            # API 草案
│   ├── 06-web-h5-pages.md        # Web/H5 页面说明
│   ├── 07-launch-check.md        # 上线前检查
│   ├── 08-screenshot-ocr-research.md # 岗位截图识别调研
│   ├── 09-free-ocr-options.md    # 免费/自建 OCR 方案
│   ├── 10-web-h5-technical-review.md # Web/H5 技术专家评审
│   ├── 11-technical-docs-plan.md # 技术文档规划
│   ├── 12-system-architecture.md # 总体系统架构
│   ├── 13-frontend-implementation.md # 前端实现方案
│   ├── 14-backend-implementation.md # 后端实现方案
│   ├── 15-ai-risk-engine.md      # AI 风险引擎设计
│   ├── 16-deployment-cost.md     # 部署与成本评估
│   ├── 17-free-llm-options.md    # 免费/低成本大模型方案
│   ├── 18-expert-review-before-development.md # 开发前专家评审汇总
│   ├── 19-api-contract.md        # P0 API 协议冻结版本
│   ├── 20-ai-output-schema.md    # P0 AI 输出 Schema 冻结版本
│   ├── 21-database-schema.md     # P0 数据库 Schema 冻结版本
│   ├── 22-privacy-retention-design.md # P0 隐私与数据保留策略
│   ├── 23-test-samples-plan.md   # P0 测试样本计划
│   └── 24-rate-limit-rules.md    # P0 限流与验证码规则
├── web-h5/                       # Web/H5 前端工程预留目录
├── backend/                      # 后端 API / OCR 服务预留目录
└── design/                       # 设计稿、原型、物料预留目录
```

## 🛠️ 技术栈

### 前端 (web-h5/)
- **框架**: React 19 + TypeScript
- **构建工具**: Vite 6
- **路由**: React Router DOM
- **样式**: Tailwind CSS 3
- **表单**: React Hook Form
- **图标**: Lucide React

### 后端 (backend/)
- **框架**: Fastify 5
- **语言**: TypeScript
- **数据库**: PostgreSQL + Prisma ORM
- **缓存**: Redis (可选，支持内存降级)
- **AI**: SiliconFlow / QwenCloud / RuleBasedProvider (自动降级)

## 📖 快速开始

### 前置条件
- Node.js >= 20
- npm >= 10

### 开发环境运行

```bash
# 1. 安装前端依赖
cd web-h5
npm install

# 2. 安装后端依赖
cd ../backend
npm install

# 3. 启动后端服务（开发模式）
npm run dev

# 4. 启动前端服务（新开终端）
cd ../web-h5
npm run dev
```

前端访问: http://localhost:5173  
后端 API: http://localhost:3000

### AI 配置

参考文档: [docs/25-ai-provider-api-key-guide.md](docs/25-ai-provider-api-key-guide.md)

在 `backend/.env` 中配置：
```bash
# 可选：siliconflow | qwen-cloud | qwencloud | rule-based
AI_PROVIDER=siliconflow

# SiliconFlow API Key
SILICONFLOW_API_KEY=your-api-key

# QwenCloud API Key（可选）
QWENCLOUD_API_KEY=your-api-key
```

## 📦 部署指南

### 方案一：零服务器部署（推荐小白使用）

使用 **Vercel** (前端) + **Render** (后端) 的组合，无需购买服务器：

1. **前端部署到 Vercel**
   - 登录 https://vercel.com/
   - 点击 "Add New Project"
   - 选择你的 GitHub 仓库
   - 配置：Root Directory → `web-h5`, Framework Preset → Vite, Build Command → `npm ci && npm run build`, Output Directory → `dist`

2. **后端部署到 Render**
   - 登录 https://render.com/
   - 点击 "New → Web Service"
   - 选择你的 GitHub 仓库
   - 配置：Build Command → `cd backend && npm ci && npm run prisma:generate && npm run build`, Start Command → `cd backend && npm start`
   - 发布前执行：`cd backend && npm run prisma:deploy`
   - 已有旧版手工建表的数据库，先按 [部署指南](docs/26-deployment-guide.md) 完成 migration baseline
   - 必填环境变量：`DATABASE_URL`, `REDIS_URL`, `TURNSTILE_SECRET_KEY`, `AI_PROVIDER`
   - 生产保护：`REQUIRE_DATABASE=true`, `REQUIRE_REDIS=true`, `TRUST_PROXY=1`
   - 按 Provider 添加：`SILICONFLOW_API_KEY` 或 `QWENCLOUD_API_KEY`
   - 添加 `CORS_ORIGIN=https://your-vercel-project.vercel.app`，多个前端域名使用逗号分隔

3. **配置前端 API 地址**
   - 在 Vercel 项目设置中添加 `VITE_API_BASE_URL=https://your-render-service.onrender.com/api`
   - 添加 Cloudflare Turnstile 公钥：`VITE_TURNSTILE_SITE_KEY=your-site-key`

### 方案二：传统服务器部署（需要购买服务器）

详细步骤请参考：[docs/26-deployment-guide.md](docs/26-deployment-guide.md)

## 📁 目录结构

```text
joblens-miniapp-project/
├── README.md
├── docs/
│   ├── 19-api-contract.md          # P0 API 协议
│   ├── 20-ai-output-schema.md      # AI 输出 Schema
│   ├── 21-database-schema.md       # 数据库 Schema
│   ├── 22-privacy-retention-design.md # 隐私策略
│   ├── 23-test-samples-plan.md     # 测试样本计划
│   ├── 24-rate-limit-rules.md      # 限流规则
│   ├── 25-ai-provider-api-key-guide.md # AI 配置指南
│   └── 26-deployment-guide.md      # 部署指南
├── web-h5/                         # 前端工程
├── backend/                        # 后端工程
└── design/                         # 设计稿与原型
```

## 📝 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/reports/detect` | POST | 岗位风险检测 |
| `/api/reports/:id` | GET | 获取报告详情 |
| `/api/reports/:id` | DELETE | 删除报告 |
| `/api/hr-analysis` | POST | HR 回复分析 |
| `/api/ocr/extract-job` | POST | 岗位截图 OCR 提取与确认编辑前回填 |

详细文档: [docs/19-api-contract.md](docs/19-api-contract.md)

## 📄 许可证

MIT License

# 职镜 JobLens Web/H5 工程项目

`职镜 JobLens` 是一款面向求职者的岗位风险检测 Web/H5 工具。第一版聚焦“岗位信息是否透明、JD 是否存在包装、HR 是否回避关键问题、是否需要继续面试前追问”，暂不做全网岗位库、企业黑名单、复杂社区和付费会员。

## 当前项目状态

- 项目阶段：MVP 启动
- 首发端：Web + H5
- 核心输入：岗位 JD、HR 聊天记录、公司名称，P1 支持岗位截图 OCR
- 核心输出：风险分、风险等级、命中证据、缺失信息、追问问题、面试建议
- 文档状态：已完成市场调研、PRD 初稿、市场专家评审、产品专家评审、综合风险评分模型、Web/H5 UI 原型

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

P1 增强：

- 上传岗位截图识别
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
│   └── 16-deployment-cost.md     # 部署与成本评估
├── web-h5/                       # Web/H5 前端工程预留目录
├── backend/                      # 后端 API / OCR 服务预留目录
└── design/                       # 设计稿、原型、物料预留目录
```

## 下一步

建议下一步进入 Web/H5 技术选型和原型转工程：

- 明确是否使用 Next.js / Vite React / Vue
- 基于现有 H5 原型创建前端工程
- 确定 AI 风险分析 JSON 输出协议
- 确定岗位截图 OCR 是否进入 P1 版本，优先评估自建 OCR，云厂商 OCR 作为兜底
- 设计隐私说明和免责声明
- 准备 50-100 条真实岗位样本用于测试

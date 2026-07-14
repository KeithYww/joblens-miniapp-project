# JobLens 管理后台技术设计

日期：2026-07-15

## 1. API

所有接口要求 `Authorization: Bearer <ADMIN_TOKEN>`。

- `GET /api/admin/overview?days=1|7|30`
  - 返回 KPI、日趋势、风险分布、模型分布、近期报告、依赖状态和 AI 日预算。
- `GET /api/admin/reports?page=&page_size=&risk_level=&source=&query=`
  - 返回分页报告 DTO；不返回 visitor、IP、input_hash。
- `GET /api/admin/feedbacks?page=&page_size=&kind=&status=`
  - 返回两类反馈的统一 DTO。
- `PATCH /api/admin/feedbacks/:kind/:id`
  - 请求 `{status, reviewer_note}`，更新审核状态并写入安全事件。
- `GET /api/admin/security?days=1|7|30`
  - 返回 API 统计和去标识化安全事件。

## 2. 前端

- `AdminPage` 负责会话登录、四个视图、统一加载与错误状态。
- `adminApi` 使用独立 fetch 包装器，遇到 401 清除 `sessionStorage`。
- 页面不共享普通 visitor API 的请求头和错误处理逻辑。
- 图表采用 CSS 条形与趋势表，不新增图表依赖，降低包体和供应链风险。

## 3. 部署配置

- GitHub Secret：`ADMIN_TOKEN`。
- Render 环境变量：`ADMIN_TOKEN`，由 provision workflow 同步。
- 管理员本机使用 macOS Keychain 保存 Token，仓库不保存明文。

## 4. 测试策略

- 鉴权：无 Token、错误 Token、跨用途 Token、正确 Token。
- 聚合：空数据、风险分布、模型来源、成本和趋势口径。
- 列表：搜索、筛选、分页、敏感字段缺失。
- 审核：状态更新、备注、非法状态、错误类型和审计事件。
- 前端：TypeScript build、ESLint、生产构建。
- 线上：登录、总览、报告列表、反馈列表、安全页、401 隔离和部署健康。

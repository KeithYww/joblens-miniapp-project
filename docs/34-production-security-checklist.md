# JobLens 上线安全检查结果

日期：2026-07-15

范围：Vercel 前端、Render API、Render Postgres、Render Key Value、模型调用链路。

## 1. 结论

| 检查项 | 状态 | 结论 |
|---|---|---|
| API rate limiting | 通过 | IP、visitor、输入哈希短窗口限流，超限阻断或 Turnstile |
| API 防盗刷 | 通过（匿名产品边界内） | Turnstile managed、匿名/IP 日额度、全站硬预算、并发上限共同保护 |
| 大模型每日费用上限 | 通过 | Redis 原子控制每日 300 积分，Redis 故障时付费调用 fail closed |
| 高敏信息持久化 | 通过 | 文本入库前拦截；OCR 结果缓存前二次检查，命中后不缓存、不落库 |
| 数据库传输与静态加密 | 通过（平台能力） | Render Postgres 提供 TLS 传输及 AES-256 静态加密 |
| 定期备份 | 通过 | 独立备份 Token 保护每日加密业务快照，剔除 IP 后保留 14 天并校验结构与可解密性 |
| 前端错误监控 | 通过（基础版） | 捕获运行时错误和未处理 Promise，去重后上报；不上传堆栈和用户输入 |
| API 成功率监控 | 通过 | Redis 分钟桶统计，受 Bearer token 保护的内部指标接口 |
| 模型费用告警 | 通过 | 每 30 分钟巡检每日积分，达到 80% 使监控工作流失败并触发 GitHub 通知 |

## 2. API 安全边界

浏览器 SPA 中不能安全保存用于请求签名的长期密钥。把 HMAC secret 写入 Vite 环境变量或前端 JavaScript 只能制造“看起来有签名”的假安全，攻击者可以直接提取密钥。

本项目采用适合匿名公开产品的组合：

- `x-visitor-id` 只作为匿名配额标识，不作为身份认证。
- Turnstile token 在后端调用 Cloudflare `siteverify` 验证，并校验生产 hostname。
- IP、visitor 和输入内容哈希执行短窗口限流。
- 匿名 visitor 每日 3 次 AI OCR、3 次 AI 分析。
- IP 聚合额度限制 visitor 重置绕过。
- 全站每日 300 积分是费用硬上限。
- Redis 不可用时不允许新的付费模型调用。
- 模型并发总数和 OCR/文本分类并发均有限制。

若后续增加登录账户、付费功能或管理后台，必须使用服务端会话或 OAuth/JWT。不能沿用 `x-visitor-id` 作为授权凭证。

## 3. 数据安全

### 3.1 高敏数据

手机号、有效身份证号和通过 Luhn 校验的银行卡号：

1. 前端输入时实时提示，但不作为唯一防线。
2. 后端在模型调用和 PostgreSQL 写入前再次校验。
3. OCR 无法在识别前读取图片文字，因此模型返回后、Redis 缓存前再次校验。
4. 命中时只记录固定错误码，不记录原始敏感值。
5. API 日志不保存 JD、HR 对话和截图内容。

### 3.2 数据库加密

当前数据库由 Render 托管。平台提供静态 AES-256 加密，外部连接由 TLS 保护。API 使用 Render 同区域内部连接字符串，数据库凭证仅存在 Render 环境变量和受保护的部署流程中。

应用层没有字段级加密。对于当前会被定期删除的匿名 JD 数据，这是可接受的 MVP 边界；若未来保存账户、简历、合同或证据文件，必须增加字段级信封加密和密钥轮换。

### 3.3 备份

Render Free Postgres 没有平台自动备份或 PITR，因此新增 `backup-render-postgres.yml`：

- 每天北京时间 03:30 执行。
- 通过独立 `BACKUP_TOKEN` 保护的 `GET /api/internal/backup`，从 Render 私网读取未删除的核心业务数据；监控 Token 无法访问该接口。
- 快照包含岗位报告、HR 分析、面试反馈和报告纠错反馈；导出时剔除业务表 IP 字段，也不复制 API 日志与安全事件。
- 使用 AES-256-CBC、PBKDF2 200000 次迭代加密。
- 加密前核对各业务表记录数，解密后再次验证快照版本和 JSON 结构。
- 只上传加密文件和 SHA-256 校验文件，保留 14 天。

依赖 GitHub Secrets：`BACKUP_TOKEN`、`BACKUP_ENCRYPTION_PASSPHRASE`。恢复时必须使用同一加密口令，并优先导入新的空数据库验证，禁止直接覆盖生产库。该免费方案是应用级逻辑备份，不替代数据库 PITR。

## 4. 监控与告警

### 4.1 前端错误

前端监听 `error` 和 `unhandledrejection`，一分钟内相同错误只上报一次。上报字段限制为错误类型、截断消息、资源路径、页面路径和行列号；不上传堆栈、表单内容、localStorage、Cookie 或用户标识原文。

后端对上报接口继续执行 visitor/IP/内容哈希限流。消息若命中高敏检测，日志只写 `[redacted]`。

### 4.2 API 指标

Redis 按分钟记录：

- API 请求总数。
- 2xx/3xx 成功数。
- 4xx 客户端错误数。
- 5xx 服务端错误数。
- 前端错误上报数。

`GET /api/internal/metrics` 需要 `Authorization: Bearer <MONITORING_TOKEN>`，未授权返回 401。指标不包含 IP、visitor、请求正文或模型输入。

### 4.3 告警阈值

`monitor-production.yml` 每 30 分钟检查：

- Vercel 首页必须返回 200，包含正确产品标题和应用挂载节点，且引用的主 JavaScript 资源可下载。
- 健康检查必须为 200，Postgres 和 Redis 都可用。
- 30 分钟至少 10 个请求时，API 成功率不得低于 95%。
- 30 分钟 5xx 不得达到 3 次。
- 30 分钟前端错误不得达到 5 次。
- 每日 AI 积分使用率不得达到 80%。

任何阈值失败都会使 GitHub Actions 失败。仓库维护者必须开启 GitHub Actions 失败邮件通知；该通知是零成本方案的告警出口。

## 5. 运维要求

- 每月至少手工下载并验证一次加密备份。
- 每季度分别轮换 `MONITORING_TOKEN` 与 `BACKUP_TOKEN`；备份加密口令轮换前必须保留旧口令直到旧备份过期。
- 每周检查监控工作流是否按计划运行，GitHub 对长期无活动仓库可能暂停定时工作流。
- 模型供应商控制台仍应设置余额告警或小额充值，应用内 300 积分是第一道费用硬上限，供应商余额是第二道上限。
- Render Free 不具备 PITR。开始承载不可丢失的商业数据前，应升级到带 PITR 的付费数据库或迁移到提供免费备份能力的数据库平台。

## 6. 平台依据

- Render Postgres 加密与连接说明：https://render.com/docs/postgresql-creating-connecting
- Render Postgres 恢复与备份限制：https://render.com/docs/postgresql-backups
- Render 健康检查：https://render.com/docs/health-checks
- Render 通知：https://render.com/docs/notifications
- GitHub Actions artifact 保留策略：https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts

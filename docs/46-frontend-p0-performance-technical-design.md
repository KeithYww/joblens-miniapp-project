# JobLens 前端 P0 性能优化技术设计

## 1. 文档状态

- 状态：已评审通过，可进入开发
- 范围：截图上传内存、请求生命周期、管理后台查询竞态、异步资源清理、性能回归门禁
- 不涉及：视觉重构、业务功能扩展、全量状态管理替换

## 2. 背景与结论

当前前端没有证据表明存在持续增长的高危内存泄漏，但存在四类 P0 风险：

1. 首页将最多 3 张 2MB 图片并行转换为 Data URL，并长期保存在 React State；Base64、`JSON.stringify` 和 Fetch 请求体会制造多份大字符串。
2. 公共 API Client 不能同时正确处理调用方取消与超时，普通请求及管理接口缺少统一超时和取消语义。
3. 管理后台搜索每次输入都会发请求，旧请求不能取消，旧响应可以覆盖新响应。
4. FileReader、短定时器和 RAF 没有全部纳入组件卸载清理，CI 也没有前端生命周期和性能回归测试。

## 3. P0 目标与非目标

### 3.1 目标

- React State 不再保存截图 Base64。
- 截图选择、删除、识别循环后，内存不随操作次数线性增长。
- 页面卸载、查询条件变化和重复请求可以取消旧请求。
- 取消、超时、网络错误、HTTP 错误和响应解析错误具有稳定契约。
- 管理后台搜索具备防抖和 latest-wins 保证。
- 国内与全球生产环境使用同一 SHA 完成自动化和真实浏览器回归。

### 3.2 非目标

- 不引入 React Query 或其他全局请求框架。
- 不建设分片上传、断点续传或对象存储直传。
- 不使用客户端 OCR、AVIF 或强制 WebP。
- 不将 OffscreenCanvas Worker 作为 P0 主链路。
- 不在本轮进行路由懒加载、UI 重构或管理后台功能扩展。

## 4. 架构决策

### ADR-001：新增 OCR multipart v2，并统一业务操作标识

新增 `POST /api/ocr/extract-job-v2`，旧 `POST /api/ocr/extract-job` 至少保留一个完整发布周期。独立路径便于统计、灰度和回滚，也避免同一路径根据 Content-Type 产生隐藏分支。

两个 URL 必须映射到同一个规范业务操作 `OCR_OPERATION_KEY = 'ocr.extract-job'`：

- v1/v2 都先取得图片原始字节，并按上传顺序计算 `imageHashes`。
- Write Guard 使用 `ownerId + OCR_OPERATION_KEY + imageHashes + language`。
- 路径限流使用同一个 Operation Key；匿名/IP 额度和并发控制复用同一 OCR 业务管线。验证码豁免继续保持现有 visitor 级语义。
- 审计日志保留实际 URL，但实际 URL 不参与额度或重复提交分桶。
- v1/v2 共用缓存键函数和缓存 Namespace。

### ADR-002：截图 State 只保存 File/Blob 与元数据

```ts
interface ScreenshotAsset {
  id: string;
  file: File | Blob;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  originalBytes: number;
  uploadBytes: number;
  width?: number;
  height?: number;
}
```

当前界面只展示文件名，不创建预览 URL。以后若增加预览，必须在删除、替换、识别完成和卸载时调用 `URL.revokeObjectURL()`。

### ADR-003：P0 默认上传原图，不做有损压缩

- 不放大原图。
- P0 使用 `compression=none`，直接通过 multipart 上传用户选择的 PNG/JPEG/WebP File。
- 单张文件仍限制为 2MB，因此仅移除 Base64 和 JSON 副本已经可以解决主要内存峰值。
- 图片压缩作为独立且默认关闭的灰度能力，不阻塞 P0 主链路上线。
- 只有固定 OCR 对照集达到质量门槛后才允许启用；PNG 文字截图默认保持 PNG，JPEG 只降采样已有 JPEG。
- 任何压缩后体积变大、浏览器能力不足或质量未知的情况均回退原文件。

### ADR-004：统一公共与管理 API 请求内核

```ts
type RequestOptions = RequestInit & { timeoutMs?: number };
type ApiErrorKind = 'cancelled' | 'timeout' | 'network' | 'http' | 'decode';

class ClientApiError extends Error {
  kind: ApiErrorKind;
  code: string;
  status?: number;
  retryAfter?: string;
  requestId?: string;
}
```

- 调用方取消：`kind=cancelled`、`code=CLIENT_CANCELLED`，不提示、不监控、不重试。
- 客户端超时：`kind=timeout`、`code=CLIENT_TIMEOUT`。
- 服务端现有 `error/message/details/retry_after` 保持兼容。
- 超时覆盖 Fetch 和响应体解析的完整生命周期。
- 默认超时：监控 5 秒、普通 GET/Admin 15 秒、普通写请求 30 秒、风险分析 75 秒、OCR 70 秒。
- 调用方取消与超时竞争时采用“第一原因获胜”，错误类型一旦确定不可被后续事件覆盖。
- Timer 和 Signal Listener 只能在响应体读取、错误体读取和解析流程全部结束后的统一 `finally` 中清理。
- 超时覆盖 Fetch 与 Body Read；同步 JSON Parse 不承诺可取消，而通过响应体字节上限控制最坏开销。
- 禁止仅使用 `Promise.race` 而不终止底层 Fetch 或 Body Read。

### ADR-005：不直接依赖 AbortSignal.any

可以能力检测 `AbortSignal.any`，但基础路径使用兼容信号组合器：监听调用方 Signal，同时由内部 Controller 负责超时，并在请求结束后移除监听器和清理定时器。该路径覆盖旧版 iOS Safari。

### ADR-006：后台查询使用 debounce + abort + requestId

- 搜索文本使用 300ms trailing debounce。
- 风险等级、来源、日期和分页立即触发查询。
- 新请求开始前取消旧请求。
- 单调递增 requestId 再次保证只有最后请求可以提交状态。
- 取消旧请求时保留当前列表，仅显示轻量刷新状态，避免布局跳动。
- 搜索状态拆分为 `draftQuery`、`appliedQuery` 和 `committedResultKey`。
- Debounce 到期时原子设置 `appliedQuery` 与 `page=1`；筛选变化立即取消 pending debounce 并重置页码。
- 刷新期间禁用分页；只有 latest requestId 可以提交 items、total、error、401 和 loading。
- 若当前页超过新的最大页码，跳转到末页并重新请求，不提交越界空页。

## 5. OCR v2 接口

```text
POST /api/ocr/extract-job-v2
Content-Type: multipart/form-data

images=<binary>        # 重复 1 至 3 次
language=zh-CN|en-US
captcha_token=<token>  # 可选
```

前端不得手工设置 multipart `Content-Type`，必须由浏览器生成 boundary。

后端引入 `@fastify/multipart`，并使用以下唯一常量：

| 常量 | 值 |
| --- | --- |
| `MAX_FILE_BYTES` | `2 * 1024 * 1024` |
| `MAX_TOTAL_FILE_BYTES` | `6 * 1024 * 1024` |
| `MAX_MULTIPART_BODY_BYTES` | `MAX_TOTAL_FILE_BYTES + 128 * 1024` |
| `MAX_FILES` | `3` |
| `MAX_FIELDS` | `2` |
| `MAX_PARTS` | `5` |
| `MAX_FIELD_NAME_BYTES` | `32` |
| `MAX_FIELD_BYTES` | `4096` |
| `MAX_HEADER_PAIRS` | `16` |
| `MAX_IMAGE_WIDTH` | `16384` |
| `MAX_IMAGE_HEIGHT` | `16384` |
| `MAX_PIXELS_PER_IMAGE` | `20_000_000` |
| `MAX_TOTAL_PIXELS` | `40_000_000` |

限制行为：

- 全局 JSON `bodyLimit` 保持 1MB；v1 JSON OCR 和 v2 multipart 分别使用路由级上限，避免扩大其他接口攻击面。
- v2 路由级 Body Limit 严格使用 `MAX_MULTIPART_BODY_BYTES`，只用于包含 Boundary 与字段开销的提前拒绝。
- multipart 插件使用表中 files、fileSize、fields、parts、fieldSize 和 headerPairs 常量。
- 解析流时累计文件原始字节，总量超过 `MAX_TOTAL_FILE_BYTES` 立即终止流并返回 413；不能依赖 Content-Length，因为请求可能使用 Chunked 传输。
- 拒绝截断文件、重复字段、未知字段和第四个文件；不得使用无界 `toBuffer()`。
- 校验声明 MIME、文件 Magic Bytes、可解码尺寸和表中宽、高、单图像素、总像素限制，防止伪 MIME 与图片解压炸弹。
- 拒绝 Animated PNG、Animated WebP、多页图片及解码器报告的多帧输入。
- 文件超过限制时返回稳定的 400 或 413 业务错误。
- 图片原始字节只在请求生命周期内存在，不写数据库和业务日志。
- v2 加入与 v1 相同的生产依赖 Fail Closed 路由集合。

后端以图片字节哈希作为规范输入：

```ts
const imageHashes = files.map(file => sha256(file.bytes));
const visitorIdHash = hmacSha256(cacheSecret, visitorId);
const cacheKey = sha256({ visitorIdHash, imageHashes, language, model, promptVersion });
const singleflightKey = cacheKey;
const writeHash = calculateOcrWriteHash(visitorId, OCR_OPERATION_KEY, imageHashes, language);
const providerDataUrls = files.map(toProviderDataUrl);
```

v1 同步改为从解码字节计算相同的 `imageHashes`，不能继续哈希完整 Data URL 字符串。限流、验证码、匿名额度、OCR 缓存和模型并发控制必须复用同一个业务函数，禁止复制两套路由逻辑。并发 v1/v2 Cache Miss 使用 visitor-scoped Singleflight，保证同一 visitor、同一缓存键最多产生一次模型调用。仅在调用模型前创建 Provider 所需 Data URL，并在调用结束后释放引用。

固定处理顺序：

1. Write Guard 与请求频控。
2. Visitor-scoped OCR Cache。
3. Visitor-scoped Singleflight。
4. Leader 预留 AI Credit 与并发 Lease。
5. 模型调用、敏感数据检测与写缓存。
6. Follower 不重复预留 AI Credit 或并发 Lease，Leader 完成后读取缓存结果并返回最新 Quota Snapshot。

Leader 失败时 Follower 接收相同的结构化失败结果，不自动发起第二次模型调用。Singleflight Promise 和结果在请求完成后立即移除。

### 5.1 缓存隐私决策

当前跨 visitor OCR 文本缓存会把未被手机号、身份证和银行卡规则命中的姓名、邮箱、地址或聊天文本共享给相同图片的其他访客。P0 将缓存改为 visitor-scoped：

- Cache Key 与 Singleflight Key 都加入使用服务端密钥计算的不可逆 `visitorIdHash`。
- 缓存内容、TTL、删除能力和数据分类同步进入隐私文档。
- 原图、multipart 字段、Data URL 和 OCR 文本禁止进入错误日志、Trace Attribute 和安全事件详情。
- 全局图片哈希只用于不保存结果的滥用统计，不保存 Promise、OCR Result 或图片正文，也不向其他 visitor 传播结果。
- 跨 visitor Singleflight 与结果缓存均默认禁用；只有通过独立隐私、额度和并发语义评审后才能重新启用。

### 5.2 multipart 错误契约

| HTTP | 错误码 | 场景 |
| --- | --- | --- |
| 400 | `OCR_INVALID_MULTIPART` | 重复/未知字段、截断流、缺少图片或非法 Part |
| 400 | `OCR_TOO_MANY_FILES` | 第四个文件或超过 Part 上限 |
| 400 | `OCR_UNSUPPORTED_IMAGE` | MIME 与 Magic Bytes 不一致、无法解码、多帧图片 |
| 400 | `OCR_IMAGE_DIMENSIONS_EXCEEDED` | 宽、高、单图或总像素超过限制 |
| 400 | `OCR_FIELD_TOO_LARGE` | 字段名或字段值超过限制 |
| 413 | `OCR_FILE_TOO_LARGE` | 单文件超过 `MAX_FILE_BYTES` |
| 413 | `OCR_TOTAL_SIZE_EXCEEDED` | 文件总字节超过 `MAX_TOTAL_FILE_BYTES` |
| 413 | `OCR_MULTIPART_BODY_TOO_LARGE` | 完整请求体超过 `MAX_MULTIPART_BODY_BYTES` |

以上拒绝必须发生在 AI Credit 预留和模型调用之前；日志只记录错误码、尺寸区间和请求 ID，不记录文件名、字段值或图片正文。

## 6. 前端生命周期设计

### 6.1 页面请求

每个 Effect 创建独立 `AbortController`，cleanup 时取消。用户操作请求使用 ref 保存 Controller；新操作开始前取消旧操作。

```ts
useEffect(() => {
  const controller = new AbortController();
  void load({ signal: controller.signal });
  return () => controller.abort('component-unmounted');
}, [load]);
```

### 6.2 管理后台 latest-wins

```ts
const requestId = ++latestRequestId.current;
activeController.current?.abort();
const controller = new AbortController();
activeController.current = controller;

try {
  const result = await adminApi.reports(token, params, { signal: controller.signal });
  if (requestId !== latestRequestId.current) return;
  setItems(result.items);
} catch (error) {
  if (!isCancelled(error) && requestId === latestRequestId.current) {
    setError(toDisplayMessage(error));
  }
} finally {
  if (requestId === latestRequestId.current) setLoading(false);
}
```

该模式覆盖 Overview、Reports、Feedbacks、Security 和登录校验。

### 6.3 其他资源

- 截图迁移完成后删除 FileReader；迁移期保存 Reader 引用并在卸载时 `abort()`。
- 首页识别完成延时和输入框聚焦 Timer 纳入 ref 与 cleanup。
- 设置保存提示、复制提示的 Timer 重复执行前先清除，卸载时清除。
- 报告页保存 RAF ID，Effect cleanup 调用 `cancelAnimationFrame()`。
- Turnstile 卸载时调用 `remove()` 后将 widget ID 置空；使用 `!= null` 判断 ID，禁止卸载后回调写状态。

## 7. 兼容策略

- 主路径使用 `HTMLImageElement + HTMLCanvasElement.toBlob()`。
- P0 默认原图上传，不要求 Canvas；压缩灰度启用后，主兼容路径才使用 `HTMLImageElement + HTMLCanvasElement.toBlob()`。
- `createImageBitmap` 仅在能力存在时渐进增强，并捕获异常回退。
- 不要求 OffscreenCanvas。
- 不假设 Canvas 一定能导出 WebP，必须检查返回 Blob 的实际 MIME。
- 不直接依赖 `AbortSignal.any` 或 `AbortSignal.timeout`。
- 基础路径不得依赖 `AbortSignal.reason`、`crypto.randomUUID` 或 OffscreenCanvas。
- 明确 Vite Build Target 与必要 Polyfill；支持 Chrome、Edge、Firefox 当前版和 Safari 17+。
- iOS Safari 14、16.4 和 17+使用 BrowserStack、Sauce Labs 或登记真实设备验证；Playwright WebKit 不能替代旧 iOS 回归。

## 8. 工作包与实施顺序

### WP-0：测试基线

- 引入 Vitest、React Testing Library、MSW 和 Playwright Chromium。
- 固定图片 Fixture、Chromium 版本、预热步骤、GC 方法和统计口径。
- 先记录现状 API、竞态、JS Heap 与 Renderer 原生内存基线。

### WP-1：API Client 与取消语义

- 提取公共请求内核。
- 接入结构化错误、完整超时和 Signal 组合。
- 改造 H5、报告、反馈和 Admin 调用。
- 为取消、超时竞争、慢响应体、非 JSON 和 HTTP 错误补测试。

### WP-2：管理后台请求治理

- 搜索值与生效查询值分离。
- 增加 300ms 防抖。
- 所有管理查询增加 abort 和 requestId 守卫。
- 验证快速切换筛选、分页、Tab 和退出登录。

### WP-3：OCR multipart v2 后端

- 增加 multipart 插件、Schema、路由和输入校验。
- 复用 v1 的限流、验证码、成本额度、缓存和 OCR 服务。
- 增加 v1/v2 结果等价、哈希稳定性和非法文件测试。

### WP-4：截图 File/Blob 前端迁移

- State 改为 ScreenshotAsset。
- 原 File 直接使用 FormData 上传，不做默认图片压缩。
- 前端读取后端 `/api/capabilities` 的 `preferred_ocr_upload_mode` 运行时能力；不能使用只能在构建时变化的 `VITE_` 开关作为紧急回滚手段。
- v2 不可用、能力端点不可用或运行时开关关闭时回退 v1；回退只允许发生在尚未消耗模型额度的能力判断阶段，不能在未知执行结果后自动重放写请求。
- OCR 成功、删除和卸载后释放资源。

### WP-5：资源清理、压缩灰度与真实设备验证

- 清理 Timer、RAF、FileReader 和 Turnstile 生命周期。
- 在 CI 加入功能、竞态和内存回归。
- 图片压缩保持默认关闭，独立完成 OCR 质量对照后再决定是否启用。

每个工作包都必须可以独立合并、测试、发布和回滚；完成定义不要求所有工作包在同一个提交中上线。

## 9. 测试矩阵

| 领域 | 场景 | P0 门槛 |
| --- | --- | --- |
| JS 内存 | 固定 Fixture，预热后选择、删除 3 张 2MB 图片，循环 10 次并强制 GC；至少运行 3 次 | 末次相对基线增量中位数不超过 10MB，回归斜率无持续上升 |
| Renderer 内存 | 隔离 Renderer，以 RSS/cgroup 或 Chrome memory-infra 采样 Blob、Canvas 和解码内存 | 建立 20 次 CI 基线前只告警；之后以 p95 + 容差确定硬门槛 |
| 上传 | PNG/JPEG/WebP、伪 MIME、超尺寸、1 至 3 文件 | v2 与 v1 结果等价；非法输入稳定返回 400/413 |
| 边界 | 2MB+1 字节、第四文件、总量超过 6MB、超大字段、Chunked 超限、截断流 | 模型调用前返回 400/413；内存有界、无临时文件和正文日志 |
| OCR | 中英、长图、小字、聊天、宣传海报、旋转图 | 字符错误率劣化不超过 0.5 个百分点；核心字段准确率下降不超过 1 个百分点 |
| 一致性 | 同 visitor、同图不同 Base64 表示、v1/v2、并发 Cache Miss | Image Hash、Write Hash、缓存键、验证码计数和额度一致；Leader 只预留一次额度且最多一次模型调用 |
| API | 外部取消、超时、取消与超时竞争、慢响应体、非 JSON、401/429/5xx | 错误 kind/code 唯一；Timer 和 Signal listener 释放 |
| 搜索 | 快速输入 10 字、倒序响应、切筛选和分页 | 输入突发最多 initial + final 两次请求；不展示旧条件结果 |
| 生命周期 | 卸载时存在 Fetch、Timer、RAF、Turnstile | 无未处理 rejection、残留 Widget、Listener 或卸载后状态提交 |
| 浏览器 | 桌面主流浏览器及 iOS Safari 14/16.4/17+ | 旧 Safari 使用兼容路径，核心流程可用 |
| 双生产 | 全球与中国环境 | 同一 SHA，首页、OCR、取消、后台搜索和健康检查通过 |

## 10. 发布与回滚

1. 记录全球与中国环境的 Previous Good 前后端 SHA，并验证回滚产物仍可获取。
2. 先发布两环境的 additive v2 后端，`preferred_ocr_upload_mode` 仍返回 v1。
3. 运行 v2 契约、限流、缓存、验证码和隐私门禁。
4. 通过运行时能力配置依次启用全球前端和中国前端 v2，不依赖重新构建前端。
5. 两环境分别运行 v1/v2 OCR 对照及真实浏览器回归，并观察至少 48 小时的成功率、OCR 时延、413、客户端取消和模型调用率。
6. 任一环境异常时先将运行时模式切回 v1并验证，再回滚前端，最后按需回滚后端；v1 至少保留一个完整发布周期。

当前工作流会并行部署全球与中国环境，且 Vercel 主要依赖自动部署。进入 WP-3 前必须补齐指定 Vercel Deployment Promote/Rollback、国内 Previous Good 镜像检查和运行时模式切换步骤。Additive v2 与能力协商保证前后端短暂版本不一致时仍使用 v1，但发布完成仍要求两环境收敛到同一 SHA。

双环境发布门禁要求 `version.json`、`/api/health` 与 Git commit SHA 一致。任何一侧失败均不得宣告发布完成。

## 11. 完成定义

- 当前工作包及其自动化测试通过，不要求所有 WP 在同一次发布完成。
- 前端生产构建和 Lint 无新增错误。
- OCR 质量、内存、竞态和旧 Safari 回归达到测试矩阵门槛。
- 全球与中国生产环境部署相同 SHA 并完成真实浏览器回归。
- 更新 API 文档、README 和 CHANGELOG。

## 12. 独立评审记录

首次独立评审结论为“不通过”，阻断项包括：v1/v2 规范操作与哈希不一致、multipart 流式边界不完整、默认有损压缩、内存门禁不可执行、运行时回滚缺失以及跨 visitor 缓存隐私风险。

二次独立评审确认大部分阻断项已闭环，但要求进一步统一 visitor-scoped Cache/Singleflight 的键空间和 AI Credit 语义，并将 multipart 字节、字段、像素限制及错误码固化为唯一契约。本版已完成修订。

最终独立复审结论：无剩余阻断项，技术方案通过，可进入开发。

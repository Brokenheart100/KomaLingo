# KomaLingo 任务清单

> 活的清单：完成任务就把 `[ ]` 改成 `[x]`，并写明产出文件。
> 编号规则：`P{阶段}-{序号}`，编号一旦分配不再复用。
> 关联：[`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`ROADMAP.md`](./ROADMAP.md)

**图例：** `[x]` 已完成（已验证） · `[ ]` 待办 · 🔥 当前批次 · ⛔ 被依赖阻塞

---

## 阶段一：基础工程

### 批次 0 — 工程底座（已完成）

- [x] **P1-01** 初始化 WXT + Vue 3 + TypeScript 工程
  → `wxt.config.ts`、`entrypoints/`、`tsconfig.json`
- [x] **P1-02** 安装并锁定依赖（pinia / vueuse / messaging / zod / reka-ui / lucide / tailwind v4 / vitest）
  → `package.json`、`package-lock.json`
- [x] **P1-03** 配置 manifest：`permissions: ["storage"]` + `optional_host_permissions: ["<all_urls>"]`
  → `wxt.config.ts`（构建产物已验证）
- [x] **P1-04** 接入 Tailwind CSS v4 的 Vite 插件（无 config 文件）
  → `wxt.config.ts`
- [x] **P1-05** 定义设置契约：schema、默认值、`SettingsPatch`、`resolveSettings`
  → `shared/contracts/settings.ts`
- [x] **P1-06** 定义唯一消息协议 `ProtocolMap`（4 条：ping / get / patch / reset）
  → `shared/messaging/index.ts`
- [x] **P1-07** 验证链路：`vue-tsc --noEmit` 0 error、`wxt build` 成功、契约运行期冒烟 3/3 通过
- [x] **P1-08** 编写架构 / 路线图 / 任务清单文档
  → `docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`docs/TODOLIST.md`

### 批次 1 — 纯逻辑层（已完成）

- [x] **P1-09** `shared/lib/result.ts`：`Result<T,E>`、`ok()`、`err()`、`isOk()`/`isErr()`、`mapResult()`、`mapErr()`、`foldResult()`、`attempt()`
  - 已实现；纯函数、零平台依赖；随临时测试验证（13/13 通过）后删除测试文件
- [x] **P1-10** `shared/lib/concurrency-limiter.ts`：`ConcurrencyLimiter` + FIFO + `clear()` + `drain()`
  - 已实现；独立 `AbortController` 每任务、排队/执行两阶段都支持取消；`AbortTaskError` 区分取消与失败
- [x] **P1-11** `shared/storage/settings-store.ts`：`readSettings` / `writeSettings` / `patchSettings` / `resetSettings` / `watchSettings`
  - 已实现；损坏数据回退默认值并自愈；写操作经 Promise 链串行化；写入前过 schema

### 批次 2 — 消息链路（已完成）

- [x] **P1-12** `entrypoints/background.ts`：注册 `app:ping` / `settings:get` / `settings:patch` / `settings:reset`
  - 已实现：四个 handler 均返回 `MessagingResult`；非对象 patch 直接拒绝；`ZodError` 映射 `invalid-patch`，其余映射 `storage-failure`
  - 版本号取自 `browser.runtime.getManifest()`，SW 不缓存任何业务状态
- [x] **P1-13** `entrypoints/popup/`：Tailwind 入口 + 设置表单 + 连接状态
  - 已实现：`@import "tailwindcss";`、360px 宽、ping/get 并行加载、四类字段即时 patch、失败显示 `error.message`、未配置引擎时提示并跳转设置页
- [x] **P1-14** `entrypoints/options/`：完整设置页（baseUrl / model / 翻译参数 / 识别阈值 / 覆盖层）
  - 已实现：本地草稿 + 脏检查 + `toRaw()` 后过消息边界 + 保存/恢复默认
  - 偏离说明：API Key 输入**未在本阶段实现**，按 I2 设计推迟到 P3-05（`apiKey` 不进入 `Settings`）

### 批次 3 — 工程收口（已完成）

- [x] **P1-15** `vitest.config.ts`（`WxtVitest` 插件 + happy-dom）+ 4 个测试文件
  - `tests/shared/result.test.ts`（8）、`concurrency-limiter.test.ts`（9）、`settings.test.ts`（7）、`settings-store.test.ts`（10）
  - 实测 `npm run test` → **34 passed / 4 files**
- [x] **P1-16** 清理模板残留：`components/HelloWorld.vue`、`assets/vue.svg`、`public/wxt.svg` 已删除（`public/icon/` 保留，manifest 引用）
- [x] **P1-17** 重写 `README.md`（项目说明、技术栈、目录、开发命令、权限与密钥说明、文档导航）

### 批次 4 — 阶段一验收

- [ ] **P1-18** 手工冒烟：加载 `.output/chrome-mv3`，逐条核对 `ROADMAP.md` §阶段一验收标准
  - ⛔ 需要真实浏览器操作，交由项目所有者执行；自动化部分（类型检查、构建、单测）已验证
- [x] **P1-19** 存储损坏演练：由 `settings-store.test.ts` 的「存储数据损坏时回退默认值并写回修复」用例覆盖（含非法 patch 拒绝用例）
- [x] **P1-20** 更新文档：`ARCHITECTURE.md` §12、`ROADMAP.md` 阶段一状态、本清单已同步

---

## 阶段二：漫画图片识别

- [x] **P2-01** `features/manga/domain/{types,filters,ports}.ts`：`ImageCandidate` / `MangaImage` / `DetectionFilters` / `DetectionSnapshot` 类型，尺寸与比例过滤纯函数，`ImageScanner` / `ImageWatcher` 端口
- [x] **P2-02** `features/manga/infrastructure/dom-scanner.ts`：扫描 `img` / `picture` / `canvas` / 内联样式背景图；`WeakMap` 保证元素 key 稳定；`data-koma-lingo-ignore` 可排除子树
- [x] **P2-03** `features/manga/infrastructure/image-observer.ts`：`MutationObserver`（childList/subtree + src/srcset/style/class/hidden）+ document 捕获阶段 `scroll` + `resize`
  - ⚠ 偏离原计划：**未使用 `IntersectionObserver`**。改为同步 `getBoundingClientRect()` + `innerHeight` 判定视口 ±1 屏，避免异步回调把状态拆成两套；页面图片 >300 张或滚动掉帧时再评估换用 IO
- [x] **P2-04** `features/manga/application/manga-detector.ts`：按 key 去重、过滤、快照相等不重复通知，`start` / `stop` / `refresh` / `setFilters` / `subscribe`
- [x] **P2-05** `entrypoints/manga.content/index.ts`：替换模板内容脚本（旧 `entrypoints/content.ts` 已删除）；`matches: ['<all_urls>']`、`runAt: 'document_idle'`
- [x] **P2-06** Shadow DOM 控制栏：`createShadowRootUi`（`name: 'koma-lingo-ui'`、`position: 'inline'`、`cssInjectionMode: 'ui'`，构建产物自动登记 `web_accessible_resources`）
  - 说明：`position: 'overlay'` 的容器相对宿主元素绝对定位（宿主位于 body 末尾），不是视口，故改用 `inline` + 组件根节点 `position: fixed`
- [x] **P2-07** 控制栏交互：开始/停止、重新扫描、打开设置、原文/译文切换占位、翻译进度占位、引擎未配置提示、深浅色跟随系统
- [x] **P2-08** 生命周期清理：`ctx.onInvalidated` 中移除 media query 监听、取消设置订阅与 detector 订阅并 `detector.stop()`；UI 由 WXT 自动移除
- [ ] **P2-09** 冒烟：≥2 个真实站点（日漫/韩漫），图标不误判、滚动新图可发现、布局不被破坏
  - ⛔ 需要真实浏览器操作（本环境无法验证 Shadow DOM 样式注入与 fixed 定位的实际表现）
- [x] **P2-10** 单测：`tests/features/manga/` 共 38 例（filters 9 / detector 10 / scanner 9 / watcher 4 / control-bar 6），全库 72 例通过

---

## 阶段三：AI 翻译（✅ 代码完成，待真实端点冒烟）

- [x] **P3-01** `features/translation/domain/ports.ts`：`TranslationProvider` / `ImageLoader` / `TranslationCache` 接口
  - 偏离说明：原计划的 `OcrProvider` 未实现——阶段三选择"多模态一次直译"（图片直接交给视觉模型，同时完成识别与翻译），见 ARCHITECTURE ADR-11
- [x] **P3-02** `features/translation/domain/validate.ts`：坐标 clamp、文本折叠与截断、噪点框丢弃、按行 + 阅读方向排序、上限 80 条（9 例单测）
- [x] **P3-03** `shared/lib/fetch-json.ts`：单次超时 + `AbortController` + 有选择重试（429/5xx/网络/超时），`Retry-After` 封顶 10s（7 例单测）
- [x] **P3-04** `features/translation/infrastructure/openai-compatible-provider.ts`：`response_format: json_object`、去 markdown 围栏、结构校验、错误映射（13 例单测）
- [x] **P3-05** `shared/storage/credentials.ts`：Background 独占密钥，对外只回 `{ configured, maskedHint }`；Options 提供保存/清除 UI
- [x] **P3-06** `shared/storage/translation-cache.ts`：键 = `sha256(图片 key + 目标语言 + providerId + model)`，上限 60 条 / 14 天（6 例单测）
- [x] **P3-07** `features/translation/application/translate-image.ts`：读设置 → 算键 → 查缓存 → 取图 → 调用 → 清洗 → 写缓存
  - 偏离说明：Background 内没有单独的限流器；同键请求通过 in-flight 表合并，跨图并发由内容脚本侧的 `ImageTranslationRunner` 控制（每页 2 个）
- [x] **P3-08** Background 注册 `translate:image` / `translate:cancel` / `credentials:*` / `permissions:ensure-host`，取消经 `AbortController` 传到 fetch
- [x] **P3-09** 去重表：同键并发请求合并为一次付费调用，共享同一个 controller 与 promise（8 例单测）
- [x] **P3-10** 错误语义：401/403 不重试；429/5xx/网络/超时可重试（指数退避 + 抖动）；取消不重试；错误码映射到 `MessagingError.code`
- [ ] **P3-11** ⛔ 冒烟：真实端点单图跑通；取消后无后续流量；重复触发命中缓存——需真实 API Key 与浏览器，尚未执行
- [x] **P3-12** 图片加载：`FetchImageLoader` 在 Background 取图，最长边缩到 1400 / JPEG 0.82 / 12MB 上限，非 http(s) 与 `image/*` 拒绝
- [x] **P3-13** 测试：新增 7 个测试文件 / 61 例，全库 **16 文件 / 133 例通过**

---

## 阶段四：原位翻译渲染

- [ ] **P4-01** `features/overlay/domain/layout.ts`：换行 + 字号自适应 + 竖排转横排（纯函数 + 单测，重点）
- [ ] **P4-02** `features/overlay/presentation/TranslationLayer.vue`：绝对定位图层，`pointer-events` 不挡页面
- [ ] **P4-03** `features/overlay/presentation/BubbleText.vue`：溢出降级（缩字号 → 省略号）
- [ ] **P4-04** `features/overlay/presentation/use-overlay.ts`：`ResizeObserver` 同步图片缩放/滚动
- [ ] **P4-05** 原文/译文一键切换（无闪烁）
- [ ] **P4-06** 译文样式跟随 `settings.overlay`（theme / fontScale）
- [ ] **P4-07** 冒烟：缩放窗口、页面缩放、长图滚动后仍对齐；大图不掉帧

---

## 阶段五：高级能力

- [ ] **P5-01** 图像修复（Inpainting）：先云端能力，评估 LaMa / ONNX Runtime Web
- [ ] **P5-02** 本地 OCR（ONNX Runtime Web，懒加载 + 进度提示）
- [ ] **P5-03** 术语词典 + 章节上下文一致性
- [ ] **P5-04** 多语言 UI（i18n）
- [ ] **P5-05** 缓存淘汰策略（容量 / 时间）
- [ ] **P5-06** 性能专项：批处理、`createImageBitmap`、内存监控
- [ ] **P5-07** Playwright E2E：加载 → 识别 → 翻译 → 渲染 → 切换 → 缓存
- [ ] **P5-08** 发布准备：图标、隐私政策、商店文案

---

## 待决问题（需要产品/技术拍板）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| Q1 | 首个接入的服务商与模型型号？ | 决定 Provider 默认值与提示词格式 | 保持 `openai-compatible` + 用户自填 `model`，不写死型号 |
| Q2 | 翻译缓存用 IndexedDB 还是 `storage.local`？ | 容量上限与实现复杂度 | ✅ 已定：`storage.local`（60 条 / 14 天），容量不足再上 IndexedDB |
| Q3 | 图片跨域取不到时的回退策略？ | 阶段二/三的覆盖率 | Background 按 URL 取图 + `blob:` 兜底 |
| Q4 | 是否做商业化服务端代理？ | 密钥安全模型 | 第一版只做 BYOK，代理留作后续 |
| Q5 | 目标浏览器是否包含 Firefox？ | `browser` 命名空间与 manifest 差异 | WXT 已支持，但首发只验证 Chrome/Edge |

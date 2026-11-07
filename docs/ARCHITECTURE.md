# KomaLingo 架构设计

> 本文档是实现的**唯一事实来源**。改动架构必须先改这里，再改代码。
> 版本：v0.1（对应工程 `0.1.0`，第一阶段基础工程已可构建）

---

## 1. 设计不变量

以下 7 条是硬约束，任何实现、优化、重构都不得破坏。代码评审以此为准。

| # | 不变量 | 违反后果 |
|---|---|---|
| I1 | 跨上下文只走 `shared/messaging` 的 `ProtocolMap` | 协议分裂、类型漂移、难以排查 |
| I2 | `apiKey` 只存在于 Background，绝不下发 | 密钥被页面脚本或恶意扩展读取 |
| I3 | `domain` 层零框架依赖（无 Vue / WXT / chrome API） | 业务规则无法单测、无法迁移 |
| I4 | 所有外部输入先过 zod（storage、消息、AI 响应、OCR 结果） | 脏数据导致渲染崩溃 / XSS |
| I5 | 单张图片 = 一个幂等任务（可安全重发） | SW 被回收后任务丢失或重复计费 |
| I6 | 不跨上下文共享内存或 Pinia 实例 | 状态幻影、调试地狱 |
| I7 | UI 组件不直接调用 AI Provider | 组件耦合服务商、无法替换引擎 |

---

## 2. 技术栈基线

核实时间：2026-11-07（npm registry 实测）。改版本前先确认 peer 约束。

| 依赖 | 锁定版本 | 用途 | 备注 |
|---|---|---|---|
| `wxt` | 0.21.5 | 扩展框架 / MV3 构建 | Node ≥ 22；peer `vite ^6.3.4‖^7‖^8`、`typescript ≥5.4` |
| `vue` | 3.5.45 | UI 框架 | Composition API + `<script setup>` |
| `typescript` | **5.9.3** | 类型系统 | 见 ADR-03：不升 7.0 |
| `vite` | 8.3.6 | 构建器 | 由 WXT 模板提供 |
| `pinia` | 4.1.0 | 单上下文 UI 状态 | peer `vue ^3.5.11`、`typescript ≥5.6` |
| `@webext-core/messaging` | 4.0.1 | 类型化消息通信 | `defineExtensionMessaging()` |
| `zod` | 4.6.7 | 运行时校验 | 需要 v4 的 `z.url()` / `.prefault()` |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.5 | 样式 | v4 插件式，无 `tailwind.config.js` |
| `reka-ui` | 2.11.0 | 无障碍基础组件 | peer `vue ≥3.4` |
| `lucide-vue-next` | 1.0.0 | 图标 | peer `vue ≥3.0.1` |
| `@vueuse/core` | 15.0.0 | 组合式工具 | peer `vue ^3.5.0` |
| `@vitejs/plugin-vue` | 6.0.10 | SFC 编译 | Vitest 需显式加入；WxtVitest 不含 SFC 编译 |
| `vitest` / `@vue/test-utils` / `happy-dom` | 5.1.0 / 2.5.1 / 21.0.4 | 测试 | vitest peer `vite ^6.4‖^7‖^8` |
| `@playwright/test` | 1.65.0 | 端到端 | **尚未安装**，第五阶段引入 |

**WXT 0.21 的存储位置变更：** `storage` 来自 `@wxt-dev/storage`，经 `wxt/utils/storage` 再导出。旧的 `wxt/storage` 导入路径已不存在，`storage.defineItem` / `.getValue()` / `.setValue()` / `.watch()` 均可用。

---

## 3. 运行时拓扑

```
┌──────────────┐   ┌──────────────┐   ┌───────────────────┐
│    Popup     │   │   Options    │   │  Content Script    │
│  Vue + Pinia │   │  Vue + Pinia │   │ DOM + Shadow DOM   │
└──────┬───────┘   └──────┬───────┘   └─────────┬─────────┘
       │                  │                     │
       │  sendMessage     │  sendMessage        │  sendMessage
       └──────────┬───────┴─────────────────────┘
                  ▼
        ┌───────────────────────────┐   tabs.sendMessage（下行）
        │   Background (SW, 非驻留)  │──────────────────────────► Content
        │  唯一网络出口 / 唯一写设置  │
        └─────────────┬─────────────┘
                      │ fetch（host_permissions）
                      ▼
              AI Provider / 漫画图源
```

| 上下文 | 可以做的事 | 明确不可做 |
|---|---|---|
| Popup | 启停翻译、选语言/引擎、显示状态 | 不调 Provider、不持有密钥、不做长任务 |
| Options | 完整配置、缓存管理、术语词典 | 不直接写 storage（走消息，由 BG 写） |
| Content Script | DOM 扫描、观察器、裁剪图片、Shadow DOM 渲染 | 不跨域 `fetch`（受页面 CORS 限制）、不读密钥 |
| Background SW | 处理消息、发网络请求、调度队列、申请权限 | 不假设常驻；不把长任务唯一状态放内存 |

---

## 4. 分层架构

采用 **Feature-Based + 轻量 Clean Architecture + MVVM**。按业务特性切分（manga / translation / overlay / settings），每个特性内部再分四层。

### 4.1 目录

```text
KomaLingo/
├── entrypoints/                  # 组合根：只装配，不写业务
│   ├── background.ts             # ✅ SW：注册消息、读写 storage
│   ├── manga.content/            # ✅ 图片识别入口（index.ts + style.css）
│   ├── popup/                    # ✅ 快速操作面板（360px）
│   └── options/                  # ✅ 完整配置页
├── features/
│   ├── manga/
│   │   ├── domain/               # ✅ types / filters / ports（零框架依赖）
│   │   ├── application/          # ✅ manga-detector.ts：去重、过滤、订阅
│   │   ├── infrastructure/       # ✅ dom-scanner.ts、image-observer.ts
│   │   └── presentation/         # ✅ ControlBar.vue、control-bar-model.ts
│   ├── translation/
│   │   ├── domain/               # ✅ types / errors / ports / validate
│   │   ├── application/          # ✅ translate-image.ts、image-translation-runner.ts
│   │   └── infrastructure/       # ✅ openai-compatible-provider.ts、image-loader.ts
│   ├── overlay/                  # ⬜ 原位渲染、原文/译文切换（第四阶段）
│   └── settings/                 # ⬜ 设置用例与 UI 状态（当前散在 Popup/Options）
├── components/ui/                # ⬜ Reka UI 薄封装（暂未引入组件库封装）
├── shared/
│   ├── contracts/                # ✅ settings.ts、translation.ts（zod 契约）
│   ├── messaging/                # ✅ ProtocolMap + MessagingResult
│   ├── storage/                  # ✅ settings-store / credentials / translation-cache
│   └── lib/                      # ✅ Result、并发限制器、fetch-json、hash、base64、语言常量
├── tests/
│   ├── shared/                   # ✅ 7 个文件（55 用例）
│   ├── features/manga/           # ✅ 5 个文件（40 用例）
│   └── features/translation/     # ✅ 4 个文件（38 用例）
├── public/icon/                  # ✅ manifest 图标
├── docs/
├── wxt.config.ts                 # ✅
├── vitest.config.ts              # ✅ WxtVitest + @vitejs/plugin-vue + happy-dom
└── package.json                  # ✅
```

### 4.2 依赖矩阵

行 = 发起依赖的层，列 = 被依赖的层。✅ 允许，❌ 禁止。

| from \ to | domain | application | infrastructure | presentation | shared | entrypoints |
|---|---|---|---|---|---|---|
| **domain** | ✅ | ❌ | ❌ | ❌ | 仅 `shared/lib`（纯函数） | ❌ |
| **application** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **infrastructure** | ✅（实现端口） | ❌ | ✅ | ❌ | ✅ | ❌ |
| **presentation** | ✅（仅类型） | ✅ | ❌ | ✅ | ✅ | ❌ |
| **entrypoints** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**额外禁令：**

- `domain`、`application` 不得 import `vue`、`wxt/*`、`@webext-core/*`、`zod` 之外的运行时库。
- 任何层不得 import `entrypoints/*`（组合根不导出能力）。
- `presentation` 不得 import 任何具体 Provider（`features/*/infrastructure`）。
- infrastructure 之间不互相调用；横向协作一律经 application 编排。

### 4.3 各层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| **domain** | 实体、值对象、端口接口（`TranslationProvider`、`ImageLoader`、`TranslationCache`）、纯业务规则（坐标 clamp、阅读顺序、气泡适配） | IO、平台 API、UI、序列化 |
| **application** | 用例编排：发现图片 → 去重 → 入队 → 调端口 → 校验 → 缓存；重试/取消/并发策略 | 具体 HTTP 细节、DOM 操作、组件状态 |
| **infrastructure** | 端口实现：AI 调用、Canvas 处理、DOM 扫描、Storage/IndexedDB、消息适配 | 业务判断（放 application 或 domain） |
| **presentation** | Vue 组件、composables、Pinia store（仅本上下文 UI 状态） | 直接访问 chrome API、直接调 Provider |
| **entrypoints** | 实例化 infra → 注入 application → 注册消息/生命周期 | 任何业务规则 |

---

## 5. 模块职责

| 模块 | 职责 | 边界 |
|---|---|---|
| `features/manga` | 找出"这是漫画图"、给出可处理的位图与几何信息 | 不关心翻译，不负责渲染 |
| `features/translation` | 原文 → 译文的编排；引擎选择、结果校验、失败语义 | 不碰 DOM，不碰像素渲染 |
| `features/overlay` | 把 `TranslationResult` 画到页面上；样式、换行、缩放 | 不发起网络，不改设置 |
| `features/settings` | 设置读写用例、迁移、校验 | 不渲染具体页面 |
| `shared/contracts` | 跨上下文数据契约（zod schema + 类型） | 不含副作用、不含平台 API |
| `shared/messaging` | 唯一消息协议定义 | 不含业务逻辑 |
| `shared/storage` | WXT Storage 适配与迁移 | 不含业务规则 |
| `shared/lib` | Result、并发限制器、logger、id 生成 | 不含业务概念 |
| `components/ui` | Reka UI 的主题化封装（Button/Dialog/Switch…） | 不引入业务依赖 |

---

## 6. 通信设计

### 6.1 协议（当前）

定义于 `shared/messaging/index.ts`，单一 `ProtocolMap`，随功能追加，**不允许出现第二套协议**。

| 类型 | 方向 | 请求 → 响应 | 状态 |
|---|---|---|---|
| `app:ping` | 任意 → BG | `()` → `MessagingResult<PingResponse>`（`{ name, version }`） | ✅ 已实现 |
| `settings:get` | 任意 → BG | `()` → `MessagingResult<Settings>` | ✅ 已实现 |
| `settings:patch` | 任意 → BG | `SettingsPatch` → `MessagingResult<Settings>` | ✅ 已实现 |
| `settings:reset` | 任意 → BG | `()` → `MessagingResult<Settings>` | ✅ 已实现 |
| `translate:image` | Content → BG | `TranslateImagePayload` → `MessagingResult<TranslateImageResponse>` | ✅ 已实现 |
| `translate:cancel` | Content → BG | `CancelTranslationPayload` → `MessagingResult<{ cancelled: boolean }>` | ✅ 已实现 |
| `credentials:status` | Popup / Options → BG | `()` → `MessagingResult<{ configured, maskedHint }>` | ✅ 已实现 |
| `credentials:set` | Options → BG | `{ apiKey }` → `MessagingResult<{ configured, maskedHint }>` | ✅ 已实现 |
| `credentials:clear` | Options → BG | `()` → `MessagingResult<{ configured, maskedHint }>` | ✅ 已实现 |
| `permissions:ensure-host` | Content → BG | `()` → `MessagingResult<{ granted: boolean }>` | ✅ 已实现 |
| `translate:progress` | Content 内存（不跨上下文） | `ImageTranslationRunner` 进度回调 | ✅ 第四阶段前由内容脚本内部消费 |

当前消费方：`app:ping` ← Popup；`settings:get` ← Popup / Options / `manga.content`（内容脚本启动时读一次，之后靠 `watchSettings` 推送）；`settings:patch`、`settings:reset` ← Options；`credentials:status` ← Popup / Options；`credentials:set`、`credentials:clear` ← Options；`translate:image`、`translate:cancel`、`permissions:ensure-host` ← `manga.content`。

### 6.2 载荷约束

- 必须**结构化克隆可序列化**：纯对象/数组/字符串/数字/布尔/`ArrayBuffer`。禁止 `Map`、`Set`、class 实例、函数、`Proxy`（Vue reactive 对象必须先 `toRaw` 或深拷贝）。
- 大二进制（图片）优先传 `Blob`/`ArrayBuffer` 或由 BG 按 URL 自行取图；**不要**把 base64 长串塞进消息（体积膨胀约 33%，且两条边界都要解码）。
- 消息是不可信输入：BG 收到后仍须 zod 复验，不能因为"是我们自己发的"就跳过。

### 6.3 错误传递约定

`browser.runtime.sendMessage` 在 handler 抛异常时会丢失原始栈信息。因此：

> **可能失败的消息一律返回 `Result<T, E>`（`{ ok: true, value } | { ok: false, error }`），不让异常穿过消息边界。**

当前错误码：`invalid-patch`（设置载荷非法）、`invalid-payload`（翻译/凭据载荷非法）、`storage-failure`（存储读写失败）、`not-configured`（缺服务地址/模型/密钥）、`auth`、`rate-limit`、`provider-error`、`image-fetch`、`cancelled`、`unexpected`（兜底）。`auth` 等由 Provider 语义映射而来，带 `retryable` 与可选 `status`；Background 的 `toMessagingError` 负责把 `ZodError` 映射为 `invalid-patch`，`TranslationFailure` 经 `toTranslationMessagingError` 映射。

异常只用于真正的编程错误（不变量被破坏），并在 BG 侧记录日志。

### 6.4 协议演进

- 只增不改：新能力新增消息类型，不复用旧类型改变语义。
- 破坏性变更（改载荷形状）必须同步升级 `SETTINGS_VERSION` 或协议版本号，并在 `docs` 记录迁移方式。
- 删除消息类型前先确认无调用方（`grep` 全仓）。

---

## 7. 状态与持久化归属

| 状态 | 归属 | 介质 | 生命周期 | 写入者 |
|---|---|---|---|---|
| 用户设置 | 全局 | `storage.local` → `local:settings` | 永久 | **仅 Background** |
| API Key | Background 独占 | `storage.local` → `local:credentials` | 永久 | 仅 Background |
| 翻译任务进度 | 单个 tab | Content Script 内存（`ImageTranslationRunner`） | 页面刷新即失效 | Content |
| 翻译结果缓存 | 全局 | `storage.local` → `local:translation-cache`（60 条 / 14 天） | 超限或过期淘汰 | **仅 Background** |
| 页面扫描状态 | 单个 tab | Content Script 内存 | 页面刷新即失效 | Content |
| UI 状态（面板开合等） | 单上下文 | Pinia 内存 | 上下文销毁即失效 | 各自 UI |

**为什么设置只让 Background 写：** 三个上下文并发 patch 会产生丢失更新；单一写入方 + 服务端式校验（schema）是成本最低的一致性方案。

---

## 8. 核心数据流：翻译一张图

```
Content（每页）                 Background                         Provider
   │ 1. 扫描 DOM，得到候选图          │                                  │
   │ 2. Runner 取视口附近目标，        │                                  │
   │    生成 jobId，并发上限 2         │                                  │
   │ 3. translate:image ────────────►│                                  │
   │                                 │ 4. 校验载荷 + 读密钥               │
   │                                 │ 5. 按缓存键合并在途请求            │
   │                                 │ 6. 查缓存（命中直接返回）          │
   │                                 │ 7. fetch 图片（host 权限）         │
   │                                 │ 8. 结构化请求 ───────────────────►│
   │                                 │ 9. 响应 zod 校验 + 坐标 clamp ◄────│
   │                                 │ 10. 写缓存                        │
   │◄─────────── 11. Result ─────────│                                  │
   │ 12. 第四阶段：Shadow DOM 渲染译文 │                                  │
```

- **去重与合并：** 缓存键 = `sha256(图片元素 key + 目标语言 + providerId + model)`。同一页重复出现的目标按 key 去重；同键并发请求在 Background 合并为一次付费调用。图片元素 key 由 Content 侧的 `DomImageScanner` 稳定生成，**不是像素哈希**——图片内容变化但元素未换时可能命中旧缓存（已知限制）。
- **取消：** 每个在途任务持有一个 `AbortController`，`translate:cancel` → BG `abort()`，信号一路传到 `fetch`；取消不重试、不写缓存。
- **重试：** 只对 429 / 5xx / 网络中断 / 超时按 `settings.translation.maxAttempts` 指数退避 + 抖动；401/403/400 不重试，直接上报用户。
- **并发：** 跨图并发由内容脚本侧的 `ImageTranslationRunner` 控制（默认每页 2 个）；Background 不额外排队，只做在途合并。
- **缓存命中：** 命中则跳过 7–10，返回 `fromCache: true`；空结果不写缓存。

---

## 9. 安全与隐私

| 面 | 措施 |
|---|---|
| 密钥 | 仅 BG 读取；不写日志、不进消息、不进 `Settings` 快照；Options 里以 `type="password"` 输入，只显示掩码 |
| 权限 | 安装时只要 `storage`；`<all_urls>` 走 `optional_host_permissions`，用户点"开始翻译"时才申请 |
| CSP | 遵守 MV3 默认 CSP；不 `eval`、不加载远程脚本、不在 content script 里执行远端代码 |
| 不可信 DOM | 只用 `textContent`，禁用 `v-html`；URL 只接受 `http:`/`https:`/`blob:` |
| AI 输出 | 视为不可信：zod 校验结构 → 坐标 clamp 到图像范围 → 文本长度上限 → 纯文本渲染 |
| Prompt Injection | 漫画原文可能包含"忽略以上指令"之类内容。系统提示与素材严格分区，要求模型只输出 JSON schema；客户端不做模型指令解释，只按 schema 取字段 |
| 图片来源 | 拒绝 `data:` 之外的非图像 MIME；限制解码像素（`maxDecodedPixels`） |
| 日志 | 默认不记录 prompt/response 全文；调试日志需显式开关 |
| 隐私 | 图片只发往用户自己配置的端点；不上报任何遥测（除非后续明确设计并默认关闭） |

---

## 10. 性能与资源

- **图片：** 超过 `maxDecodedPixels` 先降采样；用 `createImageBitmap` + `OffscreenCanvas`（可用时）避免主线程卡顿；用完 `close()` / `width = 0` 释放。
- **观察器：** `MutationObserver` 只关心新增 `img`/`canvas`/背景图元素（属性过滤 `src`/`srcset`/`style`/`class`/`hidden`），150ms 防抖合并；滚动与 resize 事件 200ms 节流。视口判定是扫描时同步的 `getBoundingClientRect()`，不做异步可见性订阅（ADR-10）。
- **并发：** 内容脚本 `ImageTranslationRunner` 每页默认 2 个并发任务（跨图）；Background 不额外排队，只按缓存键合并在途请求。
- **缓存键：** `sha256(图片元素 key + 目标语言 + providerId + model)`；不按像素哈希，避免在 BG 重复解码整图。
- **SW 生命周期：** 单任务耗时控制在秒级；超长图先切片再分别请求（待真实端点验证）。

---

## 11. 架构决策记录（ADR-lite）

| # | 决策 | 备选 | 理由 | 影响 |
|---|---|---|---|---|
| ADR-01 | 网络请求放 Background | Content 直连 / Offscreen Document | Content 受页面 CORS 限制；BG 有 host permissions；能集中限流/超时/密钥 | BG 不能常驻，任务需幂等可重发 |
| ADR-02 | 单张图片 = 一个幂等任务 | 整章一个大任务 | SW 随时可能被回收；小任务可重试、可缓存、可并行 | 需要 jobId 与去重表 |
| ADR-03 | TypeScript 固定 5.9.3 | 最新 7.0.2 | `vue-tsc@3.3.14` 只声明 `>=5.0.0`，未验证 7.0 原生编译器；SFC 类型检查依赖 5.x 编译器 API | 升级需单独 PR 并跑通 `vue-tsc` |
| ADR-04 | Tailwind v4 用 Vite 插件 | PostCSS + v3 配置 | v4 官方推荐；无 `tailwind.config.js`；与 Vite 8 兼容 | 样式入口写 `@import "tailwindcss";` |
| ADR-05 | 单一 `ProtocolMap` | 每个特性一套 messaging | 避免协议分裂；类型集中可审计 | 新增消息必须改同一文件 |
| ADR-06 | 不引入 axios | 原生 `fetch` | MV3 下 axios 无额外收益；AbortController 原生支持 | 需自写超时/重试组合（放 `shared/lib`） |
| ADR-07 | `Settings` 不含 `apiKey` | 一并存 | 设置快照会下发到 Content，必须保证密钥不出 BG | 多一个 storage item 与读取路径 |
| ADR-08 | domain 不依赖 zod | 用 zod 定义实体 | 保持 domain 纯粹、可移植；校验放在边界层 | 需要在 application/contracts 做 schema→实体映射 |
| ADR-09 | 页面 UI 用 Shadow DOM 隔离 | iframe / 无隔离 | WXT 官方 `createShadowRootUi` 支持；避免污染宿主样式，也避免被宿主污染 | 需要 `cssInjectionMode: 'ui'`，字体/`rem` 需注意 |
| ADR-10 | 视口判定用同步 `getBoundingClientRect()` + `innerHeight` | `IntersectionObserver` | 一次扫描内同步得到结果，避免异步回调把状态拆成两套；实现更少状态、更好测 | 每次扫描读取布局，页面图 >300 张或滚动掉帧时需改回 IO |
| ADR-11 | 多模态一次直译（识别 + 翻译同一次调用） | 先本地 OCR 再文本翻译 | 一次付费调用拿到文字与气泡框；无需维护两套模型与对齐逻辑 | 识别错误与翻译错误耦合；本地 OCR、术语词典只能作为后续增强 |
| ADR-12 | 缓存键 = 元素 key + 目标语言 + providerId + model，并在途合并 | 像素哈希 / 图片 URL | 键可在 Content 与 BG 两侧稳定算出，无需解码图片；同键并发只付一次费 | 图片元素复用但内容变化时可能返回旧结果（已知限制） |

---

## 12. 当前实现状态与已知限制

**已落地（可构建、类型检查通过）：**

- [x] WXT + Vue 3 + TS 工程，`wxt build` 产出 `.output/chrome-mv3`（609.49 kB）
- [x] `manifest`：`permissions: ["storage"]`、`optional_host_permissions: ["<all_urls>"]`；`content_scripts` 匹配 `<all_urls>`（`document_idle`）；`web_accessible_resources` 含 `content-scripts/manga.css`（`use_dynamic_url`）；`options_ui.open_in_tab`
- [x] Tailwind v4 Vite 插件接入；Popup、Options、Content Script 均有 `@import "tailwindcss";` 入口
- [x] `shared/contracts/settings.ts`：完整设置 schema、默认值、`patch` 合并、`resolveSettings`；语言常量移至 `shared/lib/languages.ts`
- [x] `shared/messaging/index.ts`：`ProtocolMap` 10 条消息，统一返回 `MessagingResult`，错误码 10 种
- [x] `shared/lib/`：`result`、`concurrency-limiter`、`languages`、`language-labels`、`hash`、`base64`、`translation-limits`、`fetch-json`
- [x] `shared/storage/`：`settings-store`（串行化 + 损坏自愈）、`credentials`（BG 独占）、`translation-cache`（60 条 / 14 天）
- [x] `entrypoints/background.ts`：10 个 handler 全部注册；组装 `ImageTranslationService` + `OpenAICompatibleProvider` + `FetchImageLoader`
- [x] `features/translation/` 四层：`domain/{types,errors,ports,validate}.ts`、`application/{translate-image,image-translation-runner}.ts`、`infrastructure/{openai-compatible-provider,image-loader}.ts`
- [x] `features/manga/` 四层：`domain/{types,filters,ports}.ts`、`application/manga-detector.ts`、`infrastructure/{dom-scanner,image-observer}.ts`、`presentation/{ControlBar.vue,control-bar-model.ts}`
- [x] `entrypoints/manga.content/`：扫描 `img`/`picture`/`canvas`/内联背景图；Shadow DOM 控制栏（`position: 'inline'` + 内部 `fixed`）；开始/取消翻译、进度与错误提示；`ctx.onInvalidated` 完整清理
- [x] `entrypoints/popup/`：360px 面板（启停、语言、自动翻译、连接状态、API Key 状态、授权入口）
- [x] `entrypoints/options/`：完整设置页（翻译引擎 / API Key / 图片访问权限 / 翻译质量 / 页面识别 / 覆盖层）
- [x] `vitest.config.ts` + `tests/`：16 文件 / 133 用例（shared lib、settings、manga 四层、translation 四层）

**尚未实现（不要假设可用）：**

- [ ] 译文原位覆盖层、气泡适配、Inpainting——阶段四
- [ ] 控制栏的「原文 / 译文」切换仍是禁用占位，点击无效果
- [ ] Pinia 尚未引入任何 store（等 UI 状态真正需要时再加）
- [ ] 未对真实 AI 端点冒烟（P3-11）；阶段二的人工冒烟（P2-09）也未执行
- [ ] 图片识别不覆盖：CSS 文件里的背景图、iframe、页面内 Shadow DOM 内容、`<video>` 帧
- [ ] `<all_urls>` 的 host 权限是 optional，未授权前无法跨域取图；Popup 只能提示，不能内联编辑密钥
- [ ] 缓存键依赖页面元素 key 而非像素哈希，元素复用但图片内容变化时可能命中旧结果
- [ ] 没有术语词典、本地 OCR、令牌计数与成本统计

---

## 13. 文档维护规则

1. 新增跨上下文能力 → 同步更新 §6 协议表。
2. 新增持久化数据 → 同步更新 §7 状态表。
3. 做出与本文冲突的决定 → 先加 ADR，再改代码。
4. 阶段交付物变化 → 同步更新 `ROADMAP.md` 与 `TODOLIST.md`。

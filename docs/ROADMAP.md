# KomaLingo 开发路线图

> 与 `docs/ARCHITECTURE.md` 配套。每个阶段都有**可验证的验收标准**，不以"写完了"代替"跑通了"。
> 交付节奏：每轮最多 3 个文件，先架构说明再给代码；每阶段结束必须通过质量门禁。

---

## 质量门禁（每个阶段都必须通过）

| 检查 | 命令 | 通过标准 |
|---|---|---|
| 类型 | `npm run compile`（`vue-tsc --noEmit`） | 0 error，不允许新增 `@ts-ignore` / 类型断言掩盖 |
| 构建 | `npm run build` | 产出 `.output/chrome-mv3`，manifest 权限未意外扩大 |
| 单测 | `npm run test` | 全绿；核心业务规则必须有纯函数测试 |
| 手工冒烟 | Chrome `chrome://extensions` 加载 `.output/chrome-mv3` | 关键路径可操作，控制台无未捕获异常 |
| 文档 | —— | `ARCHITECTURE.md` 的协议表 / 状态表与实际一致 |

**准入规则：** 上一阶段未过门禁，不进入下一阶段。允许标注"已知限制"后带风险前行，但必须在 `TODOLIST.md` 记录。

---

## 阶段一：基础工程（✅ 已完成，待人工冒烟）

**目标：** 工程可开发、可构建、可加载；设置可持久化；上下文能通信。

**交付物**（全部落地）
1. WXT + Vue 3 + TS 工程 ✅
2. 依赖与构建配置 ✅
3. `shared/contracts` 设置契约 ✅
4. `shared/messaging` 协议（4 条，全部返回 `Result`）✅
5. `shared/lib/result.ts`、`shared/lib/concurrency-limiter.ts` ✅
6. `shared/storage/settings-store.ts` ✅
7. `entrypoints/background.ts` 注册 4 条消息 ✅
8. Popup：Tailwind 入口 + 设置读写 + 连接状态 ✅
9. Options 页（翻译引擎 / 翻译质量 / 页面识别 / 覆盖层四段）✅
10. `vitest.config.ts` + 4 个测试文件（34 用例）✅

**验收标准**
- [x] 类型/构建/单测门禁：`vue-tsc` 0 error、`wxt build` 成功、`vitest run` 34 passed
- [x] 存储层对非法数据回退默认值并自愈（自动化用例覆盖）
- [x] Options 与 Popup 走同一条 `settings:*` 消息链路（单一事实来源）
- [ ] **人工冒烟**：加载 `.output/chrome-mv3`，确认 Popup 显示版本号、改语言后重开仍是新值
  - 交给项目所有者执行；代码侧已具备条件，构建产物含 `popup.html` / `options.html` / `background.js`

**风险：** WXT Storage 版本行为差异（0.21 已改用 `@wxt-dev/storage`）；已通过 `wxt/utils/storage` 导入规避。

---

## 阶段二：漫画图片识别（✅ 实现完成，待人工冒烟）

**目标：** 在真实漫画站点上准确找出"需要翻译的图"，并把控制栏挂上去。

**交付物**
1. ✅ `features/manga/domain`：`types.ts` / `filters.ts` / `ports.ts`（`ImageScanner`、`ImageWatcher` 端口）
2. ✅ `features/manga/infrastructure/dom-scanner.ts`：`img` / `picture` / `canvas` / 内联背景图扫描，`WeakMap` 稳定 key
3. ✅ `features/manga/infrastructure/image-observer.ts`：`MutationObserver` + 捕获阶段 `scroll` + `resize`，150ms 防抖 / 200ms 滚动节流
   - ⚠ 偏离原计划：未用 `IntersectionObserver`，改为同步 `getBoundingClientRect()` + `innerHeight` 判定 ±1 屏（ADR-10）
4. ✅ `features/manga/application/manga-detector.ts`：去重（按元素 key）、过滤、快照相等不重复通知
5. ✅ `entrypoints/manga.content/`：Shadow DOM 控制栏（`createShadowRootUi`，`cssInjectionMode: 'ui'`，`position: 'inline'` + 内部 `fixed`）
6. ✅ 原图/译图切换开关（框架占位，阶段四接内容）

**验收标准**
- [x] 自动化：38 例单测覆盖过滤规则 / 去重 / DOM 扫描 / 观察器节流 / 控制栏交互
- [ ] 在 ≥2 个真实站点（日漫/韩漫各一）能识别主图，不把图标/头像当漫画
- [ ] 滚动加载的新图能自动被发现（MutationObserver 生效）
- [ ] 控制栏不破坏原站布局；不拦截页面滚动与点击
- [ ] 关闭/刷新页面后无监听器泄漏（`ctx.onInvalidated` 清理）

**风险：** 各站点 DOM 结构差异大 → 规则以"图片特征"为主而非站点白名单；`matches: '<all_urls>'` 会让 Chrome 安装时提示"读取所有网站数据"，需在 README 解释；跨域 `img.currentSrc` 取图可能失败，需回退到 Background 按 URL 取图。

---

## 阶段三：AI 翻译（✅ 实现完成，待真实端点冒烟）

**目标：** 打通"图片 → 文字区域 + 译文"的最小闭环，具备取消、去重、重试。

**交付物**
1. ~~`features/translation/domain/ports.ts`：`TranslationProvider`、`OcrProvider` 接口与错误类型~~ → ✅ 实际为 `TranslationProvider` / `ImageLoader` / `TranslationCache`（不做独立 OCR，见架构 ADR-11）
2. ✅ `features/translation/domain/validate.ts`：AI 输出的坐标 clamp、文本长度、阅读顺序（纯函数）
3. ✅ `features/translation/infrastructure/openai-compatible-provider.ts`：结构化 JSON 输出 + 超时 + `AbortController`
4. ✅ `features/translation/application/translate-image.ts` + `image-translation-runner.ts`：用例编排（查缓存 → 合并在途 → 取图 → 调用 → 校验 → 缓存写回）
5. ✅ `shared/storage/credentials.ts`：BG 独占的密钥读写
6. ✅ `shared/storage/translation-cache.ts`：`storage.local` 缓存（60 条 / 14 天，键含目标语言与模型）
7. ✅ Background 注册 `translate:image` / `translate:cancel` / `credentials:*` / `permissions:ensure-host`

**验收标准**
- [ ] ⛔ 配置真实端点后，单张图能返回结构化结果（原文、译文、坐标、阅读顺序）——需真实 API Key，尚未执行
- [ ] ⛔ 取消请求后不再有网络流量，UI 状态回到 idle——单测覆盖到 abort 传播，未在浏览器验证
- [x] 同一图重复触发只发一次请求（去重 + 缓存命中）——单测 8 例覆盖
- [x] 401/400 不重试并给出可读错误；429/5xx 按退避重试——单测 7 例覆盖
- [x] 模型返回非法 JSON / 越界坐标时被拦截，不污染缓存——单测覆盖
- [x] 密钥不出现在任何 Content Script 可读的位置——`credentials:status` 只回 `{ configured, maskedHint }`

**风险：** 多模态模型对**竖排日文**与**不规则气泡**的坐标精度不稳定 → 先接受粗坐标，第四阶段用调优提示 + 后处理修正；成本控制依赖缓存命中率。

---

## 阶段四：原位翻译渲染

**目标：** 译文像原生漫画一样落在气泡里，可随时切回原文。

**交付物**
1. `features/overlay/domain/layout.ts`：文本换行、字号自适应、竖排→横排转换（纯函数，重点测试）
2. `features/overlay/presentation/TranslationLayer.vue`：按坐标定位的绝对图层
3. `features/overlay/presentation/BubbleText.vue`：自动缩放 + 溢出处理
4. `features/overlay/presentation/use-overlay.ts`：图片缩放/滚动同步（`ResizeObserver`）
5. 原图/译图一键切换
6. 翻译结果缓存落盘（复用阶段三的缓存实现）

**验收标准**
- [ ] 图片缩放、窗口 resize、页面缩放后译文与气泡仍对齐
- [ ] 中文长译文不溢出气泡，字号自适应下限合理
- [ ] 切换原文/译文无闪烁、无布局跳动
- [ ] 大图（≥ 4000px 高）不造成明显掉帧或内存暴涨
- [ ] 译文渲染使用 `textContent`，不存在 `v-html`

**风险：** 极窄气泡里中文换行难看 → 提供"字号下限 + 必要时省略号"的降级策略，不追求 100% 完美。

---

## 阶段五：高级能力

**目标：** 从"能用"到"好用"：去原文、离线、术语一致、可测。

**交付物（按优先级排序，不必一次做完）**
1. 图像修复（Inpainting）：先接云端能力，再评估 LaMa / ONNX Runtime Web
2. 本地 OCR（ONNX Runtime Web，按需懒加载，不阻塞首屏）
3. 术语词典 + 章节上下文（一致性）
4. 多语言 UI（i18n）
5. 性能优化：图片批处理、缓存淘汰、内存监控
6. 完整自动化测试：Vitest 单测 + Playwright E2E

**验收标准**
- [ ] 修复后的气泡无原文残影，译文可读
- [ ] 离线模式下 OCR 可用（模型可分批下载）
- [ ] 同一角色名在整章内译法一致
- [ ] E2E 覆盖：加载 → 识别 → 翻译 → 渲染 → 切换 → 缓存命中
- [ ] 首屏注入 < 50ms，无同步大文件加载

**风险：** ONNX 模型体积大、WASM 初始化慢 → 一律懒加载 + 明确进度提示；不在 MV3 CSP 下使用 `eval`/动态 `new Function`。

---

## 里程碑视图

```
阶段一 基础工程   ████████████████  已完成（人工冒烟待补）
阶段二 图片识别   ████████████░░░░  代码完成，待真实站点冒烟
阶段三 AI 翻译    ████████████░░░░  代码完成，待真实端点冒烟
阶段四 原位渲染   ░░░░░░░░░░░░░░░░  未开始
阶段五 高级能力   ░░░░░░░░░░░░░░░░  未开始
```

具体可执行任务见 [`TODOLIST.md`](./TODOLIST.md)。

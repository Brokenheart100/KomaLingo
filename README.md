# KomaLingo 漫格译

开源的浏览器漫画翻译扩展：识别页面上的漫画图片，读出气泡里的原文，把译文**原位覆盖**回气泡区域，阅读时不必来回切换页面。

> 当前进度：**第三阶段（AI 翻译）实现完成，待真实端点冒烟**。设置读写、消息协议、Popup / Options、页面图片扫描、Shadow DOM 控制栏、多模态翻译链路（含缓存、取消、去重）已可用；译文原位渲染尚未实现（第四阶段）。

## 快速开始

1. `npm install` → `npm run build`，在 `chrome://extensions` 加载 `.output/chrome-mv3`。
2. 打开扩展的「完整设置」，填写兼容 OpenAI Chat Completions 的服务地址与视觉模型名。
3. 在同一页面保存 API Key（只写入 Background 的 `storage.local`，不随设置下发），并「授权访问图片」。
4. 打开任意漫画页面，右下角控制栏出现后点「开始翻译」。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 扩展框架 | [WXT](https://wxt.dev) 0.21 + Manifest V3 |
| UI | Vue 3.5（Composition API + `<script setup>`） |
| 语言 | TypeScript 5.9（strict，无 `any`） |
| 样式 | Tailwind CSS v4（Vite 插件，无配置文件） |
| 状态 | Pinia（仅 UI 状态）、WXT Storage（持久化） |
| 通信 | [@webext-core/messaging](https://webext-core.aklinker1.io/guide/messaging/) |
| 校验 | Zod 4 |
| 测试 | Vitest 5 + Vue Test Utils（单元）；Playwright（后续端到端） |

## 目录结构

```
entrypoints/          # WXT 入口：background / manga.content / popup / options
features/
  manga/              # 图片识别：domain / application / infrastructure / presentation
  translation/        # 翻译链路：端口、用例、Provider、取图与缓存
shared/
  contracts/          # Zod schema 与领域类型（跨上下文共享的唯一事实来源）
  lib/                # 纯函数工具：Result、并发限制器、fetch-json、hash、语言常量
  messaging/          # ProtocolMap 与类型安全的 sendMessage / onMessage
  storage/            # 存储适配层（设置、凭据、翻译缓存）
tests/                # Vitest 单元测试（16 文件 / 133 例）
docs/                 # 架构、路线图、任务清单
```

分层与依赖规则见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发

环境要求：Node.js >= 22（WXT 0.21 的最低要求）。

```bash
npm install          # 安装依赖（postinstall 会执行 wxt prepare）
npm run dev          # 启动开发模式，自动打开 Chrome 并加载扩展
npm run compile      # vue-tsc 类型检查
npm run test         # Vitest 单元测试
npm run build        # 产出 .output/chrome-mv3
```

手动加载：`chrome://extensions` → 开启开发者模式 → “加载已解压的扩展程序” → 选择 `.output/chrome-mv3`。

## 权限说明

- `storage`：保存设置（服务地址、模型名、界面偏好）、API Key（仅 Background 可读写）与翻译结果缓存。
- `content_scripts.matches: <all_urls>`：图片识别需要扫描任意站点的页面 DOM。这会让 Chrome 在安装时提示"读取和更改您在所有网站上的数据"，扩展不会上传页面内容。
- `optional_host_permissions: <all_urls>`：**默认不授予**。只有在抓取页面图片、调用用户自己配置的 AI 接口时才会向用户申请；可在 Popup / Options 里随时授权。
- API Key 不会写进设置对象，也不会下发给内容脚本；它只存放在 Background 独占的 `local:credentials` 中，界面只能看到打码后的提示（如 `sk-…abcd`）。浏览器扩展的 `storage.local` 并非加密存储，请使用限定额度、可随时吊销的密钥。

## 文档

- [架构设计](docs/ARCHITECTURE.md)：设计不变量、分层依赖矩阵、消息协议、数据流、安全边界、ADR。
- [路线图](docs/ROADMAP.md)：五个阶段的交付物、验收标准与质量门禁。
- [任务清单](docs/TODOLIST.md)：可执行的待办与待决问题。

## 许可证

尚未确定，正式发布前会补齐（计划 MIT）。

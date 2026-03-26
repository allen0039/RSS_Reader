# RSS Reader for macOS

一个为 macOS 打造的 RSS 阅读器，支持本地订阅、多个 FreshRSS 账号、AI 摘要 / 翻译 / 日报，以及更接近原生阅读器的三栏阅读体验。

> 把 RSS 当成稳定的信息输入源，把 AI 当成阅读加速器。

## 亮点

- 支持本地 RSS / Atom 订阅与多个 FreshRSS 远端账号
- 支持 OpenAI 兼容接口，内置 AI 摘要、翻译、健康检测
- 支持生成日报，并可精确选择到 FreshRSS 分类下的单个订阅源
- 支持已读同步、滚动标记、列表图文预览、图片显示控制
- 支持 Telegram 推送日报、选择性备份恢复

## 下载

- Apple Silicon: `dist/RSS-Reader-vX.Y.Z-macOS-arm64.dmg`
- Intel: `dist/RSS-Reader-vX.Y.Z-macOS-x64.dmg`

如果只是本地测试，也可以直接运行：

- `dist/mac-arm64/RSS Reader.app`
- `dist/mac/RSS Reader.app`

## 核心能力

### RSS 阅读
- 支持本地手动添加 RSS / Atom 订阅源
- 支持多 FreshRSS 账号登录
- 每个 FreshRSS 账号可作为独立远程阅读组显示
- 保留 FreshRSS 原始分类结构
- 支持分类折叠、账号折叠，界面更整洁
- 支持按分类或单个订阅源浏览文章
- 支持全文阅读与原文跳转

### 已读与阅读体验
- 支持未读 / 已读状态显示
- 支持打开文章后自动标记为已读
- 支持滚动正文后自动标记为已读
- 支持第二栏列表滚动自动标记为已读
- 支持文章图片预览
- 支持控制正文中是否显示图片
- 支持文章列表图文卡片样式展示

### AI 能力
- 支持兼容 OpenAI 格式的模型接口
- 支持配置自定义 Base URL
- 支持配置 API Key 和模型名称
- 支持文章 AI 摘要
- 支持文章 AI 翻译
- 支持 AI 健康检测，快速验证接口可用性
- 对错误接口地址有更清晰的提示（例如返回 HTML 而不是 JSON）

### 日报生成
- 支持生成 RSS 日报
- 支持从以下来源中精细选择：
  - 本地订阅源
  - FreshRSS 整个账号
  - FreshRSS 某个分类
  - FreshRSS 某个分类下的单个订阅源
- 支持 Telegram 推送日报
- 支持自定义日报摘要提示词
- 支持限制每个来源生成日报时纳入的文章数量

### 数据与配置
- 支持导入 / 导出本地订阅源
- 支持选择性备份与恢复
- 可备份：
  - 本地订阅源
  - AI 设置
  - FreshRSS 设置
  - Telegram 设置
  - 主题设置

## 为什么做这个项目

这个项目希望把传统 RSS 阅读体验和现代 AI 能力结合起来：

- 用 RSS 构建稳定、可控的信息输入源
- 用 AI 降低阅读成本，提高筛选效率
- 用 FreshRSS 提供多账号、远程同步和分组管理能力
- 在 macOS 上提供更清晰、更轻量、更适合长期使用的阅读体验

如果你日常会阅读大量博客、技术文章、新闻站点或行业更新，这个应用可以帮助你更快地完成：
- 汇总
- 翻译
- 筛选
- 跟踪
- 日报输出

## 适合谁

这个应用适合：

- 希望在 macOS 上集中阅读 RSS 的用户
- 已经在使用 FreshRSS，希望获得更接近桌面原生体验的用户
- 需要对大量文章进行快速摘要和翻译的用户
- 想把 RSS 阅读和 AI 工作流结合起来的人

## 界面结构

应用主体采用三栏布局：

- 第一栏：订阅源 / FreshRSS 分组 / 分类导航
- 第二栏：文章列表（支持图文卡片预览）
- 第三栏：文章正文阅读、AI 摘要与翻译结果

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发版

```bash
npm run start
```

### 构建 DMG

```bash
npm run dist
```

## 开发环境

### 依赖要求
- macOS
- Node.js 18+
- npm
- Xcode Command Line Tools

### 构建应用
```bash
npm run dist
```

### 单独构建平台包
```bash
npm run build:arm64
npm run build:x64
```

## AI 配置说明

应用支持兼容 OpenAI Chat Completions 格式的服务。

### 常见可用服务
- OpenAI
- Azure OpenAI（需兼容路径配置）
- DeepSeek 兼容网关
- Qwen 兼容网关
- 其他实现 OpenAI 风格 `/chat/completions` 接口的服务

### 基本配置项
- `API Base URL`
- `API Key`
- `模型名称`

### 示例
```text
API Base URL: https://api.openai.com/v1
API Key: sk-xxxx
模型名称: gpt-4o-mini
```

### 健康检测
在 AI 设置页可点击“健康检测”：
- 成功时会显示模型可访问
- 失败时会提示是认证问题、Base URL 错误，还是返回了 HTML 页面

如果你遇到类似：

```text
Unexpected token '<', "<!doctype ..." is not valid JSON
```

通常说明接口地址返回的是网页 HTML，而不是 OpenAI 兼容 JSON，优先检查 `API Base URL` 是否正确。

## FreshRSS 配置说明

### 支持能力
- 多账号登录
- 每个账号独立刷新周期
- 每个账号独立远程组名称
- 支持保留 FreshRSS 分类结构
- 支持分类折叠
- 支持实时远程刷新
- 支持已读状态回写

### 登录方式
需要填写：
- FreshRSS 地址
- 用户名
- API Password

建议使用 FreshRSS 中专门生成的 API Password，而不是网页登录密码。

### 远程模式说明
FreshRSS 内容以“远程组”方式使用：
- 不会强制同步成一份本地静态订阅列表
- 阅读时按远程内容实时刷新
- 更接近桌面端阅读器对服务端数据的直接消费方式

## 日报生成说明

日报功能支持精细来源选择。

你可以选择：
- 若干本地订阅源
- 某个 FreshRSS 账号的全部内容
- 某个 FreshRSS 分类
- 某个分类下的某一个订阅源

这意味着你可以只针对：
- 某个技术分类
- 某个新闻分类
- 某个特定博客源

来生成定向日报，而不是每次都汇总全部内容。

## 主题与阅读体验

应用内支持：
- 白色主题
- 黑色主题
- 跟随系统

此外还支持：
- 控制正文是否显示图片
- 控制是否滚动即标记为已读
- 控制第二栏滚动是否标记为已读

## 项目结构

```text
.
├── main.js
├── preload.js
├── renderer.js
├── index.html
├── style.css
├── package.json
└── dist/
```

### 主要文件说明
- `main.js`：Electron 主进程，处理数据存储、网络请求、FreshRSS、AI 调用等
- `preload.js`：向渲染层暴露安全 API
- `renderer.js`：前端交互逻辑
- `index.html`：界面结构
- `style.css`：界面样式

## 当前实现特点

- Electron 桌面应用
- 本地存储配置与订阅信息
- FreshRSS 远程数据读取与已读回写
- OpenAI 兼容接口调用
- Telegram 日报推送

## 已知说明

- 未进行 macOS Developer ID 签名时，首次打开应用可能需要在“系统设置 -> 隐私与安全性”中允许
- 某些站点的图片可能因防盗链策略无法显示
- 某些 OpenAI 兼容服务虽然路径兼容，但返回格式可能不完全一致，建议先使用“健康检测”验证

## Roadmap

后续可继续扩展的方向：

- OPML 导入 / 导出
- 文章收藏 / 星标
- 离线缓存文章全文
- 更细粒度的阅读统计
- 更强的日报模板与导出格式
- GitHub Release 自动化发布
- 应用签名与 notarization

## 许可证

如需开源发布，可在这里补充你的许可证，例如：

```md
MIT License
```

## 致谢

感谢以下项目和生态提供支持：

- Electron
- electron-builder
- rss-parser
- FreshRSS
- OpenAI-compatible API ecosystem

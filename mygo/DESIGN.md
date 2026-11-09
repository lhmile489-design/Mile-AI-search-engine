# DESIGN.md — Mile AI Search (mygo) 设计令牌

> 视觉与原项目 `docs/xhl-ai-search-main` 保持一致。权威来源：原项目 `src/app/globals.css`、`tailwind.config.ts` 实际生效的值，以及其 `DESIGN.md`。
> 原项目的 `DESIGN.md`（暖象牙底色）与 `AGENTS.md`（冷调 Apple 底色 `#FBFBFD`）互相矛盾。本项目取实际生效的组合：暖象牙底色 + 暖灰边框 + Apple Blue 交互强调 + 琥珀证据高亮。
> 所有颜色、字号、圆角、阴影、间距只能引用 `src/tokens.css` 里的变量。组件里不出现 hex、`rgb()`、任意值。
> 版本：v1.0 · 2026-11-09

---

## 1. 风格定位

温润的纸张质感，低对比、克制、偏学术期刊排版。拒绝廉价渐变、多层卡片嵌套、营销药丸徽标。动效只用 `transform` 和 `opacity`，150 到 300ms。

不实现：深色模式（变量预留同名覆盖位置，本期不做）、移动端布局（桌面应用，窗口最小 960x640）。

## 2. 颜色令牌

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--canvas` | `#FBFBFA` | 全局画布底色。mygo 窗口 `BackgroundColor` 必须与此一致，避免启动白闪 |
| `--sidebar` | `#F3F3EE` | 侧栏底色、胶囊底色、悬浮底色 |
| `--surface` | `#FFFFFF` | 卡片、搜索框、研报底色 |
| `--surface-hover` | `#EBEBE4` | 胶囊悬浮 |
| `--surface-active` | `#EAE8E1` | 选中项、侧栏当前项 |
| `--border` | `#E6E4DC` | 1px 默认分割线 |
| `--border-hover` | `#D5D3CC` | 控件悬浮边框 |
| `--border-focus` | `#B5B3AC` | 聚焦边框 |
| `--text` | `#191919` | 标题、正文、输入文字 |
| `--text-pill` | `#3D3B36` | 胶囊文字 |
| `--text-2` | `#66645E` | 次要文字、时间戳 |
| `--text-icon` | `#686660` | 图标 |
| `--text-label` | `#8E8C85` | 分组小标头、下拉箭头 |
| `--text-3` | `#9E9B93` | 占位符 |
| `--action` | `#191919` | 发送圆钮、激活胶囊 |
| `--action-hover` | `#333333` | 发送圆钮悬浮 |
| `--teal` | `#20808D` | 检索图标、品牌强调 |
| `--teal-light` | `#E6F5F6` | 强调浅底 |
| `--primary` | `#0071E3` | 角标激活、链接、聚焦环、选区 |
| `--primary-hover` | `#0077ED` | 主色悬浮 |
| `--primary-light` | `#E8F2FF` | 选中浅底、推荐行底 |
| `--evidence` | `#F59E0B` | 证据高亮 |
| `--evidence-bg` | `#FEF3C7` | 证据句子底色、原文片段底衬 |
| `--evidence-text` | `#78350F` | 证据高亮文字 |
| `--code-bg` | `#12141A` | DSL 源码视图深色底 |
| `--code-border` | `#1F2937` | DSL 源码视图边框 |
| `--code-text` | `#E5E7EB` | DSL 源码文字 |

状态与分类徽标（底、字、边三件套）：

| 语义 | 底 | 字 | 边 | 用途 |
| --- | --- | --- | --- | --- |
| blue | `#EFF6FF` | `#1D4ED8` | `#BFDBFE` | TMA / DMA 类、预印本 |
| amber | `#FFFBEB` | `#92400E` | `#FDE68A` | 同步栅障类、警告 |
| purple | `#FAF5FF` | `#7E22CE` | `#E9D5FF` | Tensor Core 类 |
| emerald | `#ECFDF5` | `#047857` | `#A7F3D0` | 完成、提速、缓存命中、共识度 |
| rose | `#FFF1F2` | `#BE123C` | `#FECDD3` | 错误、异常、降级 |

变量命名：`--badge-<语义>-bg / -fg / -border`。

对比度：`--text` 对 `--canvas` 大于 12:1；正文最低 4.5:1；`--text-3` 只用于占位符和装饰，不承载必读信息。

## 3. 字体

| 角色 | 字体栈 | 用于 |
| --- | --- | --- |
| serif | `"Newsreader", "Canela", "Georgia", "Cambria", "Times New Roman", "PingFang SC", "Microsoft YaHei", serif` | 首屏主标题，研报 H1 |
| sans | `"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 界面、按钮、正文 |
| mono | `"JetBrains Mono", "Geist Mono", "Menlo", "Monaco", "Consolas", monospace` | 快捷键提示、耗时、代码、数值 |

桌面应用离线运行，不能依赖 Google Fonts 在线加载。Newsreader、Inter、JetBrains Mono 不保证本机已装，缺失时按栈回退到系统字体。是否把这三套字体打进安装包，列为待决策项（见 `docs/mygo迁移-PRD.md`），默认不打包。

字阶（变量 `--text-*`，不允许栈外字号）：

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--fs-hero` | 36px，字重 400，行高 1.2，字距 -0.02em | 首屏主标题（serif） |
| `--fs-h1` | 28px，字重 700，字距 -0.01em | 研报标题 |
| `--fs-h2` | 20px，字重 700 | 章节标题 |
| `--fs-body` | 15px，行高 1.7 | 研报正文、搜索框输入 |
| `--fs-ui` | 13px，字重 500 | 侧栏项、胶囊、按钮 |
| `--fs-small` | 12px，字重 500 | 胶囊小字、元数据 |
| `--fs-micro` | 11px | 分组小标头、徽标、mono 标签 |

## 4. 圆角、阴影、间距

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--r-search` | 22px | 搜索框 |
| `--r-card-xl` | 24px | 工作台容器 |
| `--r-card-lg` | 20px | 研报面板、OpenUI 卡片外框 |
| `--r-card` | 16px | 信源卡片、小卡片 |
| `--r-item` | 8px | 侧栏项 |
| `--r-pill` | 9999px | 胶囊、圆钮 |

阴影只用 4 级：

| 变量 | 值 |
| --- | --- |
| `--shadow-rest` | `0 2px 12px rgba(0,0,0,0.03)` |
| `--shadow-hover` | `0 4px 16px rgba(0,0,0,0.04)` |
| `--shadow-focus` | `0 4px 24px rgba(0,0,0,0.06)` |
| `--shadow-pop` | `0 12px 36px -4px rgba(0,0,0,0.08), 0 4px 12px -2px rgba(0,0,0,0.03)` |

间距为 4px 基网：`--s-1` 4、`--s-2` 8、`--s-3` 12、`--s-4` 16、`--s-5` 20、`--s-6` 24、`--s-8` 32、`--s-12` 48。

固定尺寸：侧栏展开 240px、折叠 64px；搜索框最大宽 760px；双栏页最大宽 1040px；结果页研报与证据抽屉 60/40。

## 5. 关键组件

**搜索框（Superbar）**：白底，`--r-search` 圆角，1px `--border`。悬浮 `--border-hover` + `--shadow-hover`，聚焦 `--border-focus` + `--shadow-focus`。上区 `px-5 pt-4 pb-2`，下区操作栏 `px-3.5 pb-3 pt-1`，胶囊间距 6px。左侧：信源范围过滤按钮（32px 圆钮）、检索模式胶囊。右侧：引擎选择胶囊、发送圆钮（`--action`，32px，上箭头图标）。所有弹出菜单向下展开。

**胶囊**：`--sidebar` 底，`--text-pill` 字，`--fs-small`，悬浮 `--surface-hover`，激活 `--action` 底白字。

**侧栏**：`--sidebar` 底，分组小标头 `--fs-micro` + `--text-label`，当前项 `--surface-active`，圆角 `--r-item`。

**引用角标**：行内小圆角方块，`--primary-light` 底，`--primary` 字；激活态 `--primary` 底白字，焦点可见。

**证据抽屉**：顶部固定区（标题、分类标签）带下边线，下方独立滚动区，滚动内容不穿透顶栏。证据句子 `--evidence-bg` 底，`--evidence-text` 字。

**OpenUI 卡片**：外框 `--r-card-lg` + 1px `--border` + `--shadow-rest`；顶部控制条 `--sidebar` 底，下边线；交互视图与 DSL 源码用分段控件切换，源码视图用 `--code-*` 深色底；表头可排序，推荐行 `--primary-light` 底。

**步骤时间轴（Heron）**：序号圆标 28px，完成用 emerald 徽标色，进行中用 `--primary` 脉冲（仅 `opacity`），待处理用 `--text-3`。

## 6. 图标

只用 SVG（Lucide 线性图标，24x24 viewBox，stroke 2）。禁止 emoji，包括界面、文案、日志和文档。原项目里的 emoji 图标一律换成 SVG。

## 7. 动效

时长 150 到 300ms，缓动 `cubic-bezier(0.32, 0.72, 0, 1)`，禁止 `linear` 和 `ease-in-out`。只动 `transform`、`opacity`。必须尊重 `prefers-reduced-motion`。流式文本不加逐字动画。

## 8. 验收清单

- 组件源码里没有 hex、`rgb()`、Tailwind 任意值或行内颜色。
- 无 emoji。
- 键盘 focus 环可见（`--primary`，2px）。
- 窗口 960、1280、1440 宽度下无横向滚动。
- `prefers-reduced-motion` 下无位移动画。
- mygo 窗口 `BackgroundColor` 等于 `--canvas`，启动无白闪。

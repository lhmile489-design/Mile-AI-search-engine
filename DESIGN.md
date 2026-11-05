# DESIGN.md — 设计令牌与组件规范

> 本文件是前端视觉的**单一来源**。所有颜色、字体、圆角、阴影、间距、层级、动效都从这里取值，组件代码里不允许出现 hex 色值或游离的魔法数字。
> 视觉基线：`E:\WebApp\Claude Fable 5 Max\style-templates\pages\46-dimensional-layering.html`（46 维度分层）。
> 适用：本项目所有前端代码（Next.js + Tailwind CSS v3）。产品层面的约束见同目录 `PRODUCT.md`。
> 版本：v1.0 · 2026-11-06

---

## 0. 风格一句话

**层级即秩序。** 浅灰点阵底板上，用四级海拔阴影表达信息优先级：越重要、越临时的东西离纸面越远。顶层浮窗才使用背景模糊。整体冷静、干净，只用一个蓝色强调。

视觉指纹（缺一不可）：

1. `#F5F5F5` 底板 + 24px 点阵纹理
2. 白色表面 + 四级海拔阴影（不用边框描卡片）
3. 唯一强调色 `#2563EB`，按钮带同色投影
4. Space Grotesk 标题 + Inter 正文
5. 14px 卡片圆角、12px 控件圆角、胶囊形 chip 与 badge
6. 交互状态即海拔变化：悬停上浮、按下回落

---

## 1. 令牌总表（落地到 `app/globals.css` 的 `:root`）

下面这段是权威值。组件只能通过 `var(--*)` 或第 9 节的 Tailwind 映射引用它们。

```css
:root {
  /* ---------- 颜色：中性 ---------- */
  --bg: #F5F5F5;              /* 底板灰：页面背景 */
  --surface: #FFFFFF;         /* 表面白：卡片、面板、输入框 */
  --surface-sunk: #EDEDED;    /* 下沉表面：骨架屏、最底层卡片 */
  --layer-line: #E0E0E0;      /* 分界灰：分隔线（装饰性，不承载信息） */
  --line-input: #D2D2D2;      /* 输入框边框 */
  --track-off: #D5D5D5;       /* 开关关闭态轨道 */
  --disabled-bg: #E5E5E5;     /* 停用控件底色 */
  --ink: #17181C;             /* 顶层墨：主文字、深色徽章底 */
  --ink-soft: #4A4D57;        /* 次级文字 */
  --ink-muted: #6B7280;       /* 弱化文字：页脚、时间戳（只放在 --surface 上） */
  --ink-faint: #9A9DA6;       /* 占位符、停用文字（不得承载必要信息） */
  --on-accent: #FFFFFF;       /* 强调色上的文字 */

  /* ---------- 颜色：强调 ---------- */
  --accent: #2563EB;          /* 海拔蓝：主按钮、选中、焦点环 */
  --accent-deep: #1D4ED8;     /* 链接、悬停态、强调文字 */
  --accent-soft: #EFF6FF;     /* 图标底框、浅色徽章底 */
  --accent-soft-ink: #1E40AF; /* 浅色徽章上的文字 */
  --accent-tint-hover: rgba(37, 99, 235, .08);  /* 幽灵按钮悬停 */
  --accent-tint-press: rgba(37, 99, 235, .16);  /* 幽灵按钮按下 */

  /* ---------- 颜色：语义（模板外扩展，见 §10） ---------- */
  --success: #15803D;  --success-soft: #F0FDF4;
  --warning: #B45309;  --warning-soft: #FFFBEB;
  --danger:  #B91C1C;  --danger-soft:  #FEF2F2;
  --highlight-bg: #FEF3C7;    /* 证据高亮：琥珀底 */
  --highlight-ink: #92400E;   /* 证据高亮的边线与标注文字 */

  /* ---------- 玻璃 ---------- */
  --glass-header: rgba(255, 255, 255, .8);
  --glass-float: rgba(255, 255, 255, .65);
  --glass-edge: rgba(255, 255, 255, .8);
  --blur-amount: 8px;

  /* ---------- 底板纹理 ---------- */
  --dot-color: rgba(23, 24, 28, .06);
  --dot-gap: 24px;

  /* ---------- 海拔阴影 ---------- */
  --elevation-1: 0 1px 3px rgba(0, 0, 0, .1);
  --elevation-2: 0 4px 6px rgba(0, 0, 0, .1);
  --elevation-3: 0 10px 20px rgba(0, 0, 0, .1);
  --elevation-4: 0 20px 40px rgba(0, 0, 0, .15);
  --elevation-top-edge: 0 -1px 3px rgba(0, 0, 0, .06);   /* 底部固定条 */
  --shadow-accent-rest:  0 6px 16px rgba(37, 99, 235, .35);
  --shadow-accent-hover: 0 12px 26px rgba(37, 99, 235, .4);
  --shadow-accent-press: 0 3px 8px rgba(37, 99, 235, .35);
  --shadow-inset-input: inset 0 1px 2px rgba(0, 0, 0, .05);
  --shadow-inset-track: inset 0 1px 3px rgba(0, 0, 0, .15);
  --ring-focus-soft: 0 0 0 3px rgba(37, 99, 235, .25);    /* 输入框聚焦光晕 */

  /* ---------- 圆角 ---------- */
  --radius-xs: 6px;      /* 小标签、焦点环 */
  --radius-sm: 8px;      /* 品牌方块 */
  --radius-md: 12px;     /* 按钮、输入框、图标底框、色卡 */
  --radius: 14px;        /* 卡片、面板、层叠卡 */
  --radius-pill: 999px;  /* chip、badge、开关 */

  /* ---------- 字体 ---------- */
  --font-display: var(--font-space-grotesk, 'Space Grotesk'), 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --font-body: var(--font-inter, 'Inter'), 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --font-mono: var(--font-jetbrains-mono, 'JetBrains Mono'), 'Cascadia Code', Consolas, monospace;

  /* ---------- 字号 ---------- */
  --text-xs: 12px;       /* 小标签、层级角标 */
  --text-sm: 13px;       /* badge、元信息、页脚 */
  --text-label: 14px;    /* 表单标签、chip、eyebrow */
  --text-ui: 15px;       /* 按钮、导航、卡片正文 */
  --text-base: 16px;     /* 正文、输入框 */
  --text-lg: 18px;       /* 卡片标题 h3 */
  --text-xl: 25px;       /* 区块标题 */
  --text-2xl: clamp(24px, 3.5vw, 31px);  /* h2 */
  --text-display: clamp(32px, 5.2vw, 50px);  /* h1 */

  --leading-body: 1.6;
  --leading-heading: 1.18;
  --leading-display: 1.15;
  --tracking-eyebrow: .06em;
  --tracking-meta: .08em;
  --tracking-label-caps: .14em;

  /* ---------- 间距（4px 刻度） ---------- */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 20px;  --space-6: 24px;  --space-7: 28px;  --space-8: 32px;
  --space-12: 48px; --space-16: 64px; --space-20: 80px;

  /* ---------- 布局 ---------- */
  --container: 1060px;      /* 通用内容宽 */
  --gutter: 20px;           /* 容器左右内边距 */
  --w-command: 760px;       /* 首屏命令台（产品扩展） */
  --w-pipeline: 1040px;     /* 检索推理态（产品扩展） */
  --w-workbench: 1280px;    /* 结果工作台（产品扩展） */
  --w-sidebar: 260px;       /* 历史侧边栏展开（产品扩展） */
  --w-sidebar-compact: 68px; /* 历史侧边栏收起（产品扩展） */
  --measure: 60ch;          /* 正文最大行宽 */
  --measure-lead: 48ch;     /* 导语最大行宽 */

  /* ---------- 层级 z-index ---------- */
  --z-layer-1: 1; --z-layer-2: 2; --z-layer-3: 3; --z-layer-4: 4;  /* 组件内层叠 */
  --z-sticky: 50;    /* 侧边栏、吸顶工具条 */
  --z-header: 60;    /* 顶栏 */
  --z-drawer: 70;    /* 覆盖式抽屉 + 遮罩 */
  --z-modal: 80;     /* 对话框 */
  --z-toast: 90;     /* 提示条 */

  /* ---------- 动效 ---------- */
  --duration-fast: 200ms;   /* 按钮、开关、输入框 */
  --duration-base: 250ms;   /* 卡片、色卡、抽屉 */
  --ease: ease;
}
```

---

## 2. 颜色使用规则

### 2.1 角色分配

| 场景 | 令牌 |
| --- | --- |
| 页面背景 | `--bg` + 点阵纹理 |
| 卡片、面板、输入框、抽屉 | `--surface` |
| 骨架屏、占位块 | `--surface-sunk` |
| 主文字、标题 | `--ink` |
| 描述、导语、卡片正文 | `--ink-soft` |
| 时间戳、页脚、辅助说明 | `--ink-muted`（只放在白色表面上） |
| 链接、悬停文字、强调字 | `--accent-deep` |
| 主按钮、选中态、开关开启、焦点环 | `--accent` |
| 代码块、深色徽章底 | `--ink` 底 + `--on-accent` 字 |

### 2.2 对比度实测（WCAG 2.x）

| 组合 | 对比度 | 结论 |
| --- | --- | --- |
| `--ink` / `--surface` | 17.74 | 通过 |
| `--ink` / `--bg` | 16.27 | 通过 |
| `--ink-soft` / `--surface` | 8.43 | 通过 |
| `--ink-soft` / `--bg` | 7.73 | 通过 |
| `--ink-muted` / `--surface` | 4.83 | 通过 |
| `--ink-muted` / `--bg` | 4.43 | **不通过**，`--bg` 上禁止放 `--ink-muted` 正文 |
| `--accent` / `--surface` | 5.17 | 通过 |
| `--on-accent` / `--accent` | 5.17 | 通过 |
| `--on-accent` / `--accent-deep` | 6.70 | 通过 |
| `--accent-deep` / `--bg` | 6.15 | 通过 |
| `--accent-soft-ink` / `--accent-soft` | 8.01 | 通过 |
| `--ink` / `--highlight-bg` | 15.93 | 通过 |
| `--highlight-ink` / `--highlight-bg` | 6.37 | 通过 |
| `--success` / `--surface` | 5.02 | 通过 |
| `--success` / `--success-soft` | 4.79 | 通过 |
| `--warning` / `--surface` | 5.02 | 通过 |
| `--warning` / `--warning-soft` | 4.84 | 通过 |
| `--danger` / `--surface` | 6.47 | 通过 |
| `--danger` / `--danger-soft` | 5.91 | 通过 |
| `--ink-faint` / `--surface` | 2.71 | 只用于占位符和停用态 |
| `#FFFFFF` / `#3B82F6` | 3.68 | **不通过**，模板里这个组合不纳入令牌 |

### 2.3 禁止

- 组件里写 hex、`rgb()`、Tailwind 任意值色（如 `bg-[#1D1D1F]`）。
- 第二个强调色。语义色（成功/警告/危险/高亮）只用于表达状态，不能当装饰色。
- 渐变。唯一允许的 `radial-gradient` 是底板点阵。
- 纯黑硬阴影，或自行拼写阴影值。阴影只用 §1 里的令牌。

---

## 3. 海拔系统（核心）

### 3.1 四级海拔与用途

| 级别 | 令牌 | 视觉 | 本项目用途 |
| --- | --- | --- | --- |
| 0 | 无 | 贴在底板上 | 页面背景、区块标题、正文段落 |
| 1 | `--elevation-1` | 贴地 | 顶栏、chip、badge、输入框、图标底框、侧边栏历史条目 |
| 2 | `--elevation-2` | 常规卡片 | 信源卡片、OpenUI 卡片、步骤时间轴面板、研报正文面板 |
| 3 | `--elevation-3` | 浮起 | Superbar 搜索框、表单面板、证据抽屉（桌面内嵌）、次按钮悬停态 |
| 4 | `--elevation-4` | 悬空 | 覆盖式抽屉、对话框、提示条、下拉菜单、可点击卡片悬停态 |

### 3.2 规则

1. **海拔表达优先级，不表达装饰。** 同一视图里同级信息用同一海拔。
2. **嵌套时海拔不降级也不重复叠卡片。** 面板里的子项用分隔线（`1px solid var(--layer-line)`）或 `--surface-sunk` 区块分组，不要在 elevation-2 面板里再放 elevation-2 卡片。
3. **卡片靠阴影成形，不加边框。** 唯一例外是 elevation-4 玻璃浮窗的 `1px solid var(--glass-edge)` 亮边。
4. **背景模糊只给固定或吸顶元素**：顶栏、提示条、小型浮窗。长文本容器（研报、证据抽屉）一律用实色 `--surface`，保证可读。
5. 只有**可点击**的卡片才有悬停上浮。不可点击的卡片保持静止，避免误导用户以为能点。

### 3.3 玻璃配方

```css
/* 顶栏 */
background: var(--glass-header);
backdrop-filter: blur(var(--blur-amount));
box-shadow: var(--elevation-1);

/* 顶层浮窗（提示条、小浮窗） */
background: var(--glass-float);
backdrop-filter: blur(var(--blur-amount));
border: 1px solid var(--glass-edge);
box-shadow: var(--elevation-4);
```

### 3.4 底板纹理

```css
body {
  background-color: var(--bg);
  background-image: radial-gradient(var(--dot-color) 1px, transparent 1px);
  background-size: var(--dot-gap) var(--dot-gap);
}
```

---

## 4. 字体

### 4.1 字族

| 用途 | 字族 | 字重 |
| --- | --- | --- |
| 标题 h1–h3、品牌、层级角标 | `--font-display`（Space Grotesk） | 500 / 700 |
| 正文、按钮、表单、导航 | `--font-body`（Inter） | 400 / 500 / 600 / 700 |
| 代码、DSL 源码、耗时数字、URL | `--font-mono`（JetBrains Mono） | 400 / 500 |

- Space Grotesk 和 Inter 都没有中文字形，中文会落到回退字体（PingFang SC / Microsoft YaHei / Noto Sans SC）。这是预期行为，不要为中文另配网络字体。
- Next.js 用 `next/font/google` 加载 `Space_Grotesk`（500、700）、`Inter`（400–700）、`JetBrains_Mono`（400、500），通过 `variable` 选项注入到 `--font-*`，不要用 `<link>` 标签。
- 耗时、计数、分数这类会跳动的数字加 `font-variant-numeric: tabular-nums`，防止宽度抖动。

### 4.2 字阶

| 级别 | 字族 / 字重 | 字号 | 行高 | 用法 |
| --- | --- | --- | --- | --- |
| Display | display 700 | `--text-display` | 1.15 | 首屏主标题（全站最多一处） |
| H2 | display 700 | `--text-2xl` | 1.18 | 区块标题，下方带 52×5px 强调条 |
| Title | display 700 | `--text-xl` | 1.18 | 研报标题、抽屉标题 |
| H3 | display 700 | `--text-lg` | 1.18 | 卡片标题 |
| Body | body 400 | `--text-base` | 1.6 | 正文、研报段落 |
| Body-sm | body 400 | `--text-ui` | 1.6 | 卡片描述、列表正文 |
| UI | body 600 | `--text-ui` | 1.2 | 按钮、导航 |
| Label | body 600 | `--text-label` | 1.4 | 表单标签、chip、eyebrow |
| Meta | body 600 | `--text-sm` | 1.4 | badge、时间戳；全大写时字距 `--tracking-meta` |
| Tag | body 700 | `--text-xs` | 1.2 | 层级角标、小标签 |

H2 强调条：

```css
h2 { position: relative; display: inline-block; }
h2::after {
  content: ""; position: absolute; left: 0; bottom: -6px;
  width: 52px; height: 5px; border-radius: 3px;
  background: var(--accent); box-shadow: var(--elevation-2);
}
```

---

## 5. 间距、圆角、布局

### 5.1 间距

只用 `--space-*` 刻度。常用组合：

| 场景 | 值 |
| --- | --- |
| 区块上下内边距 | `--space-16`（首屏 `--space-20` / `--space-16`） |
| 卡片、面板内边距 | `--space-7` 上下 × `--space-6` 左右 |
| 卡片网格间距 | `--space-5` |
| 面板内部行间距 | `--space-6` |
| 控件行内间距 | `--space-3` |
| 表单字段间距 | `--space-4`；标签与输入框 `--space-2` |
| 区块标题 → 说明文字 | `--space-5` |
| 说明文字 → 内容 | `--space-7` |

### 5.2 布局与断点

| 断点 | 宽度 | 行为 |
| --- | --- | --- |
| 基础 | < 760px | 全部单列；容器内边距 `--gutter` |
| sm | ≥ 760px | 卡片三列、表单两列 |
| md | ≥ 900px | 首屏左右两栏 |
| lg | ≥ 1024px | 结果工作台 60/40 双栏；证据抽屉内嵌。低于此宽度时抽屉改为覆盖式 |

375 / 768 / 1024 / 1440 四个宽度下都不能出现横向滚动。

---

## 6. 组件规范

### 6.1 按钮

| 变体 | 静止 | 悬停 | 按下 |
| --- | --- | --- | --- |
| 主按钮 | `--accent` 底、`--on-accent` 字、`--shadow-accent-rest` | 底色 `--accent-deep`、上移 2px、`--shadow-accent-hover` | 回到原位、`--shadow-accent-press` |
| 次按钮 | `--surface` 底、`1px solid var(--layer-line)`、`--elevation-1` | 上移 2px、`--elevation-3` | 回到原位、`--elevation-1` |
| 幽灵按钮 | 透明底、`--accent-deep` 字 | `--accent-tint-hover` | `--accent-tint-press` |
| 停用 | `--disabled-bg` 底、`--ink-faint` 字、无阴影、`cursor: not-allowed`、不位移 | — | — |

共同属性：`--font-body` 600、`--text-ui`、内边距 `--space-3` × `--space-6`、圆角 `--radius-md`。只有图标的按钮必须有 `aria-label`，点击区域不小于 40×40px。

### 6.2 输入框与 Superbar

- 普通输入框：`--surface` 底、`1px solid var(--line-input)`、`--radius-md`、内边距 `--space-3` × `--space-4`、`--text-base`、`--shadow-inset-input`。
- 聚焦：边框 `--accent`，阴影 `var(--ring-focus-soft), var(--elevation-1)`，去掉默认 outline。
- 占位符 `--ink-faint`。每个输入框都要有可见的 `<label>`，或在 Superbar 上用 `aria-label`。
- **Superbar**（首屏主搜索框）：外层是 elevation-3 面板，圆角 `--radius`；内部 `textarea` 自动增高，右下角放主按钮。聚焦时面板阴影保持 elevation-3，并叠加 `--ring-focus-soft`。

### 6.3 卡片与面板

- 卡片：`--surface`、`--radius`、内边距 §5.1、`--elevation-2`。可点击卡片悬停时上移 6px、升到 `--elevation-4`。
- 面板（表单、Superbar、控制区）：同卡片，但用 `--elevation-3`，内部用 grid，间距 `--space-6`。
- 图标底框：46×46px、`--radius-md`、`--accent-soft` 底、`--accent-deep` 图标色、`--elevation-1`。

### 6.4 chip、badge、eyebrow

- chip：`--surface`、`--radius-pill`、内边距 `--space-2` × `--space-4`、`--text-label`、`--ink-soft` 字、`--elevation-1`；强调字用 `--accent-deep` 600。可点击的 chip（推荐问题）悬停时上移 2px、升到 `--elevation-2`。
- badge：`--accent-soft` 底、`--accent-soft-ink` 字、`--text-sm` 600、`--radius-pill`、`--elevation-1`，左侧 7px 圆点用 `currentColor`。深色变体：`--ink` 底、`--on-accent` 字。
- eyebrow：`--surface` 底、`--accent-deep` 字、`--text-label` 600、字距 `--tracking-eyebrow`、`--radius-pill`、`--elevation-1`。

### 6.5 开关

轨道 50×28px、`--radius-pill`、关闭态 `--track-off` + `--shadow-inset-track`、开启态 `--accent`。滑块 22px 白色圆 + `--elevation-2`，开启时 `translateX(22px)`。用原生 `<input type="checkbox" role="switch">`，焦点环画在轨道上。

### 6.6 焦点

全站统一：`:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-xs); }`。输入框例外，见 §6.2。不允许 `outline: none` 后不给替代样式。

### 6.7 图标

- 用 Lucide（`lucide-react`）。线条风格：24×24 viewBox、`stroke-width: 2`、圆角端点。
- 尺寸：行内 16px；独立按钮 20px；图标底框 22px。
- 颜色继承 `currentColor`。装饰性图标加 `aria-hidden="true"`。
- **禁止 emoji**，包括按钮文字、提示条、占位符、空状态。

---

## 7. 搜索引擎专属组件

这些组件模板里没有，按 §3 海拔规则和上面的基础组件组合出来。

| 组件 | 海拔 / 外观 | 要点 |
| --- | --- | --- |
| 顶栏 | 玻璃顶栏、`--z-header` | 左侧品牌方块（32px、`--radius-sm`、`--accent` 底、`--elevation-2`），右侧侧边栏开关 |
| 历史侧边栏 | `--surface`、`--elevation-1`、`--z-sticky` | 条目之间用分隔线；当前条目 `--accent-soft` 底 + `--accent-deep` 字 |
| 推荐问题 | 可点击 chip | 点击即发起检索，不能只填进输入框不提交（除非明确标注“填入”） |
| HeronStepper 步骤时间轴 | elevation-2 面板 | 竖线 `2px var(--layer-line)`；节点 10px 圆点。等待 `--ink-muted`、进行中 `--accent`、完成 `--success`、失败 `--danger`。耗时用 `--font-mono` + tabular-nums，右对齐 |
| LiveSourceRadar 信源抓取 | elevation-2 面板 | 每个信源一行：favicon 16px、域名（mono）、分类 badge、状态点。未到达的行用 `--surface-sunk` 骨架块 |
| 研报正文 | elevation-2 面板 | 行宽 `--measure`；h2/h3 用 display 字族；代码块 `--ink` 底；表格行用分隔线，不用斑马纹 |
| 引用角标 `[n]` | 小号 badge | `--accent-soft` 底、`--accent-soft-ink` 字、`--text-xs` 700、`--radius-xs`，用 `<button>` 可键盘聚焦；激活时 `--accent` 底 + `--on-accent` 字 |
| 证据抽屉 | 桌面 elevation-3 内嵌；< 1024px 覆盖式 elevation-4、`--z-drawer` | 实色底，不用玻璃。被引用句子用高亮配方（见下） |
| OpenUI 交互卡片 | elevation-2 卡片 | 右上角分段切换“交互视图 / DSL 源码”，用次按钮组；源码视图 `--ink` 底 + mono |
| 推演全景观测台 | elevation-3 面板 | 阶段耗时用水平条，填充 `--accent`，轨道 `--surface-sunk`；数字 mono |
| 提示条 | 顶层浮窗玻璃、`--z-toast` | 左侧语义色图标；3–5 秒自动消失，可手动关闭 |
| 空状态 / 错误态 | 无海拔，居中 | 一个 Lucide 图标 + 一句原因 + 一个可执行的按钮 |

证据高亮配方：

```css
.evidence-mark {
  background: var(--highlight-bg);
  color: var(--ink);
  box-shadow: inset 2px 0 0 var(--highlight-ink);
  border-radius: 2px;
  padding: 0 2px;
}
```

---

## 8. 动效

- 时长只用 `--duration-fast`（200ms）和 `--duration-base`（250ms），缓动 `--ease`。
- **只对 `transform` 和 `opacity` 做过渡。** 模板里阴影和背景色的过渡要改写：把目标阴影或目标底色放在伪元素上，过渡伪元素的 `opacity`。

```css
.lift { position: relative; transition: transform var(--duration-base) var(--ease); }
.lift::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: var(--elevation-4); opacity: 0; pointer-events: none;
  transition: opacity var(--duration-base) var(--ease);
}
.lift:hover { transform: translateY(-6px); }
.lift:hover::after { opacity: 1; }
```

- 位移幅度：按钮 2px、chip 2px、卡片 6px、色卡 4px。
- 模板 hero 里 6 秒循环的 `floaty` 漂浮动画**不进产品**。检索进行中的状态用步骤节点和骨架表达，不用无限循环的装饰动画。
- Framer Motion 只用于进出场（opacity + y 位移 ≤ 8px），不做弹簧夸张效果。
- `prefers-reduced-motion: reduce` 下关闭全部动画和过渡，`scroll-behavior` 改为 `auto`。

---

## 9. Tailwind v3 映射（`tailwind.config.ts`）

组件里用这些类名，背后指向 CSS 变量。不允许写任意值（`[#...]`、`[13px]`）。

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', sunk: 'var(--surface-sunk)' },
        line: { DEFAULT: 'var(--layer-line)', input: 'var(--line-input)' },
        ink: {
          DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)', faint: 'var(--ink-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)', deep: 'var(--accent-deep)',
          soft: 'var(--accent-soft)', 'soft-ink': 'var(--accent-soft-ink)',
          on: 'var(--on-accent)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        highlight: { bg: 'var(--highlight-bg)', ink: 'var(--highlight-ink)' },
      },
      boxShadow: {
        e1: 'var(--elevation-1)', e2: 'var(--elevation-2)',
        e3: 'var(--elevation-3)', e4: 'var(--elevation-4)',
        'accent-rest': 'var(--shadow-accent-rest)',
        'accent-hover': 'var(--shadow-accent-hover)',
        'accent-press': 'var(--shadow-accent-press)',
        'inset-input': 'var(--shadow-inset-input)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        card: 'var(--radius)', pill: 'var(--radius-pill)',
      },
      fontFamily: {
        display: 'var(--font-display)', body: 'var(--font-body)', mono: 'var(--font-mono)',
      },
      fontSize: {
        xs: 'var(--text-xs)', sm: 'var(--text-sm)', label: 'var(--text-label)',
        ui: 'var(--text-ui)', base: 'var(--text-base)', lg: 'var(--text-lg)',
        xl: 'var(--text-xl)', '2xl': 'var(--text-2xl)', display: 'var(--text-display)',
      },
      spacing: {
        1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)', 4: 'var(--space-4)',
        5: 'var(--space-5)', 6: 'var(--space-6)', 7: 'var(--space-7)', 8: 'var(--space-8)',
        12: 'var(--space-12)', 16: 'var(--space-16)', 20: 'var(--space-20)',
      },
      maxWidth: {
        container: 'var(--container)', command: 'var(--w-command)',
        pipeline: 'var(--w-pipeline)', workbench: 'var(--w-workbench)',
        measure: 'var(--measure)', lead: 'var(--measure-lead)',
      },
      zIndex: {
        sticky: 'var(--z-sticky)', header: 'var(--z-header)', drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)', toast: 'var(--z-toast)',
      },
      transitionDuration: { fast: 'var(--duration-fast)', base: 'var(--duration-base)' },
      screens: { sm: '760px', md: '900px', lg: '1024px', xl: '1440px' },
    },
  },
  plugins: [],
} satisfies Config
```

---

## 10. 相对模板的调整（需知悉）

模板是一张展示页，产品化时做了以下调整。改动都已体现在 §1 的令牌里。

1. **间距取整到 4px 刻度。** 模板里的 62px、13px、7px、9px 等就近取 64、12、8、8。视觉差异不超过 2px。
2. **半像素字号取整。** 13.5px → 14px（`--text-label`），15.5px → 15px（`--text-ui`），11.5px → 12px（`--text-xs`）。
3. **新增模板没有的令牌：** 语义色（成功/警告/危险）、证据高亮琥珀色、等宽字体、中文回退字体、z-index 分层、三个产品布局宽度。全部过了 §2.2 的对比度检查。
4. **去掉的组合：** 白字配 `#3B82F6`（对比度 3.68，不达标）、hero 的 `floaty` 循环动画。
5. **阴影和颜色的过渡**改成伪元素 + opacity，以符合“动效只用 transform / opacity”的约束。

---

## 11. 未定事项

| 事项 | 现状 | 需要谁决定 |
| --- | --- | --- |
| 深色模式 | 模板只有浅色，本期不做。以后要做时，在 `[data-theme="dark"]` 下覆盖同名变量，组件不改 | 用户 |
| 输入框边框对比度 | `--line-input`（#D2D2D2）对白底 1.51，低于 WCAG 1.4.11 要求的 3:1。目前靠标签和内阴影辨识。如需严格达标，可改为 #8A8D96（3.32） | 用户 |
| 结果工作台宽度 1280px | 教程只给了 760 / 1040 两个宽度，1280 是本文档定的 | 用户确认 |

---

## 12. 交付前自检

- [ ] 组件代码里没有 hex、`rgb()`、Tailwind 任意值
- [ ] 没有 emoji；图标全部来自 Lucide
- [ ] 每个元素的海拔符合 §3.1；没有卡片套卡片
- [ ] 背景模糊只出现在固定或吸顶元素上
- [ ] 只有可点击元素有悬停上浮
- [ ] 过渡只作用于 `transform` / `opacity`，时长 200 或 250ms
- [ ] 正文对比度 ≥ 4.5:1；`--ink-muted` 没有放在 `--bg` 上
- [ ] 键盘焦点处处可见
- [ ] 375 / 768 / 1024 / 1440 无横向滚动
- [ ] `prefers-reduced-motion` 已处理

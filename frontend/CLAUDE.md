# CLAUDE.md — 前端 session

> 启动目录：`frontend/`。上级规范见 `../CLAUDE.md`，冲突时以上级为准。
> 版本：v1.0 · 2026-11-06

## 1. 职责边界

- 只读写 `frontend/` 内的文件。
- 只读参考：`../DESIGN.md`（视觉）、`../PRODUCT.md`（交互）、`../docs/PRD.md`（功能）、`../docs/接口设计.md`（契约，M1 定稿后生效）。
- 不改 `../backend/`、根目录文档、`../docs/` 下的契约文档。需要后端配合时，在汇报的「发现的其他问题」里写明，由主调度转达。

## 2. 技术栈（已安装）

| 项 | 版本 |
| --- | --- |
| Next.js（App Router） | 15.5.29 |
| React | 19.1.0 |
| TypeScript | 5.x，`strict: true` |
| Tailwind CSS | 3.4.19 |
| 图标 | `lucide-react` |

新增依赖前先确认包真实存在、维护活跃，并写进汇报。

## 3. 目录约定

```text
src/
├── app/          路由、layout、globals.css（令牌已接入）
├── components/   纯渲染组件，props 全部 Readonly
├── lib/          SSE 解析、http 封装、工具函数
├── store/        三态状态机（单一 reducer）
├── types/        与接口契约对应的类型
└── mocks/        开发期 mock，只按定稿契约写，生产构建不得引用
```

## 4. 硬规则

1. **视觉只从令牌取值。** 组件里不出现 hex、`rgb()`、Tailwind 任意值（`bg-[#..]`、`p-[13px]`）。令牌映射见 `tailwind.config.ts`，权威值见 `../DESIGN.md` §1。`globals.css` 的 `:root` 由 `DESIGN.md` 同步，改令牌先改 `DESIGN.md`（找主调度）。
2. **状态机**：只有 `initial` / `retrieving` / `result` 三态，`result` 内用 `generating` 区分生成中，状态切换只在 reducer 里做（`../PRODUCT.md` §3）。
3. **不放假功能、不放假数据**：界面上的每个按钮都要有真实后端支撑；数字全部来自接口。
4. **请求一律走相对路径 `/api`**，由 `next.config.ts` 的 rewrites 转发到 `http://127.0.0.1:8000`。
5. 单个组件文件不超过 300 行；重组件用 `next/dynamic` 懒加载；每个屏幕包 ErrorBoundary。
6. 禁止 emoji（代码、注释、文案）。所有文件 UTF-8 无 BOM。

## 5. 命令

```bash
npm run dev     # http://localhost:3000
npm run build   # 交付前必须通过，且零警告
npm run lint
```

Windows 注意：构建时 `next/font` 会从 Google Fonts 下载字体，本机走代理 `127.0.0.1:7897`。偶发报 `Cannot read properties of null (reading '1')` 是代理返回异常内容导致，重跑一次即可；连续失败再报阻塞。

## 6. 汇报

按 `../CLAUDE.md` §4 的格式，必须附原始验证输出和「知识点素材」。

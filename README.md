# Mile AI Search

本地运行的 AI 技术研报搜索引擎。输入一个技术问题，系统改写检索词、并发检索、按相关性/权威度/时效性重排信源，再由大模型流式生成带引用角标的研报。每个角标都能点回原文段落。

## 功能

- 流式检索：SSE 推送阶段进度、信源、研报增量
- 引用角标与证据抽屉：角标与原文句子一一对应高亮
- 检索模式（通用 / 学术 / 代码）、信源范围过滤、搜索引擎切换
- 核心要点、相关追问、共识度（按规则实算，算不出则不显示）
- 推演观测台、历史记录（SQLite）、结果缓存（回放耗时为本次实测值）
- OpenUI 交互表格卡片、arXiv 信源 BibTeX 复制
- 停止检索（Esc）、全键盘操作

## 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | 22.x |
| uv | 0.12 及以上（会自动安装 Python 3.12） |

还需要两个 API Key：

- `LLM_API_KEY`：DeepSeek（OpenAI 兼容接口）
- `TAVILY_API_KEY`：Tavily 搜索

## 一键启动

```powershell
# Windows
.\start.ps1
```

```bash
# macOS / Linux / Git Bash
./start.sh
```

首次运行会创建 `backend/.env` 并退出，填入两个 Key 后再运行一次。脚本会安装依赖、把前端导出为静态文件，再只启动一个服务：后端同时提供接口和页面。浏览器打开 <http://localhost:8000>，按 Ctrl+C 停止。端口冲突时设置环境变量 `PORT`。

强制重新构建前端：`.\start.ps1 -Rebuild` 或 `./start.sh --rebuild`。

## 手动启动

```bash
cd frontend
npm ci
STATIC_EXPORT=1 npm run build     # 生成 frontend/out
cd ../backend
cp .env.example .env              # 填入 Key
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`frontend/out` 存在时，后端会在同一端口托管页面。开发前端时可单独运行 `npm run dev`（3000），它会把 `/api` 转发到 `http://127.0.0.1:8000`，转发目标用构建时的 `BACKEND_ORIGIN` 修改。

## 测试

```bash
cd backend && uv run pytest -q
cd frontend && npm run lint && npx tsc --noEmit && npm test
```

## 已知限制

- 信源分类服务未接入，使用本地域名规则分类。
- 前端构建时 `next/font` 会从 Google Fonts 下载字体，网络受限时需要代理，偶发失败重跑一次即可。
- 服务只监听 `127.0.0.1`，仅供本机使用。

## 目录

```text
backend/    FastAPI 后端：检索流水线、缓存、SQLite 历史
frontend/   Next.js 前端：三态界面、SSE 客户端、证据抽屉
start.ps1   Windows 一键启动
start.sh    macOS / Linux 一键启动
```

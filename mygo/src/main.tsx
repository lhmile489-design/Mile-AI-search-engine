import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";

// ?dev=ui 是开发期组件预览入口（对应前端 app/dev/ui）。
// lazy + DEV 门控：生产构建里 import.meta.env.DEV 是 false，UiPreview 整块被剔除。
const isDevUi = import.meta.env.DEV && new URLSearchParams(window.location.search).get("dev") === "ui";
const UiPreview = isDevUi
  ? lazy(() => import("./dev/UiPreview").then((m) => ({ default: m.UiPreview })))
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {UiPreview ? (
      <Suspense fallback={null}>
        <UiPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

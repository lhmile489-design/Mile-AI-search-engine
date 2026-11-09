"""Mile AI Search 桌面启动器（PyInstaller 入口）。

双击后打开原生窗口（WebView2），后端在本进程的后台线程里运行，关窗即退出。
用户数据（.env、SQLite）放在 %APPDATA%\\MileAISearch，升级和卸载不会丢数据。
首次运行创建 .env 模板并用记事本打开，用户填入 Key 后再次启动。
"""

from __future__ import annotations

import ctypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_NAME = "MileAISearch"
TITLE = "Mile AI Search"


def _data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _resource(name: str) -> Path:
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return root / name


def _message(text: str) -> None:
    """窗口模式下没有控制台，用系统消息框提示。"""
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(0, text, TITLE, 0x40)
    else:
        print(text)


def _free_port(preferred: int) -> int:
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("没有可用端口")


def _wait_ready(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=1):
                return True
        except Exception:
            time.sleep(0.3)
    return False


def main() -> int:
    data = _data_dir()
    os.chdir(data)  # config 读取相对路径的 .env，数据库路径也相对于此

    env_file = data / ".env"
    if not env_file.exists():
        shutil.copy(_resource(".env.example"), env_file)
        if os.name == "nt":
            subprocess.Popen(["notepad.exe", str(env_file)])
        _message(
            f"首次运行：已创建配置文件\n{env_file}\n\n"
            "请在记事本中填入 LLM_API_KEY 和 TAVILY_API_KEY，保存后重新打开本程序。"
        )
        return 1

    port = _free_port(int(os.environ.get("PORT", "8000")))
    url = f"http://127.0.0.1:{port}"

    import uvicorn

    from app.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()

    if not _wait_ready(url):
        _message("后端启动超时，请检查配置文件后重试。")
        return 1

    import webview

    webview.create_window(TITLE, url, width=1440, height=900, min_size=(1024, 700))
    webview.start()  # 阻塞到窗口关闭

    server.should_exit = True
    return 0


if __name__ == "__main__":
    sys.exit(main())

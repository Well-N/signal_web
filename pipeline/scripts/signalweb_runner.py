"""SignalWeb desktop runner.

Commands:
  configure  Read a JSON object from stdin, store the API key in the OS
             credential store, write non-secret settings, and register a
             daily OS task.
  schedule   Register or refresh the daily task.
  unschedule Remove the daily task.
  test       Make one minimal chat-completions request.
  delivery   Update schedule, robot webhooks, report folder and PDF preset.
  publish    Regenerate the PDF for the current latest.json without re-running AI.
  run        Execute the Horizon pipeline and write latest.json.
  status     Return non-secret settings and last run status.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import keyring
from filelock import FileLock
from filelock import Timeout as FileLockTimeout
from rich.console import Console


APP_NAME = "SignalWeb"
KEYRING_SERVICE = "SignalWeb"
KEYRING_USER = "llm-api-key"
KEYRING_HEADERS = "llm-extra-headers"
KEYRING_FEISHU = "feishu-webhook"
KEYRING_WECOM = "wecom-webhook"
TASK_NAME = "SignalWebDaily"
PDF_STYLE_IDS = {"grid", "darkroom", "atelier", "riso"}
PDF_STYLE_ALIASES = {
    "cobalt-ledger": "grid",
    "ivory-editorial": "atelier",
    "midnight-signal": "darkroom",
}
PDF_STYLE_CATALOG = [
    {
        "id": "grid",
        "name": "网格档案",
        "description": "白纸、群青与瑞士红，像一张现代主义展册。",
    },
    {
        "id": "darkroom",
        "name": "暗房",
        "description": "暖黑纸、纤维白与一盏琥珀安全灯，安静而克制。",
    },
    {
        "id": "atelier",
        "name": "手作工坊",
        "description": "亚麻纸、深褐字与石板蓝，像一本安静的造物目录。",
    },
    {
        "id": "riso",
        "name": "孔版印刷",
        "description": "蓝墨、荧光粉与错位套印，像一份小出版社的日报。",
    },
]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def pipeline_root() -> Path:
    if getattr(sys, "frozen", False):
        configured = os.environ.get("SIGNALWEB_PIPELINE_DIR")
        if not configured:
            raise RuntimeError("打包运行器缺少 SIGNALWEB_PIPELINE_DIR")
        return Path(configured).resolve()
    return Path(__file__).resolve().parent.parent


ROOT = pipeline_root()
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
CONFIG_DIR = (
    Path(os.environ["APPDATA"]) / APP_NAME
    if platform.system() == "Windows" and os.environ.get("APPDATA")
    else Path.home() / "Library" / "Application Support" / APP_NAME
    if platform.system() == "Darwin"
    else Path.home() / ".config" / "signalweb"
)
SETTINGS_PATH = CONFIG_DIR / "settings.json"
RUN_STATUS_PATH = CONFIG_DIR / "last_run.json"
RUN_LOCK_PATH = ROOT / "data" / "state" / "run.lock"
LAUNCH_AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / "com.signalweb.daily.plist"


class RunnerError(RuntimeError):
    pass


def default_report_dir() -> Path:
    return Path.home() / "Documents" / "SignalWeb Reports"


def normalize_settings(settings: dict[str, Any]) -> dict[str, Any]:
    if "notify_enabled" not in settings:
        settings["notify_enabled"] = bool(
            settings.get("notify_feishu") or settings.get("notify_wecom")
        )
    settings.setdefault("notify_feishu", False)
    settings.setdefault("notify_wecom", False)
    settings.setdefault("report_dir", str(default_report_dir()))
    settings.setdefault("pdf_style", "grid")
    if not settings.get("report_dir"):
        settings["report_dir"] = str(default_report_dir())
    settings["pdf_style"] = PDF_STYLE_ALIASES.get(settings.get("pdf_style"), settings.get("pdf_style"))
    if settings.get("pdf_style") not in PDF_STYLE_IDS:
        settings["pdf_style"] = "grid"
    return settings


def validate_webhook(value: str, channel: str) -> str:
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        raise RunnerError(f"{channel} Webhook 必须是 HTTPS 地址")
    if channel == "飞书":
        valid = host in {"open.feishu.cn", "open.larksuite.com"} and parsed.path.startswith(
            "/open-apis/bot/v2/hook/"
        )
    else:
        valid = host == "qyapi.weixin.qq.com" and parsed.path.startswith("/cgi-bin/webhook/send")
    if not valid:
        raise RunnerError(f"{channel} Webhook 地址格式不正确")
    return value.strip()


def validate_report_dir(value: str) -> str:
    raw = value.strip()
    if not raw:
        raw = str(default_report_dir())
    target = Path(raw).expanduser()
    if not target.is_absolute():
        raise RunnerError("日报保存位置必须是绝对路径")
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RunnerError("无法创建日报保存位置：" + str(exc)) from exc
    if not target.is_dir():
        raise RunnerError("日报保存位置不是文件夹")
    return str(target.resolve())


def validate_time(value: str) -> str:
    try:
        hour, minute = (int(part) for part in value.strip().split(":"))
    except ValueError as exc:
        raise RunnerError("每日时间必须是 HH:MM") from exc
    if hour not in range(24) or minute not in range(60):
        raise RunnerError("每日时间超出范围")
    return f"{hour:02d}:{minute:02d}"


def webhook(channel: str) -> str | None:
    return get_secret(KEYRING_FEISHU if channel == "feishu" else KEYRING_WECOM)


def delivery_field_changes(
    settings: dict[str, Any], payload: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, str | None]]:
    changes: dict[str, str | None] = {}

    def available(key: str) -> bool:
        return bool(changes[key]) if key in changes else bool(get_secret(key))

    for channel, label, key in (
        ("feishu", "飞书", KEYRING_FEISHU),
        ("wecom", "企业微信", KEYRING_WECOM),
    ):
        value = payload.get(f"{channel}_webhook")
        if isinstance(value, str) and value.strip():
            changes[key] = validate_webhook(value, label)
        if payload.get(f"clear_{channel}"):
            changes[key] = None
            settings[f"notify_{channel}"] = False
        elif f"notify_{channel}" in payload:
            settings[f"notify_{channel}"] = bool(payload[f"notify_{channel}"])
    if "report_dir" in payload:
        settings["report_dir"] = validate_report_dir(str(payload.get("report_dir") or ""))
    if "pdf_style" in payload:
        style = str(payload.get("pdf_style") or "").strip()
        style = PDF_STYLE_ALIASES.get(style, style)
        if style not in PDF_STYLE_IDS:
            raise RunnerError("未知 PDF 风格")
        settings["pdf_style"] = style
    if "time" in payload:
        settings["time"] = validate_time(str(payload["time"]))
    if "schedule_enabled" in payload:
        settings["schedule_enabled"] = bool(payload["schedule_enabled"])
    if "notify_enabled" in payload:
        settings["notify_enabled"] = bool(payload["notify_enabled"])
    if settings.get("notify_enabled") and settings.get("notify_feishu") and not available(KEYRING_FEISHU):
        raise RunnerError("启用飞书投递前需要填写飞书 Webhook")
    if settings.get("notify_enabled") and settings.get("notify_wecom") and not available(KEYRING_WECOM):
        raise RunnerError("启用企业微信投递前需要填写企业微信 Webhook")
    settings["updated_at"] = datetime.now(timezone.utc).isoformat()
    return settings, changes


class Tee:
    """Write console output to stderr and to a log file at the same time."""

    encoding = "utf-8"

    def __init__(self, *streams: Any) -> None:
        self.streams = streams

    def write(self, data: str) -> int:
        for stream in self.streams:
            if stream is not None:
                stream.write(data)
        return len(data)

    def flush(self) -> None:
        for stream in self.streams:
            if stream is not None:
                stream.flush()

    def isatty(self) -> bool:
        return False


def emit(payload: dict[str, Any]) -> None:
    if sys.stdout is None:
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def read_stdin_json() -> dict[str, Any]:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise RunnerError("stdin 不是有效 JSON") from exc
    if not isinstance(payload, dict):
        raise RunnerError("stdin 必须是 JSON 对象")
    return payload


def read_settings() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        raise RunnerError("尚未完成初始化，缺少 settings.json")
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RunnerError("settings.json 无法读取") from exc
    if not isinstance(data, dict):
        raise RunnerError("settings.json 格式错误")
    legacy_headers = data.pop("headers", None)
    settings = normalize_settings(data)
    if legacy_headers is not None:
        settings["headers"] = normalize_headers(legacy_headers)
        set_secret(KEYRING_HEADERS, serialized_headers(settings["headers"]))
        write_settings(settings)
    else:
        settings["headers"] = stored_headers()
    return settings


def write_settings(settings: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    safe = {key: value for key, value in settings.items() if key not in {"api_key", "headers"}}
    temp = SETTINGS_PATH.with_name(SETTINGS_PATH.name + ".tmp")
    temp.write_text(json.dumps(safe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, SETTINGS_PATH)


def get_secret(name: str) -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, name)
    except Exception as exc:
        raise RunnerError("无法读取系统凭据库：" + str(exc)) from exc


def set_secret(name: str, value: str | None) -> None:
    try:
        if value is None:
            keyring.delete_password(KEYRING_SERVICE, name)
        else:
            keyring.set_password(KEYRING_SERVICE, name, value)
    except keyring.errors.PasswordDeleteError:
        return
    except Exception as exc:
        raise RunnerError("无法写入系统凭据库：" + str(exc)) from exc


def normalize_headers(value: Any) -> dict[str, str]:
    if isinstance(value, str):
        value = value.strip()
        if value:
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise RunnerError("额外请求头必须是 JSON 对象") from exc
        else:
            value = {}
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise RunnerError("额外请求头必须是 JSON 对象")
    return {
        str(name): str(header_value)
        for name, header_value in value.items()
        if str(name).strip()
    }


def serialized_headers(headers: dict[str, str]) -> str | None:
    return json.dumps(headers, ensure_ascii=False, sort_keys=True) if headers else None


def stored_headers() -> dict[str, str]:
    raw = get_secret(KEYRING_HEADERS)
    if not raw:
        return {}
    try:
        return normalize_headers(json.loads(raw))
    except (json.JSONDecodeError, TypeError) as exc:
        raise RunnerError("系统凭据库中的额外请求头格式错误") from exc


def api_key() -> str:
    value = get_secret(KEYRING_USER)
    if not value:
        raise RunnerError("系统凭据库中没有 API Key")
    return value


def validate_settings(payload: dict[str, Any]) -> dict[str, Any]:
    endpoint = str(payload.get("endpoint", "")).strip()
    headers = normalize_headers(payload.get("headers", {}))
    model = str(payload.get("model", "")).strip()
    key = str(payload.get("api_key", "")).strip()
    daily_time = str(payload.get("time", "08:00")).strip()
    language = str(payload.get("language", "zh")).strip() or "zh"
    if not endpoint.startswith("https://"):
        raise RunnerError("API Base URL 必须是 HTTPS 地址")
    if not model:
        raise RunnerError("模型名不能为空")
    if not key:
        raise RunnerError("API Key 不能为空")
    daily_time = validate_time(daily_time)
    report_dir = validate_report_dir(str(payload.get("report_dir") or default_report_dir()))
    pdf_style = str(payload.get("pdf_style") or "grid").strip()
    pdf_style = PDF_STYLE_ALIASES.get(pdf_style, pdf_style)
    if pdf_style not in PDF_STYLE_IDS:
        raise RunnerError("未知 PDF 风格")
    return normalize_settings({
        "endpoint": endpoint.rstrip("/"),
        "model": model,
        "headers": headers,
        "time": daily_time,
        "language": language,
        "schedule_enabled": bool(payload.get("schedule_enabled", True)),
        "notify_feishu": bool(payload.get("notify_feishu", False)),
        "notify_wecom": bool(payload.get("notify_wecom", False)),
        "notify_enabled": bool(
            payload.get(
                "notify_enabled",
                payload.get("notify_feishu", False) or payload.get("notify_wecom", False),
            )
        ),
        "report_dir": report_dir,
        "pdf_style": pdf_style,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def runner_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [str(Path(sys.executable).resolve()), "run"]
    python = Path(sys.executable)
    background = python.with_name("pythonw.exe")
    executable = str(background) if platform.system() == "Windows" and background.exists() else str(python)
    return [executable, str(Path(__file__).resolve()), "run"]


def register_windows_task(daily_time: str) -> dict[str, Any]:
    command = subprocess.list2cmdline(runner_command())
    args = [
        "schtasks",
        "/Create",
        "/TN",
        TASK_NAME,
        "/SC",
        "DAILY",
        "/ST",
        daily_time,
        "/TR",
        command,
        "/F",
    ]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if completed.returncode != 0:
        raise RunnerError(
            "注册 Windows 每日任务失败：" + (completed.stderr or completed.stdout).strip()
        )
    verify = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if verify.returncode != 0:
        raise RunnerError("计划任务已创建但无法查询，请检查任务计划程序")
    return {"platform": "windows", "task": TASK_NAME, "time": daily_time}


def launch_agent_xml(daily_time: str) -> str:
    from xml.sax.saxutils import escape

    hour, minute = daily_time.split(":")
    command_items = "".join(
        "        <string>" + escape(item) + "</string>\n"
        for item in runner_command()
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        "<dict>\n"
        "    <key>Label</key>\n"
        "    <string>com.signalweb.daily</string>\n"
        "    <key>ProgramArguments</key>\n"
        "    <array>\n"
        + command_items
        + "    </array>\n"
        "    <key>EnvironmentVariables</key>\n"
        "    <dict>\n"
        "        <key>SIGNALWEB_PIPELINE_DIR</key>\n"
        "        <string>" + escape(str(ROOT)) + "</string>\n"
        "    </dict>\n"
        "    <key>StartCalendarInterval</key>\n"
        "    <dict>\n"
        "        <key>Hour</key>\n"
        "        <integer>" + hour + "</integer>\n"
        "        <key>Minute</key>\n"
        "        <integer>" + minute + "</integer>\n"
        "    </dict>\n"
        "    <key>WorkingDirectory</key>\n"
        "    <string>" + escape(str(ROOT)) + "</string>\n"
        "    <key>StandardOutPath</key>\n"
        "    <string>" + escape(str(CONFIG_DIR / "daily.out.log")) + "</string>\n"
        "    <key>StandardErrorPath</key>\n"
        "    <string>" + escape(str(CONFIG_DIR / "daily.err.log")) + "</string>\n"
        "</dict>\n"
        "</plist>\n"
    )


def register_macos_task(daily_time: str) -> dict[str, Any]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENT_PATH.write_text(launch_agent_xml(daily_time), encoding="utf-8")
    uid = os.getuid()
    bootstrap = subprocess.run(
        ["launchctl", "bootstrap", "gui/" + str(uid), str(LAUNCH_AGENT_PATH)],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if bootstrap.returncode != 0:
        load = subprocess.run(
            ["launchctl", "load", "-w", str(LAUNCH_AGENT_PATH)],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if load.returncode != 0:
            raise RunnerError(
                "注册 macOS LaunchAgent 失败："
                + (bootstrap.stderr or load.stderr or "unknown error").strip()
            )
    return {"platform": "macos", "task": str(LAUNCH_AGENT_PATH), "time": daily_time}


def register_task(settings: dict[str, Any], dry_run: bool = False) -> dict[str, Any]:
    daily_time = settings["time"]
    if dry_run:
        return {
            "platform": platform.system().lower(),
            "dry_run": True,
            "command": subprocess.list2cmdline(runner_command()),
            "time": daily_time,
        }
    if platform.system() == "Windows":
        return register_windows_task(daily_time)
    if platform.system() == "Darwin":
        return register_macos_task(daily_time)
    raise RunnerError("当前系统暂不支持自动注册每日任务（仅支持 Windows/macOS）")


def unregister_task() -> dict[str, Any]:
    if platform.system() == "Windows":
        query = subprocess.run(
            ["schtasks", "/Query", "/TN", TASK_NAME],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if query.returncode != 0:
            return {"platform": "windows", "removed": False}
        completed = subprocess.run(
            ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if completed.returncode != 0:
            raise RunnerError("删除 Windows 每日任务失败：" + completed.stderr.strip())
        return {"platform": "windows", "removed": True}
    if platform.system() == "Darwin" and LAUNCH_AGENT_PATH.exists():
        completed = subprocess.run(
            ["launchctl", "bootout", "gui/" + str(os.getuid()), str(LAUNCH_AGENT_PATH)],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if completed.returncode != 0:
            raise RunnerError(
                "取消 macOS 每日任务失败：" + (completed.stderr or completed.stdout).strip()
            )
        LAUNCH_AGENT_PATH.unlink()
        return {"platform": "macos", "removed": True}
    return {"platform": platform.system().lower(), "removed": False}


def completion_endpoint(base_url: str) -> str:
    clean = base_url.rstrip("/")
    return clean if clean.endswith("/chat/completions") else clean + "/chat/completions"


def test_connection(settings: dict[str, Any], key: str | None = None) -> dict[str, Any]:
    key = key or api_key()
    extra = settings.get("headers") or {}
    if not isinstance(extra, dict):
        extra = {}
    url = completion_endpoint(settings["endpoint"])
    payload = {
        "model": settings["model"],
        "messages": [{"role": "user", "content": "Reply with OK."}],
    }
    # Use the model's documented parameter directly; do not retry another model.
    if settings["model"].startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
        payload["max_completion_tokens"] = 64
    else:
        payload["max_tokens"] = 64
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                **{str(name): str(value) for name, value in extra.items()},
            },
            json=payload,
            timeout=30.0,
        )
    except Exception as exc:
        raise RunnerError("连接测试失败：" + str(exc)) from exc
    if response.status_code != 200:
        raise RunnerError(
            "连接测试返回 HTTP " + str(response.status_code) + "：" + response.text[:300]
        )
    return {"ok": True, "status": 200, "endpoint": url, "model": settings["model"]}


def save_run_status(data: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    temp = RUN_STATUS_PATH.with_name(RUN_STATUS_PATH.name + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, RUN_STATUS_PATH)


def run_task_active() -> bool:
    RUN_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(RUN_LOCK_PATH))
    try:
        lock.acquire(timeout=0)
    except FileLockTimeout:
        return True
    lock.release()
    return False


def configure_schedule(settings: dict[str, Any]) -> dict[str, Any]:
    if settings.get("schedule_enabled", True):
        return register_task(settings)
    result = unregister_task()
    result["enabled"] = False
    return result


def restore_schedule(settings: dict[str, Any] | None) -> None:
    if settings is None:
        unregister_task()
        return
    configure_schedule(settings)


def commit_settings(
    updated: dict[str, Any],
    previous: dict[str, Any] | None,
    credential_changes: dict[str, str | None],
) -> dict[str, Any]:
    secret_names = {KEYRING_USER, KEYRING_HEADERS, KEYRING_FEISHU, KEYRING_WECOM}
    before = {name: get_secret(name) for name in secret_names}
    try:
        for name, value in credential_changes.items():
            set_secret(name, value)
        schedule_result = configure_schedule(updated)
        write_settings(updated)
        return schedule_result
    except Exception as exc:
        rollback_errors: list[str] = []
        for name, value in before.items():
            try:
                set_secret(name, value)
            except RunnerError as rollback_error:
                rollback_errors.append(str(rollback_error))
        try:
            restore_schedule(previous)
        except Exception as rollback_error:
            rollback_errors.append(str(rollback_error))
        if rollback_errors:
            raise RunnerError(
                f"{exc}；回滚时仍有错误：{'；'.join(rollback_errors)}"
            ) from exc
        raise


def acquire_run_lock() -> FileLock:
    RUN_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(RUN_LOCK_PATH))
    try:
        lock.acquire(timeout=0)
    except FileLockTimeout as exc:
        raise RunnerError("已有日报任务正在运行，请等待当前任务结束") from exc
    return lock


def run_pipeline() -> dict[str, Any]:
    lock = acquire_run_lock()
    try:
        return _run_pipeline_locked()
    finally:
        lock.release()


def _run_pipeline_locked() -> dict[str, Any]:
    # The Windows scheduled task starts with System32 as its working directory.
    # Resolve config.profiles_dir and docs paths from the pipeline root instead.
    os.chdir(ROOT)
    settings = read_settings()
    key = api_key()
    os.environ["LLM_BASE_URL"] = settings["endpoint"]
    os.environ["LLM_API_KEY"] = key
    os.environ["LLM_MODEL"] = settings["model"]
    os.environ["LLM_EXTRA_HEADERS"] = json.dumps(settings.get("headers") or {}, ensure_ascii=False)
    os.environ["PYTHONUTF8"] = "1"
    started = datetime.now(timezone.utc).isoformat()
    save_run_status({"ok": False, "started_at": started, "stage": "starting"})
    sys.path.insert(0, str(ROOT))
    from src.export.crawl_events import emit_event, reset_events

    reset_events()
    emit_event("run_started", started_at=started)
    try:
        test_connection(settings, key)
        from src.orchestrator import HorizonOrchestrator
        from src.storage.manager import StorageManager

        storage = StorageManager(data_dir=str(ROOT / "data"))
        config = storage.load_config()
        log_path = ROOT / "data" / "state" / "last_run.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as log_handle:
            console = Console(
                file=Tee(sys.stderr, log_handle),
                force_terminal=False,
            )
            orchestrator = HorizonOrchestrator(config, storage, console=console)
            generated = asyncio.run(orchestrator.run(force_hours=24))
        if generated is not True:
            raise RunnerError("本次没有抓取到新内容，未生成新日报")
        latest_path = ROOT / "data" / "export" / "latest.json"
        if not latest_path.exists():
            raise RunnerError("流水线结束但没有生成 data/export/latest.json")
        latest = json.loads(latest_path.read_text(encoding="utf-8"))
        from src.report.pdf import generate_report_pdf
        from src.services.notify import send_daily

        report_dir = Path(settings["report_dir"]).expanduser()
        try:
            pdf_path = generate_report_pdf(latest_path, report_dir, settings["pdf_style"])
        except Exception as exc:
            raise RunnerError("PDF 生成失败：" + str(exc)) from exc
        notifications = send_daily(
            latest,
            pdf_path,
            feishu_url=webhook("feishu"),
            wecom_url=webhook("wecom"),
            feishu_enabled=bool(settings.get("notify_enabled")) and bool(settings.get("notify_feishu")),
            wecom_enabled=bool(settings.get("notify_enabled")) and bool(settings.get("notify_wecom")),
        )
        emit_event("stage", stage="pdf", percent=98)
        result = {
            "ok": True,
            "started_at": started,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "latest_json": str(latest_path),
            "date": latest.get("date"),
            "story_count": latest.get("stats", {}).get("story_count", 0),
            "pdf_path": str(pdf_path),
            "pdf_style": settings["pdf_style"],
            "report_dir": str(report_dir),
            "notifications": notifications,
        }
        save_run_status(result)
        emit_event(
            "run_finished",
            stories=result["story_count"],
            date=result["date"],
            pdf_path=result["pdf_path"],
        )
        return result
    except Exception as exc:
        failed = {
            "ok": False,
            "started_at": started,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
            "traceback": traceback.format_exc()[-4000:],
        }
        save_run_status(failed)
        try:
            (ROOT / "data" / "state").mkdir(parents=True, exist_ok=True)
            (ROOT / "data" / "state" / "last_error.log").write_text(
                traceback.format_exc(), encoding="utf-8"
            )
        except OSError as write_exc:
            if sys.stderr is not None:
                print(f"could not save traceback: {write_exc}", file=sys.stderr)
        emit_event("run_failed", error=str(exc))
        raise


def status_payload() -> dict[str, Any]:
    active = run_task_active()
    result: dict[str, Any] = {
        "settings_path": str(SETTINGS_PATH),
        "run_status_path": str(RUN_STATUS_PATH),
        "default_report_dir": str(default_report_dir()),
        "has_feishu_webhook": bool(webhook("feishu")),
        "has_wecom_webhook": bool(webhook("wecom")),
        "run_active": active,
    }
    result["pdf_styles"] = PDF_STYLE_CATALOG
    try:
        settings = read_settings()
        result["settings"] = {
            key: value
            for key, value in settings.items()
            if key not in {"api_key", "headers"}
        }
        result["has_extra_headers"] = bool(settings.get("headers"))
        result["has_api_key"] = bool(get_secret(KEYRING_USER))
    except Exception as exc:
        result["settings"] = None
        result["settings_error"] = str(exc)
        result["has_api_key"] = False
        result["has_extra_headers"] = False
    if RUN_STATUS_PATH.exists():
        try:
            last_run = json.loads(RUN_STATUS_PATH.read_text(encoding="utf-8"))
            if (
                isinstance(last_run, dict)
                and last_run.get("started_at")
                and not last_run.get("finished_at")
                and not last_run.get("error")
                and not active
            ):
                last_run["ok"] = False
                last_run["finished_at"] = datetime.now(timezone.utc).isoformat()
                last_run["error"] = "上次运行意外中断，未留下完成记录"
                save_run_status(last_run)
            result["last_run"] = last_run
        except Exception as exc:
            result["last_run_error"] = str(exc)
    else:
        result["last_run"] = None
    latest_path = ROOT / "data" / "export" / "latest.json"
    if latest_path.exists():
        try:
            latest = json.loads(latest_path.read_text(encoding="utf-8"))
            result["latest"] = {
                "date": latest.get("date"),
                "is_sample": latest.get("is_sample"),
                "stats": latest.get("stats"),
                "generated_at": latest.get("generated_at"),
            }
        except Exception as exc:
            result["latest_error"] = str(exc)
    else:
        result["latest"] = None
    return result


def delivery() -> dict[str, Any]:
    payload = read_stdin_json()
    previous = read_settings()
    settings, credential_changes = delivery_field_changes(dict(previous), payload)
    schedule_result = commit_settings(settings, previous, credential_changes)
    return {
        "ok": True,
        "settings": {key: value for key, value in settings.items() if key not in {"api_key", "headers"}},
        "has_feishu_webhook": bool(webhook("feishu")),
        "has_wecom_webhook": bool(webhook("wecom")),
        "schedule": schedule_result,
    }


def publish() -> dict[str, Any]:
    raw = sys.stdin.read().strip() if not sys.stdin.isatty() else ""
    payload = json.loads(raw) if raw else {}
    if not isinstance(payload, dict):
        raise RunnerError("发布参数必须是 JSON 对象")
    settings = read_settings()
    if "report_dir" in payload:
        settings["report_dir"] = validate_report_dir(str(payload.get("report_dir") or ""))
    if "pdf_style" in payload:
        style = str(payload.get("pdf_style") or "").strip()
        if style not in PDF_STYLE_IDS:
            raise RunnerError("未知 PDF 风格")
        settings["pdf_style"] = style
    if payload:
        write_settings(settings)
    latest_path = ROOT / "data" / "export" / "latest.json"
    if not latest_path.exists():
        raise RunnerError("还没有 latest.json，请先运行一次日报")
    from src.report.pdf import generate_report_pdf

    latest = json.loads(latest_path.read_text(encoding="utf-8"))
    pdf_path = generate_report_pdf(latest_path, Path(settings["report_dir"]), settings["pdf_style"])
    if RUN_STATUS_PATH.exists():
        try:
            last_run = json.loads(RUN_STATUS_PATH.read_text(encoding="utf-8"))
            if isinstance(last_run, dict):
                last_run["pdf_path"] = str(pdf_path)
                last_run["pdf_style"] = settings["pdf_style"]
                save_run_status(last_run)
        except (OSError, json.JSONDecodeError):
            pass
    return {
        "ok": True,
        "pdf_path": str(pdf_path),
        "pdf_style": settings["pdf_style"],
        "date": latest.get("date"),
        "story_count": latest.get("stats", {}).get("story_count", 0),
    }


def configure() -> dict[str, Any]:
    raw_payload = read_stdin_json()
    previous = read_settings() if SETTINGS_PATH.exists() else None
    existing = previous or {}
    payload = {**existing, **raw_payload}
    if not str(payload.get("api_key", "")).strip():
        existing_key = get_secret(KEYRING_USER)
        if not existing_key:
            raise RunnerError("首次配置必须提供 API Key")
        payload["api_key"] = existing_key
    settings = validate_settings(payload)
    settings, webhook_changes = delivery_field_changes(settings, raw_payload)
    credential_changes = {
        KEYRING_USER: str(payload["api_key"]).strip(),
        KEYRING_HEADERS: serialized_headers(settings["headers"]),
        **webhook_changes,
    }
    schedule_result = commit_settings(settings, previous, credential_changes)
    return {
        "ok": True,
        "settings": {key: value for key, value in settings.items() if key not in {"api_key", "headers"}},
        "has_feishu_webhook": bool(webhook("feishu")),
        "has_wecom_webhook": bool(webhook("wecom")),
        "has_extra_headers": bool(settings.get("headers")),
        "schedule": schedule_result,
        "keyring": "stored",
    }


def main() -> int:
    parser = argparse.ArgumentParser(prog="signalweb-runner")
    parser.add_argument(
        "command",
        choices=["configure", "delivery", "publish", "schedule", "unschedule", "test", "run", "status"],
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "configure":
            emit(configure())
        elif args.command == "delivery":
            emit(delivery())
        elif args.command == "publish":
            emit(publish())
        elif args.command == "schedule":
            settings = read_settings()
            emit({"ok": True, "schedule": register_task(settings, dry_run=args.dry_run)})
        elif args.command == "unschedule":
            emit({"ok": True, "schedule": unregister_task()})
        elif args.command == "test":
            payload: dict[str, Any] | None = None
            if not sys.stdin.isatty():
                raw = sys.stdin.read().strip()
                if raw:
                    parsed = json.loads(raw)
                    payload = parsed if isinstance(parsed, dict) else None
            if payload and str(payload.get("endpoint", "")).strip():
                endpoint = str(payload.get("endpoint", "")).strip().rstrip("/")
                model_name = str(payload.get("model", "")).strip()
                if not endpoint.startswith("https://"):
                    raise RunnerError("API Base URL 必须是 HTTPS 地址")
                if not model_name:
                    raise RunnerError("模型名不能为空")
                provided_key = str(payload.get("api_key", "")).strip()
                stored = read_settings() if SETTINGS_PATH.exists() else {}
                headers = (
                    normalize_headers(payload["headers"])
                    if "headers" in payload
                    else stored.get("headers", {})
                )
                emit(
                    test_connection(
                        {
                            "endpoint": endpoint,
                            "model": model_name,
                            "headers": headers,
                        },
                        provided_key or None,
                    )
                )
            else:
                emit(test_connection(read_settings()))
        elif args.command == "run":
            emit(run_pipeline())
        elif args.command == "status":
            emit({"ok": True, "status": status_payload()})
        return 0
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

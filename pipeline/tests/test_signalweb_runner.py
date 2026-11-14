from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def load_runner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = Path(__file__).resolve().parents[1] / "scripts" / "signalweb_runner.py"
    spec = importlib.util.spec_from_file_location("signalweb_runner_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.CONFIG_DIR = tmp_path
    module.SETTINGS_PATH = tmp_path / "settings.json"
    module.RUN_STATUS_PATH = tmp_path / "last_run.json"
    module.RUN_LOCK_PATH = tmp_path / "run.lock"
    secrets: dict[str, str | None] = {}
    monkeypatch.setattr(module, "get_secret", lambda name: secrets.get(name))

    def set_secret(name: str, value: str | None) -> None:
        secrets[name] = value

    monkeypatch.setattr(module, "set_secret", set_secret)
    return module, secrets


def base_settings():
    return {
        "endpoint": "https://api.example.com/v1",
        "model": "model",
        "time": "08:00",
        "language": "zh",
        "schedule_enabled": False,
        "notify_feishu": False,
        "notify_wecom": False,
        "notify_enabled": False,
        "report_dir": "/tmp/reports",
        "pdf_style": "grid",
    }


def test_headers_are_not_written_to_settings_json(tmp_path, monkeypatch):
    runner, secrets = load_runner(tmp_path, monkeypatch)
    settings = runner.normalize_settings({**base_settings(), "headers": {"Authorization": "secret"}})
    secrets[runner.KEYRING_HEADERS] = runner.serialized_headers(settings["headers"])

    runner.write_settings(settings)

    raw = runner.SETTINGS_PATH.read_text(encoding="utf-8")
    assert "Authorization" not in raw
    assert "secret" not in raw
    assert runner.read_settings()["headers"] == {"Authorization": "secret"}


def test_legacy_headers_are_migrated_and_removed_from_settings(tmp_path, monkeypatch):
    runner, secrets = load_runner(tmp_path, monkeypatch)
    runner.SETTINGS_PATH.write_text(
        json.dumps({**base_settings(), "headers": {"X-Relay-Token": "secret"}}),
        encoding="utf-8",
    )

    settings = runner.read_settings()

    assert settings["headers"] == {"X-Relay-Token": "secret"}
    assert "X-Relay-Token" in (secrets[runner.KEYRING_HEADERS] or "")
    assert "X-Relay-Token" not in runner.SETTINGS_PATH.read_text(encoding="utf-8")


def test_status_redacts_headers_and_recovers_interrupted_run(tmp_path, monkeypatch):
    runner, secrets = load_runner(tmp_path, monkeypatch)
    secrets[runner.KEYRING_USER] = "key"
    secrets[runner.KEYRING_HEADERS] = runner.serialized_headers({"Authorization": "secret"})
    runner.write_settings(runner.normalize_settings(base_settings()))
    runner.RUN_STATUS_PATH.write_text(
        json.dumps({"ok": False, "started_at": "2026-01-01T00:00:00+00:00"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "run_task_active", lambda: False)
    monkeypatch.setattr(runner, "webhook", lambda channel: None)

    status = runner.status_payload()

    assert status["has_extra_headers"] is True
    assert "headers" not in status["settings"]
    assert status["last_run"]["error"] == "上次运行意外中断，未留下完成记录"
    persisted = json.loads(runner.RUN_STATUS_PATH.read_text(encoding="utf-8"))
    assert persisted["error"] == "上次运行意外中断，未留下完成记录"


def test_commit_settings_rolls_back_schedule_and_credentials(tmp_path, monkeypatch):
    runner, secrets = load_runner(tmp_path, monkeypatch)
    secrets[runner.KEYRING_USER] = "old-key"
    previous = runner.normalize_settings(base_settings())
    updated = runner.normalize_settings({**base_settings(), "schedule_enabled": True})
    restored = []
    monkeypatch.setattr(runner, "configure_schedule", lambda settings: {"enabled": True})
    monkeypatch.setattr(runner, "restore_schedule", restored.append)

    def fail_write(_settings):
        raise OSError("disk full")

    monkeypatch.setattr(runner, "write_settings", fail_write)

    with pytest.raises(OSError, match="disk full"):
        runner.commit_settings(updated, previous, {runner.KEYRING_USER: "new-key"})

    assert secrets[runner.KEYRING_USER] == "old-key"
    assert restored == [previous]


def test_run_lock_rejects_overlapping_runs(tmp_path, monkeypatch):
    runner, _secrets = load_runner(tmp_path, monkeypatch)
    lock = runner.acquire_run_lock()
    try:
        assert runner.run_task_active() is True
        with pytest.raises(runner.RunnerError, match="已有日报任务正在运行"):
            runner.acquire_run_lock()
    finally:
        lock.release()
    assert runner.run_task_active() is False


def test_schedule_failure_leaves_settings_file_unchanged(tmp_path, monkeypatch):
    runner, secrets = load_runner(tmp_path, monkeypatch)
    secrets[runner.KEYRING_USER] = "old-key"
    previous = runner.normalize_settings(base_settings())
    runner.write_settings(previous)
    updated = runner.normalize_settings({**base_settings(), "schedule_enabled": True})

    def fail_schedule(_settings):
        raise runner.RunnerError("scheduler denied")

    monkeypatch.setattr(runner, "configure_schedule", fail_schedule)
    monkeypatch.setattr(runner, "restore_schedule", lambda _settings: None)

    with pytest.raises(runner.RunnerError, match="scheduler denied"):
        runner.commit_settings(updated, previous, {runner.KEYRING_USER: "new-key"})

    persisted = json.loads(runner.SETTINGS_PATH.read_text(encoding="utf-8"))
    assert persisted["schedule_enabled"] is False
    assert secrets[runner.KEYRING_USER] == "old-key"


def test_empty_crawl_does_not_publish_existing_brief(tmp_path, monkeypatch):
    runner, _secrets = load_runner(tmp_path, monkeypatch)
    monkeypatch.setattr(runner.os, "environ", dict(os.environ))
    runner.ROOT = tmp_path
    export = tmp_path / "data" / "export"
    export.mkdir(parents=True)
    old_brief = export / "latest.json"
    old_brief.write_text('{"date":"2026-01-01"}', encoding="utf-8")
    monkeypatch.setattr(runner, "read_settings", lambda: base_settings())
    monkeypatch.setattr(runner, "api_key", lambda: "test-key")
    monkeypatch.setattr(runner, "test_connection", lambda *_args: None)
    monkeypatch.setattr("src.export.crawl_events.reset_events", lambda: None)
    monkeypatch.setattr("src.export.crawl_events.emit_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("src.storage.manager.StorageManager", lambda **_kwargs: SimpleNamespace(load_config=lambda: {}))

    class EmptyOrchestrator:
        def __init__(self, *_args, **_kwargs):
            pass

        async def run(self, **_kwargs):
            return False

    monkeypatch.setattr("src.orchestrator.HorizonOrchestrator", EmptyOrchestrator)
    previous_directory = Path.cwd()
    try:
        with pytest.raises(runner.RunnerError, match="没有抓取到新内容"):
            runner.run_pipeline()
    finally:
        os.chdir(previous_directory)

    assert json.loads(old_brief.read_text(encoding="utf-8"))["date"] == "2026-01-01"
    assert json.loads(runner.RUN_STATUS_PATH.read_text(encoding="utf-8"))["ok"] is False


def test_macos_unschedule_keeps_task_file_when_bootout_fails(tmp_path, monkeypatch):
    runner, _secrets = load_runner(tmp_path, monkeypatch)
    runner.LAUNCH_AGENT_PATH = tmp_path / "com.signalweb.daily.plist"
    runner.LAUNCH_AGENT_PATH.write_text("existing task", encoding="utf-8")
    monkeypatch.setattr(runner.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(runner.os, "getuid", lambda: 501, raising=False)
    monkeypatch.setattr(runner.subprocess, "run", lambda *_args, **_kwargs:
                        SimpleNamespace(returncode=1, stderr="bootout denied", stdout=""))

    with pytest.raises(runner.RunnerError, match="bootout denied"):
        runner.unregister_task()

    assert runner.LAUNCH_AGENT_PATH.exists()

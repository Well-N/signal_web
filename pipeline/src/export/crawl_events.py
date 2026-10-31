"""Append-only crawl telemetry for the visualizer.

Each line is one JSON object: {kind, at, ...}. The web layer reads this file to
animate a run while it happens and to replay the last run afterwards.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_DIR = Path(__file__).resolve().parents[2] / "data" / "state"
EVENTS_PATH = STATE_DIR / "crawl-events.jsonl"


def reset_events() -> None:
    """Start a new run log. Old events belong to the previous run."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    EVENTS_PATH.write_text("", encoding="utf-8")


def emit_event(kind: str, **fields: Any) -> None:
    event = {
        "kind": kind,
        "at": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with EVENTS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError as exc:
        if sys.stderr is not None:
            print(f"crawl telemetry write failed: {exc}", file=sys.stderr)


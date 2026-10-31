"""Fetch configured sources without invoking the LLM.

This is a diagnostic helper for checking feed availability and source health.
It does not write a briefing and does not create placeholder content.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from rich.console import Console

from src.orchestrator import HorizonOrchestrator
from src.storage.manager import StorageManager

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


async def main() -> None:
    storage = StorageManager(data_dir="data")
    config = storage.load_config()
    orchestrator = HorizonOrchestrator(config, storage, console=Console())
    since = datetime.now(timezone.utc) - timedelta(
        hours=config.collection.time_window_hours
    )
    items = await orchestrator.fetch_all_sources(since)
    print("fetched_items:", len(items))
    if orchestrator.last_fetch_report is not None:
        report = orchestrator.last_fetch_report.to_dict()
        print("fetch_status:", report["status"])
        for source in report["sources"]:
            print(
                source["source"],
                source["status"],
                source["item_count"],
                source.get("error", ""),
            )


if __name__ == "__main__":
    asyncio.run(main())

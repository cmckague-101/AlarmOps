import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync_supabase import selection_priority


def args(**overrides):
    values = {"force": False, "file_id": None, "incremental_only": False, "recheck_days": 7}
    values.update(overrides)
    return SimpleNamespace(**values)


def item(name="Engine Type 3"):
    return {"id": 123, "name": name}


def previous(status="complete", name="Engine Type 3", checked_days_ago=1):
    return {
        "name": name,
        "sync_status": status,
        "last_checked_at": datetime.now(timezone.utc) - timedelta(days=checked_days_ago),
        "pdf_sha256": "abc",
    }


def test_new_and_metadata_changed_lists_have_highest_priority():
    assert selection_priority(item(), None, args()) == 0
    assert selection_priority(item(), previous(name="Old name"), args()) == 0


def test_retries_run_before_pending_backfill():
    assert selection_priority(item(), previous(status="partial"), args()) == 1
    assert selection_priority(item(), previous(status="failed"), args()) == 1
    assert selection_priority(item(), previous(status="pending"), args()) == 2


def test_incremental_mode_skips_complete_list_reconciliation():
    old = previous(checked_days_ago=30)
    assert selection_priority(item(), old, args(incremental_only=True)) is None
    assert selection_priority(item(), old, args()) == 3


def test_recent_complete_list_is_not_selected():
    assert selection_priority(item(), previous(checked_days_ago=1), args()) is None

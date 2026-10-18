import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sync_supabase
from scraper import UpstreamNotFoundError
from sync_supabase import process_list, selection_priority


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


def test_missing_agreement_pdf_is_warning_not_retryable_error(monkeypatch):
    class Client:
        @staticmethod
        def dpl_pdf(file_id):
            return SimpleNamespace(content=b"dpl")

        @staticmethod
        def agreement_pdf(piid):
            raise UpstreamNotFoundError("missing")

    monkeypatch.setattr(
        sync_supabase,
        "parse_dpl",
        lambda content: {
            "dispatch_center": "Test Center",
            "resource_type": "Test Type",
            "published_on": None,
            "rows": [
                {
                    "rank": "1",
                    "agreement_piid": "12024B26T8994",
                    "company_name": "Test Company",
                    "vin": "TEST-VIN",
                }
            ],
        },
    )

    parsed, _, agreements, errors, warnings = process_list(Client(), {"id": 1})
    assert agreements == {}
    assert errors == []
    assert warnings == ["12024B26T8994: agreement PDF unavailable from USDA (404)"]
    assert parsed["rows"][0]["rate_status"] == "not_found"

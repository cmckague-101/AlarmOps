import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync_supabase as sync

NOW = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)


def catalog(size=70, age=1, status="complete"):
    lists = [{"id": i, "name": f"List {i}"} for i in range(size)]
    old = {item["id"]: {
        "name": item["name"], "sync_status": status,
        "synced_at": NOW - timedelta(days=age),
        "last_checked_at": NOW - timedelta(days=age), "last_error": None,
        "pdf_sha256": "hash",
    } for item in lists}
    return lists, old


def succeed(old, selected, now):
    for item in selected:
        old[item["id"]].update(synced_at=now, last_checked_at=now,
                               sync_status="complete", last_error=None)


def test_weekly_rotation_covers_catalog_and_stays_current_with_timing_jitter():
    lists, old = catalog()
    seen = set()
    for day in range(21):
        now = NOW + timedelta(days=day, minutes=day * 3)
        selected, plan = sync.weekly_plan(lists, old, now)
        assert plan["baseline"] == 10
        assert len(selected) <= 20
        seen.update(item["id"] for item in selected)
        succeed(old, selected, now)
        assert sync.weekly_coverage(lists, old, now)["overdue"] == 0
        if day == 6:
            assert len(seen) == 70


def test_new_and_renamed_lists_are_extra_to_rotation():
    lists, old = catalog()
    lists.append({"id": 70, "name": "New"})
    lists[0]["name"] = "Renamed"
    selected, plan = sync.weekly_plan(lists, old, NOW)
    assert {0, 70} <= {item["id"] for item in selected}
    assert plan["new_or_renamed"] == 2
    assert plan["rotation"] == 11


def test_pending_backfill_is_split_over_seven_runs():
    lists, old = catalog(status="pending")
    for row in old.values():
        row.update(synced_at=None, last_checked_at=None)
    for day in range(7):
        now = NOW + timedelta(days=day)
        selected, plan = sync.weekly_plan(lists, old, now)
        assert 10 <= plan["rotation"] <= 20
        succeed(old, selected, now)
    assert sync.weekly_coverage(lists, old, now)["never_successful"] == 0


def test_missed_runs_expand_quota_to_catch_deadlines():
    lists, old = catalog(age=8)
    selected, plan = sync.weekly_plan(lists, old, NOW)
    assert len(selected) == 70
    assert plan["baseline"] == 10
    assert plan["deadline_catchup"] == 70


def test_pending_backfill_cannot_displace_imminent_deadlines():
    lists, old = catalog(age=6)
    for i in range(60):
        old[i].update(synced_at=None, sync_status="pending")
    selected, plan = sync.weekly_plan(lists, old, NOW)
    assert set(range(60, 70)) <= {item["id"] for item in selected}
    assert len(selected) == 20
    assert plan["deadline_catchup"] == 10


def test_retries_are_bounded_and_rotate_without_starving_healthy_lists():
    lists, old = catalog()
    for i in range(35):
        old[i]["sync_status"] = "failed"
    retried = set()
    for day in range(7):
        now = NOW + timedelta(days=day)
        selected, plan = sync.weekly_plan(lists, old, now)
        assert plan["rotation"] == 10
        assert plan["retries"] == 3
        assert plan["retries_deferred"] == 32
        for item in selected:
            if old[item["id"]]["sync_status"] == "failed":
                retried.add(item["id"])
                old[item["id"]]["last_checked_at"] = now
            else:
                succeed(old, [item], now)
    assert len(retried) == 21


def test_coverage_does_not_treat_attempts_or_missing_agreements_as_success():
    lists, old = catalog(size=6)
    old[1].update(sync_status="failed", synced_at=NOW - timedelta(days=10), last_checked_at=NOW)
    old[2].update(sync_status="partial", synced_at=None, last_checked_at=NOW)
    old[3].update(last_error="agreement unavailable")  # Legacy complete-with-warning record.
    old[4].update(synced_at=None, last_checked_at=None, sync_status="pending")
    lists[5]["name"] = "Renamed"
    assert sync.weekly_coverage(lists, old, NOW) == {
        "total": 6, "current_7_days": 1, "overdue": 3,
        "never_successful": 2, "never_checked": 1, "failed_or_partial": 3,
    }
    selected, plan = sync.weekly_plan(lists, old, NOW)
    assert plan["new_or_renamed"] == 1
    assert plan["retries_deferred"] == 2


@pytest.mark.parametrize("flag", ["--force", "--limit=5", "--area-id=1", "--dry-run", "--metadata-only", "--incremental-only"])
def test_weekly_rejects_ambiguous_or_incomplete_modes(monkeypatch, flag):
    monkeypatch.setattr(sys, "argv", ["sync", "--weekly", flag])
    with pytest.raises(SystemExit, match="--weekly requires"):
        sync.main()


@pytest.mark.parametrize("errors", [[], ["parse failed"]])
def test_weekly_runner_fresh_downloads_disposable_cache_and_safe_cleanup(monkeypatch, tmp_path, capsys, errors):
    lists, old = catalog(size=7)
    for row in old.values():
        row.update(synced_at=datetime.now(timezone.utc) - timedelta(days=1),
                   last_checked_at=datetime.now(timezone.utc) - timedelta(days=1))
    monkeypatch.setattr(sys, "argv", ["sync", "--weekly", "--cleanup"])
    monkeypatch.setenv("FS_USER_AGENT", "test")
    constructed = []

    def client(*args, **kwargs):
        constructed.append(kwargs)
        return SimpleNamespace(cache_dir=tmp_path, pdf_downloads=1, pdf_cache_hits=0)

    monkeypatch.setattr(sync, "ForestServiceClient", client)
    monkeypatch.setattr(sync, "discover", lambda *a: ([{}], [{}], lists))
    monkeypatch.setattr(sync, "connect_database", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(sync, "existing_lists", lambda c: old)
    monkeypatch.setattr(sync, "existing_agreements", lambda c: {})
    monkeypatch.setattr(sync, "create_run", lambda *a: 1)
    for name in ("acquire_sync_lock", "upsert_catalog", "finish_run"):
        monkeypatch.setattr(sync, name, lambda *a, **kw: None)
    (tmp_path / "agreement-prior.pdf").write_bytes(b"old cache")
    (tmp_path / "notes.pdf").write_bytes(b"keep")

    def process(*args):
        assert not (tmp_path / "agreement-prior.pdf").exists()
        (tmp_path / "dpl-1.pdf").write_bytes(b"current run")
        (tmp_path / "dpl-1.sha256").write_text("hash")
        return {"rows": []}, "hash", {}, errors, []

    monkeypatch.setattr(sync, "process_list", process)
    monkeypatch.setattr(sync, "write_list", lambda c, item, *a: succeed(old, [item], datetime.now(timezone.utc)))
    cleaned = []
    monkeypatch.setattr(sync, "cleanup_obsolete", lambda *a: cleaned.append(True) or {})
    assert sync.main() == (1 if errors else 0)
    assert {p.name for p in tmp_path.iterdir()} == {"notes.pdf"}
    output = capsys.readouterr().out
    assert "Weekly cache: removed 1 prior-run files" in output
    assert "Weekly cache: removed 2 run files" in output
    assert constructed == [{"fresh_pdfs": True}]
    assert "Weekly plan:" in output
    assert "Weekly coverage after:" in output
    assert "Selected: 1; deferred by weekly rotation: 6" in output
    assert cleaned == ([] if errors else [True])


@pytest.mark.parametrize("errors,status", [([], "complete"), (["parse failed"], "partial")])
def test_warning_write_separates_warnings_from_errors(errors, status):
    statements = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, sql, params):
            statements.append((sql, params))

    connection = SimpleNamespace(cursor=Cursor, commit=lambda: None)
    sync.write_list(connection, {"id": 1}, {"rows": []}, "hash", {}, errors, ["404"])
    update, params = statements[-1]
    assert params[4] == status
    assert params[5] == ("parse failed" if errors else None)
    assert params[6] == "404"
    assert params[-2] == status
    assert "synced_at = case when %s = 'complete'" in update
    assert "last_warning = %s" in update


def test_warning_only_success_counts_as_current_and_rotates_normally():
    lists, old = catalog(size=7)
    old[6]["last_warning"] = "agreement PDF unavailable from USDA (404)"
    assert sync.weekly_coverage(lists, old, NOW)["current_7_days"] == 7
    _, plan = sync.weekly_plan(lists, old, NOW)
    assert plan["retries"] == 0
    selected, _ = sync.weekly_plan(lists, old, NOW + timedelta(days=6))
    assert 6 in {item["id"] for item in selected}

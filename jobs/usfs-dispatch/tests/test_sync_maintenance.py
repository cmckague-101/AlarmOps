import os
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sync_supabase as sync
from scraper import ForestServiceClient, UpstreamError


def test_pdf_changes_are_content_based():
    assert sync.pdf_change(None, "abc") == "new"
    assert sync.pdf_change("abc", "def") == "changed"
    assert sync.pdf_change("abc", "abc") == "unchanged"


def test_fresh_mode_downloads_once_per_pdf_per_run(tmp_path, monkeypatch):
    path = tmp_path / "dpl-1.pdf"
    path.write_bytes(b"%PDF old")
    client = ForestServiceClient(tmp_path, fresh_pdfs=True)
    calls = []

    def request(url):
        calls.append(url)
        return b"%PDF updated", {}

    monkeypatch.setattr(client, "_request", request)
    assert client.dpl_pdf(1).content == b"%PDF updated"
    assert client.dpl_pdf(1).from_cache
    assert len(calls) == 1
    assert client.pdf_downloads == 1
    assert client.pdf_cache_hits == 1
    # Freshness must not survive across daily runs.
    next_client = ForestServiceClient(tmp_path, fresh_pdfs=True)
    monkeypatch.setattr(next_client, "_request", request)
    next_client.dpl_pdf(1)
    assert len(calls) == 2


def test_normal_mode_can_reuse_recent_disk_pdf(tmp_path, monkeypatch):
    (tmp_path / "dpl-1.pdf").write_bytes(b"%PDF cached")
    client = ForestServiceClient(tmp_path)
    monkeypatch.setattr(client, "_request", lambda url: pytest.fail("unexpected download"))
    assert client.dpl_pdf(1).from_cache


def test_fresh_download_failure_does_not_silently_use_old_pdf(tmp_path, monkeypatch):
    path = tmp_path / "dpl-1.pdf"
    path.write_bytes(b"%PDF last known")
    client = ForestServiceClient(tmp_path, fresh_pdfs=True)

    def fail(url):
        raise UpstreamError("offline")

    monkeypatch.setattr(client, "_request", fail)
    with pytest.raises(UpstreamError, match="offline"):
        client.dpl_pdf(1)
    assert path.read_bytes() == b"%PDF last known"


def test_prune_only_old_managed_cache_files(tmp_path):
    old = time.time() - 31 * 86400
    for name in ("dpl-1.pdf", "dpl-1.sha256", "agreement-ABC.pdf", "notes.pdf", "dpl-1.tmp"):
        path = tmp_path / name
        path.write_bytes(b"test")
        os.utime(path, (old, old))
    (tmp_path / "dpl-2.pdf").write_bytes(b"recent")
    (tmp_path / "dpl-link.pdf").symlink_to(tmp_path / "notes.pdf")
    assert sync.prune_cache(tmp_path, 30) == 3
    assert {p.name for p in tmp_path.iterdir()} == {
        "notes.pdf", "dpl-1.tmp", "dpl-2.pdf", "dpl-link.pdf",
    }


@pytest.mark.parametrize("flag", ["--dry-run", "--metadata-only", "--incremental-only", "--area-id=1"])
def test_cleanup_rejects_incomplete_scopes(monkeypatch, flag):
    monkeypatch.setattr(sys, "argv", ["sync", "--cleanup", flag])
    with pytest.raises(SystemExit, match="full database catalog"):
        sync.main()


def test_empty_catalog_cannot_deactivate_or_cleanup(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", ["sync", "--cleanup"])
    monkeypatch.setenv("FS_USER_AGENT", "test")
    monkeypatch.setattr(sync, "ForestServiceClient", lambda *a, **kw: object())
    monkeypatch.setattr(sync, "discover", lambda *a: ([], [], []))
    monkeypatch.setattr(sync, "connect_database", lambda: pytest.fail("must not write"))
    with pytest.raises(SystemExit, match="Empty USDA catalog"):
        sync.main()


def setup_run(monkeypatch, tmp_path, *, warnings=(), errors=(), limit=None):
    monkeypatch.setenv("FS_USER_AGENT", "test")
    argv = ["sync", "--force"]
    argv += ["--cleanup"] if limit is None else [f"--limit={limit}"]
    monkeypatch.setattr(sys, "argv", argv)
    client = SimpleNamespace(cache_dir=tmp_path, pdf_downloads=2, pdf_cache_hits=1)
    monkeypatch.setattr(sync, "ForestServiceClient", lambda *a, **kw: client)
    catalog = [{"id": i, "name": f"List {i}"} for i in (1, 2)]
    monkeypatch.setattr(sync, "discover", lambda *a: ([{}], [{}], catalog))
    connection = SimpleNamespace(close=lambda: None, rollback=lambda: None)
    monkeypatch.setattr(sync, "connect_database", lambda: connection)
    monkeypatch.setattr(sync, "existing_lists", lambda c: {
        1: {"pdf_sha256": "same", "last_checked_at": None},
        2: {"pdf_sha256": "old", "last_checked_at": None},
    })
    monkeypatch.setattr(sync, "existing_agreements", lambda c: {"A": "same"})
    for name in ("acquire_sync_lock", "upsert_catalog", "write_list", "finish_run"):
        monkeypatch.setattr(sync, name, lambda *a, **kw: None)
    monkeypatch.setattr(sync, "create_run", lambda *a: 1)
    monkeypatch.setattr(sync, "process_list", lambda c, item: (
        {"rows": [{}, {}]}, "same" if item["id"] == 1 else "updated",
        {"A": {"sha256": "same"}}, list(errors), list(warnings),
    ))


def test_full_run_reports_actual_changes_and_cleans(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path)
    calls = []
    monkeypatch.setattr(sync, "cleanup_obsolete", lambda *a: calls.append(a) or {})
    assert sync.main() == 0
    output = capsys.readouterr().out
    assert "Eligible: 2" in output
    assert "Selected: 2; deferred: 0" in output
    assert "DPL PDFs: 0 new, 1 changed, 1 unchanged" in output
    assert "Agreement PDFs: 0 new, 0 changed, 1 unchanged" in output
    assert "4 equipment rows written" in output
    assert len(calls) == 1


def test_cleanup_skipped_on_errors(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path, errors=["parse failed"])
    monkeypatch.setattr(sync, "cleanup_obsolete", lambda *a: pytest.fail("unsafe cleanup"))
    assert sync.main() == 1
    assert "Cleanup skipped" in capsys.readouterr().out


def test_missing_agreement_warning_does_not_block_cleanup(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path, warnings=["agreement PDF unavailable from USDA (404)"])
    calls = []
    monkeypatch.setattr(sync, "cleanup_obsolete", lambda *a: calls.append(a) or {})
    assert sync.main() == 0
    assert len(calls) == 1
    assert "2 warnings" in capsys.readouterr().out


def test_cap_reports_backlog(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path, limit=1)
    assert sync.main() == 0
    assert "Selected: 1; deferred: 1" in capsys.readouterr().out


def test_cleanup_allows_capped_work_after_full_catalog_discovery(monkeypatch, tmp_path):
    setup_run(monkeypatch, tmp_path, limit=1)
    monkeypatch.setattr(sys, "argv", ["sync", "--force", "--limit=1", "--cleanup"])
    calls = []
    monkeypatch.setattr(sync, "cleanup_obsolete", lambda *a: calls.append(a) or {})
    assert sync.main() == 0
    assert len(calls) == 1


def test_cap_selects_oldest_check_first(monkeypatch, tmp_path):
    setup_run(monkeypatch, tmp_path, limit=1)
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sync, "existing_lists", lambda c: {
        1: {"last_checked_at": now},
        2: {"last_checked_at": now - timedelta(days=10)},
    })
    selected = []
    monkeypatch.setattr(sync, "process_list", lambda c, item: (
        selected.append(item["id"]) or {"rows": []}, "hash", {}, [], [],
    ))
    assert sync.main() == 0
    assert selected == [2]


def test_database_cleanup_uses_retention_and_protects_references(tmp_path):
    statements = []

    class Cursor:
        rowcount = 2

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, sql, params):
            statements.append((sql, params))

    connection = SimpleNamespace(cursor=Cursor, commit=lambda: None)
    result = sync.cleanup_obsolete(connection, tmp_path, 30)
    assert result == {"retired_lists": 2, "orphan_agreements": 2, "cached_files": 0}
    assert "not is_active" in statements[0][0]
    assert "last_seen_at" in statements[0][0]
    assert "not exists" in statements[1][0]
    assert "usfs_dpl_entries" in statements[1][0]
    assert all(params == (30,) for _, params in statements)

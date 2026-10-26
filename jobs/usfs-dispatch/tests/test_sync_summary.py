from test_sync_maintenance import setup_run

import sync_supabase as sync


def test_final_summary_includes_all_errors_and_warnings(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path, errors=["parse failed"], warnings=["agreement 404"])
    assert sync.main() == 1
    output = capsys.readouterr().out
    summary = output[output.index("Error summary (2):"):]
    for file_id in (1, 2):
        assert f"ERROR: DPL {file_id} parse failed" in summary
        assert f"WARNING: DPL {file_id} agreement 404" in summary
    assert "Warning summary (2):" in summary
    assert "2 errors, 2 warnings" in summary


def test_final_summary_includes_cleanup_failure(monkeypatch, tmp_path, capsys):
    setup_run(monkeypatch, tmp_path)

    def fail(*args):
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(sync, "cleanup_obsolete", fail)
    assert sync.main() == 1
    output = capsys.readouterr().out
    assert "Error summary (1):\n  ERROR: Cleanup: cleanup failed" in output

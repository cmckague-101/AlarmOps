import os
import subprocess
from pathlib import Path

import pytest


RUNNER = Path(__file__).resolve().parents[1] / "hotelsRun.sh"


def runner_env(tmp_path):
    env = os.environ.copy()
    for key in ("SUPABASE_DB_URL", "FS_USER_AGENT", "FEDROOMS_USER_AGENT", "FEDROOMS_VENV", "VENV"):
        env.pop(key, None)
    env["HOME"] = str(tmp_path)
    return env


def run_runner(tmp_path, env):
    return subprocess.run(
        ["bash", str(RUNNER)],
        cwd=tmp_path,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=5,
    )


@pytest.mark.parametrize("missing", ["SUPABASE_DB_URL", "FS_USER_AGENT"])
def test_unattended_runner_requires_config(tmp_path, missing):
    env = runner_env(tmp_path)
    env.update(SUPABASE_DB_URL="test-db", FS_USER_AGENT="FireOps/1.0 (test@example.com)")
    env.pop(missing)
    result = run_runner(tmp_path, env)
    assert result.returncode == 1
    assert "required for unattended runs" in result.stderr
    assert "test-db" not in result.stdout + result.stderr


def test_missing_virtualenv_ignores_vipr_venv(tmp_path):
    vipr = tmp_path / "vipr"
    (vipr / "bin").mkdir(parents=True)
    (vipr / "bin" / "python").write_text("#!/bin/bash\n")
    (vipr / "bin" / "python").chmod(0o755)
    env = runner_env(tmp_path)
    env.update(SUPABASE_DB_URL="test-db", FS_USER_AGENT="test-contact", VENV=str(vipr))
    result = run_runner(tmp_path, env)
    assert result.returncode == 1
    assert "Missing virtualenv:" in result.stderr and "fedrooms-venv" in result.stderr
    assert "README.md" in result.stderr


@pytest.mark.parametrize("sync_exit", [0, 1])
def test_runner_logs_result_and_waits_even_after_sync_failure(tmp_path, sync_exit):
    env = runner_env(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    scripts = {
        "python": (
            '#!/bin/bash\nprintf "cwd=%s\\n" "$PWD"\n'
            'printf "arg=%s\\n" "$@"\n'
            'printf "unbuffered=%s; agent=%s\\n" "$PYTHONUNBUFFERED" "$FEDROOMS_USER_AGENT"\n'
            f"exit {sync_exit}\n"
        ),
        "date": '#!/bin/bash\nif [[ "$1" == +%s ]]; then echo 100; else echo test-date; fi\n',
        # Exit after one loop; no real network requests or sleeping.
        "sleep": '#!/bin/bash\nprintf "sleep=%s\\n" "$1"\nexit 73\n',
    }
    for name, content in scripts.items():
        script = bin_dir / name
        script.write_text(content)
        script.chmod(0o755)
    env.update(
        SUPABASE_DB_URL="test-db",
        FS_USER_AGENT="test-contact",
        FEDROOMS_VENV=str(tmp_path),
        PATH=f"{bin_dir}:{env['PATH']}",
    )
    result = run_runner(tmp_path, env)
    assert result.returncode == 73, result.stderr
    assert f"cwd={RUNNER.parents[2]}" in result.stdout
    assert "arg=jobs/fedrooms-hotels/sync_hotels.py\n" in result.stdout
    assert "unbuffered=1; agent=test-contact" in result.stdout
    assert f"Finished: exit code {sync_exit};" in result.stdout
    assert "sleep=86400" in result.stdout

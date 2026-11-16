#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Require either direct Postgres (SUPABASE_DB_URL) or HTTPS (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
if [[ -z "${SUPABASE_DB_URL:-}" && ( -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ) ]]; then
  if [[ ! -t 0 ]]; then
    echo "Supabase configuration is required for unattended runs (either SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)." >&2
    exit 1
  fi
  read -rsp "Supabase Postgres session connection URL (leave blank to use HTTPS RPC): " SUPABASE_DB_URL || true
  echo
  if [[ -z "$SUPABASE_DB_URL" ]]; then
    read -rp "Supabase project URL (https://xyz.supabase.co): " SUPABASE_URL
    read -rsp "Supabase service role key: " SUPABASE_SERVICE_ROLE_KEY
    echo
  fi
fi
export SUPABASE_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

if [[ -z "${FS_USER_AGENT:-}" ]]; then
  if [[ ! -t 0 ]]; then
    echo "FS_USER_AGENT is required for unattended runs (include a monitored contact email)." >&2
    exit 1
  fi
  read -rp "Monitored contact email: " CONTACT
  [[ -n "$CONTACT" ]] || { echo "Contact email is required." >&2; exit 1; }
  FS_USER_AGENT="FireOps/1.0 ($CONTACT)"
fi
export FS_USER_AGENT
export FS_REQUEST_INTERVAL="${FS_REQUEST_INTERVAL:-3}"
export PYTHONUNBUFFERED=1

VENV="${VENV:-$HOME/.local/share/fireops/usfs-venv}"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing virtualenv: $VENV. Follow jobs/usfs-dispatch/README.md setup instructions." >&2
  exit 1
fi

while true; do
  next_run=$(( $(date +%s) + 86400 ))
  printf '\n=== VIPR sync started: %s ===\n' "$(date)"

  if "$VENV/bin/python" jobs/usfs-dispatch/sync_supabase.py \
    --weekly --fresh-pdfs --cleanup --retention-days 30; then
    result=0
  else
    result=$?
  fi
  printf '\n=== Finished: exit code %s; %s ===\n' "$result" "$(date)"
  printf 'Next run: %s\n' "$(date -d "@$next_run")"

  delay=$(( next_run - $(date +%s) ))
  sleep "$(( delay > 0 ? delay : 60 ))"
done

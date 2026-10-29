#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  if [[ ! -t 0 ]]; then
    echo "SUPABASE_DB_URL is required for unattended runs." >&2
    exit 1
  fi
  read -rsp "Supabase Postgres session connection URL: " SUPABASE_DB_URL
  echo
fi
export SUPABASE_DB_URL

# Shares the VIPR service config, so fall back to its user agent.
FEDROOMS_USER_AGENT="${FEDROOMS_USER_AGENT:-${FS_USER_AGENT:-}}"
if [[ -z "$FEDROOMS_USER_AGENT" ]]; then
  if [[ ! -t 0 ]]; then
    echo "FEDROOMS_USER_AGENT or FS_USER_AGENT is required for unattended runs (include a monitored contact email)." >&2
    exit 1
  fi
  read -rp "Monitored contact email: " CONTACT
  [[ -n "$CONTACT" ]] || { echo "Contact email is required." >&2; exit 1; }
  FEDROOMS_USER_AGENT="FireOps/1.0 ($CONTACT)"
fi
export FEDROOMS_USER_AGENT
export PYTHONUNBUFFERED=1

# Not VENV: the shared VIPR config sets that to the USFS virtualenv.
FEDROOMS_VENV="${FEDROOMS_VENV:-$HOME/.local/share/fireops/fedrooms-venv}"
if [[ ! -x "$FEDROOMS_VENV/bin/python" ]]; then
  echo "Missing virtualenv: $FEDROOMS_VENV. Follow jobs/fedrooms-hotels/README.md setup instructions." >&2
  exit 1
fi

while true; do
  next_run=$(( $(date +%s) + 86400 ))
  printf '\n=== FedRooms hotel sync started: %s ===\n' "$(date)"

  if "$FEDROOMS_VENV/bin/python" jobs/fedrooms-hotels/sync_hotels.py; then
    result=0
  else
    result=$?
  fi
  printf '\n=== Finished: exit code %s; %s ===\n' "$result" "$(date)"
  printf 'Next run: %s\n' "$(date -d "@$next_run")"

  delay=$(( next_run - $(date +%s) ))
  sleep "$(( delay > 0 ? delay : 60 ))"
done

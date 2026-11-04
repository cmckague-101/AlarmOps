#!/usr/bin/env bash
# Show runner health and latest journal entry; online does not imply sync success.
set -u

for command in systemctl journalctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command missing: %s\n' "$command" >&2
    exit 1
  fi
done

exit_status=0
for service in fireco-vipr.service fireco-hotels.service; do
  if state=$(systemctl show "$service" --property=ActiveState --value 2>/dev/null); then
    if [[ "$state" == active ]]; then
      status=online
    else
      status="offline (${state:-unknown})"
      exit_status=1
    fi
  else
    status='unknown (status unavailable)'
    exit_status=1
  fi

  if ! log=$(journalctl -u "$service" -n 1 --no-pager --quiet -o short-iso 2>/dev/null); then
    log='log unavailable (try sudo ./status.sh)'
  elif [[ -z "$log" ]]; then
    log='no visible logs (try sudo ./status.sh)'
  fi
  # Keep multiline journal messages on a single output line.
  log=${log//$'\n'/ }
  log=${log//$'\r'/ }
  printf '%s | %s | %s\n' "$service" "$status" "$log"
done

exit "$exit_status"

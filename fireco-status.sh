#!/usr/bin/env bash
# Usage: ./fireco-status.sh [log-lines]
lines="${1:-50}"

if [[ ! "$lines" =~ ^[0-9]+$ ]]; then
  printf 'Usage: %s [log-lines: nonnegative integer]\n' "$0" >&2
  exit 2
fi

for service in fireco-hotels.service fireco-vipr.service; do
  printf '\n========== %s ==========\n' "$service"
  systemctl status "$service" --no-pager --full || true

  printf '\n--- Recent logs ---\n'
  journalctl -u "$service" -n "$lines" --no-pager
done

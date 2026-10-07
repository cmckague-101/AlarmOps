#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

for command_name in git node npm npx; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Git worktree is dirty. Commit changes before a production deployment." >&2
  git -C "$ROOT_DIR" status --short >&2
  exit 1
fi

cd "$MOBILE_DIR"

cat <<'EOF'
Queuing production jobs in EAS:
  iOS:    build, then submit to App Store Connect
  Android: build only
EOF

echo
echo "==> Checking EAS login and project"
npx eas-cli whoami
npx eas-cli project:info

echo
echo "==> Queuing iOS production build and App Store Connect submission"
npx eas-cli build \
  --platform ios \
  --profile production \
  --auto-submit \
  --no-wait

echo
echo "==> Queuing Android production build"
npx eas-cli build \
  --platform android \
  --profile production \
  --no-wait

cat <<'EOF'

Jobs queued. Track them with:
  cd apps/mobile
  npx eas-cli build:list --limit 2
  npx eas-cli submit:list --platform ios --limit 1

A successful iOS submission uploads the build to App Store Connect. Public App
Store release still requires review/release in App Store Connect.
EOF

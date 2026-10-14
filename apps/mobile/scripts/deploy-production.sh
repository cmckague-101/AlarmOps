#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
APP_CONFIG="$MOBILE_DIR/app.json"
BUILD_IOS=1
BUILD_ANDROID=1
EXPECTED_IOS_VERSION=""

usage() {
  cat <<'EOF'
Usage: deploy-production.sh [options]

Queues production EAS builds. iOS builds require an explicit marketing version
to prevent submission to an old or closed App Store release train.

Options:
  --ios-only             Build and submit iOS only
  --android-only         Build Android only
  --ios-version VERSION  Required when building iOS; must match expo.version
  -h, --help             Show this help

Examples:
  npm run deploy:mobile:production -- --ios-only --ios-version 1.0.6
  npm run deploy:mobile:production -- --ios-version 1.0.6
  npm run deploy:mobile:production -- --android-only
EOF
}

while (($#)); do
  case "$1" in
    --ios-only)
      BUILD_IOS=1
      BUILD_ANDROID=0
      ;;
    --android-only)
      BUILD_IOS=0
      BUILD_ANDROID=1
      ;;
    --ios-version)
      if (($# < 2)); then
        echo "--ios-version requires a value." >&2
        usage >&2
        exit 1
      fi
      EXPECTED_IOS_VERSION="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$BUILD_IOS" -eq 1 ]]; then
  if [[ ! "$EXPECTED_IOS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "iOS deployment requires --ios-version in X.Y.Z format." >&2
    usage >&2
    exit 1
  fi
elif [[ -n "$EXPECTED_IOS_VERSION" ]]; then
  echo "--ios-version cannot be used with --android-only." >&2
  exit 1
fi

for command_name in git node npm npx; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ "$BUILD_IOS" -eq 1 ]]; then
  CONFIGURED_IOS_VERSION="$(node -e "const c=require(process.argv[1]); process.stdout.write(c.expo?.version || '')" "$APP_CONFIG")"
  if [[ "$CONFIGURED_IOS_VERSION" != "$EXPECTED_IOS_VERSION" ]]; then
    cat >&2 <<EOF
Refusing iOS deployment: requested version $EXPECTED_IOS_VERSION does not match
expo.version $CONFIGURED_IOS_VERSION in apps/mobile/app.json.

Set expo.version to a version higher than the latest approved App Store version,
commit that change, then rerun this command.
EOF
    exit 1
  fi
fi

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Git worktree is dirty. Commit changes before a production deployment." >&2
  git -C "$ROOT_DIR" status --short >&2
  exit 1
fi

cd "$MOBILE_DIR"

echo "Queuing production jobs in EAS:"
if [[ "$BUILD_IOS" -eq 1 ]]; then
  echo "  iOS:    version $EXPECTED_IOS_VERSION, auto-incremented build, then submit to App Store Connect"
fi
if [[ "$BUILD_ANDROID" -eq 1 ]]; then
  echo "  Android: build only"
fi

echo
echo "==> Checking EAS login and project"
npx eas-cli whoami
npx eas-cli project:info

if [[ "$BUILD_IOS" -eq 1 ]]; then
  echo
  echo "==> Queuing iOS $EXPECTED_IOS_VERSION production build and App Store Connect submission"
  npx eas-cli build \
    --platform ios \
    --profile production \
    --auto-submit \
    --no-wait
fi

if [[ "$BUILD_ANDROID" -eq 1 ]]; then
  echo
  echo "==> Queuing Android production build"
  npx eas-cli build \
    --platform android \
    --profile production \
    --no-wait
fi

cat <<'EOF'

Jobs queued. Track builds with:
  cd apps/mobile
  npx eas-cli build:list --limit 2
EOF

if [[ "$BUILD_IOS" -eq 1 ]]; then
  cat <<'EOF'

Track iOS submission with:
  cd apps/mobile
  npx eas-cli submit:list --platform ios --limit 1

Successful submission uploads build to App Store Connect. Public App Store
release still requires selecting build and submitting it for review there.
EOF
fi

#!/usr/bin/env bash

set -euo pipefail

EXPECTED_BUNDLE_ID="com.tinykings.fireops"
EXPECTED_PROJECT_ID="87cec740-d031-4aa2-9c0a-cf8151395d9e"
SKIP_CHECKS=0
ALLOW_DIRTY=0
BUILD_NUMBER=""

usage() {
  cat <<'EOF'
Usage: prepare-ios-app-store.sh BUILD_NUMBER [options]

Generates FireOps iOS native project for local Xcode archive and upload.
BUILD_NUMBER must exceed every build already uploaded to App Store Connect.

Options:
  --skip-checks  Skip typecheck, tests, web build, mobile lint, and Expo Doctor
  --allow-dirty  Allow preparation from a dirty Git worktree
  -h, --help     Show this help

Example:
  npm run ios:app-store:prepare -- 7
EOF
}

while (($#)); do
  case "$1" in
    --skip-checks)
      SKIP_CHECKS=1
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$BUILD_NUMBER" ]]; then
        echo "Only one build number may be supplied." >&2
        usage >&2
        exit 1
      fi
      BUILD_NUMBER="$1"
      ;;
  esac
  shift
done

if [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo "BUILD_NUMBER must be a positive integer." >&2
  usage >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
ENV_FILE="$MOBILE_DIR/.env.local"
APP_CONFIG="$MOBILE_DIR/app.json"
IOS_DIR="$MOBILE_DIR/ios"
PLIST="$IOS_DIR/FireOps/Info.plist"
WORKSPACE="$IOS_DIR/FireOps.xcworkspace"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS App Store preparation requires macOS." >&2
  exit 1
fi

for command_name in git node npm npx pod xcodebuild; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ ! -x /usr/libexec/PlistBuddy ]]; then
  echo "Missing required tool: /usr/libexec/PlistBuddy" >&2
  exit 1
fi

if [[ "$ALLOW_DIRTY" -eq 0 && -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Git worktree is dirty. Commit changes first or pass --allow-dirty." >&2
  git -C "$ROOT_DIR" status --short >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Copy apps/mobile/.env.example and add production publishable Supabase values." >&2
  exit 1
fi

require_env_value() {
  local key="$1"
  local value
  value="$(awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    echo "Missing $key in $ENV_FILE" >&2
    exit 1
  fi
  if [[ "$value" == *"your-project"* || "$value" == *"your-publishable-anon-key"* ]]; then
    echo "$key still contains placeholder value in $ENV_FILE" >&2
    exit 1
  fi
}

require_env_value "EXPO_PUBLIC_SUPABASE_URL"
require_env_value "EXPO_PUBLIC_SUPABASE_ANON_KEY"

VERSION="$(node -e "const c=require(process.argv[1]); process.stdout.write(c.expo.version || '')" "$APP_CONFIG")"
if [[ -z "$VERSION" ]]; then
  echo "expo.version is missing from $APP_CONFIG" >&2
  exit 1
fi

echo "Preparing FireOps iOS version $VERSION, build $BUILD_NUMBER"
echo "Repository: $ROOT_DIR"
echo

echo "==> Installing locked dependencies"
cd "$ROOT_DIR"
npm ci

if [[ "$SKIP_CHECKS" -eq 0 ]]; then
  echo "==> Running release checks"
  npm run typecheck
  npm test
  npm run build
  npm run lint --workspace=@fireops/mobile
  cd "$MOBILE_DIR"
  npx expo-doctor
else
  echo "==> Skipping release checks"
fi

cd "$MOBILE_DIR"
CONFIG_JSON="$(mktemp -t fireops-expo-config.XXXXXX)"
trap 'rm -f "$CONFIG_JSON"' EXIT

echo "==> Validating Expo configuration"
npx expo config --type public --json > "$CONFIG_JSON"
node - "$CONFIG_JSON" "$EXPECTED_BUNDLE_ID" "$EXPECTED_PROJECT_ID" "$VERSION" <<'NODE'
const fs = require('node:fs');
const [configPath, expectedBundleId, expectedProjectId, expectedVersion] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const failures = [];
if (config.ios?.bundleIdentifier !== expectedBundleId) {
  failures.push(`bundle identifier is ${config.ios?.bundleIdentifier || 'missing'}, expected ${expectedBundleId}`);
}
if (config.extra?.eas?.projectId !== expectedProjectId) {
  failures.push(`EAS project ID is ${config.extra?.eas?.projectId || 'missing'}, expected ${expectedProjectId}`);
}
if (config.version !== expectedVersion) {
  failures.push(`version is ${config.version || 'missing'}, expected ${expectedVersion}`);
}
if (failures.length) {
  console.error(`Invalid Expo configuration:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
NODE

echo "==> Regenerating native iOS project"
echo "    Existing apps/mobile/ios is generated and will be replaced."
npx expo prebuild --platform ios

if [[ ! -f "$PLIST" || ! -d "$WORKSPACE" ]]; then
  echo "Expo prebuild did not create expected FireOps workspace." >&2
  exit 1
fi

echo "==> Applying version $VERSION and build $BUILD_NUMBER"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$PLIST"

ACTUAL_BUNDLE_ID="$(xcodebuild -workspace "$WORKSPACE" -scheme FireOps -configuration Release -showBuildSettings 2>/dev/null | awk -F ' = ' '/PRODUCT_BUNDLE_IDENTIFIER = / { print $2; exit }')"
if [[ "$ACTUAL_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]]; then
  echo "Generated Xcode bundle identifier is '$ACTUAL_BUNDLE_ID', expected '$EXPECTED_BUNDLE_ID'." >&2
  exit 1
fi

cat <<EOF

Preparation complete.

Generated workspace:
  $WORKSPACE

Release identity:
  Version:   $VERSION
  Build:     $BUILD_NUMBER
  Bundle ID: $EXPECTED_BUNDLE_ID

Manual Xcode steps:
  1. Open workspace:
       open "$WORKSPACE"
  2. Select FireOps project → FireOps target → Signing & Capabilities.
  3. Enable Automatically manage signing and select Apple team owning
     $EXPECTED_BUNDLE_ID. Confirm Push Notifications capability exists.
  4. Open target Info and verify:
       Bundle versions string, short = $VERSION
       Bundle version                = $BUILD_NUMBER
  5. Select FireOps scheme and Any iOS Device (arm64).
  6. Choose Product → Archive.
  7. In Organizer, select archive → Distribute App → App Store Connect → Upload.
  8. Keep automatic signing and symbol upload enabled; validate, then upload.
  9. In App Store Connect → FireOps Fleet → TestFlight, wait for processing,
     resolve compliance prompts, and add build to tester group.

Uploading does not publish app. Public release still requires selecting build under
App Store Connect → FireOps Fleet → App Store and submitting version for review.
EOF

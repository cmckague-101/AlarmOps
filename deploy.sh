#!/usr/bin/env bash
#
# Interactive production deployment for FireOps.
#
#   Web:     git push -> Vercel deploys automatically.
#   iOS:     EAS cloud build + App Store Connect submit, or local build on macOS.
#   Android: EAS cloud build (optional Google Play submit), or local .aab build.
#
# Usage: ./deploy.sh [--dry-run]
#   --dry-run  Print the commands that would run without executing them.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
APP_CONFIG="$MOBILE_DIR/app.json"
BUILD_DIR="$ROOT_DIR/builds"
# Paths whose commits count as mobile app changes in the release notes.
MOBILE_PATHS=(apps/mobile packages)
DRY_RUN=0

case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "Unknown option: $1" >&2; exit 1 ;;
esac

# ---------- helpers ----------

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ask_yn "Question" [default y|n]
ask_yn() {
  local prompt="$1" default="${2:-n}" hint reply
  [[ "$default" == y ]] && hint="[Y/n]" || hint="[y/N]"
  while true; do
    read -r -p "$prompt $hint " reply
    reply="${reply:-$default}"
    case "$(printf %s "$reply" | tr "[:upper:]" "[:lower:]")" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
    esac
  done
}

# ask_choice VAR "Question" option1 option2 ...  (stores chosen option in VAR)
ask_choice() {
  local __var="$1" prompt="$2"; shift 2
  local options=("$@") i reply
  echo "$prompt"
  for i in "${!options[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${options[$i]}"
  done
  while true; do
    read -r -p "Choose [1-${#options[@]}]: " reply
    if [[ "$reply" =~ ^[0-9]+$ ]] && ((reply >= 1 && reply <= ${#options[@]})); then
      printf -v "$__var" '%s' "${options[$((reply - 1))]}"
      return
    fi
  done
}

run() {
  printf '\033[2m$ %s\033[0m\n' "$*"
  ((DRY_RUN)) && return 0
  "$@"
}

eas() { (cd "$MOBILE_DIR" && run npx eas-cli "$@"); }

app_version() {
  node -e "process.stdout.write(require(process.argv[1]).expo.version)" "$APP_CONFIG"
}

version_at() {
  git -C "$ROOT_DIR" show "$1:apps/mobile/app.json" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).expo.version))"
}

next_patch() {
  local major minor patch
  IFS=. read -r major minor patch <<<"$1"
  echo "$major.$minor.$((patch + 1))"
}

# ---------- preflight ----------

for cmd in git node npm npx; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
done

cd "$ROOT_DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
IS_MAC=0
[[ "$(uname -s)" == Darwin ]] && IS_MAC=1

bold "FireOps production deploy"
((DRY_RUN)) && warn "Dry run: commands are printed, not executed."
echo "Branch: $BRANCH    Mobile version (app.json): $(app_version)"
[[ "$BRANCH" != main ]] && warn "You are not on main; Vercel production deploys from main."
echo

if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working tree has uncommitted changes:"
  git status --short
  ask_yn "Continue anyway? (EAS builds upload the working tree)" n || exit 1
fi

if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git fetch --quiet || warn "git fetch failed; remote status may be stale."
  BEHIND="$(git rev-list --count 'HEAD..@{u}')"
  ((BEHIND > 0)) && warn "Branch is $BEHIND commit(s) behind its upstream. Consider 'git pull' first."
fi

# ---------- targets ----------

DO_WEB=0 DO_IOS=0 DO_ANDROID=0
ask_yn "Deploy web (git push -> Vercel)?" y && DO_WEB=1
ask_yn "Deploy iOS?" y && DO_IOS=1
ask_yn "Deploy Android?" y && DO_ANDROID=1
((DO_WEB + DO_IOS + DO_ANDROID > 0)) || die "Nothing selected."
echo

IOS_MODE="" ANDROID_MODE=""
if ((DO_IOS)); then
  ask_choice IOS_MODE "How should iOS be built?" \
    "EAS cloud build + submit to App Store Connect" \
    "Local build (macOS only)"
  echo
fi
if ((DO_ANDROID)); then
  ask_choice ANDROID_MODE "How should Android be built?" \
    "EAS cloud build" \
    "Local build (.aab)"
  echo
fi

IOS_LOCAL_ELSEWHERE=0
if [[ "$IOS_MODE" == Local* ]] && ((!IS_MAC)); then
  IOS_LOCAL_ELSEWHERE=1
fi

# ---------- mobile release notes + version ----------

if ((DO_IOS || DO_ANDROID)); then
  bold "Mobile changes"
  BUMPS=()
  while IFS= read -r sha; do BUMPS+=("$sha"); done \
    < <(git log --format=%H -G'"version"[[:space:]]*:' -- apps/mobile/app.json)
  if ((${#BUMPS[@]} == 0)); then
    warn "Could not find a version change in apps/mobile/app.json history."
    NOTES=""
  else
    BASE="${BUMPS[0]}"
    NOTES="$(git log --no-merges --format='- %s' "$BASE..HEAD" -- "${MOBILE_PATHS[@]}")"
    # Version was already bumped with nothing after it: show the release it started.
    if [[ -z "$NOTES" && ${#BUMPS[@]} -gt 1 ]]; then
      BASE="${BUMPS[1]}"
      NOTES="$(git log --no-merges --format='- %s' "$BASE..HEAD" -- "${MOBILE_PATHS[@]}")"
    fi
    echo "Since version $(version_at "$BASE") ($(git log -1 --format='%h, %as' "$BASE")):"
    echo
    echo "${NOTES:-  (no mobile changes found)}"
  fi
  echo

  CURRENT_VERSION="$(app_version)"
  SUGGESTED="$(next_patch "$CURRENT_VERSION")"
  echo "Current app.json version: $CURRENT_VERSION"
  echo "iOS needs a version higher than the latest approved App Store version."
  if ask_yn "Update the app version?" y; then
    while true; do
      read -r -p "New version [$SUGGESTED]: " NEW_VERSION
      NEW_VERSION="${NEW_VERSION:-$SUGGESTED}"
      [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
      echo "Use X.Y.Z format."
    done
    info "Setting expo.version to $NEW_VERSION and committing"
    if ((DRY_RUN)); then
      echo "(dry run) would update $APP_CONFIG"
    else
      node -e '
        const fs = require("fs"), [file, v] = process.argv.slice(1);
        const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
        cfg.expo.version = v;
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      ' "$APP_CONFIG" "$NEW_VERSION"
    fi
    run git commit -m "chore(mobile): bump version to $NEW_VERSION" -- apps/mobile/app.json
  fi
  VERSION="$(app_version)"
  ((DRY_RUN)) && VERSION="${NEW_VERSION:-$VERSION}"

  if [[ -n "${NOTES:-}" ]]; then
    mkdir -p "$BUILD_DIR"
    NOTES_FILE="$BUILD_DIR/release-notes-$VERSION.md"
    printf '%s\n' "$NOTES" >"$NOTES_FILE"
    echo "Release notes saved to ${NOTES_FILE#"$ROOT_DIR"/}"
  fi
  echo
fi

# ---------- push (web, and needed for building iOS on the Mac) ----------

if ((DO_WEB || IOS_LOCAL_ELSEWHERE)); then
  AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')"
  info "Pushing $BRANCH ($AHEAD commit(s) ahead of upstream)"
  ((DO_WEB)) && [[ "$BRANCH" == main ]] && echo "Vercel will deploy the web app from this push."
  if ask_yn "Push $BRANCH to origin now?" y; then
    run git push origin "$BRANCH"
  else
    warn "Skipped push."
  fi
  echo
elif ((DO_IOS || DO_ANDROID)) && [[ -n "$(git rev-list '@{u}..HEAD' 2>/dev/null)" ]]; then
  ask_yn "You have unpushed commits. Push $BRANCH too?" n && run git push origin "$BRANCH"
  echo
fi

# ---------- mobile builds ----------

if ((DO_IOS || DO_ANDROID)) && ! { ((IOS_LOCAL_ELSEWHERE)) && ((!DO_ANDROID)); }; then
  info "Checking EAS login and project"
  eas whoami
  eas project:info
  echo
fi

if ((DO_IOS)); then
  if [[ "$IOS_MODE" == EAS* ]]; then
    info "Queuing iOS $VERSION EAS production build with App Store Connect submission"
    eas build --platform ios --profile production --auto-submit --no-wait
  elif ((IOS_LOCAL_ELSEWHERE)); then
    bold "iOS local build must run on your MacBook:"
    cat <<EOF
  cd <fireco repo>
  git pull
  npm ci
  ./deploy.sh        # answer: web=n, iOS=y (local), Android=n, skip version update
EOF
  else
    IPA="$BUILD_DIR/fireops-$VERSION.ipa"
    mkdir -p "$BUILD_DIR"
    info "Building iOS $VERSION locally (this takes a while)"
    eas build --platform ios --profile production --local --output "$IPA"
    ask_choice IOS_UPLOAD "Upload $(basename "$IPA") to App Store Connect how?" \
      "eas submit" \
      "Open Transporter (drag the .ipa in)" \
      "Skip upload"
    case "$IOS_UPLOAD" in
      "eas submit") eas submit --platform ios --profile production --path "$IPA" ;;
      Open*) run open -a Transporter; ((DRY_RUN)) || open -R "$IPA" ;;
    esac
  fi
  echo
fi

if ((DO_ANDROID)); then
  if [[ "$ANDROID_MODE" == EAS* ]]; then
    ANDROID_ARGS=(--platform android --profile production --no-wait)
    ask_yn "Also auto-submit to Google Play? (needs a Play service account key configured in EAS)" n &&
      ANDROID_ARGS+=(--auto-submit)
    info "Queuing Android $VERSION EAS production build"
    eas build "${ANDROID_ARGS[@]}"
  else
    AAB="$BUILD_DIR/fireops-$VERSION.aab"
    mkdir -p "$BUILD_DIR"
    # EAS local builds run in a fresh temp dir without local.properties, so Gradle
    # needs ANDROID_HOME to find the SDK.
    if [[ -z "${ANDROID_HOME:-}" ]]; then
      for sdk in "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
        [[ -n "$sdk" && -d "$sdk" ]] && { export ANDROID_HOME="$sdk"; break; }
      done
      [[ -n "${ANDROID_HOME:-}" ]] || die "Android SDK not found; set ANDROID_HOME."
    fi
    info "Building Android $VERSION locally (this takes a while)"
    eas build --platform android --profile production --local --output "$AAB"
    if ask_yn "Submit $(basename "$AAB") to Google Play with eas submit? (No = upload manually in Play Console)" n; then
      eas submit --platform android --profile production --path "$AAB"
    else
      echo "Upload $AAB at https://play.google.com/console"
    fi
  fi
  echo
fi

# ---------- summary ----------

bold "Done."
((DO_WEB)) && echo "  Web:     check the Vercel dashboard for the deployment."
if ((DO_IOS || DO_ANDROID)); then
  echo "  Track EAS builds:      (cd apps/mobile && npx eas-cli build:list --limit 2)"
fi
if [[ "$IOS_MODE" == EAS* ]]; then
  echo "  Track iOS submission:  (cd apps/mobile && npx eas-cli submit:list --platform ios --limit 1)"
fi
if ((DO_IOS)) && ((!IOS_LOCAL_ELSEWHERE)); then
  echo "  iOS: after processing, pick the build in App Store Connect and submit it for review."
fi
if [[ -n "${NOTES_FILE:-}" ]]; then
  echo "  \"What's new\" draft: ${NOTES_FILE#"$ROOT_DIR"/}"
fi

#!/usr/bin/env bash
#
# Interactive production release for FireOps, run from this laptop.
#
#   Checks:    typecheck, unit/database tests and a web build, before anything ships.
#   Database:  Supabase migrations (shows what is pending, dry runs, then asks).
#   Web:       Vercel deploys main when a PR merges. This script never pushes to
#              main; it pushes a branch and opens a PR instead.
#   iOS:       EAS (Expo) cloud build + App Store Connect submission.
#   Android:   EAS (Expo) cloud build (optional Google Play submission).
#
# Order matters: database migrations go out before the web push and mobile builds,
# because the new app code expects the new columns and rules.
#
# Usage: ./deploy.sh [--dry-run] [--skip-checks]
#   --dry-run      Print the commands that would run without executing them.
#   --skip-checks  Skip typecheck, tests and web build (not recommended).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
APP_CONFIG="$MOBILE_DIR/app.json"
BUILD_DIR="$ROOT_DIR/builds"
# Paths whose commits count as mobile app changes in the release notes.
MOBILE_PATHS=(apps/mobile packages)
DRY_RUN=0
CHECKS=1

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-checks) CHECKS=0 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

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
supabase() { (cd "$ROOT_DIR" && run npx supabase "$@"); }

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

bold "FireOps production release"
((DRY_RUN)) && warn "Dry run: commands are printed, not executed."
echo "Branch: $BRANCH    Mobile version (app.json): $(app_version)"
[[ "$BRANCH" != main ]] && warn "You are not on main; Vercel deploys production only after this branch merges into main."
echo

if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working tree has uncommitted changes:"
  git status --short
  ask_yn "Continue anyway? (EAS builds upload the working tree)" n || exit 1
fi

if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git fetch --quiet origin || warn "git fetch failed; remote status may be stale."
  BEHIND="$(git rev-list --count 'HEAD..@{u}')"
  AHEAD="$(git rev-list --count '@{u}..HEAD')"
  ((BEHIND > 0)) && warn "Branch is $BEHIND commit(s) behind origin. Pull first so you don't ship over someone else's work."
  echo "$AHEAD commit(s) not yet pushed to origin."
  echo
fi

[[ -d node_modules ]] || { info "Installing dependencies"; run npm ci; }

# ---------- checks ----------

if ((CHECKS)); then
  bold "Checks"
  if ask_yn "Run typecheck, tests and a web build before releasing?" y; then
    run npm run typecheck
    run npm test
    run npm run build:web
    info "Checks passed."
  else
    warn "Skipped checks."
  fi
  echo
fi

# ---------- targets ----------

DO_DB=0 DO_WEB=0 DO_IOS=0 DO_ANDROID=0
ask_yn "Apply Supabase database migrations?" y && DO_DB=1
ask_yn "Push this branch and open a PR (Vercel deploys web once it merges)?" y && DO_WEB=1
ask_yn "Deploy iOS?" y && DO_IOS=1
ask_yn "Deploy Android?" y && DO_ANDROID=1
((DO_DB + DO_WEB + DO_IOS + DO_ANDROID > 0)) || die "Nothing selected."
echo

ANDROID_MODE=""
if ((DO_ANDROID)); then
  ask_choice ANDROID_MODE "How should Android be deployed through EAS (Expo)?" \
    "EAS (Expo) production cloud build + submit to Google Play closed testing (alpha)" \
    "EAS (Expo) production cloud build only"
  echo
fi

# ---------- database ----------

if ((DO_DB)); then
  bold "Database migrations (production)"
  echo "This changes the live database. Take a backup first (Supabase dashboard -> Database -> Backups)."
  echo "The project must be linked once: npx supabase link --project-ref <ref>"
  echo
  info "Local vs. applied migrations"
  supabase migration list --linked
  echo
  info "What would be applied (dry run)"
  supabase db push --linked --dry-run
  echo
  echo "Check the list is exactly the pending files, in filename order."
  if ask_yn "Apply these migrations to production now?" n; then
    supabase db push --linked
    info "Migrations applied. Spot-check the app before continuing."
    ask_yn "Continue with the app release?" y || exit 0
  else
    warn "Skipped migrations."
    if ((DO_WEB || DO_IOS || DO_ANDROID)); then
      warn "New app code may expect migrations that are not applied yet."
      ask_yn "Continue with the app release anyway?" n || exit 1
    fi
  fi
  echo
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
    if [[ "$BRANCH" == main ]]; then
      # Never commit release changes straight onto main; they go out through a PR.
      BRANCH="release/mobile-$NEW_VERSION"
      info "Moving the version bump to branch $BRANCH"
      run git switch -c "$BRANCH"
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

# ---------- push (web) ----------

# push_branch_with_pr: push the current (non-main) branch and open a PR into main.
push_branch_with_pr() {
  if [[ "$BRANCH" == main ]]; then
    warn "Direct pushes to main are disabled. Commit on a branch and merge a PR to deploy web."
    return 0
  fi
  run git push -u origin "$BRANCH"
  if command -v gh >/dev/null 2>&1; then
    if ((DRY_RUN)) || [[ -z "$(gh pr list --head "$BRANCH" --state open --json number --jq '.[].number' 2>/dev/null)" ]]; then
      run gh pr create --base main --head "$BRANCH" --fill
    else
      echo "A PR for $BRANCH is already open."
    fi
  else
    warn "GitHub CLI (gh) not found; open a PR for $BRANCH into main manually."
  fi
}

if ((DO_WEB)); then
  AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')"
  info "Pushing $BRANCH ($AHEAD commit(s) ahead of origin) and opening a PR"
  echo "Vercel deploys the web app after the PR merges into main."
  if ask_yn "Push $BRANCH and open a PR now?" y; then
    push_branch_with_pr
  else
    warn "Skipped push."
  fi
  echo
elif ((DO_IOS || DO_ANDROID)) && [[ "$BRANCH" != main ]] && [[ -n "$(git rev-list '@{u}..HEAD' 2>/dev/null || echo new)" ]]; then
  ask_yn "You have unpushed commits. Push $BRANCH and open a PR too?" n && push_branch_with_pr
  echo
fi

# ---------- mobile builds ----------

if ((DO_IOS || DO_ANDROID)); then
  info "Checking EAS login and project"
  eas whoami
  eas project:info
  echo
fi

if ((DO_IOS)); then
  info "Queuing iOS $VERSION EAS production build with App Store Connect submission"
  eas build --platform ios --profile production --auto-submit --no-wait
  echo
fi

if ((DO_ANDROID)); then
  ANDROID_ARGS=(--platform android --profile production --no-wait)
  if [[ "$ANDROID_MODE" == *" + submit "* ]]; then
    ANDROID_ARGS+=(--auto-submit)
    info "Auto-submitting to Google Play closed testing (alpha); Play service account key must be configured in EAS."
  fi
  info "Queuing Android $VERSION EAS production build"
  eas build "${ANDROID_ARGS[@]}"
  echo
fi

# ---------- summary ----------

bold "Done."
((DO_DB)) && echo "  Database: confirm with 'npx supabase migration list --linked'."
((DO_WEB)) && echo "  Web:      check the Vercel dashboard for the deployment."
if ((DO_IOS || DO_ANDROID)); then
  echo "  Track EAS builds:      (cd apps/mobile && npx eas-cli build:list --limit 2)"
fi
if ((DO_IOS)); then
  echo "  Track iOS submission:  (cd apps/mobile && npx eas-cli submit:list --platform ios --limit 1)"
fi
((DO_IOS)) && echo "  iOS: after processing, test in TestFlight, then submit for review in App Store Connect."
if [[ -n "${NOTES_FILE:-}" ]]; then
  echo "  \"What's new\" draft: ${NOTES_FILE#"$ROOT_DIR"/}"
fi
echo "  Release checklist: docs/release-checklist.md"

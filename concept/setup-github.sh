#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-fireops-mobile}"
VISIBILITY="${2:-private}"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Install the Xcode Command Line Tools with: xcode-select --install"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install it with: brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Sign in to GitHub first."
  gh auth login --web --git-protocol https
fi

if [ ! -d .git ]; then
  git init -b main
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "Initial FireOps v1.7 prototype"
fi

gh repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin --push

echo "FireOps is now on GitHub."

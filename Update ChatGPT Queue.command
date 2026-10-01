#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"ChatGPT Queue Updater\"" >/dev/null 2>&1 || true
}

echo "ChatGPT Queue Updater"
echo "Repository: $REPO_DIR"
echo

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed."
  notify "Git is not installed."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d ".git" ]; then
  echo "ERROR: This folder is not a Git repository."
  notify "Updater must be inside the Git repository folder."
  read -r -p "Press Enter to close..."
  exit 1
fi

# Never overwrite local edits silently.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: Local tracked files have uncommitted changes."
  echo "Commit or discard them before updating."
  notify "Update stopped: local code has uncommitted changes."
  read -r -p "Press Enter to close..."
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  BRANCH="master"
fi

echo "Checking GitHub..."
git fetch origin "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date."
else
  echo "Downloading update..."
  git pull --ff-only origin "$BRANCH"
fi

VERSION="$(/usr/bin/python3 - <<'PY'
import json
try:
    with open("manifest.json", "r", encoding="utf-8") as f:
        print(json.load(f).get("version", "unknown"))
except Exception:
    print("unknown")
PY
)"

echo
echo "Local extension version: $VERSION"
notify "Updated to v$VERSION. Restarting Chrome to load it."

# chrome://restart is preferable to killing Chrome because it restores
# the current browsing session while reloading unpacked extensions from disk.
if /usr/bin/osascript -e 'tell application "Google Chrome" to open location "chrome://restart"' >/dev/null 2>&1; then
  echo "Chrome restart requested."
  echo "Done."
  sleep 2
else
  echo "Could not request Chrome restart automatically."
  echo "Open chrome://restart manually to reload the unpacked extension."
  /usr/bin/open -a "Google Chrome" "chrome://restart" >/dev/null 2>&1 || true
  sleep 2
fi

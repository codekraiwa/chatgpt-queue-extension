#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh 1.5.2"
  exit 1
fi

python3 scripts/bump-version.py "$VERSION"
git add manifest.json
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push
git push origin "v$VERSION"

echo "Pushed v$VERSION. GitHub Actions will create the release ZIP."

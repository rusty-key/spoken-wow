#!/usr/bin/env bash
# Releases Spoken, the one zip that holds Spoken and its modules, to CurseForge and Wago.
#
#   make package-spoken                        # build dist/Spoken-<version>.zip first
#   ./scripts/spoken/release.sh --dry-run      # check, and say what would be sent
#   ./scripts/spoken/release.sh                # both stores
#   ./scripts/spoken/release.sh --store=wago   # one store; --store=curseforge for the other
#
# Then push the spoken/v<version> tag: .github/workflows/release-addons.yaml builds the same zip
# and makes the GitHub release, with this version's changelog section as its notes.
#
# Checked before anything is sent: the version in Spoken.toc has its own `## <version>` section in
# docs/spoken/CHANGELOG.md. A release whose notes are still under `## Unreleased` would go out
# with none. package.sh has already held every .toc and AddonVersion literal to that version.
#
# The upload is scripts/quests/release.sh's `spoken` target, which holds the project ids, the game
# versions and the upload code the sound packs share.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOC="$REPO/addons/Spoken/Spoken.toc"
CHANGELOG="$REPO/docs/spoken/CHANGELOG.md"

passed=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n|--store=*) passed+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected --dry-run, --store=curseforge|wago|both)" >&2; exit 1;;
  esac
done

version="$(sed -n 's/^## Version:[[:space:]]*//p' "$TOC" | head -1 | tr -d '\r')"
[ -n "$version" ] || { echo "error: no '## Version:' line in $TOC" >&2; exit 1; }

node "$REPO/scripts/lib/changelog.mjs" section "$CHANGELOG" "$version" >/dev/null || {
  echo "error: docs/spoken/CHANGELOG.md has no '## $version' section; a release PR renames" >&2
  echo "       '## Unreleased' to it before anything is released." >&2
  exit 1
}

exec "$REPO/scripts/quests/release.sh" ${passed[@]+"${passed[@]}"} spoken

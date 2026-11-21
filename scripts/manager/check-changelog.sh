#!/usr/bin/env bash
# Spoken Manager's changelog against the rules in AGENTS.md ("Versions and changelogs"), as
# scripts/spoken/check-changelog.sh checks Spoken's: the version in manager/package.json and every
# released manager/vX.Y.Z tag have a section of their own, `## Unreleased` comes first, and each
# of its bullets credits its author. A checkout without tags checks package.json's version alone.
#
#   ./scripts/manager/check-changelog.sh      # make lint runs it
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(node -p "require('$REPO/manager/package.json').version")"
tagged="$(git -C "$REPO" tag -l 'manager/v*' 2>/dev/null | sed -n 's|^manager/v\([0-9]*\.[0-9]*\.[0-9]*\)$|\1|p')"

# shellcheck disable=SC2086 # one argument per tagged version
exec node "$REPO/scripts/lib/changelog.mjs" check "$REPO/docs/manager/CHANGELOG.md" "$version" $tagged

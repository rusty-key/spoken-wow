#!/usr/bin/env bash
# Spoken's changelog against the rules in AGENTS.md ("Versions and changelogs"): the version in
# Spoken.toc and every released spoken/vX.Y.Z tag have a section of their own, `## Unreleased`
# comes first, and each of its bullets credits its author. Pre-release tags (-alpha, -beta) need
# no section. A checkout without tags, as CI's shallow one is, checks the .toc's version alone.
#
#   ./scripts/spoken/check-changelog.sh      # make lint runs it
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(sed -n 's/^## Version:[[:space:]]*//p' "$REPO/addons/Spoken/Spoken.toc" | head -1 | tr -d '\r')"
tagged="$(git -C "$REPO" tag -l 'spoken/v*' 2>/dev/null | sed -n 's|^spoken/v\([0-9]*\.[0-9]*\.[0-9]*\)$|\1|p')"

# shellcheck disable=SC2086 # one argument per tagged version
exec node "$REPO/scripts/lib/changelog.mjs" check "$REPO/docs/spoken/CHANGELOG.md" "$version" $tagged

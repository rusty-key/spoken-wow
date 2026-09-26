#!/usr/bin/env bash
# Uploads built zips to CurseForge and to Wago Addons.
#
#   ./scripts/zones/release.sh --dry-run        # say what would be sent, send nothing
#   ./scripts/zones/release.sh                  # both projects, both stores
#   ./scripts/zones/release.sh zones            # just the addon
#   ./scripts/zones/release.sh audio            # just the sound pack
#   ./scripts/zones/release.sh --lang=esMX audio # that language's sound pack instead
#   ./scripts/zones/release.sh --store=wago     # one store only; --store=curseforge for the other
#
# TWO STORES, ONE RELEASE. The same zip goes to both by default: a file that exists on one
# store and not the other is how the two drift into being different addons.
#
# Needs CURSEFORGE_TOKEN and WAGO_TOKEN in the environment or in the repo-root .env. Generate one at
# https://authors-old.curseforge.com/account/api-tokens -- it is an author token
# tied to your account, not to a project, so the same one covers all three.
#
# This uploads files, and declares the addon's one required dependency -- the
# Spoken player -- with the file; relations are upload metadata, not a project
# setting. It does not create projects or edit descriptions: there is no API for
# either, and a script that rewrote them every release could undo an edit made in
# the web UI.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$REPO/dist"

# The language whose sound pack `audio` means. English unless --lang says otherwise; the
# addon itself has one language-independent project, so --lang is refused alongside `zones`.
LANG_CODE=enUS
pack_field() { node "$REPO/scripts/lib/packs.mjs" get zones "$LANG_CODE" - "$1"; }
english() { [[ "$LANG_CODE" == enUS ]]; }

# The Wago half, which is the same for every project and so lives in one file.
# shellcheck source=../lib/wago.sh
source "$REPO/scripts/lib/wago.sh"

# Site-relative API, per game. WoW projects are not reachable through another
# game's subdomain even with a valid token.
API="https://wow.curseforge.com/api"

# The clients a zip can target. Matched by name against /api/game/versions rather
# than hardcoding the numeric IDs, because those IDs are not documented anywhere
# and would be mystery constants the first time they need changing.
#
# ANNIVERSARY is the 2.5.6 client the Anniversary realms run. Its name on
# CurseForge is whatever /api/game/versions calls it -- if the default below is
# not it, the exactly-one-match check further down fails loudly before anything is
# uploaded, which is the failure mode to want.
GAME_VERSION_ERA="${GAME_VERSION_ERA:-1.15.9}"
GAME_VERSION_ANNIVERSARY="${GAME_VERSION_ANNIVERSARY:-2.5.6}"
# The 1.60.1 Forever client, which is CurseForge's name for the one whose TOC suffix is
# _Camelot. Both addons declare interface 16001 and load there.
GAME_VERSION_FOREVER="${GAME_VERSION_FOREVER:-1.60.1}"

# CurseForge's own channel, which is not the same thing as the beta disclaimer in
# the descriptions. Marking these "beta" would keep most addon managers from
# offering them to players on the default channel -- the audience this is for.
RELEASE_TYPE="${RELEASE_TYPE:-release}"

# project key -> CurseForge project ID, addon folder the version is read from,
# and the zip basename package*.sh produces. `audio`'s come from LANG_CODE's page under
# publishers/zones/ -- the registry a language's pack is created in by hand on CurseForge
# before it can be released, so an unregistered language fails on the empty project id
# below rather than uploading over the English project.
target_curseforge() { case "$1" in zones) echo "1636521";; audio) pack_field curseforge;; esac; }
# The Wago project id for the same project: eight alphanumeric characters, from the project's
# entry in https://addons.wago.io/developers, and also in the page frontmatter under
# publishers/zones/ where scripts/descriptions.mjs checks it.
# A sound pack is never uploaded to Wago, whatever its page says: Wago answers 413 to a file
# that size (scripts/lib/wago.sh). The page keeps its `wago:` id for the description pasted
# there, which sends players to the GitHub release.
target_wago()       { case "$1" in zones) echo "mNw7b5No";; esac; }
target_addon()      { case "$1" in zones) echo "SpokenZones";; audio) pack_field folder;; esac; }
target_zip()        { target_addon "$1"; }
# The project's slug, which is neither the folder nor the zip name: the folders keep the names
# they were published under and the slugs were changed with the rename. Used for the link
# printed after an upload, so a wrong one here is a dead link and nothing worse.
target_slug()       { case "$1" in zones) echo "spoken-zones";; audio) pack_field slug;; esac; }
# Which clients each file is offered to. Every zip built from 0.3.1 onwards carries
# a .toc for both clients, so both are filed against both. Files uploaded
# before that are Era-only and stay filed as they were -- a file offered to a
# client it cannot load on is worse than one that is simply absent there.
# Required dependencies by CurseForge slug. The addon needs the player it speaks through, and
# the pack needs the addon: it is data, inert without something to read it, and a manager that
# installs it alone leaves a player several hundred megabytes heavier and no louder.
#
# It also makes the pair upgrade together, which is what lets a pack register itself under one
# name only - see the ONE REGISTRY note in tools/voice/build-lookup.mjs.
target_dependencies()  { case "$1" in zones) echo "spoken-player";; audio) echo "spoken-zones";; esac; }
target_game_versions() { echo "$GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY $GAME_VERSION_FOREVER"; }

dry_run=""
stores="curseforge wago"
targets=()
for arg in "$@"; do
  case "$arg" in
    --store=both)       stores="curseforge wago";;
    --store=curseforge) stores="curseforge";;
    --store=wago)       stores="wago";;
    --dry-run|-n) dry_run=1;;
    --lang=*) LANG_CODE="${arg#--lang=}";;
    zones|audio) targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: zones, audio, --lang=..., --store=..., --dry-run)" >&2; exit 1;;
  esac
done

if ! english; then
  # ${targets[@]+...} rather than a bare expansion: macOS's bash 3.2 raises "unbound variable"
  # under set -u when "${targets[@]}" is empty, which it is for `--lang=xx` alone.
  for t in ${targets[@]+"${targets[@]}"}; do
    [[ "$t" == audio ]] || { echo "error: --lang=$LANG_CODE releases a sound pack; '$t' has one project for every language" >&2; exit 1; }
  done
  (( ${#targets[@]} > 0 )) || targets=("audio")
fi

# Asked once, answered at each of the places below that only concern one store.
store_has() { [[ " $stores " == *" $1 "* ]]; }
if (( ${#targets[@]} == 0 )); then
  targets=("zones" "audio")
fi

command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for JSON handling)" >&2; exit 1; }

# The token is account-wide -- it uploads all six projects -- so it lives once, in the
# repo-root .env alongside the other shared credentials, rather than in a shell history or
# in a copy per pipeline.
if store_has curseforge; then
  if [[ -z "${CURSEFORGE_TOKEN:-}" && -f "$REPO/.env" ]]; then
    CURSEFORGE_TOKEN="$(sed -n 's/^CURSEFORGE_TOKEN=//p' "$REPO/.env" | head -1 | tr -d '\r"')"
  fi
  if [[ -z "${CURSEFORGE_TOKEN:-}" ]]; then
    echo "error: CURSEFORGE_TOKEN is not set" >&2
    echo "       Generate one at https://authors-old.curseforge.com/account/api-tokens" >&2
    echo "       then put CURSEFORGE_TOKEN=... in the repo root's .env, or export it." >&2
    exit 1
  fi
fi

# Checked before the first upload rather than at it: a missing token should stop a release
# before half of it has gone out, not between the addon and its sound pack.
store_has wago && wago_require_token

api_get() {
  curl -fsSL -H "X-Api-Token: $CURSEFORGE_TOKEN" "$API/$1"
}

#-- the game versions ---------------------------------------------------------
# The list is fetched once; each name is resolved against it separately, and a
# name matching anything other than exactly one version is fatal. An unknown name
# here is the failure that otherwise produces a file uploaded against the wrong
# client, which players discover as "the addon does not appear in my AddOns list".
versions_json=""
if store_has curseforge; then
  versions_json="$(api_get "game/versions")" || {
    echo "error: could not list game versions -- is the token valid?" >&2
    exit 1
  }
fi

resolve_game_version() {
  node -e '
    const wanted = process.argv[1];
    const versions = JSON.parse(process.argv[2]);
    const hits = versions.filter((v) => v.name === wanted);
    if (hits.length !== 1) {
      console.error(`expected exactly one game version named ${wanted}, found ${hits.length}`);
      if (hits.length > 1) console.error(JSON.stringify(hits));
      process.exit(1);
    }
    process.stdout.write(String(hits[0].id));
  ' "$1" "$versions_json"
}

if store_has curseforge; then
  echo "resolving game versions..."
  for name in $GAME_VERSION_ERA $GAME_VERSION_ANNIVERSARY $GAME_VERSION_FOREVER; do
    echo "  $name -> id $(resolve_game_version "$name")"
  done
fi

#-- the changelog -------------------------------------------------------------
# The section of CHANGELOG.md for the version being uploaded, so the release
# notes on the site and the notes in the repository cannot drift apart. Extracted
# per version rather than sending the whole file: a player opening the Files tab
# wants to know what changed in this one.
#
# THE KIND IS HALF THE KEY. The addon and the pack read their own TOCs and have numbered
# themselves independently since 2.0.0, so the same number belongs to both of them at
# different times -- 2.0.1 is the addon's placeholder-folder fix and, separately, the pack's
# new icon. A heading of `## <version> — audio` is the pack's and anything else at that
# number is the addon's, which is what keeps one's notes off the other's upload. A language
# pack's own heading names its release tag instead, and goes through packs.mjs changelog in
# the upload loop below, not this function -- but its heading still has to be stepped over
# here, since it can share a version number with the English pack.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version, target] = process.argv.slice(1);
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    // Restated from isLanguageHeading in scripts/lib/packs.mjs, because this is a node -e
    // string and cannot import it -- keep the two in step.
    const language = /^## \S+ — [a-z]+(?:-[a-z]+)+-[a-z]{2}[A-Z]{2}(?:\s|$)/;
    const matches = (l) => l.startsWith(`## ${version}`) && !language.test(l) &&
      /—\s*audio\b/.test(l) === (target === "audio");
    const start = lines.findIndex(matches);
    if (start === -1) {
      console.error(`no "## ${version}" section for ${target} in CHANGELOG.md`);
      process.exit(1);
    }
    if (lines.findIndex((l, i) => i > start && matches(l)) !== -1) {
      console.error(`two "## ${version}" sections for ${target} in CHANGELOG.md`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$REPO/docs/zones/CHANGELOG.md" "$1" "$2"
}

#-- preflight -------------------------------------------------------------------
# EVERY TARGET'S ZIP IS RESOLVED BEFORE ANY UPLOAD STARTS. English's default run covers both
# zones and audio, and uploading the addon before discovering the pack was never built is a
# half release. Checked in --dry-run too, since a dry run's job is to say what a real run
# would hit.
missing=()
for target in "${targets[@]}"; do
  addon="$(target_addon "$target")"
  if [[ "$target" == audio ]] && ! english; then
    version="$(pack_field version)"
  else
    toc="$REPO/addons/$addon/$addon.toc"
    version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" 2>/dev/null | head -1 | tr -d '\r')"
  fi
  if [[ -z "$version" ]]; then
    missing+=("$target -- not built (no version); run make zones-package / make zones-package-audio")
    continue
  fi
  zip_path="$DIST/$(target_zip "$target")-$version.zip"
  [[ -f "$zip_path" ]] || missing+=("$zip_path")
done
if (( ${#missing[@]} > 0 )); then
  echo "error: missing zips -- nothing was released:" >&2
  for m in "${missing[@]}"; do echo "  $m" >&2; done
  exit 1
fi

#-- upload --------------------------------------------------------------------
for target in "${targets[@]}"; do
  project="$(target_curseforge "$target")"
  addon="$(target_addon "$target")"
  zip_name="$(target_zip "$target")"

  # Checked rather than assumed: a target added here without its project id would
  # otherwise POST to CurseForge's /projects//upload-file and fail somewhere less
  # legible, or worse, land on whatever project the API resolved.
  if store_has curseforge && [[ -z "$project" ]]; then
    echo "error: no CurseForge project id for '$target' -- create the project and add its id to target_curseforge()" >&2
    exit 1
  fi

  if [[ "$target" == audio ]] && ! english; then
    version="$(pack_field version)"
  else
    toc="$REPO/addons/$addon/$addon.toc"
    version="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" | head -1 | tr -d '\r')"
  fi
  zip_path="$DIST/$zip_name-$version.zip"

  echo
  echo "=== $target -> $stores ==="

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make package / make package-audio first" >&2
    exit 1
  fi

  if [[ "$target" == audio ]] && ! english; then
    changelog="$(node "$REPO/scripts/lib/packs.mjs" changelog "$REPO/docs/zones/CHANGELOG.md" "$version" "$(pack_field release)")"
  else
    changelog="$(changelog_for "$version" "$target")"
  fi
  size="$(du -h "$zip_path" | cut -f1)"

  echo "  file:      $zip_path ($size)"
  echo "  version:   $version   release type: $RELEASE_TYPE"
  echo "  changelog: $(echo "$changelog" | head -1) ..."

  if store_has curseforge; then
    game_version_names="$(target_game_versions "$target")"
    game_version_ids=""
    for name in $game_version_names; do
      game_version_ids="$game_version_ids $(resolve_game_version "$name")"
    done

    # One file can carry versions from more than one client. If CurseForge ever
    # rejects the pair (Era and Anniversary are different game-version *types*),
    # the fix is to upload the same zip once per id rather than to drop one of them.
    #
    # Built with node rather than a heredoc: the changelog is markdown containing
    # quotes, backticks and newlines, and hand-escaping it into JSON is how a
    # release ends up with a mangled changelog nobody notices for a month.
    # By slug, which must name an approved project or the upload fails with errorCode 1018.
    dependencies="$(target_dependencies "$target")"
    metadata="$(node -e '
      const [changelog, releaseType, gameVersionIds, displayName, dependencies] = process.argv.slice(1);
      const slugs = dependencies.trim().split(/\s+/).filter(Boolean);
      process.stdout.write(JSON.stringify({
        changelog,
        changelogType: "markdown",
        displayName,
        gameVersions: gameVersionIds.trim().split(/\s+/).map(Number),
        releaseType,
        ...(slugs.length ? { relations: { projects: slugs.map((slug) => ({ slug, type: "requiredDependency" })) } } : {}),
      }));
    ' "$changelog" "$RELEASE_TYPE" "$game_version_ids" "$zip_name $version" "$dependencies")"

    echo "  curse:     project $project, game versions $game_version_names"
    [[ -n "$dependencies" ]] && echo "  requires:  $(echo $dependencies)"

    if [[ -n "$dry_run" ]]; then
      echo "  dry run -- not uploading to CurseForge"
    else

    # --progress-bar because the packs are hundreds of megabytes and a silent curl
    # for six minutes is indistinguishable from a hang.
    #
    # Deliberately not -f: on a rejection the API explains itself in the response
    # body, and -f discards exactly that, leaving "curl: (56) error 400" as the only
    # evidence of a release that will not go out. The status code is appended on its
    # own line instead, and split back off below.
    #
    # --form-string for the metadata, never -F: -F reads `;` in a value as the start
    # of a `;type=` parameter and silently truncates there, so a changelog with a
    # semicolon in it arrives as invalid JSON and the API rejects the whole release.
    # The file part stays -F, which is what makes @ mean "read this file".
    response="$(curl -sS --progress-bar -w '\n%{http_code}' \
      -H "X-Api-Token: $CURSEFORGE_TOKEN" \
      --form-string "metadata=$metadata" \
      -F "file=@$zip_path" \
      "$API/projects/$project/upload-file")" || {
        echo "error: could not reach CurseForge for $target" >&2
        exit 1
      }

    status="${response##*$'\n'}"
    response="${response%$'\n'*}"

    if [[ "$status" != 2* ]]; then
      echo "error: upload failed for $target -- HTTP $status" >&2
      echo "$response" >&2
      exit 1
    fi

    file_id="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).id ?? "?"))' "$response")"
    echo "  uploaded -- file id $file_id"
    echo "  https://www.curseforge.com/wow/addons/$(target_slug "$target")/files/$file_id"
    fi
  fi

  # The Wago upload, after the CurseForge one and not conditional on it: the two stores refuse
  # files for different reasons, and a file one store will not take is still a file the other
  # should have.
  if store_has wago && [[ -z "$(target_wago "$target")" ]]; then
    echo "  wago:      no Wago upload for $target -- skipped (its players use the GitHub release)"
  elif store_has wago; then
    if [[ -n "$dry_run" ]]; then
      echo "  wago:      project $(target_wago "$target") -- dry run, not uploading"
    else
      wago_upload "$(target_wago "$target")" "$zip_path" "$zip_name $version" "$changelog" \
        "$(target_slug "$target")" || {
          echo "  wago upload failed for $target" >&2
          exit 1
        }
    fi
  fi
done

#-- descriptions --------------------------------------------------------------
# There is no API for these. Uploading a file cannot update the page around it,
# so the most this can do is notice that the text in the repository has moved on
# from what was last pasted, and say so at the moment somebody is already looking
# at the project pages.
echo
stale="$(node "$REPO/scripts/descriptions.mjs" --drift --group=zones)"
if [[ -n "$stale" ]]; then
  echo "descriptions that differ from what was last pasted into the site:"
  echo "$stale" | while IFS=$'\t' read -r slug why; do
    echo "  $slug -- $why  ($DIST/descriptions/$slug.md)"
  done
  echo "  paste them, then: make descriptions-published"
else
  echo "descriptions match what was last pasted."
fi

echo
echo "done. Uploads sit in moderation before they appear publicly."

#!/usr/bin/env bash
# Uploads the built books zips to CurseForge and to Wago Addons.
#
#   ./scripts/books/release.sh --dry-run   # say what would be sent, send nothing
#   ./scripts/books/release.sh             # both projects, both stores
#   ./scripts/books/release.sh books       # just the addon
#   ./scripts/books/release.sh audio       # just the sound pack
#   ./scripts/books/release.sh --lang=esMX audio # that language's sound pack instead
#   ./scripts/books/release.sh --store=wago        # Wago only
#   ./scripts/books/release.sh --store=curseforge  # CurseForge only
#   NO_DEPENDENCIES=1 ./scripts/books/release.sh audio   # upload without declaring the addon
#
# TWO STORES, ONE RELEASE. The same zip goes to both by default, because a file that exists
# on one store and not the other is how the two drift into being different addons. --store
# exists for the case where one of them has already taken the file and the other has not.
#
# Needs CURSEFORGE_TOKEN and WAGO_TOKEN in the environment or in the repo-root .env. Generate one at
# https://authors-old.curseforge.com/account/api-tokens -- it is an author token tied to
# your account rather than to a project, so the same one covers every Spoken project.
#
# This uploads files and declares each one's required dependency; relations are upload
# metadata rather than a project setting. It does not create projects or edit descriptions:
# there is no API for either, and a script that rewrote them every release could undo an
# edit made in the web UI.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$REPO/dist"

# The language whose sound pack `audio` means. English unless --lang says otherwise; the
# addon itself has one language-independent project, so --lang is refused alongside `books`.
LANG_CODE=enUS
pack_field() { node "$REPO/scripts/lib/packs.mjs" get books "$LANG_CODE" - "$1"; }
english() { [[ "$LANG_CODE" == enUS ]]; }

# The Wago half, which is the same for every project and so lives in one file.
# shellcheck source=../lib/wago.sh
source "$REPO/scripts/lib/wago.sh"

# Site-relative API, per game. WoW projects are not reachable through another game's
# subdomain even with a valid token.
API="https://wow.curseforge.com/api"

# The clients a zip can target. Matched by name against /api/game/versions rather than
# hardcoding the numeric ids, because those ids are not documented anywhere and would be
# mystery constants the first time they need changing. Both addons declare interface
# 11509, 20506 and 16001, which is Era, Anniversary and the Forever beta in that order.
GAME_VERSION_ERA="${GAME_VERSION_ERA:-1.15.9}"
GAME_VERSION_ANNIVERSARY="${GAME_VERSION_ANNIVERSARY:-2.5.6}"
GAME_VERSION_FOREVER="${GAME_VERSION_FOREVER:-1.60.1}"

# CurseForge's own channel, which is not the same thing as a beta disclaimer in the
# description. Marking these "beta" would keep most addon managers from offering them to
# players on the default channel -- the audience this is for.
RELEASE_TYPE="${RELEASE_TYPE:-release}"

# project key -> CurseForge project id, addon folder the version is read from, and the zip
# basename the package scripts produce. `audio`'s come from LANG_CODE's page under
# publishers/books/ -- the registry a language's pack is created in by hand on CurseForge
# before it can be released, so an unregistered language fails on the empty project id
# below rather than uploading over the English project.
target_curseforge() { case "$1" in books) echo "1701514";; audio) pack_field curseforge;; esac; }
# The Wago project id for the same project: eight alphanumeric characters, from the project's
# entry in https://addons.wago.io/developers. They are also in each page's frontmatter under
# publishers/, which is where scripts/descriptions.mjs checks them -- kept here as well so
# that this script needs no YAML parser to know where to upload.
# A sound pack is never uploaded to Wago, whatever its page says: Wago answers 413 to a file
# that size (scripts/lib/wago.sh). The page keeps its `wago:` id for the description pasted
# there, which sends players to the GitHub release.
target_wago()       { case "$1" in books) echo "qGYZnRNg";; esac; }
target_addon()      { case "$1" in books) echo "SpokenBooks";; audio) pack_field folder;; esac; }
target_zip()        { target_addon "$1"; }
# The project's slug. Used for the link printed after an upload, so a wrong one here is a
# dead link and nothing worse -- unlike the slugs in target_dependencies(), which
# CurseForge resolves at upload time.
target_slug()       { case "$1" in books) echo "spoken-books";; audio) pack_field slug;; esac; }
# Required dependencies by CurseForge slug. The addon needs the player it speaks through,
# and the pack needs the addon: it is data, inert without something to read it, and a
# manager that installs it alone leaves a player several hundred megabytes heavier and no
# louder. It also makes the pair upgrade together, which is what lets the pack register
# itself under one name only.
target_dependencies() { case "$1" in books) echo "spoken-player";; audio) echo "spoken-books";; esac; }
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
    books|audio) targets+=("$arg");;
    *) echo "error: unknown argument '$arg' (expected: books, audio, --lang=..., --store=..., --dry-run)" >&2; exit 1;;
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

# Asked once, answered everywhere below: `case " $stores " in *" wago "*)` reads worse than
# this does at each of the four places that need it.
store_has() { [[ " $stores " == *" $1 "* ]]; }
# The addon goes first. CurseForge resolves a relations slug at upload time, so the pack's
# required dependency has to name a project that already exists and is approved -- see the
# errorCode 1018 note in publishers/README.md.
if (( ${#targets[@]} == 0 )); then
  targets=("books" "audio")
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
# The list is fetched once; each name is resolved against it separately, and a name matching
# anything other than exactly one version is fatal. An unknown name here is the failure that
# otherwise produces a file uploaded against the wrong client, which players discover as
# "the addon does not appear in my AddOns list".
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
# The section of docs/books/CHANGELOG.md for the version being uploaded, so the release
# notes on the site and the notes in the repository cannot drift apart. Extracted per
# version rather than sending the whole file: a player opening the Files tab wants to know
# what changed in this one.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version] = process.argv.slice(1);
    const lines = readFileSync(path, "utf8").split("\n");
    // Restated from isLanguageHeading in scripts/lib/packs.mjs, because this is a node -e
    // string and cannot import it -- keep the two in step.
    const language = /^## \S+ — [a-z]+(?:-[a-z]+)+-[a-z]{2}[A-Z]{2}(?:\s|$)/;
    const start = lines.findIndex((l) => l.startsWith(`## ${version}`) && !language.test(l));
    if (start === -1) {
      console.error(`no "## ${version}" section in ${path}`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$REPO/docs/books/CHANGELOG.md" "$1"
}

#-- preflight -------------------------------------------------------------------
# EVERY TARGET'S ZIP IS RESOLVED BEFORE ANY UPLOAD STARTS. English's default run covers both
# books and audio, and uploading the addon before discovering the pack was never built is a
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
    missing+=("$target -- not built (no version); run make books-package / make books-package-audio")
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

  # Checked rather than assumed: a target added here without its project id would otherwise
  # POST to /projects//upload-file and fail somewhere less legible, or worse, land on
  # whatever project the API resolved.
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
    echo "error: $zip_path does not exist -- run make books-package / make books-package-audio first" >&2
    exit 1
  fi

  if [[ "$target" == audio ]] && ! english; then
    changelog="$(node "$REPO/scripts/lib/packs.mjs" changelog "$REPO/docs/books/CHANGELOG.md" "$version" "$(pack_field release)")"
  else
    changelog="$(changelog_for "$version")"
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

    # Built with node rather than a heredoc: the changelog is markdown containing quotes,
    # backticks and newlines, and hand-escaping it into JSON is how a release ends up with a
    # mangled changelog nobody notices for a month.
    # NO_DEPENDENCIES is the way past errorCode 1018 below: CurseForge refuses a relation to a
    # project it will not resolve yet, and a file uploaded without one can have it added in the
    # web UI once it will.
    dependencies="$(target_dependencies "$target")"
    [[ -n "${NO_DEPENDENCIES:-}" ]] && dependencies=""
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

    echo "  curse:    project $project, game versions $game_version_names"
    [[ -n "$dependencies" ]] && echo "  requires: $(echo $dependencies)"
    [[ -n "${NO_DEPENDENCIES:-}" ]] && echo "  requires: nothing (NO_DEPENDENCIES) -- add $(target_dependencies "$target") in the web UI afterwards"

    if [[ -n "$dry_run" ]]; then
      echo "  dry run -- not uploading to CurseForge"
    else

    # --progress-bar because the pack is hundreds of megabytes and a silent curl for six
    # minutes is indistinguishable from a hang.
    #
    # Deliberately not -f: on a rejection the API explains itself in the response body, and -f
    # discards exactly that, leaving "curl: (56) error 400" as the only evidence of a release
    # that will not go out. The status code is appended on its own line instead.
    #
    # --form-string for the metadata, never -F: -F reads `;` in a value as the start of a
    # `;type=` parameter and silently truncates there, so a changelog with a semicolon in it
    # arrives as invalid JSON and the API rejects the whole release. The file part stays -F,
    # which is what makes @ mean "read this file".
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
      # Both projects are new, so the first release is the one that meets this gate: a
      # dependency must name an *approved* project, and a project sits at status "New" until
      # moderation clears it.
      case "$response" in
        *1018*) echo "hint: errorCode 1018 means a slug in relations names a project CurseForge will not resolve -- if spoken-books is still awaiting moderation, upload the pack once it is approved, or now with NO_DEPENDENCIES=1." >&2;;
      esac
      exit 1
    fi

    file_id="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).id ?? "?"))' "$response")"
    echo "  uploaded -- file id $file_id"
    echo "  https://www.curseforge.com/wow/addons/$(target_slug "$target")/files/$file_id"
    fi
  fi

  # The Wago upload. Deliberately after the CurseForge one and not conditional on it: the two
  # stores reject files for different reasons -- CurseForge has a body-size ceiling the packs
  # have already met -- and a file one store refuses is still a file the other should have.
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
# There is no API for these. Uploading a file cannot update the page around it, so the most
# this can do is notice that the text in the repository has moved on from what was last
# pasted, and say so at the moment somebody is already looking at the project pages.
echo
stale="$(node "$REPO/scripts/descriptions.mjs" --drift --group=books)"
if [[ -n "$stale" ]]; then
  echo "descriptions that differ from what was last pasted into the site:"
  echo "$stale" | while IFS=$'\t' read -r slug why; do
    echo "  $slug -- $why  ($DIST/descriptions/$slug.md)"
  done
  echo "  paste into both stores -- CurseForge from dist/descriptions/, Wago from"
  echo "  dist/descriptions-wago/ -- then: make descriptions-published"
else
  echo "descriptions match what was last pasted."
fi

echo
echo "done. Uploads sit in moderation before they appear publicly."

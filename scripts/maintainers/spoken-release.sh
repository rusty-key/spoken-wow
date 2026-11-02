#!/usr/bin/env bash
# Publishes a language's voice packs, as the Spoken Manager installed them, to your own CurseForge
# projects and your own GitHub repository.
#
#   spoken-release.sh [--lang esMX] [--section quests|places|readables|bosses] [--only <folder>]
#                     [--store curseforge|github] [--changelog notes.md] [--config file] [--dry-run]
#
# Settings come from spoken-release.env beside this script (see spoken-release.env.example) or the
# environment, which wins. Needs bash, curl and either zip or tar: on Windows, run it in Git Bash.
set -uo pipefail

CF_API="https://wow.curseforge.com/api"
GH_API="https://api.github.com"
GH_UPLOADS="https://uploads.github.com"
# Era, Anniversary and Forever. CF_GAME_VERSIONS replaces them when a client patch outdates this copy.
DEFAULT_GAME_VERSIONS="1.15.9 2.5.6 1.60.1"

die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '5,6p' "${BASH_SOURCE[0]}" | sed 's/^# *//' >&2
  exit 2
}

#-- arguments ----------------------------------------------------------------------------------
lang_flag="" section="" only="" store="" changelog_file="" config="" dry_run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang|--section|--only|--store|--changelog|--config)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --lang) lang_flag="$2";;
        --section) section="$2";;
        --only) only="$2";;
        --store) store="$2";;
        --changelog) changelog_file="$2";;
        --config) config="$2";;
      esac
      shift 2;;
    --dry-run|-n) dry_run=1; shift;;
    -h|--help) usage;;
    *) echo "error: unknown argument '$1'" >&2; usage;;
  esac
done

#-- settings -----------------------------------------------------------------------------------
# Read rather than sourced, so a value's quotes, spaces and Windows line endings are only text.
explicit_config="$config"
[ -n "$config" ] || config="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/spoken-release.env"
if [ -f "$config" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue;; esac
    key="${line%%=*}"
    value="${line#*=}"
    if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then continue; fi
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}";;
      \'*\') value="${value#\'}"; value="${value%\'}";;
    esac
    if [ -z "${!key+set}" ]; then printf -v "$key" '%s' "$value"; fi
  done < "$config"
elif [ -n "$explicit_config" ]; then
  die "no config file at $config"
fi

language="${lang_flag:-${SPOKEN_LANG:-}}"
[ -n "$language" ] || die "no language: set SPOKEN_LANG in $config, or pass --lang"
[[ "$language" =~ ^[a-z]{2}[A-Z]{2}$ ]] || die "'$language' is not a language code like ptBR"

addons="${ADDONS_DIR:-}"
[ -n "$addons" ] || die "no AddOns folder: set ADDONS_DIR in $config"
command -v cygpath >/dev/null 2>&1 && addons="$(cygpath -u "$addons")"
[ -d "$addons" ] || die "ADDONS_DIR is not a folder: $addons"

case "$section" in ''|quests|places|readables|bosses) ;; *) die "unknown section '$section'";; esac

CF_TOKEN="${CF_TOKEN:-}" GH_TOKEN="${GH_TOKEN:-}" GH_REPO="${GH_REPO:-}"
case "$store" in
  '') use_cf="${CF_TOKEN:+1}"; use_gh="${GH_TOKEN:+1}"
      [ -n "$use_cf$use_gh" ] || die "no store: set CF_TOKEN or GH_TOKEN in $config";;
  curseforge) use_cf=1; use_gh=""; [ -n "$CF_TOKEN" ] || die "CF_TOKEN is not set";;
  github) use_cf=""; use_gh=1; [ -n "$GH_TOKEN" ] || die "GH_TOKEN is not set";;
  *) die "unknown store '$store' (expected curseforge or github)";;
esac
[ -z "$use_gh" ] || [[ "$GH_REPO" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] || die "GH_REPO must look like owner/repo"

changelog=""
if [ -n "$changelog_file" ]; then
  [ -f "$changelog_file" ] || die "no changelog file at $changelog_file"
  # JSON has no raw control characters; tab and newline survive, escaped in json_string.
  changelog="$(LC_ALL=C tr -d '\000-\010\013\014\016-\037' < "$changelog_file")"
fi

#-- the packs ----------------------------------------------------------------------------------
suffix="_$language"
[ "$language" = enUS ] && suffix=""
# Named rather than globbed: SpokenQuestsAudio_<lang>, the old single folder, can still be on disk.
packs=()
add_pack() { if [ -z "$section" ] || [ "$section" = "$1" ]; then packs+=("$2$suffix"); fi; }
add_pack quests SpokenQuestsAudioAlliance
add_pack quests SpokenQuestsAudioHorde
add_pack quests SpokenQuestsAudioShared
add_pack quests SpokenQuestsAudioGossip
add_pack places SpokenPlacesAudio
add_pack readables SpokenReadablesAudio
add_pack bosses SpokenBossesAudio

if [ -n "$only" ]; then
  known=""
  for folder in "${packs[@]}"; do [ "$folder" = "$only" ] && known=1; done
  [ -n "$known" ] || die "$only is not one of: ${packs[*]}"
  packs=("$only")
fi

native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

toc_version() {
  sed -n 's/^## Version:[[:space:]]*//p' "$addons/$1/$1.toc" | head -1 | tr -d '\r'
}

toc_title() {
  sed -n 's/^## Title:[[:space:]]*//p' "$addons/$1/$1.toc" | head -1 | tr -d '\r' |
    sed -e 's/|c[0-9a-fA-F]\{8\}//g' -e 's/|r//g'
}

json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

#-- zipping ------------------------------------------------------------------------------------
# The clips are Ogg already, so the zips are stored rather than compressed: nothing to gain.
# Git Bash ships a GNU tar with no zip support and no zip, so on Windows it is Windows' own tar.
zipper=""
if command -v zip >/dev/null 2>&1; then
  zipper=zip
elif [ -n "${SYSTEMROOT:-}" ] && [ -x "$(native "$SYSTEMROOT")/System32/tar.exe" ]; then
  zipper="$(native "$SYSTEMROOT")/System32/tar.exe"
elif tar --version 2>/dev/null | grep -q bsdtar; then
  zipper=tar
fi
[ -n "$zipper" ] || [ -n "$dry_run" ] || die "nothing here can make a zip: install zip"

make_zip() {
  if [ "$zipper" = zip ]; then
    (cd "$addons" && zip -q -r -0 "$2" "$1" -x '*.DS_Store')
  else
    "$zipper" -a -c -f "$(native "$2")" --exclude '.DS_Store' --options zip:compression=store -C "$(native "$addons")" "$1"
  fi
}

work=""
cleanup() { if [ -n "$work" ]; then rm -rf "$work"; fi; }
trap cleanup EXIT
trap 'exit 130' INT TERM
work="$(mktemp -d)" || die "could not make a temporary folder"

#-- CurseForge ---------------------------------------------------------------------------------
game_version_ids=""
resolve_game_versions() {
  local list name hit count id
  list="$(curl -fsSL -H "X-Api-Token: $CF_TOKEN" "$CF_API/game/versions" | tr '{' '\n')" ||
    die "could not list CurseForge's game versions: is CF_TOKEN valid?"
  for name in ${CF_GAME_VERSIONS:-$DEFAULT_GAME_VERSIONS}; do
    # An unresolved name would file the pack under the wrong client, so it stops the run.
    hit="$(printf '%s\n' "$list" | grep -F "\"name\":\"$name\"")"
    count="$(printf '%s' "$hit" | grep -c '')"
    [ "$count" = 1 ] || die "CurseForge has $count game versions named $name: set CF_GAME_VERSIONS"
    id="$(printf '%s' "$hit" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
    game_version_ids="${game_version_ids:+$game_version_ids,}$id"
  done
}

# Prints the link. Not curl -f: on a rejection CurseForge explains itself in the body.
upload_curseforge() {
  local folder="$1" version="$2" zip="$3" project="$4" notes="$5" metadata status body="$work/response"
  metadata="{\"changelog\":$(json_string "$notes"),\"changelogType\":\"markdown\",\"displayName\":$(json_string "$folder $version"),\"gameVersions\":[$game_version_ids],\"releaseType\":\"release\",\"relations\":{\"projects\":[{\"slug\":\"spoken\",\"type\":\"requiredDependency\"}]}}"
  status="$(curl -S --progress-bar -o "$body" -w '%{http_code}' -H "X-Api-Token: $CF_TOKEN" \
    --form-string "metadata=$metadata" -F "file=@$(native "$zip")" "$CF_API/projects/$project/upload-file")" || {
    echo "    could not reach CurseForge" >&2
    return 1
  }
  case "$status" in
    2*) ;;
    413) echo "    $folder is over CurseForge's upload limit (HTTP 413)" >&2; return 1;;
    *) echo "    CurseForge answered HTTP $status: $(head -c 500 "$body")" >&2; return 1;;
  esac
  echo "project $project, file $(sed -n 's/.*"id":\([0-9]*\).*/\1/p' "$body" | head -1)"
}

#-- GitHub -------------------------------------------------------------------------------------
gh_curl() {
  curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" "$@"
}

# Prints the link. A release already holding this zip is left alone, so a re-run sends only what
# is missing.
upload_github() {
  local folder="$1" version="$2" zip="$3" notes="$4" tag="$1/v$2" name="$1-$2.zip" status id body="$work/response"
  status="$(gh_curl -o "$body" -w '%{http_code}' "$GH_API/repos/$GH_REPO/releases/tags/$tag")" || return 1
  if [ "$status" = 404 ]; then
    status="$(gh_curl -o "$body" -w '%{http_code}' -X POST "$GH_API/repos/$GH_REPO/releases" \
      -d "{\"tag_name\":$(json_string "$tag"),\"name\":$(json_string "$folder $version"),\"body\":$(json_string "$notes")}")" || return 1
  fi
  case "$status" in
    2*) ;;
    *) echo "    GitHub answered HTTP $status: $(head -c 500 "$body")" >&2; return 1;;
  esac
  if grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$name\"" "$body"; then
    echo "already there: https://github.com/$GH_REPO/releases/tag/$tag"
    return 0
  fi
  id="$(sed -n 's#.*"upload_url"[[:space:]]*:[[:space:]]*"[^"]*/releases/\([0-9]*\)/assets.*#\1#p' "$body" | head -1)"
  [ -n "$id" ] || { echo "    GitHub's answer names no release id" >&2; return 1; }
  # -T streams the file; a language's biggest pack would not fit in memory on every machine.
  status="$(curl -S --progress-bar -o "$body" -w '%{http_code}' -X POST -T "$(native "$zip")" \
    -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/zip" -H "Expect:" \
    "$GH_UPLOADS/repos/$GH_REPO/releases/$id/assets?name=$name")" || {
    echo "    could not reach GitHub" >&2
    return 1
  }
  case "$status" in
    2*) echo "https://github.com/$GH_REPO/releases/tag/$tag";;
    *) echo "    GitHub answered HTTP $status: $(head -c 500 "$body")" >&2; return 1;;
  esac
}

#-- the run ------------------------------------------------------------------------------------
if [ -n "$use_cf" ] && [ -z "$dry_run" ]; then
  echo "resolving CurseForge game versions..."
  resolve_game_versions
fi

uploaded=() skipped=() failed=()
total="${#packs[@]}"
index=0
for folder in "${packs[@]}"; do
  index=$((index + 1))
  echo "==> $index/$total $folder"
  if [ ! -f "$addons/$folder/$folder.toc" ]; then
    echo "    not installed: skipped"
    skipped+=("$folder: not installed")
    continue
  fi
  version="$(toc_version "$folder")"
  if [ -z "$version" ]; then
    echo "    its .toc has no version" >&2
    failed+=("$folder: its .toc has no version")
    continue
  fi
  notes="${changelog:-$(toc_title "$folder") $version}"

  project=""
  if [ -n "$use_cf" ]; then
    project_key="CF_$folder"
    project="${!project_key:-}"
    if [ -z "$project" ]; then
      echo "    curseforge: no project id ($project_key): skipped"
      skipped+=("$folder on CurseForge: no $project_key")
    fi
  fi

  if [ -n "$dry_run" ]; then
    echo "    version $version, $(du -sh "$addons/$folder" | cut -f1)"
    [ -z "$project" ] || echo "    curseforge: would upload to project $project"
    [ -z "$use_gh" ] || echo "    github: would release $folder/v$version on $GH_REPO"
    continue
  fi
  [ -n "$project" ] || [ -n "$use_gh" ] || continue

  zip_path="$work/$folder-$version.zip"
  echo "    zipping version $version"
  if ! make_zip "$folder" "$zip_path"; then
    failed+=("$folder: could not zip it")
    rm -f "$zip_path"
    continue
  fi
  echo "    $(du -h "$zip_path" | cut -f1)"

  if [ -n "$project" ]; then
    echo "    uploading to CurseForge"
    if link="$(upload_curseforge "$folder" "$version" "$zip_path" "$project" "$notes")"; then
      uploaded+=("$folder $version on CurseForge: $link")
    else
      failed+=("$folder on CurseForge")
    fi
  fi
  if [ -n "$use_gh" ]; then
    echo "    uploading to GitHub"
    if link="$(upload_github "$folder" "$version" "$zip_path" "$notes")"; then
      uploaded+=("$folder $version on GitHub: $link")
    else
      failed+=("$folder on GitHub")
    fi
  fi
  rm -f "$zip_path"
done

#-- the summary --------------------------------------------------------------------------------
echo
[ -z "$dry_run" ] || echo "dry run: nothing was sent"
report() {
  local title="$1"
  shift
  echo "$title: $#"
  for item in "$@"; do echo "  $item"; done
}
report "uploaded" ${uploaded[@]+"${uploaded[@]}"}
report "skipped" ${skipped[@]+"${skipped[@]}"}
report "failed" ${failed[@]+"${failed[@]}"}
[ "${#failed[@]}" -eq 0 ]

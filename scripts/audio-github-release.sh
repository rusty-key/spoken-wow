#!/usr/bin/env bash
# Publishes the sound packs as GitHub releases, which is the only channel that will take them.
#
#   ./scripts/audio-github-release.sh --dry-run          # say what would be sent, send nothing
#   ./scripts/audio-github-release.sh                    # every English pack
#   ./scripts/audio-github-release.sh zones              # zones' English packs
#   ./scripts/audio-github-release.sh zones esMX         # zones' Spanish packs
#
# WHY THIS EXISTS. CurseForge takes the packs and Wago does not: each is 280-452 MB and
# Cloudflare answers 413 to Wago's version endpoint before Wago sees the body. A player who
# installs an addon from Wago therefore has nowhere to get its audio, so the packs get a
# second home here, where the ceiling is 2 GB a file.
#
# WHY IT IS NOT THE WORKFLOW. .github/workflows/release-addons.yaml builds its zips on the
# runner, which the packs cannot be: the audio is outside git (see .gitignore) and exists only
# on the machine that generated it. So this uploads what is already in dist/ from that machine,
# the same contract scripts/*/release.sh has, and the workflow keeps the addons.
#
# ONE TAG PER PACK PROJECT. A pack is versioned by the module last built for it and the three
# groups move independently -- zones audio is at 2.0.1 while the quests packs are at 2.0.0 --
# so a tag spanning them would name a version that is only true for one. The tags are
# deliberately outside the prefixes release-addons.yaml watches (spoken/, quests/, zones/):
# that workflow would try to build an addon from a pack tag and fail the tag.
#
# English quests go out as ONE download here, the way each language's do: one answer to "which do
# I install". It is a bundle, SpokenQuestsAudioAll-<version>.zip, holding the four split packs'
# own folders -- the ones CurseForge installs -- so the two channels overwrite each other rather
# than doubling every line. The four split pages say github: false and this lists only what may
# come here (scripts/lib/packs.mjs). The meta addon, SpokenQuestsAudio,
# never comes here at all: downloaded by hand it is an empty folder.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/dist"

# The branch a tag is cut against. Tags land on master rather than on whatever is checked out:
# a release whose tag points into a feature branch loses its commit the moment that branch is
# squashed, and takes the "what shipped" answer with it.
TARGET_BRANCH="${TARGET_BRANCH:-master}"

command -v gh >/dev/null || { echo "error: gh is required (https://cli.github.com)" >&2; exit 1; }
command -v node >/dev/null || { echo "error: node is required (for the changelog)" >&2; exit 1; }

dry_run=""
args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) dry_run=1;;
    *) args+=("$arg");;
  esac
done

# What to release: every English pack (no arguments, as before), one section's English packs,
# or one section's packs in a language. Each is a (section, lang, pack) the registry resolves.
#
# A third positional argument is refused rather than silently ignored: [section] [lang] is the
# whole grammar, and a typo'd third word (a pack name, say) would otherwise be dropped without
# a trace, which reads as "it did what I asked" when it did not.
if (( ${#args[@]} > 2 )); then
  echo "error: too many arguments -- expected [section] [lang], got: ${args[*]}" >&2
  exit 2
fi
SECTIONS_ALL="quests zones books"
section="${args[0]:-}"; lang="${args[1]:-enUS}"
targets=()   # "section lang pack"
for s in ${section:-$SECTIONS_ALL}; do
  list_output="$(node "$REPO/scripts/lib/packs.mjs" list "$s" "$lang" github)" || exit 1
  while IFS= read -r p; do [[ -n "$p" ]] && targets+=("$s $lang $p"); done <<<"$list_output"
done
field() { node "$REPO/scripts/lib/packs.mjs" get "$1" "$2" "$3" "$4"; }

# An English pack's version, read back out of what was built: a pack has no committed .toc, the
# build generates one. A bundle (English quests' `all`, the four split packs in one zip) has no
# folder of its own, so it is its folders' version -- empty unless all of them were built at the
# same one, since a zip mixing two builds is not a release of either.
english_version() {
  local section="$1" pack="$2" folder="$3" bundles toc v version=""
  bundles="$(field "$section" enUS "$pack" bundles)"
  for f in ${bundles:-$folder}; do
    if [[ "$section" == quests ]]; then toc="$DIST/$f/$f.toc"; else toc="$REPO/addons/$f/$f.toc"; fi
    v="$(sed -n 's/^## Version:[[:space:]]*//p' "$toc" 2>/dev/null | head -1 | tr -d '\r')"
    [[ -n "$v" && ( -z "$version" || "$v" == "$version" ) ]] || { echo ""; return; }
    version="$v"
  done
  echo "$version"
}

# The section of the pack's CHANGELOG for the version being released, so the notes on the
# release and the notes in the repository cannot drift apart. English matches by kind (and
# steps over a language pack's heading that happens to share its version number); a language
# matches its own release tag via packs.mjs changelog.
changelog_for() {
  node -e '
    const { readFileSync } = require("fs");
    const [path, version, kind] = process.argv.slice(1);
    const lines = readFileSync(path, "utf8").split("\n");
    const language = /^## \S+ — [a-z]+(?:-[a-z]+)+-[a-z]{2}[A-Z]{2}(?:\s|$)/;
    const matches = (l) => l.startsWith(`## ${version}`) && !language.test(l) &&
      (kind ? new RegExp(kind, "i").test(l) : true);
    const start = lines.findIndex(matches);
    if (start === -1) {
      console.error(`no "## ${version}${kind ? ` ... ${kind}` : ""}" section in ${path}`);
      process.exit(1);
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    process.stdout.write(lines.slice(start, end).join("\n").trim());
  ' "$1" "$2" "$3"
}

# A PACK WHOSE ZIP IS NOT IN dist/ FAILS BEFORE ANY UPLOAD. Without this, a run of several
# packs uploads the ones it finds and only then discovers the last one was never built --
# which for a GitHub release means some tags already exist and others do not, a half release
# indistinguishable from a partial failure. Checked in --dry-run too, since a dry run's job is
# to say what a real run would hit.
missing=()
for t in ${targets[@]+"${targets[@]}"}; do
  read -r t_section t_lang t_pack <<<"$t"
  t_folder="$(field "$t_section" "$t_lang" "$t_pack" folder)"
  if [[ "$t_lang" == enUS ]]; then
    t_version="$(english_version "$t_section" "$t_pack" "$t_folder")"
  else
    t_version="$(field "$t_section" "$t_lang" "$t_pack" version)"
  fi
  if [[ -z "$t_version" ]]; then
    missing+=("$t_section/$t_lang/$t_pack -- not built (no version); run make <group>-package-audio")
    continue
  fi
  t_zip="$DIST/$t_folder-$t_version.zip"
  [[ -f "$t_zip" ]] || missing+=("$t_zip")
done
if (( ${#missing[@]} > 0 )); then
  echo "error: missing zips -- nothing was released:" >&2
  for m in "${missing[@]}"; do echo "  $m" >&2; done
  exit 1
fi

failed=()
released=()

release_target() {
  local section="$1" lang="$2" pack="$3"
  local folder release title needs changelog_file version zip_path tag notes size kind

  folder="$(field "$section" "$lang" "$pack" folder)"
  release="$(field "$section" "$lang" "$pack" release)"
  title="$(field "$section" "$lang" "$pack" name)"
  needs="spoken"
  changelog_file="$REPO/docs/$section/CHANGELOG.md"

  echo
  echo "=== $release ==="

  if [[ "$lang" == enUS ]]; then
    # A pack has no committed .toc: the build generates one and package-audio.sh passes the
    # version in, so English reads it back out of the built module. Releasing a pack nobody
    # built therefore fails here rather than uploading whatever stale zip is lying about.
    version="$(english_version "$section" "$pack" "$folder")"
    if [[ -z "$version" ]]; then
      echo "error: no version for '$release' -- the pack has not been built on this machine," >&2
      echo "       or a bundle's folders were built at different versions." >&2
      echo "       Run make <group>-package-audio first; a pack's version comes from the" >&2
      echo "       module it produces, not from a committed .toc." >&2
      return 1
    fi
  else
    version="$(field "$section" "$lang" "$pack" version)"
  fi

  zip_path="$DIST/$folder-$version.zip"
  tag="$release/v$version"
  title="$title $version"

  if [[ ! -f "$zip_path" ]]; then
    echo "error: $zip_path does not exist -- run make <group>-package-audio first" >&2
    return 1
  fi

  size="$(du -h "$zip_path" | cut -f1)"
  if [[ "$lang" == enUS ]]; then
    case "$section" in
      quests) kind="pack|audio";;
      zones)  kind="audio";;
      books)  kind="";;
    esac
    notes="$(changelog_for "$changelog_file" "$version" "$kind")" || return 1
  else
    notes="$(node "$REPO/scripts/lib/packs.mjs" changelog "$changelog_file" "$version" "$release")" || return 1
  fi

  echo "  file:    $zip_path ($size)"
  echo "  tag:     $tag on $TARGET_BRANCH"
  echo "  title:   $title"
  echo "  notes:   $(echo "$notes" | head -1) ..."

  if [[ -n "$dry_run" ]]; then
    echo "  dry run -- not releasing"
    return 0
  fi

  # An existing release is added to rather than replaced: re-running after one upload of six
  # failed should finish the job, not start a new release that drops the five that worked.
  # A pack can reach GitHub before its CurseForge project exists (scripts/lib/packs.mjs), and
  # the notes should not send a reader to a store that does not have it.
  local elsewhere="CurseForge carries it too, and Wago's upload endpoint refuses a file this size."
  if [[ -z "$(field "$section" "$lang" "$pack" curseforge)" ]]; then
    elsewhere="Wago's upload endpoint refuses a file this size, and it is not on CurseForge yet."
  fi

  if gh release view "$tag" >/dev/null 2>&1; then
    echo "  release exists -- uploading the asset into it"
    gh release upload "$tag" "$zip_path" --clobber || return 1
  else
    gh release create "$tag" "$zip_path" \
      --target "$TARGET_BRANCH" \
      --title "$title" \
      --notes "$notes

**This pack is data only.** It needs [$needs](https://addons.wago.io/addons/$needs), which plays it; installed alone it does nothing.

Released here because the pack is $size: $elsewhere" || return 1
  fi

  echo "  released -- $(gh release view "$tag" --json url -q .url)"
}

for t in ${targets[@]+"${targets[@]}"}; do
  read -r t_section t_lang t_pack <<<"$t"
  if release_target "$t_section" "$t_lang" "$t_pack"; then
    released+=("$t_section/$t_lang/$t_pack")
  else
    failed+=("$t_section/$t_lang/$t_pack")
    echo "  skipping $t_section $t_lang $t_pack and continuing" >&2
  fi
done

echo
if (( ${#released[@]} > 0 )); then
  echo "done: ${released[*]}"
fi
if (( ${#failed[@]} > 0 )); then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi

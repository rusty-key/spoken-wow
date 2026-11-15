#!/usr/bin/env bash
# Runs a worktree's addons in a WoW client on another machine than the worktree.
#
#   scripts/developer/sync-addons.sh <worktree> [forever|era|tbc]          # copy once
#   scripts/developer/sync-addons.sh --watch <worktree> [forever|era|tbc]  # keep copying
#   scripts/developer/sync-addons.sh --stop                                # end --watch
#
# Run it on the machine with the client; /sync-addon gives the command filled in. <worktree>
# is a worktree's folder name (found under ~/.paseo/worktrees/*/ or ~/ on the server) or its
# absolute path there. The client is forever unless named. With no checkout on that machine,
# stream the script from the server:
#
#   ssh dev cat <worktree path>/scripts/developer/sync-addons.sh | bash -s -- --watch <worktree>
#
# SPOKEN_DEV_HOST is the server's ssh host (default dev; "local" when the worktree is on this
# machine), SPOKEN_WOW_DIR the WoW folder (default /Applications/World of Warcraft).
#
# WHY COPIES. /link-addon symlinks a worktree into the client, which needs both on one disk.
# A network mount of the server (sshfs) would keep the links, but the client reads every addon
# file at login and on /reload, and over a mount that is slow and fails without saying why.
#
# WHAT IT TOUCHES, as /link-addon: every addons/ folder with a .toc except the audio packs,
# whose mp3s are outside git, so the worktree's copy would silence the client. A real folder
# this script did not write, usually an installed release, moves to AddOns.bak/<time>/ first
# and is never deleted. A folder it wrote holds .spoken-sync naming its source, so the next
# run replaces it, from any worktree. A /link-addon symlink is replaced. WTF/ is not touched.
#
# --watch adds one Mutagen session per addon, one-way from the server, so a saved file reaches
# the client in a second or two and /reload runs it. One per addon, not one for AddOns: a
# replica of a folder deletes everything else in it. A new --watch ends the previous sessions,
# so switching worktree is one command. The sessions outlive this script and survive a reboot
# of either machine; --stop ends them and leaves the copies in place.
set -euo pipefail

HOST=${SPOKEN_DEV_HOST:-dev}
WOW_DIR=${SPOKEN_WOW_DIR:-/Applications/World of Warcraft}
MARK=.spoken-sync
LABEL=spoken-sync=yes

die() { echo "sync-addons: $*" >&2; exit 1; }

# Runs a bash script on the server. The login shell there may not be POSIX (fish), so the
# script goes to bash on stdin rather than through the shell's command line.
on_server() {
	local script=$1
	shift
	if [ "$HOST" = local ]; then
		bash -s -- "$@" <<<"$script"
	else
		ssh "$HOST" bash -s -- "$@" <<<"$script"
	fi
}

# Prints the worktree's absolute path, then one line per addon folder to sync.
RESOLVE='
want=$1
case $want in
/*) found=$want ;;
*)
	found=
	for c in "$HOME"/.paseo/worktrees/*/"$want" "$HOME/$want"; do
		[ -d "$c/addons" ] || continue
		[ -z "$found" ] || { echo "two worktrees are named $want: $found and $c" >&2; exit 2; }
		found=$c
	done ;;
esac
[ -n "$found" ] && [ -d "$found/addons" ] || { echo "no worktree $want with addons/" >&2; exit 1; }
echo "$found"
cd "$found/addons"
for d in */; do
	d=${d%/}
	case $d in *Audio*) continue ;; esac
	ls "$d"/*.toc >/dev/null 2>&1 && echo "$d"
done
'

client_dir() {
	case $1 in
	forever) echo _forever_ ;;
	era) echo _classic_era_ ;;
	tbc) echo _anniversary_ ;;
	*) die "unknown client $1: use forever, era or tbc" ;;
	esac
}

source_of() {
	if [ "$HOST" = local ]; then echo "$1"; else echo "$HOST:$1"; fi
}

stop_watch() {
	command -v mutagen >/dev/null || return 0
	mutagen sync terminate --label-selector "$LABEL" </dev/null >/dev/null 2>&1 || true
}

main() {
	local watch=no
	case ${1:-} in
	--watch) watch=yes; shift ;;
	--stop)
		command -v mutagen >/dev/null || die "Mutagen is not installed, so nothing is watching"
		stop_watch
		echo "Stopped watching. The copies stay in the client until the next sync."
		return ;;
	-h | --help | "")
		[ -f "$0" ] || die "usage: sync-addons.sh [--watch] <worktree> [forever|era|tbc], or --stop"
		sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
		return ;;
	esac
	local want=$1 client=${2:-forever}
	case $want in *[!A-Za-z0-9._/~-]*) die "unexpected characters in worktree $want" ;; esac
	[ "$watch" = no ] || command -v mutagen >/dev/null ||
		die "--watch needs Mutagen (brew install mutagen-io/mutagen/mutagen)"

	local addons_dir
	addons_dir="$WOW_DIR/$(client_dir "$client")/Interface/AddOns"
	[ -d "$addons_dir" ] || die "$addons_dir does not exist: is $client installed?"

	local listing worktree
	listing=$(on_server "$RESOLVE" "$want") || die "could not read the worktree from $HOST"
	worktree=$(sed -n 1p <<<"$listing")
	local names=()
	while IFS= read -r name; do
		[ -n "$name" ] && names+=("$name")
	done < <(sed 1d <<<"$listing")
	[ ${#names[@]} -gt 0 ] || die "$worktree has no addon folders"

	# --watch's sessions would overwrite this run's copies from the old worktree.
	stop_watch

	local backup="" moved=() name dest
	for name in "${names[@]}"; do
		dest="$addons_dir/$name"
		if [ -L "$dest" ]; then
			rm "$dest"
		elif [ -d "$dest" ] && [ ! -f "$dest/$MARK" ]; then
			[ -n "$backup" ] || backup="$WOW_DIR/$(client_dir "$client")/Interface/AddOns.bak/$(date +%Y%m%d-%H%M%S)"
			mkdir -p "$backup"
			mv "$dest" "$backup/"
			moved+=("$name")
		fi
		mkdir -p "$dest"
		rsync -a --delete --exclude="/$MARK" "$(source_of "$worktree/addons/$name")/" "$dest/" </dev/null
		source_of "$worktree" >"$dest/$MARK"
	done

	echo "$client now runs $(source_of "$worktree"):"
	printf '  %s\n' "${names[@]}"
	if [ ${#moved[@]} -gt 0 ]; then
		echo "Moved aside, not deleted, to $backup:"
		printf '  %s\n' "${moved[@]}"
	fi

	# Spoken folders this run did not write: audio packs, and copies from another worktree.
	local other entry kind
	for entry in "$addons_dir"/Spoken*; do
		[ -e "$entry" ] || [ -L "$entry" ] || continue
		other=$(basename "$entry")
		case " ${names[*]} " in *" $other "*) continue ;; esac
		if [ -L "$entry" ]; then
			kind="links to $(readlink "$entry")"
		elif [ -f "$entry/$MARK" ]; then
			kind="copied from $(cat "$entry/$MARK")"
		else
			kind="installed"
		fi
		echo "Left alone: $other, $kind"
	done

	if [ "$watch" = yes ]; then
		local slug
		for name in "${names[@]}"; do
			slug=$(tr '[:upper:]' '[:lower:]' <<<"$name" | tr _ -)
			mutagen sync create --name "spoken-$slug" --label "$LABEL" \
				--mode one-way-replica --ignore-vcs --ignore "/$MARK" \
				"$(source_of "$worktree/addons/$name")" "$addons_dir/$name" </dev/null >/dev/null
		done
		echo "Watching: saved files reach the client by themselves. /reload to run them."
		echo "Status: mutagen sync list --label-selector $LABEL"
	fi
	echo "/reload in game, or restart the client if it has not seen an addon before."
}

main "$@"
exit

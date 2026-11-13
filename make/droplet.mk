# Where the droplet is, and how to reach it. Included by web.mk, quests.mk,
# places.mk and readables.mk.
#
# NOTHING HERE NAMES THE HOST. This file is public, and a hostname in it is a
# standing invitation to knock on the door -- so the address arrives from the
# environment and a clone gets a target that fails loudly instead of one that is
# wrong. Set it once, in whatever your shell reads:
#
#     export SPOKEN_DROPLET=deploy@<host>        # the deploy user, never root
#     export SPOKEN_DEPLOY_KEY=~/.ssh/<key>      # optional; the default below
#                                                # is what a fresh setup creates
#
# CI does not read these. GitHub Actions gets the same three facts from repository
# secrets -- DO_USER, DO_HOST, DO_SSH_KEY, plus DO_KNOWN_HOSTS -- and builds its own
# ssh invocation in .github/workflows/deploy-web.yaml.
#
# Override per invocation when it is a one-off, which is what the IP is for when the
# name is ever pointed at something that will not proxy SSH:
#
#     make places-pull-history DROPLET=deploy@203.0.113.10

DROPLET ?= $(SPOKEN_DROPLET)

# Connect as deploy, never root: pm2 daemons are per-user, so a reload over an ssh
# session as root talks to root's empty daemon and silently does nothing.
REMOTE_ROOT ?= /srv/spoken

# The key CI authenticates with too, so `make web-ssh-check` tests what a deploy does.
#
# -o IdentitiesOnly=yes is not optional: a `Host *` block naming IdentityFile in
# ~/.ssh/config REPLACES the default identity list rather than adding to it. A bare
# ssh then offers only those keys and the failure is a flat "Permission denied
# (publickey)" naming neither the key it tried nor the one it wanted.
DEPLOY_KEY ?= $(if $(SPOKEN_DEPLOY_KEY),$(SPOKEN_DEPLOY_KEY),~/.ssh/id_spoken_deploy)
SSH        ?= ssh -i $(DEPLOY_KEY) -o IdentitiesOnly=yes

# Every droplet target depends on this. Without it an unset SPOKEN_DROPLET reaches
# rsync as a bare `:` path, which it reads as a LOCAL copy -- and the targets here
# run --delete.
.PHONY: require-droplet
require-droplet:
	@test -n "$(DROPLET)" || { \
	  echo "error: no droplet configured." >&2; \
	  echo "       export SPOKEN_DROPLET=deploy@<host>, or pass DROPLET=deploy@<host>." >&2; \
	  echo "       See make/droplet.mk." >&2; \
	  exit 1; }

# The database a pack is built from, and what the sync and freshness scripts need to reach
# production. One definition for every section: scripts/db/sync-section.sh and
# scripts/db/check-synced.sh are the same recipe for quests, places and readables.
LOCAL_DB ?= postgres://localhost/spoken_dev
DB_ENV    = DROPLET="$(DROPLET)" SSH="$(SSH)" REMOTE_ROOT="$(REMOTE_ROOT)" LOCAL_DB="$(LOCAL_DB)"

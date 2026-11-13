# The website: the app's own targets, and the droplet it runs on.
#
#     make web-dev           ->  make -f make/web.mk dev
#
# Run from the repo root; the root Makefile's pattern rule guarantees that.
#
# The audio stores are NOT synced from here. They belong to the two pipelines and stay in
# make/quests.mk and make/places.mk, whose rsync targets carry the guards -- several of them
# run with --delete against directories holding audio that cannot be regenerated, and
# splitting those guards across two files is how one of them gets lost.

.DEFAULT_GOAL := help
.PHONY: help dev build typecheck test bootstrap deploy-scripts releases rollback logs \
        ssh-check store migrate-readables db-pull import-locale push-seed-clips push-voice-sources

APP := @spoken/web

include make/droplet.mk


# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-18s %s\n", $$1, $$2}'

#------------------------------------------------------------------------------
# Local
#------------------------------------------------------------------------------

dev: ## Run the site locally (needs a Postgres; see .env.example and apps/web/.env.example)
	@pnpm --filter $(APP) dev

build: ## Production build, as CI does it
	@pnpm --filter $(APP) build

typecheck: ## Typecheck only
	@pnpm --filter $(APP) typecheck

test: ## Vitest (several suites need a real Postgres)
	@pnpm --filter $(APP) test

#------------------------------------------------------------------------------
# Droplet
#------------------------------------------------------------------------------

bootstrap: ## Print the first-time setup for /srv/spoken (run it on the droplet as root)
	@cat deploy/web/bootstrap.sh

store: ## Print the /mnt/voice setup (run it on the droplet as root)
	@cat deploy/web/store.sh

deploy-scripts: require-droplet ## Install deploy/web/bin + ecosystem.config.js on the droplet
	$(RSYNC) -a -e "$(SSH)" deploy/web/bin/ $(DROPLET):$(REMOTE_ROOT)/bin/
	$(RSYNC) -a -e "$(SSH)" deploy/web/ecosystem.config.js $(DROPLET):$(REMOTE_ROOT)/shared/
	$(SSH) $(DROPLET) 'chmod +x $(REMOTE_ROOT)/bin/*.sh'
	@echo "==> installed"

releases: require-droplet ## List releases on the droplet, marking the live one
	@$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh --list'

rollback: require-droplet ## Roll back to the previous release (or RELEASE=<name>)
	$(SSH) $(DROPLET) '$(REMOTE_ROOT)/bin/rollback.sh $(RELEASE)'

logs: require-droplet ## Tail the app's pm2 log
	$(SSH) $(DROPLET) 'pm2 logs spoken --lines 100'

ssh-check: require-droplet ## Test the CI deploy key against the droplet, as CI authenticates
	@echo "local  $(DEPLOY_KEY): $$(ssh-keygen -lf $(DEPLOY_KEY) 2>/dev/null | awk '{print $$2}' || echo 'MISSING')"
	@echo "compare against the 'deploy key fingerprint' line in the workflow log"
	@ssh -F /dev/null -i $(DEPLOY_KEY) -o IdentitiesOnly=yes -o BatchMode=yes $(DROPLET) \
		'echo "connected as $$(whoami)"; ls -ld $(REMOTE_ROOT) $(REMOTE_ROOT)/bin 2>&1'

#-------------------------------------------------------------------------------
# The readables corpus
#
# Its own path, because readables cannot be seeded the way the other two are. The quests corpus
# ships inside the release as a committed file and the places one is imported from the other
# droplet's database; readables is extracted from a vmangos MySQL that exists only on a
# maintainer's machine, so the rows travel from there or not at all.
#
# THE DROPLET CANNOT RE-SEED ITSELF. If this table is ever lost there, it comes back from a
# local extract and this target -- which is the reason it is a target rather than a command
# somebody remembers.
#-------------------------------------------------------------------------------

# The native local Postgres, not a container: the readables pipeline writes to whatever
# DATABASE_URL names, and this is where it has been run.
LOCAL_DB ?= postgres://localhost/spoken_dev

# pg_dump 16.10 and later wrap output in \restrict / \unrestrict, psql meta-commands that
# an older psql fails on. Both clusters are ours, so strip them rather than requiring the
# droplet's psql to match this one. scripts/db/sync-section.sh strips them the same way.
UNRESTRICT := sed -e '/^\\restrict/d' -e '/^\\unrestrict/d'

# The whole production database, copied into a local one of its own.
#
# For rehearsing a migration against the data it will actually meet. The per-section syncs
# (make quests-sync, places-sync, readables-sync) copy one section's rows for everyday work;
# this copies everything, because what a migration can break is the joins between tables --
# a take whose lineId no longer resolves, an override naming a file the corpus dropped.
#
# INTO A DATABASE OF ITS OWN, not over $(LOCAL_DB). A rehearsal you cannot repeat is not a
# rehearsal, and losing the local state to find that out is a bad trade. Override the name
# with TARGET_DB=... if you want a second one to compare against.
#
# IT BRINGS PEOPLE'S DATA WITH IT: accounts, email addresses, sessions, and the prose
# strangers wrote in reports. The ElevenLabs keys are encrypted at rest and the key that
# opens them is an environment variable that does not travel in a dump -- but the rows do.
# Drop the copy when the rehearsal is over.
TARGET_DB ?= spoken_prod_rehearsal

db-pull: require-droplet ## Copy the whole droplet database into a local one (TARGET_DB=...)
	@echo "==> this copies production data, including accounts and report prose, onto this machine"
	@printf 'Copy the droplet database into "$(TARGET_DB)" (dropping any existing copy)? [y/N] ' \
	  && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@dropdb --if-exists $(TARGET_DB)
	@createdb $(TARGET_DB)
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; pg_dump --no-owner --no-acl "$$DATABASE_URL"' \
	  | $(UNRESTRICT) \
	  | psql "postgres:///$(TARGET_DB)" -v ON_ERROR_STOP=1 -q
	@echo "==> copied. Tables:"
	@psql "postgres:///$(TARGET_DB)" -tAc "select count(*) || ' tables' from information_schema.tables where table_schema = 'public'"
	@echo "==> rehearse the migration with:  DATABASE_URL=postgres:///$(TARGET_DB) deploy/web/bin/migrate.sh \"$$PWD/apps/web\""

# One language's text, from the vmangos dump and the addon's aliases, into production's
# database through an ssh tunnel. Run here because only a workstation has the dump; see the
# script. Re-running is safe, and it switches nothing on. LOCALE and not LANG, which every
# shell sets.
import-locale: require-droplet ## Load a language's text into the droplet database (LOCALE=frFR)
	@test -n "$(LOCALE)" || { echo "import-locale: set LOCALE, e.g. LOCALE=frFR"; exit 2; }
	@$(DB_ENV) bash scripts/db/import-locale.sh $(LOCALE)

# The seed clips /voices seeds clones from, onto the droplet's shared/seed-clips. Additive: no
# --delete, so pushing one language never removes another's -- or English, which a checkout
# may not have. SEED_CLIPS is the local root, English at its top and frFR/ etc. beside.
SEED_CLIPS ?= pipelines/quests/voice/seed-clips

push-seed-clips: require-droplet ## Copy local seed clips to shared/seed-clips on the droplet
	@test -d "$(SEED_CLIPS)" || { echo "no $(SEED_CLIPS): fetch the seed clips first"; exit 1; }
	$(RSYNC) -a --exclude .DS_Store -e "$(SSH)" "$(SEED_CLIPS)/" $(DROPLET):$(REMOTE_ROOT)/shared/seed-clips/
	@echo "==> pushed"

# The clips and fish.audio references apps/web/scripts/seed-voice-sources.mts wrote locally,
# onto the droplet: files, and the fish_reference rows. Replaces only the voices that run
# listed in pipelines/quests/voice/samples/.seeded; see scripts/voice/push-sources.sh.
push-voice-sources: require-droplet ## Push seeded voice clips + fish references to the droplet (ADMIN_EMAIL=...)
	@$(DB_ENV) RSYNC="$(RSYNC)" ADMIN_EMAIL="$(ADMIN_EMAIL)" bash scripts/voice/push-sources.sh

migrate-readables: require-droplet ## Copy the local readables corpus onto the droplet (REPLACES book_page and book_line)
	@echo "local:"
	@psql "$(LOCAL_DB)" -c 'select count(*) as rows, count(*) filter (where "isCurrent") as live from "book_line"' \
	  -c 'select count(*) as pages, count(*) filter (where "aliasOf" is null) as live, count(distinct "bookId") as books from "book_page"'
	@echo "droplet:"
	@$(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" \
		-c "select count(*) as rows, count(*) filter (where \"isCurrent\") as live from \"book_line\"" \
		-c "select count(*) as pages, count(*) filter (where \"aliasOf\" is null) as live, count(distinct \"bookId\") as books from \"book_page\""'
	@printf 'Replace the droplet book_page and book_line with the local ones? [y/N] ' && read a && [ "$$a" = y ] || { echo aborted; exit 1; }
	@( echo 'begin;'; \
	   echo 'truncate "book_line", "book_page";'; \
	   pg_dump "$(LOCAL_DB)" --data-only --table=book_page --table=book_line | $(UNRESTRICT); \
	   echo 'select setval(pg_get_serial_sequence('"'"'public.book_line'"'"', '"'"'id'"'"'), coalesce(max("id"), 1)) from public."book_line";'; \
	   echo 'commit;' ) \
	  | $(SSH) $(DROPLET) 'set -a; . $(REMOTE_ROOT)/shared/app.env; set +a; psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -q'
	@echo "==> pushed"

# The sequence is reset in the same transaction, because --data-only does not carry it and
# the next edit saved through the site would collide with an id the dump already used.
#
# SCHEMA-QUALIFIED, and that is not style. pg_dump's preamble runs
# `set_config('search_path', '', false)`, so every unqualified name after it fails to
# resolve -- the dump's own statements say public.book_line for exactly this reason. Left
# bare, this line aborts the transaction and rolls the whole load back, while the sequence
# it was fixing keeps its new value, because sequences are not transactional.

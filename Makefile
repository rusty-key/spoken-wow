# Spoken -- the dispatcher.
#
# The four projects (quests, places, readables and web) keep their own Makefiles. They share about
# thirty target names (help, package, release, pull, sync and the rest) and each target is
# commented with the failure it exists to prevent, several of them guarding an
# rsync --delete against audio that cannot be regenerated. Merging them is a
# semantic rewrite of well over a hundred targets with nothing to show for it, so
# they are dispatched instead and the prefix disambiguates:
#
#     make quests-package        ->  make -f make/quests.mk package
#     make places-release-dry    ->  make -f make/places.mk release-dry
#     make web-dev               ->  make -f make/web.mk dev
#     make readables-extract     ->  make -f make/readables.mk extract
#
# Every .mk file uses paths relative to the repo root, so they must be run from
# here -- which is what the pattern rules below guarantee.

.DEFAULT_GOAL := help

LUA ?= $(shell command -v luajit || command -v lua5.1)

.PHONY: help test test-player contribute-fixtures lint package-all \
        package-spoken package-spoken-all release-spoken release-spoken-dry \
        release-spoken-all release-spoken-all-dry \
        descriptions descriptions-check descriptions-published \
        character-models dungeons bosses-extract bosses-export bosses-check bosses-sync bosses-check-synced \
        bosses-pull-live bosses-sounds bosses-lookup bosses-validate-audio bosses-package-audio \
        bosses-full-release \
        audio-release audio-release-dry \
        manager-publish manager-publish-dry manager-release manager-gc manager-gc-dry

help: ## Show this help
	@printf 'Spoken\n\n'
	@printf '  make quests-<target>   see make/quests.mk  (make quests-help)\n'
	@printf '  make places-<target>   see make/places.mk  (make places-help)\n'
	@printf '  make web-<target>      see make/web.mk     (make web-help)\n'
	@printf '  make readables-<target> see make/readables.mk (make readables-help)\n\n'
	@printf 'Repo-wide:\n'
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-16s %s\n", $$1, $$2}'

quests-%:
	@$(MAKE) --no-print-directory -f make/quests.mk $*

places-%:
	@$(MAKE) --no-print-directory -f make/places.mk $*

web-%:
	@$(MAKE) --no-print-directory -f make/web.mk $*

readables-%:
	@$(MAKE) --no-print-directory -f make/readables.mk $*

test-player: ## Run the addons' Lua tests (needs luajit)
	@[ -n "$(LUA)" ] || { echo "No luajit found: brew install luajit"; exit 1; }
	@$(LUA) tests/lua/quest_dispatch_test.lua
	@$(LUA) tests/lua/quest_autoplay_test.lua
	@$(LUA) tests/lua/gossip_part_test.lua
	@$(LUA) tests/lua/gossip_page_test.lua
	@$(LUA) tests/lua/quests_saved_settings_test.lua
	@$(LUA) tests/lua/gossip_frequency_test.lua
	@$(LUA) tests/lua/gossip_variant_test.lua
	@$(LUA) tests/lua/quest_overlay_test.lua
	@$(LUA) tests/lua/quest_overlay_classic_test.lua
	@$(LUA) tests/lua/quest_tracker_adapters_test.lua
	@$(LUA) tests/lua/quest_followup_test.lua
	@$(LUA) tests/lua/quest_chatter_test.lua
	@$(LUA) tests/lua/quest_chatbubble_test.lua
	@$(LUA) tests/lua/quest_abandon_test.lua
	@$(LUA) tests/lua/easter_egg_test.lua
	@$(LUA) tests/lua/sound_utils_test.lua
	@$(LUA) tests/lua/other_sounds_test.lua
	@$(LUA) tests/lua/background_sound_test.lua
	@$(LUA) tests/lua/parts_test.lua
	@$(LUA) tests/lua/settings_ux_test.lua
	@$(LUA) tests/lua/settings_art_test.lua
	@for lang in enUS deDE esES esMX frFR ptBR ruRU koKR zhCN zhTW itIT viVN; do $(LUA) tests/lua/settings_fit_test.lua $$lang || exit 1; done
	@$(LUA) tests/lua/settings_audit_test.lua
	@$(LUA) tests/lua/queue_test.lua
	@$(LUA) tests/lua/battlegrounds_test.lua
	@$(LUA) tests/lua/secret_values_test.lua
	@$(LUA) tests/lua/developer_hooks_test.lua
	@$(LUA) tests/lua/developer_log_test.lua
	@$(LUA) tests/lua/quests_log_test.lua
	@$(LUA) tests/lua/sources_test.lua
	@$(LUA) tests/lua/api_contract_test.lua
	@$(LUA) tests/lua/contribute_envelope_test.lua
	@$(LUA) tests/lua/report_url_contract_test.lua
	@$(LUA) tests/lua/client_variant_test.lua
	@$(LUA) tests/lua/interface_numbers_test.lua
	@$(LUA) tests/lua/contribute_box_test.lua
	@$(LUA) tests/lua/quests_contribute_test.lua
	@$(LUA) tests/lua/npc_model_test.lua
	@$(LUA) tests/lua/player_frame_test.lua
	@$(LUA) tests/lua/snap_test.lua
	@$(LUA) tests/lua/player_dialogueui_style_test.lua
	@$(LUA) tests/lua/minimal_window_test.lua
	@$(LUA) tests/lua/ellesmere_look_test.lua
	@$(LUA) tests/lua/text_only_test.lua
	@$(LUA) tests/lua/places_aliases_test.lua
	@$(LUA) tests/minimal-classic/verify.lua
	@$(LUA) tests/captions/verify.lua
	@$(LUA) tests/lua/places_source_test.lua
	@$(LUA) tests/lua/places_flight_test.lua
	@$(LUA) tests/lua/places_instance_test.lua
	@$(LUA) tests/lua/places_greeting_test.lua
	@$(LUA) tests/lua/places_pending_test.lua
	@$(LUA) tests/lua/quests_source_test.lua
	@$(LUA) tests/lua/quest_npc_silence_test.lua
	@$(LUA) tests/lua/quest_greeting_first_test.lua
	@$(LUA) tests/lua/data_modules_test.lua
	@$(LUA) tests/lua/quests_language_test.lua
	@$(LUA) tests/lua/quest_voice_files_test.lua
	@$(LUA) tests/lua/quest_wording_test.lua
	@$(LUA) tests/lua/quests_no_packs_test.lua
	@$(LUA) tests/lua/duplicate_player_test.lua
	@$(LUA) tests/lua/places_options_test.lua
	@$(LUA) tests/lua/places_test_line_test.lua
	@$(LUA) tests/lua/places_lore_ui_test.lua
	@$(LUA) tests/lua/places_lands_test.lua
	@$(LUA) tests/lua/places_map_click_test.lua
	@$(LUA) tests/lua/places_map_highlight_test.lua
	@$(LUA) tests/lua/places_area_at_test.lua
	@$(LUA) tests/lua/places_discovery_test.lua
	@$(LUA) tests/lua/subtitle_pages_test.lua
	@$(LUA) tests/lua/defaults_test.lua
	@$(LUA) tests/lua/scroll_mode_upgrade_test.lua
	@$(LUA) tests/lua/style_upgrade_test.lua
	@$(LUA) tests/lua/names_test.lua
	@$(LUA) tests/lua/packs_test.lua
	@$(LUA) tests/lua/quests_options_test.lua
	@$(LUA) tests/lua/quests_dialogueui_test.lua
	@$(LUA) tests/lua/quests_immersion_test.lua
	@$(LUA) tests/lua/readables_source_test.lua
	@$(LUA) tests/lua/readables_options_test.lua
	@$(LUA) tests/lua/module_settings_test.lua
	@$(LUA) tests/lua/module_profiles_test.lua
	@$(LUA) tests/lua/new_character_profile_test.lua
	@$(LUA) tests/lua/locale_parity_test.lua
	@$(LUA) tests/lua/readables_reader_test.lua
	@$(LUA) tests/lua/readables_playlist_test.lua
	@$(LUA) tests/lua/readables_dialogueui_test.lua
	@$(LUA) tests/lua/readables_events_test.lua
	@$(LUA) tests/lua/readables_close_test.lua
	@$(LUA) tests/lua/readables_contribute_test.lua
	@$(LUA) tests/lua/readables_compendium_test.lua
	@$(LUA) tests/lua/quests_compendium_test.lua
	@$(LUA) tests/lua/quests_shift_queue_test.lua
	@$(LUA) tests/lua/quests_compendium_races_test.lua
	@$(LUA) tests/lua/readables_language_test.lua
	@$(LUA) tests/lua/gather_test.lua
	@$(LUA) tests/lua/places_contribute_test.lua
	@$(LUA) tests/lua/places_language_test.lua
	@$(LUA) tests/lua/places_each_place_once_test.lua
	@$(LUA) tests/lua/places_city_test.lua
	@$(LUA) tests/lua/places_dungeons_test.lua
	@$(LUA) tests/lua/bosses_test.lua
	@$(LUA) tests/lua/bosses_audio_test.lua
	@$(LUA) tests/lua/places_story_place_test.lua
	@$(LUA) tests/lua/places_area_zones_test.lua
	@$(LUA) tests/lua/places_forever_places_test.lua
	@$(LUA) tests/lua/minimap_compartment_test.lua
	@$(LUA) tests/lua/bronze_rings_test.lua
	@$(LUA) tests/lua/module_globals_test.lua

# Rewrite the envelope fixtures the TypeScript reader is tested against. A diff here is the
# wire format changing, and that is a change the reader's tests must be part of. The
# captured-* ones are what the modules' own Capture functions produce in their tests, and
# report-urls.txt the report addresses the site's report-urls.test.ts resolves.
contribute-fixtures:
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/contribute_envelope_test.lua
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/report_url_contract_test.lua
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/quests_contribute_test.lua
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/places_contribute_test.lua
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/readables_contribute_test.lua

# The Python half needs its own venv:
#
#   cd pipelines/quests && python -m venv .venv \
#     && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
#
# tests/test_corpus.py skips itself without pandas, which is in requirements-extract.txt and
# pinned at a version with no wheel for this Python. See docs/quests/README.md#tests.

test: test-player ## Everything: the site, the Node and Python pipelines, the addons
	@pnpm -r test
	@node --test scripts/lib/*.test.mjs scripts/audio/*.test.mjs pipelines/lib/*.test.mjs
	@[ -x pipelines/quests/.venv/bin/python ] || { \
	  echo "No venv at pipelines/quests/.venv -- see the comment above 'test' in the Makefile"; \
	  exit 1; }
	@cd pipelines/quests && ./.venv/bin/python -m pytest -q

lint: ## The checks CI gates on
	@pnpm -r typecheck
	@node scripts/check-addon-xml.mjs
	@./scripts/spoken/check-changelog.sh
	@node pipelines/places/tools/validate.mjs
	@node scripts/descriptions.mjs --check
	@node pipelines/places/tools/locale/check-strings.mjs
	@node pipelines/places/tools/locale/build-languages.mjs --check

# The store project pages, for every addon. One tool over publishers/*/ rather than one
# per project: the pages are the same shape, and a second copy of this would be a second place
# for the summary limit and the published.json convention to drift.
#
# `descriptions-published` is a claim, not a check -- there is no API to read a live page back,
# so it records what you have just pasted. Run it after pasting, never before.

descriptions: ## Regenerate the addon READMEs and dist/descriptions*/ from publishers/
	@node scripts/descriptions.mjs --write

descriptions-check: ## Confirm the addon READMEs match publishers/
	@node scripts/descriptions.mjs

descriptions-published: ## Record the current descriptions as pasted into the site
	@node scripts/descriptions.mjs --published

# Not a target that runs itself -- scripts/character-models.mjs takes the listfile on stdin
# so this step never pulls 152 MB on its own. Run it by hand when a new race ships.

# The dungeons the quests' and readables' exporters file things under, and the one table the addon
# reads (Spoken/Data/Dungeons.lua), both from pipelines/lib/dungeons.json. Run it after editing
# that file, then the exporters that read it.
dungeons: ## Rebuild addons/Spoken/Data/Dungeons.lua from pipelines/lib/dungeons.json and the client's Map table
	@node pipelines/lib/dungeons.mjs

# The bosses of those dungeons and raids, from the client's DungeonEncounter table, for the bosses'
# tab. It writes the boss tables, not Spoken_Bosses/Data/Bosses.lua: run bosses-export after it.
bosses-extract: ## Bring the boss tables into step with the client's DungeonEncounter table
	@node pipelines/lib/bosses.mjs

# Spoken_Bosses' Bosses, Creatures and Stories Lua are exports of the boss tables. bosses-check needs
# Postgres, so it stays out of lint, which has to pass on a clone without one.
bosses-export: ## Write Spoken_Bosses' Bosses, Creatures and Stories Lua from the database
	@node pipelines/places/tools/bosses/export.mjs
bosses-check: ## Confirm the committed Spoken_Bosses data matches the database
	@node pipelines/places/tools/bosses/export.mjs --check

include make/droplet.mk

# The site will edit boss stories and names, so production is upstream for the boss tables as it
# is for every section's corpus. scripts/db/sync-section.sh has the recipe.
bosses-sync: require-droplet ## Replace the local boss tables, boss names and boss takes with the droplet's (DESTRUCTIVE)
	@$(DB_ENV) scripts/db/sync-section.sh bosses boss_instance boss boss_line
	@echo "==> bring the addon into step with:  make bosses-export"
bosses-check-synced: ## Compare the local boss data with the droplet's, and prompt if they differ
	@$(DB_ENV) scripts/db/check-synced.sh bosses

# The bosses' sound pack, SpokenBossesAudio, built as the places pack is (make/places.mk): from
# the live boss takes in LOCAL_DB and the archive, pipelines/places/bosses-audio-history (on the
# droplet shared/audio-history/bosses). Every step reads the one database LOCAL_DB names, so the
# clips Sounds/ holds and the entries the lookup lists come from the same takes. LOCALE=deDE
# acts on that language's pack, under build/bosses/deDE.
BOSSES_LOCALE = $(or $(LOCALE),enUS)
BOSSES_DB = DATABASE_URL="$(LOCAL_DB)"
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# Only the takes the pack is built from, as the local database has them: run bosses-sync first.
bosses-pull-live: require-droplet ## Fetch only the live boss takes the local database names (after bosses-sync)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh bosses $(BOSSES_LOCALE)

# Sounds/ is not kept: it is assembled from the live takes before every build (scripts/audio/sounds.mjs).
bosses-sounds: ## Assemble SpokenBossesAudio's Sounds/ (LOCALE=xx: into build/bosses/xx) from the live takes
	@$(DB_ENV) node scripts/audio/sounds.mjs --lang=$(BOSSES_LOCALE) bosses

bosses-lookup: ## Write SpokenBossesAudio's Data/Sounds.lua from the live boss takes (LOCALE=xx)
	@$(BOSSES_DB) node pipelines/places/tools/bosses/build-lookup.mjs --lang $(BOSSES_LOCALE)

# A lookup row whose mp3 is missing plays silence and reports nothing; this fails the build on it.
bosses-validate-audio: ## Check SpokenBossesAudio's lookup, mp3s and live takes agree (LOCALE=xx)
	@$(BOSSES_DB) node pipelines/places/tools/bosses/validate-audio.mjs --lang $(BOSSES_LOCALE)

bosses-package-audio: bosses-check-synced bosses-sounds bosses-lookup bosses-validate-audio ## Build the bosses sound-pack zip into dist/ (LOCALE=xx)
	@LOCALE="$(BOSSES_LOCALE)" ./scripts/bosses/package-audio.sh

# GitHub only: CurseForge has no bosses project, and English's pack reaches it inside the Places
# project's zip, Spoken Audio: Places and Bosses, with the next places-full-release. The version is
# SpokenBossesAudio.toc's (a language's, its page's), and its `## <version> — bosses-audio` section
# in docs/bosses/CHANGELOG.md is the notes.
bosses-full-release: require-droplet ## Sync, pull live takes, build and GitHub-release the bosses sound pack (LOCALE=xx)
	@$(MAKE) --no-print-directory bosses-sync
	@$(MAKE) --no-print-directory bosses-pull-live LOCALE=$(LOCALE)
	@$(MAKE) --no-print-directory bosses-package-audio LOCALE=$(LOCALE)
	@./scripts/audio-github-release.sh --dry-run bosses $(BOSSES_LOCALE)
	@printf 'Release the bosses pack on GitHub? [y/N] '; \
	  read -r answer; [ "$$answer" = y ] || { echo aborted; exit 1; }
	@./scripts/audio-github-release.sh bosses $(BOSSES_LOCALE)

character-models: ## Print how to regenerate apps/web/src/lib/npc/character-models.json
	@sed -n '2,10p' scripts/character-models.mjs | sed -e 's/^\/\/ //' -e 's/^\/\/$$//'

# The sound packs' third channel. CurseForge takes them and Wago does not -- 280-452 MB a
# pack, and that upload endpoint answers 413 -- so a player who installed an addon from Wago
# gets its audio from a GitHub release instead.
#
# Not part of .github/workflows/release-addons.yaml, and it cannot be: that workflow builds
# its zips on the runner, and the audio is outside git. This uploads what the machine that
# generated it already has in dist/.

# LOCALE without SECTION would otherwise vanish into $(if $(SECTION),$(LOCALE)) below and
# silently release every English pack instead of the language asked for.
define require_section_for_locale
	@if [ -n "$(LOCALE)" ] && [ "$(LOCALE)" != "enUS" ] && [ -z "$(SECTION)" ]; then \
	  echo "error: LOCALE=$(LOCALE) needs SECTION= too -- without it this releases every English pack" >&2; \
	  exit 2; \
	fi
endef

audio-release-dry: ## Show which pack releases would be cut (SECTION=places LOCALE=esMX to narrow)
	$(require_section_for_locale)
	@./scripts/audio-github-release.sh --dry-run $(SECTION) $(if $(SECTION),$(LOCALE))

audio-release: ## Publish the built sound packs as GitHub releases (needs gh; SECTION=, LOCALE=)
	$(require_section_for_locale)
	@./scripts/audio-github-release.sh $(SECTION) $(if $(SECTION),$(LOCALE))

# The manager's channel (scripts/manager/): what dist/ holds, uploaded to R2 as changed files only.
# Build first with the <section>-package-audio targets. Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY, R2_BUCKET and SPOKEN_PACKS_SIGNING_KEY, in the repo-root .env.
# ONLY_PRESENT=1 publishes just the folders dist/ holds, for a build of one section and language;
# without it a missing folder stops the run, so a partial build cannot pass for a full one.
# ALLOW_REMOVALS=1 lets a pack lose more files than publish.mjs accepts unasked.
manager-publish-dry: ## Show what the manager channel would get from dist/ (ONLY_PRESENT=1: only what is built)
	@node scripts/manager/cli.mjs publish --dry-run $(if $(ONLY_PRESENT),--present) $(if $(ALLOW_REMOVALS),--allow-removals)

manager-publish: ## Publish dist/'s manager packs to the manager channel (ONLY_PRESENT=1: only what is built)
	@node scripts/manager/cli.mjs publish $(if $(ONLY_PRESENT),--present) $(if $(ALLOW_REMOVALS),--allow-removals)

manager-release: ## One section and language onto the manager channel, with no clips here (SECTION=, LOCALE=, DRY_RUN=1)
	@node scripts/manager/release.mjs $(SECTION) $(or $(LOCALE),enUS) $(if $(DRY_RUN),--dry-run) $(if $(ALLOW_REMOVALS),--allow-removals)

manager-gc-dry: ## Show what manager-gc would delete
	@node scripts/manager/cli.mjs gc --dry-run

manager-gc: ## Delete channel files no recent manifest needs
	@node scripts/manager/cli.mjs gc

package-all: ## Build every addon zip: Spoken with its modules, then quests and places on their own
	@./scripts/spoken/package.sh
	@$(MAKE) --no-print-directory -f make/quests.mk package
	@$(MAKE) --no-print-directory -f make/places.mk  package

# Spoken's download: Spoken and its four modules in one zip, each module built by its own
# packager. No sound packs; scripts/spoken/package.sh says why.
package-spoken: ## Zip Spoken with its modules, Quests, Places and Readables, without the sound packs
	@./scripts/spoken/package.sh

# Spoken's release: the zip package-spoken built, to both stores, with its changelog section
# as the notes. scripts/spoken/release.sh refuses a version whose notes are still under
# ## Unreleased.
release-spoken-dry: ## Check Spoken's release and show what uploading it would send
	@./scripts/spoken/release.sh --dry-run

release-spoken: ## Upload Spoken's zip to CurseForge and Wago (build it with package-spoken first)
	@./scripts/spoken/release.sh

# Spoken: English, CurseForge project `spoken-english`: a few kilobytes naming every Spoken addon
# and English sound pack as required dependencies, so the CurseForge app installs the lot.
# scripts/spoken/package-meta.sh explains it; the upload is release.sh's spoken-all target, and
# its notes come from docs/spoken/CHANGELOG-ALL.md. VERSION defaults to the script's own.
# LOCALE=deDE builds and uploads that language's meta addon, "Spoken: German", instead
# (publishers/spoken/all-<lang>.md).
package-spoken-all: ## Zip the English meta addon (LOCALE=xx: that language's) that pulls in every pack
	@VERSION=$(VERSION) LANG_CODE=$(or $(LOCALE),enUS) ./scripts/spoken/package-meta.sh

release-spoken-all-dry: ## Show what uploading the meta addon (LOCALE=xx: that language's) would send
	@./scripts/quests/release.sh --dry-run --store=curseforge --lang=$(or $(LOCALE),enUS) spoken-all

release-spoken-all: ## Upload the meta addon (LOCALE=xx: that language's) to CurseForge (never Wago)
	@./scripts/quests/release.sh --store=curseforge --lang=$(or $(LOCALE),enUS) spoken-all

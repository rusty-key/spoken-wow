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
        character-models dungeons bosses \
        audio-release audio-release-dry \
        manager-publish manager-publish-dry manager-gc manager-gc-dry

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
	@$(LUA) tests/lua/tracker_play_button_test.lua
	@$(LUA) tests/lua/quest_followup_test.lua
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
	@$(LUA) tests/lua/interface_numbers_test.lua
	@$(LUA) tests/lua/contribute_box_test.lua
	@$(LUA) tests/lua/quests_contribute_test.lua
	@$(LUA) tests/lua/npc_model_test.lua
	@$(LUA) tests/lua/player_frame_test.lua
	@$(LUA) tests/lua/snap_test.lua
	@$(LUA) tests/lua/player_dialogueui_style_test.lua
	@$(LUA) tests/lua/minimal_window_test.lua
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
	@$(LUA) tests/lua/npcs_bosses_test.lua
	@$(LUA) tests/lua/places_story_place_test.lua
	@$(LUA) tests/lua/places_area_zones_test.lua
	@$(LUA) tests/lua/places_forever_places_test.lua
	@$(LUA) tests/lua/minimap_compartment_test.lua
	@$(LUA) tests/lua/bronze_rings_test.lua

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
# tab (Spoken_NPCs/Data/Bosses.lua).
bosses: ## Rebuild addons/Spoken_NPCs/Data/Bosses.lua from the client's DungeonEncounter table
	@node pipelines/lib/bosses.mjs

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
manager-publish-dry: ## Show what the manager channel would get from dist/
	@node scripts/manager/cli.mjs publish --dry-run

manager-publish: ## Publish dist/'s manager packs to the manager channel
	@node scripts/manager/cli.mjs publish

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

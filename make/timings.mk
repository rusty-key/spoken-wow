# The word times: when each word of a voice recording starts, so the captions can light the word
# being said. Run after the voices are generated and installed, before the packs are packaged.
#
#     make timings-align     ->  make -f make/timings.mk align
#
# Its own file, as the other pipelines' are (AGENTS.md). The times are data: they are written
# under build/timings/ and go into the voice packs with `make timings-packs`, or into a package
# run with WORD_TIMES=build/timings/word-times.json. Nothing here writes into addons/.
#
#   make timings-manifest ADDONS=<the game's Interface/AddOns>   what to time (English clips and their text)
#   make timings-align                                           force-align each text over its recording (WhisperX)
#   make timings-export                                          build/timings/word-times.json from the results
#   make timings-packs ADDONS=...                                put the times into the installed voice packs
#   make timings-test

.DEFAULT_GOAL := help
.PHONY: help manifest align export packs test

PYTHON ?= python3
WORK   := build/timings
TOOLS  := pipelines/timings
ADDONS ?=

help: ## List the timings targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

manifest: ## The English clips to time, from the packs installed under ADDONS
	@[ -n "$(ADDONS)" ] || { echo "set ADDONS to the game's Interface/AddOns folder"; exit 1; }
	@mkdir -p $(WORK)
	@$(PYTHON) $(TOOLS)/manifest.py --addons "$(ADDONS)" --out $(WORK)/manifest.jsonl

align: ## Force-align every clip's text over its recording with WhisperX (ENGINE=whisper for faster-whisper)
	@mkdir -p $(WORK)
	@$(PYTHON) $(TOOLS)/align.py --manifest $(WORK)/manifest.jsonl --out $(WORK)/aligned.jsonl --engine $(or $(ENGINE),whisperx)

export: ## word-times.json from the aligned rows, leaving out recordings cut again since
	@$(PYTHON) $(TOOLS)/export.py --aligned $(WORK)/aligned.jsonl --manifest $(WORK)/manifest.jsonl --out $(WORK)/word-times.json

packs: ## Add the times to the installed voice packs under ADDONS
	@[ -n "$(ADDONS)" ] || { echo "set ADDONS to the game's Interface/AddOns folder"; exit 1; }
	@$(PYTHON) $(TOOLS)/pack_times.py --times $(WORK)/word-times.json \
	  $(wildcard $(ADDONS)/SpokenQuestsAudio*) $(ADDONS)/SpokenBooksAudio $(ADDONS)/SpokenZonesAudio

test: ## The timing tools' tests
	@$(PYTHON) -m pytest $(TOOLS)/tests -q

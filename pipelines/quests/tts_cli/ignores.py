"""Lines this project has decided never to voice, and the files that follow from them.

Some corpus lines are not worth audio and never will be. The war-effort tallies read
"$2113w" - a world-state counter the game expands against a live server and no committed
corpus can hold. Others are Blizzard's own debris: quest 1 is a test quest, and lines turn
up that no player can reach. Neither is a text defect an override can fix, so neither
belongs in the queue, the store, or the module.

The decision is made in the web app and lives in Postgres, which is where a collaborator
can make it with a reason attached. `make quests-export-ignores` exports it to
corpus/ignored.json, committed beside the corpus, and this module is how the pack build
reads that export. The file is a snapshot: the database stays the authority, and a checkout with
no export simply ignores nothing.

A LINE IS IGNORED, A FILE IS ONLY DERIVED. 1,076 mp3s are shared by several NPCs, so a file
may be addressed by a dead line and a live one at once. ignored_files refuses to name such a
file: leaving it out of a pack would strand the line that still needs it.
"""
import json
import os

from tts_cli.naming import moment_of, split_voice, subfolder_from_line_id

DEFAULT_IGNORED_PATH = "corpus/ignored.json"


def load_ignored(path: str = DEFAULT_IGNORED_PATH) -> dict:
    """The export as {lineId: reason}, or {} where there is no export to read."""
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        document = json.load(f)
    return {entry["lineId"]: entry["reason"] for entry in document.get("ignored", [])}


def ignored_line_ids(path: str = DEFAULT_IGNORED_PATH) -> set:
    """Just the ids, for the callers that only ask 'is this one of them?'."""
    return set(load_ignored(path))


def ignored_files(corpus: dict, ignored: dict) -> list:
    """Addon-relative paths whose every corpus line is ignored, sorted, so two runs differ
    only where the decisions do.
    """
    owners, moment_owners = {}, {}
    for line in corpus["lines"]:
        folder = subfolder_from_line_id(line["lineId"])
        # A line in another voice is ignored with the line it is a voice of.
        base = split_voice(line["lineId"])[0]
        owners.setdefault(f'{folder}/{line["fileName"]}.mp3', []).append(base)
        # A language's own text may make the moment one file where English has two, or two
        # where it has one, so each form of the moment's file goes once all of its lines do.
        plain = line["fileName"][2:] if moment_of(base) != base else line["fileName"]
        for form in (plain, f"m-{plain}", f"f-{plain}"):
            moment_owners.setdefault(f"{folder}/{form}.mp3", []).append(base)

    return sorted({rel for named in (owners, moment_owners) for rel, line_ids in named.items()
                   if all(line_id in ignored for line_id in line_ids)})

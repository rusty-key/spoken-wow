"""NPC barks: the game's greeting, farewell and pissed clips per NPC type, and our text for them.

Inputs are voice/npc-sounds.json (make npc-sounds: every NPCSounds row's clips by kind, and the
type that reads the row) and a transcript of the clips by file id, made locally from the game's
audio, which never enters the repo or the database. corpus_db.import_barks writes the result.
"""
from __future__ import annotations

from typing import Callable

KINDS = ("greeting", "farewell", "pissed")


def parse_type(name: str) -> tuple[str, str, str | None]:
    """'orc-female-standard' -> ('orc', 'female', 'standard'); 'bloodelf-female' has no flavor."""
    race, gender, *flavor = name.split("-", 2)
    return race, gender, flavor[0] if flavor else None


def _files(row: dict) -> set:
    return {file for kind in KINDS for file in row[kind]}


def set_rows(sets: dict) -> list[dict]:
    """npc_bark_set rows. A set with no type whose files all belong to one typed set takes that
    set's type: muting the typed set mutes those files too, and its NPCs would go silent."""
    typed = {set_id: row for set_id, row in sets.items() if row["voice"]}
    rows = []
    for set_id, row in sets.items():
        voice = row["voice"]
        if not voice:
            files = _files(row)
            owners = {typed[other]["voice"] for other in typed if files <= _files(typed[other])}
            voice = owners.pop() if len(owners) == 1 else None
        race, gender, flavor = parse_type(voice) if voice else (None, None, None)
        rows.append({"setId": int(set_id), "race": race, "gender": gender, "flavor": flavor,
                     **{kind: sorted(row[kind]) for kind in KINDS}})
    return sorted(rows, key=lambda row: row["setId"])


def bark_rows(sets: list[dict], transcripts: dict,
              voiced: Callable[[str, str, str | None], bool]) -> list[dict]:
    """One bark per game file per type, for every typed set whose type a voice reads and every
    file with a transcript. A file two sets of a type share is one bark, of its first kind."""
    barks = {}
    for row in sets:
        type_ = (row["race"], row["gender"], row["flavor"])
        if not row["race"] or not voiced(*type_):
            continue
        for kind in KINDS:
            for game_file in row[kind]:
                text = transcripts.get(str(game_file))
                key = (game_file, *type_)
                if text is None:
                    continue
                if key in barks and barks[key]["kind"] != kind:
                    print(f"  {game_file} is a {barks[key]['kind']} and a {kind} of "
                          f"{'-'.join(filter(None, type_))}; kept as {barks[key]['kind']}")
                barks.setdefault(key, {"gameFile": game_file, "race": type_[0],
                                       "gender": type_[1], "flavor": type_[2], "kind": kind,
                                       "text": text})
    return list(barks.values())


def decide_bark(current: dict | None, text: str) -> str:
    """'insert' a new bark, 'skip' it, or record a new 'version'. An edited bark is never replaced:
    an import that could overwrite a correction is one nobody dares run."""
    if current is None:
        return "insert"
    if current["origin"] == "edited" or current["originalText"] == text:
        return "skip"
    return "version"

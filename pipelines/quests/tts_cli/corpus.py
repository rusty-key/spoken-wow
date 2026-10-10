"""The corpus: every voiceline this project knows how to produce, frozen as data.

This is the one artifact that requires the world database, and it is committed so nobody
else needs it. Everything downstream - synthesizing audio, building the data module,
browsing in the web app - reads the corpus and never touches MySQL.

Deliberately absent: anything about which audio files exist. Audio presence is a property
of the audio store, computed where it is needed. Keeping it out means the committed corpus
only changes when the game's text changes.

Extraction is generous on purpose. Standing the database back up to recover a column we
skipped is the expensive mistake, so spawn positions are captured even though nothing
reads them yet - they are what keeps zone-based selection possible after the old
matplotlib zone picker is deleted.
"""
import gzip
import json
import os
from datetime import datetime, timezone

from tts_cli.flavors import is_model_voice
from tts_cli.naming import filename_for_row, line_id_for_row

#: 3: a row a player contributed carries its "contributionId". The extract has none to mark,
#: but the number says the file's unmarked rows are all the dump's -- which is what lets
#: corpus_db's import let them overtake a contribution (see CONTRIBUTIONS_MARKED there).
#: 4: "npcs", each NPC once with its own race, gender and flavor and whose answer that is
#: (`provenance`), which every line the NPC speaks is voiced in (the npc table, migration 0070).
#: The extract's are `corpus`; an export carries every answer the site has.
SCHEMA_VERSION = 4
DEFAULT_CORPUS_PATH = "corpus/corpus.json.gz"
INVALID_CHARS = "$<>"
#: The skipReason of a line whose voice is a model slot nobody has chosen a voice for yet.
NO_VOICE = "no-voice"


def spawn_key(entity_type: str, entity_id) -> str:
    """Key for the spawns table.

    Namespaced by type because creature and gameobject IDs are separate spaces that
    overlap: creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster.
    Keying on the bare ID makes a gameobject inherit a creature's spawn points.
    """
    return f"{entity_type}:{int(entity_id)}"


def _skip_reason(row):
    """Why the generator would not synthesize this row, or None.

    Mirrors TTSProcessor.process_row (tts_cli/tts_utils.py:175-187): progress text is
    deliberately never voiced, and unresolved template tokens would be read aloud.

    A line in a model voice (flavors.model_voice) has nobody to speak it yet: which voice a
    model gets is still to be chosen, so the line is gathered - it has a line id, a file name
    and a place in the explorer - but not generated. Ahead of invalid-chars because it is the
    reason no rewrite of the text can lift; the site asks the voice, not this, for the same
    answer (apps/web/src/lib/text-gate.ts).
    """
    if row["source"] == "progress":
        return "progress"
    if is_model_voice(row.get("voice_name")):
        return NO_VOICE
    if any(c in row["cleanedText"] for c in INVALID_CHARS):
        return "invalid-chars"
    return None


def build_corpus(df, spawn_rows) -> dict:
    """Turn the preprocessed dataframe and raw spawn rows into the corpus document."""
    lines = []
    for row in df.to_dict("records"):
        reason = _skip_reason(row)
        lines.append({
            "lineId": line_id_for_row(row),
            "source": row["source"],
            "questId": int(row["quest"]) if row["quest"] else None,
            "questTitle": row["quest_title"] or None,
            "npcId": int(row["id"]),
            "npcName": row["name"],
            "npcType": row["type"],
            "race": row["race"],
            "gender": row["gender"],
            "flavor": row["flavor"],
            "voice": row["voice_name"],
            "playerGender": row["player_gender"],
            "text": row["cleanedText"],
            "originalText": row["original_text"],
            "fileName": filename_for_row(row),
            "generatable": reason is None,
            "skipReason": reason,
        })

    voiced = {spawn_key(line["npcType"], line["npcId"]) for line in lines}
    spawns = {}
    for entity_type, entity_id, map_id, x, y in spawn_rows:
        key = spawn_key(entity_type, entity_id)
        if key not in voiced:
            continue
        spawns.setdefault(key, []).append(
            {"map": int(map_id), "x": round(float(x), 1), "y": round(float(y), 1)})

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lineCount": len(lines),
        "lines": lines,
        "spawns": spawns,
        "npcs": npcs_of(df),
    }


#: Kinds that are what they are, whoever reads them: a billboard is a gameobject the narrator
#: reads, not a narrator (apps/web migration 0071).
GENERIC_TYPES = ("gameobject", "item")


def npcs_of(df) -> list:
    """Each NPC once: its type (its display's race, or its kind for a gameobject or an item)
    and gender, its own flavor or None where the game names none, and the voice its lines
    were made in. In kind-then-id order, which the export reproduces."""
    npcs = {}
    for row in df.to_dict("records"):
        key = (row["type"], int(row["id"]))
        generic = row["type"] in GENERIC_TYPES
        npcs.setdefault(key, {
            "npcType": row["type"],
            "npcId": int(row["id"]),
            "race": row["type"] if generic else row["race"],
            "gender": None if generic else row["gender"],
            "flavor": row["npc_flavor"],
            "provenance": "corpus",
            "voice": row["voice_name"],
        })
    return [npcs[key] for key in sorted(npcs)]


def write_corpus(path: str, corpus: dict) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    # mtime=0 so re-running extraction on unchanged data produces an identical file
    # rather than a spurious diff.
    with gzip.GzipFile(path, "wb", mtime=0) as raw:
        raw.write(json.dumps(corpus, ensure_ascii=False, indent=1).encode("utf-8"))


def load_corpus(path: str = DEFAULT_CORPUS_PATH) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def lines_in_area(corpus: dict, map_id: int, x_range, y_range) -> list:
    """Lines belonging to NPCs spawned inside a world-coordinate box.

    Replaces the old matplotlib zone picker: same selection, but over committed data
    instead of a GUI and a live database. An NPC matches if any of its spawns is inside.
    """
    x_min, x_max = min(x_range), max(x_range)
    y_min, y_max = min(y_range), max(y_range)

    inside = {
        key
        for key, points in corpus["spawns"].items()
        if any(p["map"] == map_id
               and x_min <= p["x"] <= x_max
               and y_min <= p["y"] <= y_max
               for p in points)
    }
    return [line for line in corpus["lines"]
            if spawn_key(line["npcType"], line["npcId"]) in inside]


def extract(path: str = DEFAULT_CORPUS_PATH) -> dict:
    """Query the world database and write the corpus. The only step that needs MySQL."""
    import pandas as pd

    from tts_cli.sql_queries import (query_dataframe_for_all_quests_and_gossip,
                                     query_followup_dataframe, query_spawns)
    from tts_cli.tts_utils import TTSProcessor

    # Follow-up lines after everything else, so adding them left every existing row where it
    # was: import-corpus records each row's place as its `ord`, and the export reproduces it.
    df = pd.concat([query_dataframe_for_all_quests_and_gossip(0), query_followup_dataframe()],
                   ignore_index=True)
    # preprocess_dataframe only uses self for handle_gender_options, so skip __init__ and
    # avoid requiring an ElevenLabs key just to extract text.
    df = TTSProcessor.preprocess_dataframe(TTSProcessor.__new__(TTSProcessor), df)

    corpus = build_corpus(df, query_spawns())
    write_corpus(path, corpus)
    return corpus

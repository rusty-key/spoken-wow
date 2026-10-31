"""Which file each NPC speaks a line in, for a pack.

A corpus row is a line and one NPC speaking it, written with the voice its file was made in.
The NPC's own voice is the one its answer in the corpus's `npcs` is read with: the site's npc
table and voice_for (apps/web migration 0071). Where the two
differ, the NPC speaks the line in a file of its own voice (naming.variant_file_name), which
the site generates; until that file has audio in the store being built, the NPC keeps the
line's own file, so nobody falls silent while a voice waits to be made.

The site reads lines the same way (apps/web/src/lib/quests/catalogue.ts): a speaker whose NPC
no voice reads keeps the file its row was written with.

An NPC split by body (the corpus's `npcBodies`, migration 0075) speaks each line once per body,
in that body's voice, as a row carrying `npcBody` and `npcSex`; `sexBody` marks the body its sex
falls back to (npc_bodies.sex_bodies), which the per-sex tables are built from.
"""
import os

from tts_cli.naming import (BROADCAST_SOURCES, moment_of, subfolder_from_line_id, variant_file_name,
                            variant_line_id)
from tts_cli.npc_bodies import body_name, sex_bodies

#: The lines an NPC speaks in its own voice: all of them but progress text, which is never
#: voiced. A quest moment's giver is found through QuestFileLookupBy*; a greeting's speaker and
#: a follow-up's are looked up per NPC already, so their tables simply name its own file.
OWN_VOICE_SOURCES = frozenset({"accept", "complete", "gossip"}) | BROADCAST_SOURCES


def npc_voices(corpus: dict) -> dict:
    """(npcType, npcId) -> the voice the NPC's answer names, for every NPC with one."""
    voices = {}
    for npc in corpus.get("npcs", []):
        if npc.get("provenance") == "none" or not npc.get("voice"):
            continue
        voices[(npc["npcType"], npc["npcId"])] = npc["voice"]
    return voices


def body_voices(corpus: dict) -> dict:
    """(npcType, npcId) -> [(body, sex, voice, sex_body)] for every split NPC, in export order:
    each body, the voice its answer names, and whether it is the body its sex falls back to."""
    npc_race = {(npc["npcType"], npc["npcId"]): npc.get("race") for npc in corpus.get("npcs", [])}
    grouped = {}
    for row in corpus.get("npcBodies", []):
        grouped.setdefault((row["npcType"], row["npcId"]), []).append(row)
    voices = {}
    for key, bodies in grouped.items():
        chosen = sex_bodies(bodies, npc_race.get(key))
        voices[key] = [(body_name(row["race"], row["gender"]), row["sex"], row.get("voice"),
                        row is chosen.get(row["sex"])) for row in bodies]
    return voices


def stored_stems(store_files) -> set:
    """Store-relative stems ('quests/5-accept') of every audio file a store holds."""
    return {os.path.splitext(rel)[0] for rel in store_files}


def with_voice_files(corpus: dict, stems: set) -> dict:
    """The corpus with each row of OWN_VOICE_SOURCES moved to its NPC's own voice's file, where that
    file has audio among `stems`. The rest are as they were."""
    voices = npc_voices(corpus)
    bodies = body_voices(corpus)
    body_voice = {(*key, body): voice for key, rows in bodies.items() for body, _, voice, _ in rows}
    # A line's file was made in its first speaker's voice, as the site reads it (catalogue.ts
    # voiced): a later speaker written with another voice still speaks that file's.
    written = {}
    for line in corpus["lines"]:
        written.setdefault(line["lineId"], line["voice"])

    def moved(line):
        voice = (body_voice.get((line["npcType"], line["npcId"], line.get("npcBody")))
                 or voices.get((line["npcType"], line["npcId"])))
        if line["source"] not in OWN_VOICE_SOURCES or not voice or voice == written[line["lineId"]]:
            return None
        file_name = variant_file_name(line["fileName"], voice)
        return {**line, "lineId": variant_line_id(line["lineId"], voice), "fileName": file_name,
                "voice": voice}

    # A line's player-gender versions move together, once each has its file: their tables hold
    # one name for both, and the addon adds the player's m-/f- to it, so moving one alone would
    # send the other player to a file that does not exist.
    def together(line):
        return (line["npcType"], line["npcId"], line.get("npcBody"), moment_of(line["lineId"]))

    # Every player reaches a file the addon can find: their m-/f- one, else the plain one. A
    # language pack's store holds its own text's forms, which need not be English's.
    def reachable(line, file_name):
        folder = subfolder_from_line_id(line["lineId"])
        if moment_of(line["lineId"]) != line["lineId"]:
            return f"{folder}/{file_name}" in stems or f"{folder}/{file_name[2:]}" in stems
        return f"{folder}/{file_name}" in stems or all(
            f"{folder}/{g}-{file_name}" in stems for g in ("m", "f"))

    # A split NPC's row is a row per body. Progress text is never voiced, so it stays one.
    def split(line):
        if line["source"] not in OWN_VOICE_SOURCES:
            return [line]
        return [{**line, "npcBody": body, "npcSex": sex, "sexBody": fallback}
                for body, sex, _, fallback in bodies.get((line["npcType"], line["npcId"]), ())] or [line]

    rows = [row for line in corpus["lines"] for row in split(line)]
    ready = {}
    for line in rows:
        candidate = moved(line)
        stored = candidate is not None and reachable(line, candidate["fileName"])
        ready[together(line)] = ready.get(together(line), True) and stored
    lines = [moved(line) if ready[together(line)] else line for line in rows]
    return {**corpus, "lines": lines}

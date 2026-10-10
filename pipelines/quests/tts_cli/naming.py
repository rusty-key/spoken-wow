"""Single source of truth for voiceline file naming and identity.

Filenames are load-bearing: the addon resolves a sound by looking its filename up in
SoundLengthLookupByFileName, so a name that differs by one character silently plays
nothing. Every filename in this project is derived here and nowhere else.

    quest lines     {questID}-{accept|complete}      optional m-/f- prefix
    gossip lines    md5(original_text+race+gender)   optional m-/f- prefix
                    b{broadcastTextID}-{voice}
                    {lang}-md5(locale_text+race+gender)
    follow-up lines {broadcastTextID}-{voice}        optional m-/f- prefix

lineId is a stable handle used by the corpus, the audio store and the web app. It is
deliberately not the filename, so references survive a naming change.

    q:{questID}:{source}[:{m|f}]
    g:{hash}[:{m|f}]
    g:b{broadcastTextID}-{voice}[:{m|f}]
    g:{lang}-{hash}[:{m|f}]
    f:{broadcastTextID}:{voice}[:{m|f}]

A gossip line's stem is whatever follows `g:`, in all three forms. The hash form is every
line that exists today. The other two are only minted for lines that have no English text to
hash: one whose BroadcastText id is known when it is created, named after the id and the
whole voice like a follow-up, and failing that one named after its own language's text. A
line keeps the form it was minted with; when it later turns out to be the same moment as
another, the two are linked (GossipAliases), never renamed. The dashes keep both new forms
from ever equalling a 32-hex hash.

Any of them in one more voice than the one its file was made in:

    {lineId}~{voice}                 file {fileName}-{voice}

An NPC speaks a line in its own voice. Where NPCs of different voices share a line, the file
already made keeps the voice it was made in, and each other voice is a file of its own: the
same words, named after the voice, as a follow-up line has always been. `~` sits outside every
other id's alphabet, so the plain id and the player-gender suffix read the same as ever.

A follow-up line - what an NPC says in chat after a quest is accepted or turned in, see
tts_cli/followup.py - is named after its words and the voice saying them, not after the quest
and not after md5(text + race + gender) the way gossip is. The words already have an id,
broadcast_text's, which the addon is handed by its own export; and the voice is the whole
voice, flavor included, because the rule for sharing a recording is that the same words share
a clip only among NPCs that sound alike. A quest file or a gossip hash is shared across
flavors and forces them to agree on one (tts_utils.resolve_flavors); this one never needs to.
"""

FOLLOWUP = "followup"


def followup_stem(broadcast_text_id, voice: str) -> str:
    """The follow-up filename before any player-gender prefix, e.g. '4377-dwarf-male-standard'.

    int() because the id reaches here from a DataFrame column that holds NaN for every
    non-follow-up row, which makes pandas carry it as a float.
    """
    return f"{int(broadcast_text_id)}-{voice}"


def broadcast_gossip_stem(broadcast_text_id, voice: str) -> str:
    """A gossip line minted from its BroadcastText id, e.g. 'b6029-orc-female-standard'."""
    return f"b{int(broadcast_text_id)}-{voice}"


def localized_gossip_stem(lang: str, text_hash: str) -> str:
    """A gossip line minted in a language with neither English nor an id, e.g. 'deDE-<md5>'.

    `text_hash` is md5(locale text + race + gender), get_hash's shape for English.
    """
    return f"{lang}-{text_hash}"


def gossip_stem_rank(stem: str) -> int:
    """0 for a broadcast stem, 1 for an English hash, 2 for a localized one.

    The order in which one moment's stems are preferred: the id is the most stable name, and
    English is the corpus every pack has always been built from.
    """
    if stem.startswith("b") and "-" in stem:
        return 0
    if "-" in stem:
        return 2
    return 1


def filename_for_row(row) -> str:
    """Filename (without extension) the generator would produce for a dataframe row."""
    # Follow-up first: its row carries a quest, and would otherwise be named after it.
    if row["source"] == FOLLOWUP:
        base = followup_stem(row["broadcast_text_id"], row["voice_name"])
    elif row["quest"]:
        base = f'{row["quest"]}-{row["source"]}'
    else:
        base = row["templateText_race_gender_hash"]
    if row["player_gender"]:
        base = f'{row["player_gender"]}-{base}'
    return base


def line_id_for_row(row) -> str:
    """Stable identity for a dataframe row."""
    if row["source"] == FOLLOWUP:
        parts = ["f", str(int(row["broadcast_text_id"])), row["voice_name"]]
    elif row["quest"]:
        parts = ["q", str(row["quest"]), row["source"]]
    else:
        parts = ["g", row["templateText_race_gender_hash"]]
    if row["player_gender"]:
        parts.append(row["player_gender"])
    return ":".join(parts)


VOICE_SEPARATOR = "~"


def moment_of(line_id: str) -> str:
    """A line id without its :m/:f player-gender suffix: what its forms share in every language."""
    return line_id[:-2] if line_id[-2:] in (":m", ":f") else line_id


def variant_line_id(line_id: str, voice: str) -> str:
    """A line in one more voice than its file was made in."""
    return f"{line_id}{VOICE_SEPARATOR}{voice}"


def variant_file_name(file_name: str, voice: str) -> str:
    """Its file: the line's own name, player-gender prefix and all, then the voice."""
    return f"{file_name}-{voice}"


def split_voice(line_id: str) -> tuple:
    """(the line id it is a voice of, the voice), or (line_id, None) for a plain one."""
    base, separator, voice = line_id.partition(VOICE_SEPARATOR)
    return (base, voice) if separator else (line_id, None)


def filename_from_line_id(line_id: str) -> str:
    """Inverse of line_id_for_row, as far as the filename is concerned."""
    line_id, voice = split_voice(line_id)
    if voice:
        return variant_file_name(filename_from_line_id(line_id), voice)
    kind, *rest = line_id.split(":")
    if kind == "q":
        quest, source, *gender = rest
        base = f"{quest}-{source}"
    elif kind == "g":
        hash_, *gender = rest
        base = hash_
    elif kind == "f":
        broadcast, voice, *gender = rest
        base = followup_stem(broadcast, voice)
    else:
        raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")
    if gender:
        base = f"{gender[0]}-{base}"
    return base


def gossip_hash_from_line_id(line_id: str) -> str:
    """The bare text hash for a gossip line, without any m-/f- prefix.

    Gossip lookup tables store the unprefixed hash: the addon adds the player's gender
    prefix at resolve time (DataModules:AddPlayerGenderToFilename) and falls back to the
    bare name, so storing a prefixed hash would make the line unreachable for the other
    gender.
    """
    line_id, voice = split_voice(line_id)
    kind, *rest = line_id.split(":")
    if kind != "g":
        raise ValueError(f"{line_id!r} is not a gossip line")
    return variant_file_name(rest[0], voice) if voice else rest[0]


def followup_stem_from_line_id(line_id: str) -> str:
    """A follow-up line's filename without any m-/f- prefix, for FollowupLookup.

    Unprefixed for gossip_hash_from_line_id's reason: the addon adds the player's gender
    prefix when it resolves the file, and falls back to the bare name.
    """
    line_id, voice = split_voice(line_id)
    kind, *rest = line_id.split(":")
    if kind != "f":
        raise ValueError(f"{line_id!r} is not a follow-up line")
    stem = followup_stem(rest[0], rest[1])
    return variant_file_name(stem, voice) if voice else stem


def subfolder_from_line_id(line_id: str) -> str:
    """Which sounds/ subdirectory a line lives in."""
    kind = line_id.split(":", 1)[0]
    if kind == "q":
        return "quests"
    if kind == "g":
        return "gossip"
    if kind == "f":
        return FOLLOWUP
    raise ValueError(f"unknown lineId kind {kind!r} in {line_id!r}")

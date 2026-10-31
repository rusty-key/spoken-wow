"""Build the addon data module from the corpus and the audio store.

This is what makes the sound pack an artifact of this project rather than something we
patch. Because the module is built rather than edited, it comes out self-consistent and
in the current format by construction - which is what dissolved the constraints that
came from treating a pre-built pack as immutable input.

Needs no database: the corpus carries every field the lookup tables key on.
"""
import json
import os
import re
import shutil

from slpp import slpp as lua
from tqdm import tqdm

from tts_cli.ignores import ignored_files, wordless
from tts_cli.length_table import write_sound_length_table_lua
from tts_cli.naming import (BROADCAST_SOURCES, followup_stem_from_line_id, gossip_hash_from_line_id,
                            moment_of, quest_moment_stem, quest_stem_from_line_id,
                            several_wordings, split_voice, subfolder_from_line_id,
                            variant_file_name)
from tts_cli.npc_bodies import GENDER_SEX, body_name
from tts_cli.store import SUBFOLDERS, audio_extension, stored_files, word_times
from tts_cli.utils import (get_first_n_words, get_last_n_words,
                           replace_dollar_bs_with_space)

DEFAULT_MODULE_NAME = "VoiceOverReduxAudio"
DEFAULT_DIST_DIR = "dist"
DEFAULT_ADDONS_DIR = ("/Applications/World of Warcraft/_classic_era_"
                      "/Interface/AddOns")
GUARD = "if not VoiceOver or not VoiceOver.DataModules then return end"

#: Group is what actually nests this under Spoken in the AddOns list - added in 11.1.0,
#: and its value is the main addon's *name*, so it is the folder name and not the title.
#: X-Part-Of and X-Child-Of are custom X- fields the client does not read at all; they are
#: kept because addon managers do, and because upstream shipped them. Three keys that look
#: interchangeable, one of which does the work.

#: The site's model-to-race map (apps/web/src/lib/npc/models.ts), shipped so the addon can name
#: the body a creature is drawn as from its model file id.
CHARACTER_MODELS = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "web", "src",
                                "lib", "npc", "character-models.json")

#: How many leading and trailing words the addon fuzzy-matches quest text on. Must stay
#: in step with DataModules:GetQuestID in AI_VoiceOver/DataModules.lua.
QUEST_SEARCH_WORDS = 15

# The follow-up branch tests for the enum first because a pack outlives the player it was
# built beside, in both directions: on a player from before follow-up lines QuestFollowup is
# nil, and without the guard a nil event - a caller's bug - would resolve to a follow-up path
# there instead of to nothing.
MODULE_LUA = """if not VoiceOver or not VoiceOver.DataModules then return end

{module} = {{}}

function {module}:GetSoundPath(fileName, event)
    setfenv(1, VoiceOver)
    if Enums.SoundEvent:IsQuestEvent(event) then
        return format([[generated\\sounds\\quests\\%s{extension}]], fileName)
    elseif Enums.SoundEvent:IsGossipEvent(event) then
        return format([[generated\\sounds\\gossip\\%s{extension}]], fileName)
    elseif Enums.SoundEvent.QuestFollowup and event == Enums.SoundEvent.QuestFollowup then
        return format([[generated\\sounds\\followup\\%s{extension}]], fileName)
    end
end

VoiceOver.DataModules:Register("{module}", {module})
"""

# No RequiredDeps on purpose: a player of this lineage ships under three folder names by
# now - AI_VoiceOver, AI_VoiceOver_Continued, VoiceOverRedux - and a dep on a disabled or
# absent one makes LoadAddOn fail with DEP_DISABLED. LoadOnDemand plus the guard in
# Module.lua suffice, and the player finds a pack by its DataModule-Version key rather than
# by name (DataModules:EnumerateAddons), so a renamed pack needs nothing else.
#
# Both generations of that key are written, with identical values. X-SpokenQuests-* is what
# the addon reads first; X-VoiceOver-* is what its previous releases and upstream
# AI_VoiceOver read, so one built pack serves every one of them. Drop the inherited pair
# only once no supported release still looks for it.
#
# The Interface line names every client the packs ship for - Era, Anniversary, Forever - as
# the places and readables packs do. DataModules turns checkAddonVersion off around LoadAddOn, which
# loads a pack a client calls out of date, but Forever build 70170 calls an Interface it does
# not list incompatible instead, and nothing turns that off: the pack has to name the client.
DEFAULT_TITLE = "Spoken Audio: Quests"

#: "Spoken" in the brand colour, as every Spoken addon is titled in the AddOns list. Only the
#: TOC wears it: the same title names the CurseForge project, where the code would show.
BRAND = "|cffb48cffSpoken|r"


def toc_title(title: str) -> str:
    return BRAND + title[len("Spoken"):] if title.startswith("Spoken") else title

#: The TOC key naming the language a pack was recorded in. Must match what the addon's
#: DataModules.lua reads.
LANGUAGE_KEY = "X-SpokenQuests-Language"

#: The artwork the client shows beside the addon's name in the AddOns list. Committed as a TGA
#: rather than converted at build time, so building needs no ffmpeg; tools/make_icon.py is what
#: made it, and its header explains the format.
ICON_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "assets", "icon")
ICON_NAME = "icon.tga"


def icon_source(language: str = None) -> str:
    """English's mark, or the language's: the same mark with its badge, so a language's packs
    are told apart from English's in the AddOns list. A language without one is an error
    rather than English's mark, which would ship a pack that looks like the wrong language."""
    if not language or language == "enUS":
        return os.path.join(ICON_DIR, "spoken-quests.tga")
    path = os.path.join(ICON_DIR, f"spoken-quests-{language}.tga")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"no icon for {language}: {path} (make quests-icon)")
    return path

TOC_HEADER = """## Interface: 11509, 20506, 16001
## Title: {title}
## Notes: Narrated quests and gossip from the Vanilla era, for Spoken Quests.|n|nIt's OK for this addon to appear "disabled" or "out of date", it's compatible with any client and Spoken Quests will load it even if it's disabled or out of date.
## Version: {version}
## IconTexture: Interface\\AddOns\\{module}\\{icon}
## LoadOnDemand: 1
## Group: Spoken
## X-Part-Of: Spoken
## X-Child-Of: Spoken_Quests
## X-SpokenQuests-DataModule-Version: 1
## X-SpokenQuests-DataModule-Priority: 100
## X-VoiceOver-DataModule-Version: 1
## X-VoiceOver-DataModule-Priority: 100

Module.lua
"""


def escape_lua_string(text: str) -> str:
    """Match how the addon escapes keys before looking them up.

    Double quotes become single, and carriage returns and newlines become spaces, so a
    key written here compares equal to what the addon builds at runtime.
    """
    return text.replace('"', "'").replace("\r", " ").replace("\n", " ")


def quest_search_text(text: str) -> str:
    """The fuzzy-match key for quest text: leading words plus trailing words."""
    joined = (f"{get_first_n_words(text, QUEST_SEARCH_WORDS)} "
              f"{get_last_n_words(text, QUEST_SEARCH_WORDS)}")
    return replace_dollar_bs_with_space(escape_lua_string(joined))


def prune_quest_id_table(quest_id_table: dict) -> dict:
    """Collapse unambiguous branches to a bare quest id.

    The addon walks title -> NPC name -> fuzzy text, returning early whenever it finds a
    number, so any level with a single possible answer can be flattened.
    """
    def is_single(node):
        if not isinstance(node, dict):
            return True
        return len(node) == 1 and is_single(next(iter(node.values())))

    def only_value(node):
        return only_value(next(iter(node.values()))) if isinstance(node, dict) else node

    pruned = {}
    for source, titles in quest_id_table.items():
        pruned[source] = {}
        for title, npcs in titles.items():
            if is_single(npcs):
                pruned[source][title] = only_value(npcs)
                continue
            pruned[source][title] = {}
            for npc, texts in npcs.items():
                pruned[source][title][npc] = only_value(texts) if is_single(texts) else texts
    return pruned


def body_by_model() -> dict:
    with open(CHARACTER_MODELS, encoding="utf-8") as f:
        return {int(file_id): body_name(row["race"], row["gender"]) for file_id, row in json.load(f).items()}


#: A title the capture kept after the name ("Ishlee Breezewhisper <Skinner>"). The game names
#: the unit without it, so a key carrying it is never matched and a quest log shows it.
_SUBNAME = re.compile(r"\s*<[^<>]*>\s*$")
#: What a capture wrote when it had no name to give: "null", "npc 263664", or the model's
#: file name ("Doodad_BeerKeg101").
_PLACEHOLDER = re.compile(r"(?i)null|npc \d+|\w+_\w+")


def speaker_name(name: str) -> str:
    """The name the game shows for the unit: the corpus's, less any <subname>."""
    return _SUBNAME.sub("", name or "") or name


def name_rank(line: dict) -> int:
    """How far the names table trusts a line's speaker name: an extracted one over a
    contributed one, which is the contributor's client's language and has put a Russian or
    German name in the English quest log; a placeholder not at all."""
    name = speaker_name(line["npcName"])
    if not name or _PLACEHOLDER.fullmatch(name):
        return 0
    return 1 if line.get("contributionId") is not None else 2


def build_tables(corpus: dict, ignored=()) -> dict:
    """Every lookup table, as {output filename: (lua table name, data)}.

    Ignored lines are left out entirely, the way progress text is below: an entry pointing
    at a sound that will never be produced resolves to silence, and the addon has no way to
    tell that apart from a broken lookup.
    """
    gossip_by_id = {"creature": {}, "gameobject": {}}
    gossip_by_name = {"creature": {}, "gameobject": {}}
    questlog = {"creature": {}, "gameobject": {}, "item": {}}
    names = {"creature": {}, "gameobject": {}, "item": {}}
    quest_ids = {}
    followup = {}
    # A quest moment's file in the voice an NPC speaks it in, where that is not the moment's
    # own (tts_cli/voice_files.py): keyed by the moment's file and the giver, since the addon
    # names a quest's file from its id and event and knows who is giving it.
    quest_files = {"creature": {}, "gameobject": {}}
    # A quest moment the game shows in several wordings: each wording's text and its file, by
    # the moment's stem. The addon matches the text on screen against it as it does gossip.
    wordings = {}
    # A split NPC's file per body, keyed by the line's own stem: the addon finds the line as
    # before, then asks the body. Each sex keeps a file too, its fallback body's
    # (npc_bodies.sex_bodies), for addons that read only the sex.
    gossip_by_body = {}
    quest_files_by_body = {}
    followup_by_body = {}
    gossip_by_sex = {}
    quest_files_by_sex = {}
    followup_by_sex = {}
    # The bodies each creature that greets is voiced as, so the addon can tell a body on screen
    # its voice is not, and offer its line for contribution; and the sex of each unsplit one,
    # which addons before the bodies read instead.
    split = {(row["npcType"], row["npcId"]) for row in corpus.get("npcBodies", [])}
    unsplit = {npc["npcId"]: npc for npc in corpus.get("npcs", [])
               if npc["npcType"] == "creature" and npc.get("gender") in GENDER_SEX
               and ("creature", npc["npcId"]) not in split}
    sex_of = {}
    bodies_of = {}
    # Within a rank the last line's name stands, as it always has: the extract gives a few
    # NPCs two English names, and another order would flip them.
    ranks = {}

    for line in corpus["lines"]:
        base_id, voice = split_voice(line["lineId"])
        if base_id in ignored:
            continue

        kind = line["npcType"]
        rank = name_rank(line)
        if rank and rank >= ranks.get((kind, line["npcId"]), 0):
            ranks[(kind, line["npcId"])] = rank
            names.setdefault(kind, {})[line["npcId"]] = speaker_name(line["npcName"])

        # Before the quest tables, which it must stay out of: a follow-up line carries its
        # quest, but it is said in chat rather than in the quest dialog, so matching its text
        # there would answer the wrong question. The addon knows the speaker and the
        # broadcast_text id from its own export, which is all this table is keyed on. NPC chat
        # (Chatter.lua) finds its recordings in the same table.
        if line["source"] in BROADCAST_SOURCES:
            broadcast = int(line["lineId"].split(":")[1])
            stem = followup_stem_from_line_id(line["lineId"])
            # A split NPC's follow-up is a file per body. The chat event names the speaker, but
            # its body is readable only while the speaker is a unit the player has up, so the
            # man's fallback body's file stays the line's for when it is not.
            if line.get("npcBody"):
                followup_by_body.setdefault(line["npcId"], {}).setdefault(broadcast, {})[
                    line["npcBody"]] = stem
            if line.get("sexBody"):
                followup_by_sex.setdefault(line["npcId"], {}).setdefault(broadcast, {})[
                    line["npcSex"]] = stem
            files = followup.setdefault(line["npcId"], {})
            if line.get("sexBody") and line["npcSex"] == 2:
                files[broadcast] = stem
            elif not line.get("npcBody") or line.get("sexBody"):
                files.setdefault(broadcast, stem)
            continue

        if line["source"] == "gossip":
            if kind not in gossip_by_id:
                continue
            text = escape_lua_string(line["originalText"])
            # The bare hash: the addon adds the gender prefix when resolving.
            digest = gossip_hash_from_line_id(line["lineId"])
            own = gossip_hash_from_line_id(base_id)
            if line.get("npcBody") and kind == "creature":
                gossip_by_body.setdefault(line["npcId"], {}).setdefault(line["npcBody"], {})[own] = digest
                bodies_of.setdefault(line["npcId"], {})[line["npcBody"]] = True
                if line.get("sexBody"):
                    gossip_by_sex.setdefault(line["npcId"], {}).setdefault(line["npcSex"], {})[own] = digest
                digest = own
            elif kind == "creature" and line["npcId"] in unsplit:
                npc = unsplit[line["npcId"]]
                sex_of[line["npcId"]] = GENDER_SEX[npc["gender"]]
                if npc.get("race"):
                    bodies_of[line["npcId"]] = {body_name(npc["race"], npc["gender"]): True}
            gossip_by_id[kind].setdefault(line["npcId"], {})[text] = digest
            # Same-named NPCs of different voices share one entry here, so it names the line's
            # own file, never a voice's that only some of them speak.
            gossip_by_name[kind].setdefault(
                escape_lua_string(speaker_name(line["npcName"])), {})[text] = own
            continue

        # Progress text is never voiced, so an entry would resolve to silence.
        if line["source"] == "progress":
            continue

        stem = quest_stem_from_line_id(base_id)
        wordings.setdefault(quest_moment_stem(base_id), {})[
            escape_lua_string(line["originalText"])] = stem

        if line["source"] == "accept" and kind in questlog:
            questlog[kind][line["questId"]] = line["npcId"]

        if line.get("npcBody") and kind == "creature":
            file_name = variant_file_name(stem, voice) if voice else stem
            quest_files_by_body.setdefault(stem, {}).setdefault(line["npcId"], {})[line["npcBody"]] = file_name
            if line.get("sexBody"):
                quest_files_by_sex.setdefault(stem, {}).setdefault(line["npcId"], {})[line["npcSex"]] = file_name
        elif voice and kind in quest_files:
            quest_files[kind].setdefault(stem, {})[line["npcId"]] = variant_file_name(stem, voice)

        quest_ids.setdefault(line["source"], {}) \
                 .setdefault(escape_lua_string(line["questTitle"]), {}) \
                 .setdefault(escape_lua_string(speaker_name(line["npcName"])), {}) \
                 .setdefault(quest_search_text(line["originalText"]), line["questId"])

    wordings = several_wordings(wordings)

    return {
        "npc_gossip_file_lookups": ("GossipLookupByNPCID", gossip_by_id["creature"]),
        "object_gossip_file_lookups": ("GossipLookupByObjectID", gossip_by_id["gameobject"]),
        "npc_name_gossip_file_lookups": ("GossipLookupByNPCName", gossip_by_name["creature"]),
        "object_name_gossip_file_lookups": ("GossipLookupByObjectName",
                                            gossip_by_name["gameobject"]),
        "quest_id_lookups": ("QuestIDLookup", prune_quest_id_table(quest_ids)),
        "questlog_npc_lookups": ("NPCIDLookupByQuestID", questlog["creature"]),
        "questlog_object_lookups": ("ObjectIDLookupByQuestID", questlog["gameobject"]),
        "questlog_item_lookups": ("ItemIDLookupByQuestID", questlog["item"]),
        "npc_name_lookups": ("NPCNameLookupByNPCID", names["creature"]),
        "object_name_lookups": ("ObjectNameLookupByObjectID", names["gameobject"]),
        "item_name_lookups": ("ItemNameLookupByItemID", names["item"]),
        "followup_lookups": ("FollowupLookup", followup),
        "npc_quest_file_lookups": ("QuestFileLookupByNPCID", quest_files["creature"]),
        "quest_wording_lookups": ("QuestWordingLookup", wordings),
        "object_quest_file_lookups": ("QuestFileLookupByObjectID", quest_files["gameobject"]),
        "npc_sex_gossip_file_lookups": ("GossipFileLookupByNPCSex", gossip_by_sex),
        "npc_sex_quest_file_lookups": ("QuestFileLookupByNPCSex", quest_files_by_sex),
        "npc_sex_lookups": ("NPCSexByNPCID", sex_of),
        "npc_sex_followup_lookups": ("FollowupLookupByNPCSex", followup_by_sex),
        "npc_body_gossip_file_lookups": ("GossipFileLookupByNPCBody", gossip_by_body),
        "npc_body_quest_file_lookups": ("QuestFileLookupByNPCBody", quest_files_by_body),
        "npc_body_followup_lookups": ("FollowupLookupByNPCBody", followup_by_body),
        "npc_bodies_lookups": ("NPCBodiesByNPCID", bodies_of),
        "body_model_lookups": ("BodyByModelFileID", body_by_model()),
    }


#: The tables a language's Gossip pack gets a client-locale copy of: the ones keyed by the
#: NPC's words and its id. Quest ids come from the client itself on every supported release,
#: names are only shown, and the name-keyed gossip tables are the fallback for a speaker with
#: no GUID, which is rare enough to leave to the English text.
LOCALE_TABLES = {
    "creature": ("npc_gossip_file_lookups", "GossipLookupByNPCID"),
    "gameobject": ("object_gossip_file_lookups", "GossipLookupByObjectID"),
}


def locale_tables(corpus: dict, rows: list, ignored=()) -> dict:
    """One client locale's gossip tables, as {output filename: (lua table name, data)}.

    Keyed by the locale's text and pointing at the English line's hash, which names the
    file in every pack. A row is joined to the corpus on its moment and originalText -- the
    English text is what a translated row is anchored to, and the language's own text may
    make one line of English's two or two of its one -- so it takes its speakers from the
    corpus, and a row whose English has since changed is dropped.
    """
    texts = {}
    for row in rows:
        texts.setdefault((moment_of(row["lineId"]), row["originalText"]), []).append(row["localeText"])
    tables = {kind: {} for kind in LOCALE_TABLES}
    for line in corpus["lines"]:
        # A line in another voice has the words of the line it is a voice of.
        base_id = split_voice(line["lineId"])[0]
        if line["source"] != "gossip" or base_id in ignored:
            continue
        kind = line["npcType"]
        if kind not in tables:
            continue
        # A split NPC's bodies find the line's own stem, and GossipFileLookupByNPCBody the rest.
        stem = gossip_hash_from_line_id(base_id if line.get("npcBody") else line["lineId"])
        for text in texts.get((moment_of(base_id), line["originalText"]), ()):
            tables[kind].setdefault(line["npcId"], {})[escape_lua_string(text)] = stem
    return {filename: (table_name, tables[kind])
            for kind, (filename, table_name) in LOCALE_TABLES.items()}


def write_lua_table(path: str, module_name: str, table_name: str, data,
                    lang: str = None) -> None:
    """One generated table. With `lang`, a copy that exists only on a client in that locale.

    That copy is in a language's pack, but a player on an English client may install the
    pack to hear the language, and their client shows English: the English tables are the
    ones that match there, so the copy returns before it is built.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(GUARD + "\n")
        target = f"{module_name}.{table_name}"
        if lang:
            f.write("if not VoiceOver.Language or "
                    f'VoiceOver.Language:GetClientLanguage() ~= "{lang}" then return end\n')
            f.write(f"{module_name}.ClientLocaleLookups = "
                    f"{module_name}.ClientLocaleLookups or {{}}\n")
            target = f"{module_name}.ClientLocaleLookups.{table_name}"
        f.write(f"{target} = ")
        f.write(lua.encode(data))
        f.write("\n")


def module_toc(module_name: str, generated_files: list, version: str = "1.0.1",
               title: str = DEFAULT_TITLE, language: str = None) -> str:
    """The TOC, listing exactly the files this build produced.

    The title is what tells the packs apart in the AddOns list, where five of them can sit at
    once and their folder names differ only by a suffix.
    """
    lines = [TOC_HEADER.format(version=version, title=toc_title(title),
                               module=module_name, icon=ICON_NAME)]
    if language:
        # Only when asked: the addon reads an absent key as enUS, so every English pack keeps
        # its exact TOC.
        lines.insert(0, f"## {LANGUAGE_KEY}: {language}\n")
    lines.extend(f"generated\\{name}" for name in generated_files)
    return "\n".join(lines) + "\n"


def build_module(corpus: dict, store_dir: str, dist_dir: str = DEFAULT_DIST_DIR,
                 module_name: str = DEFAULT_MODULE_NAME, version: str = "1.0.1",
                 progress: bool = False, ignored=(), include=None,
                 title: str = DEFAULT_TITLE, language: str = None,
                 locale_text: list = None) -> dict:
    """Assemble the data module. Returns a report.

    An ignored line's audio is left behind as well as its lookup entry, so a take made
    before the decision - or one imported from the old sound pack - does not ship anyway.
    Only a file whose every line is ignored is skipped; see tts_cli/ignores.py.

    `include` is a set of store-relative stems ('quests/5-accept', no extension) and makes
    this one pack of several: the store is staged once and built into a pack per side of the
    war. None means everything in the store. The lookup tables are not narrowed with it -
    they map text to ids and hashes rather than to files, they are the same in every pack,
    and an entry whose audio is in a pack the player did not install simply finds no length
    and stays quiet. See tts_cli/factions.py.

    `locale_text` is `language`'s rows from tts_cli.locale_text, and adds that language's
    gossip tables under generated/<language>/, loaded only on a client in it. Only the
    language's pack holding its gossip - Gossip, or All - is given them (cli-main.py refuses
    the rest). The English tables
    are written either way: they are what matches on an English client.
    """
    if locale_text is not None and (not language or language == "enUS"):
        raise ValueError("locale text belongs to a language pack; pass its language")
    module_dir = os.path.join(dist_dir, module_name)
    generated_dir = os.path.join(module_dir, "generated")
    sounds_dir = os.path.join(generated_dir, "sounds")

    # Cleared first, so a module holds what this build produced and nothing that a previous
    # one did. Every file under generated/ is written from the corpus and the store, and a
    # leftover is not merely stale: a build in a different audio format would otherwise ship
    # both, doubling the pack with audio no lookup entry can reach.
    if os.path.isdir(generated_dir):
        shutil.rmtree(generated_dir)

    for sub in SUBFOLDERS:
        os.makedirs(os.path.join(sounds_dir, sub), exist_ok=True)

    extension = audio_extension(store_dir)

    # Compared without extensions: the ignore list is derived from the corpus and so names
    # mp3s, while a staged store may hold the same audio transcoded to something else.
    silent = set(wordless(corpus)) | set(ignored)
    skip = {os.path.splitext(rel)[0] for rel in ignored_files(corpus, silent)} \
        if silent else set()
    audio = [rel for rel in stored_files(store_dir)
             if os.path.splitext(rel)[0] not in skip
             and (include is None or os.path.splitext(rel)[0] in include)]
    iterator = tqdm(audio, unit="file", desc="Copying audio") if progress else audio
    for rel in iterator:
        shutil.copy2(os.path.join(store_dir, rel), os.path.join(sounds_dir, rel))

    tables = build_tables(corpus, ignored)
    written = []
    for filename, (table_name, data) in sorted(tables.items()):
        write_lua_table(os.path.join(generated_dir, filename + ".lua"),
                        module_name, table_name, data)
        written.append(filename + ".lua")

    locale_rows = {}
    if locale_text is not None:
        for filename, (table_name, data) in sorted(
                locale_tables(corpus, locale_text, ignored).items()):
            write_lua_table(os.path.join(generated_dir, language, filename + ".lua"),
                            module_name, table_name, data, lang=language)
            written.append(f"{language}\\{filename}.lua")
            locale_rows[f"{language}/{filename}"] = len(data)

    # Durations come from the copied files, so the table can never disagree with them.
    write_sound_length_table_lua(module_name, sounds_dir, generated_dir)
    written.append("sound_length_table.lua")

    # Keyed like the length table, and only for audio this pack carries: the other packs'
    # times would be dead weight in every one of them.
    stored = word_times(store_dir)
    times = {os.path.basename(stem): stored[stem]
             for stem in (os.path.splitext(rel)[0] for rel in audio) if stem in stored}
    write_lua_table(os.path.join(generated_dir, "word_times_table.lua"),
                    module_name, "WordTimesByFileName", times)
    written.append("word_times_table.lua")

    shutil.copy2(icon_source(language), os.path.join(module_dir, ICON_NAME))

    with open(os.path.join(module_dir, "Module.lua"), "w", encoding="utf-8") as f:
        f.write(MODULE_LUA.format(module=module_name, extension=extension))
        if language:
            # The unguarded tables are built from the English corpus whatever the pack speaks.
            f.write(f'{module_name}.LookupLocale = "enUS"\n')
    with open(os.path.join(module_dir, module_name + ".toc"), "w", encoding="utf-8") as f:
        f.write(module_toc(module_name, sorted(written), version, title, language))

    return {
        "moduleDir": module_dir,
        "audioFiles": len(audio),
        "audioFormat": extension,
        "tables": sorted(written),
        "tableRows": {**{name: len(data) for name, (_, data) in tables.items()}, **locale_rows,
                      "word_times_table": len(times)},
        "language": language,
    }


def install_module(module_dir: str, addons_dir: str, force: bool = False) -> dict:
    """Copy a built module into a WoW AddOns folder.

    Refuses to replace an existing install unless forced. The existing pack may hold audio
    this project never imported - files whose text has drifted out of the world database -
    and overwriting is the one step here that is not recoverable from the audio store.
    """
    if not os.path.isdir(module_dir):
        raise FileNotFoundError(f"nothing built at {module_dir}; run build first")

    name = os.path.basename(module_dir.rstrip(os.sep))
    target = os.path.join(addons_dir, name)

    replaced = None
    if os.path.exists(target):
        if not force:
            raise FileExistsError(
                f"{target} already exists; pass force to replace it")
        replaced = target + ".replaced"
        if os.path.exists(replaced):
            shutil.rmtree(replaced)
        os.rename(target, replaced)

    shutil.copytree(module_dir, target)
    return {"target": target, "replaced": replaced}

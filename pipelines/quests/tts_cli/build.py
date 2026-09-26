"""Build the addon data module from the corpus and the audio store.

This is what makes the sound pack an artifact of this project rather than something we
patch. Because the module is built rather than edited, it comes out self-consistent and
in the current format by construction - which is what dissolved the constraints that
came from treating a pre-built pack as immutable input.

Needs no database: the corpus carries every field the lookup tables key on.
"""
import os
import shutil

from slpp import slpp as lua
from tqdm import tqdm

from tts_cli.ignores import ignored_files
from tts_cli.length_table import write_sound_length_table_lua
from tts_cli.naming import gossip_hash_from_line_id, subfolder_from_line_id
from tts_cli.store import audio_extension, stored_files
from tts_cli.utils import (get_first_n_words, get_last_n_words,
                           replace_dollar_bs_with_space)

DEFAULT_MODULE_NAME = "VoiceOverReduxAudio"
DEFAULT_DIST_DIR = "dist"
DEFAULT_ADDONS_DIR = ("/Applications/World of Warcraft/_classic_era_"
                      "/Interface/AddOns")
GUARD = "if not VoiceOver or not VoiceOver.DataModules then return end"

#: Group is what actually nests this under the player in the AddOns list - added in 11.1.0,
#: and its value is the main addon's *name*, so it is the folder name and not the title.
#: X-Part-Of and X-Child-Of are custom X- fields the client does not read at all; they are
#: kept because addon managers do, and because upstream shipped them. Three keys that look
#: interchangeable, one of which does the work.

#: How many leading and trailing words the addon fuzzy-matches quest text on. Must stay
#: in step with DataModules:GetQuestID in AI_VoiceOver/DataModules.lua.
QUEST_SEARCH_WORDS = 15

MODULE_LUA = """if not VoiceOver or not VoiceOver.DataModules then return end

{module} = {{}}

function {module}:GetSoundPath(fileName, event)
    setfenv(1, VoiceOver)
    if Enums.SoundEvent:IsQuestEvent(event) then
        return format([[generated\\sounds\\quests\\%s{extension}]], fileName)
    elseif Enums.SoundEvent:IsGossipEvent(event) then
        return format([[generated\\sounds\\gossip\\%s{extension}]], fileName)
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
DEFAULT_TITLE = "Spoken Quests Audio"

#: The TOC key naming the language a pack was recorded in. Must match what the addon's
#: DataModules.lua reads.
LANGUAGE_KEY = "X-SpokenQuests-Language"

#: The artwork the client shows beside the addon's name in the AddOns list. Committed as a TGA
#: rather than converted at build time, so building needs no ffmpeg; tools/make_icon.py is what
#: made it, and its header explains the format.
ICON_SOURCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "assets", "icon", "spoken-quests.tga")
ICON_NAME = "icon.tga"

TOC_HEADER = """## Interface: 100000
## Title: {title}
## Notes: Contains voiceovers for content released during the Vanilla era.|n|nIt's |cFF20FF20OK|r for this addon to appear |cFF808080"disabled"|r or |cFFFF2020"out of date"|r, it's compatible with any client and |cFFFFD200Spoken Quests|r will load it even if it's disabled or out of date.
## Version: {version}
## IconTexture: Interface\\AddOns\\{module}\\{icon}
## LoadOnDemand: 1
## Group: SpokenQuests
## X-Part-Of: Spoken
## X-Child-Of: SpokenQuests
## X-SpokenQuests-DataModule-Version: 1
## X-SpokenQuests-DataModule-Priority: 100
## X-SpokenQuests-DataModule-Maps: 0, 1, 30, 33, 43, 47, 48, 70, 90, 109, 129, 189, 209, 229, 230, 289, 309, 329, 349, 369, 389, 429, 469, 509, 531, 533
## X-VoiceOver-DataModule-Version: 1
## X-VoiceOver-DataModule-Priority: 100
## X-VoiceOver-DataModule-Maps: 0, 1, 30, 33, 43, 47, 48, 70, 90, 109, 129, 189, 209, 229, 230, 289, 309, 329, 349, 369, 389, 429, 469, 509, 531, 533

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


def build_tables(corpus: dict, ignored=()) -> dict:
    """Every lookup table, as {output filename: (lua table name, data)}.

    Ignored lines are left out entirely: an entry pointing
    at a sound that will never be produced resolves to silence, and the addon has no way to
    tell that apart from a broken lookup.
    """
    gossip_by_id = {"creature": {}, "gameobject": {}}
    gossip_by_name = {"creature": {}, "gameobject": {}}
    questlog = {"creature": {}, "gameobject": {}, "item": {}}
    names = {"creature": {}, "gameobject": {}, "item": {}}
    quest_ids = {}

    for line in corpus["lines"]:
        if line["lineId"] in ignored:
            continue

        kind = line["npcType"]
        names.setdefault(kind, {})[line["npcId"]] = line["npcName"]

        if line["source"] == "gossip":
            if kind not in gossip_by_id:
                continue
            text = escape_lua_string(line["originalText"])
            # The bare hash: the addon adds the gender prefix when resolving.
            digest = gossip_hash_from_line_id(line["lineId"])
            gossip_by_id[kind].setdefault(line["npcId"], {})[text] = digest
            gossip_by_name[kind].setdefault(
                escape_lua_string(line["npcName"]), {})[text] = digest
            continue

        if line["source"] == "accept" and kind in questlog:
            questlog[kind][line["questId"]] = line["npcId"]

        quest_ids.setdefault(line["source"], {}) \
                 .setdefault(escape_lua_string(line["questTitle"]), {}) \
                 .setdefault(escape_lua_string(line["npcName"]), {}) \
                 .setdefault(quest_search_text(line["originalText"]), line["questId"])

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
    file in every pack. A row is joined to the corpus on (lineId, originalText) -- the
    English text is what a translated row is anchored to -- so it takes its speakers from
    the corpus, and a row whose English has since changed is dropped.
    """
    texts = {}
    for row in rows:
        texts.setdefault((row["lineId"], row["originalText"]), []).append(row["localeText"])
    tables = {kind: {} for kind in LOCALE_TABLES}
    for line in corpus["lines"]:
        if line["source"] != "gossip" or line["lineId"] in ignored:
            continue
        kind = line["npcType"]
        if kind not in tables:
            continue
        for text in texts.get((line["lineId"], line["originalText"]), ()):
            tables[kind].setdefault(line["npcId"], {})[escape_lua_string(text)] = \
                gossip_hash_from_line_id(line["lineId"])
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
    lines = [TOC_HEADER.format(version=version, title=title,
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
    gossip tables under generated/<language>/, loaded only on a client in it. Only a
    language's Gossip pack is given them (cli-main.py refuses the rest). The English tables
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

    for sub in ("quests", "gossip"):
        os.makedirs(os.path.join(sounds_dir, sub), exist_ok=True)

    extension = audio_extension(store_dir)

    # Compared without extensions: the ignore list is derived from the corpus and so names
    # mp3s, while a staged store may hold the same audio transcoded to something else.
    skip = {os.path.splitext(rel)[0] for rel in ignored_files(corpus, ignored)} \
        if ignored else set()
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

    shutil.copy2(ICON_SOURCE, os.path.join(module_dir, ICON_NAME))

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
        "tableRows": {**{name: len(data) for name, (_, data) in tables.items()}, **locale_rows},
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

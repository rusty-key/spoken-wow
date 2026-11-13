"""The lines an NPC says in chat right after a quest is accepted or turned in.

Read out of the world DB once, here, and used twice: tools/export_followup_lines.py writes
them to addons/Spoken_Quests/FollowupLines.lua, which the addon matches arriving /say and /yell
against, and tts_cli/corpus.py turns them into corpus rows (source "followup") so they are
voiced and shipped like every other line. Two readers of one extraction, so the addon can
never be armed for a line the corpus has no audio for, or the other way round.

WHERE THEY COME FROM. vmangos runs quest_start_scripts / quest_end_scripts when a quest is
accepted / completed; a row with command 0 (TALK) makes somebody say broadcast_text.dataint,
`delay` seconds after the event, in chat type `datalong` - or, where datalong is 0, in the
broadcast text's own chat_type (DoScriptText takes datalong only as an override). Say, yell and
zone yell are kept, the last labelled "yell" because it arrives as CHAT_MSG_MONSTER_YELL like
any other: Thrall's speech, the Stormwind heralds. So are whispers, the NPC speaking to the
player alone: Lucius reminding you of the thieves' tools he slipped you. The script a quest runs is named by
quest_template.StartScript / CompleteScript and is usually, not always, the quest's own id:
the Scarlet Crusade supply quests share one, and quest 8984 runs 9028's.

Some quest scripts say nothing themselves and hand off instead: command 39 (START_SCRIPT)
starts a generic_scripts script, and the talking happens there - Thrall's speech after For The
Horde!, Kum'isha's after To Serve Kum'isha. vmangos (Map::ScriptCommand_StartScript) picks one
of up to four script ids, datalong..datalong4, rolling 1-100 against their chances in
dataint..dataint4 (a zero chance is never picked), and schedules it from the moment the hand-off
runs. So a chained line is `delay` of the hand-off plus its own, and the lines of the scripts
one row chooses between are alternatives the addon cannot tell apart until one is said - each
its own entry, as with random texts. A generic script can hand off again; the chain is followed
to MAX_CHAIN deep and never back into a script already on it.

WHO SPEAKS. The script's source is the quest ender (end) or giver (start). A non-zero
target_type finds a creature near it - 10 by entry, 11 by spawn guid - and that creature only
becomes the speaker when data_flags swaps the final targets (0x02); otherwise the ender speaks
*to* it. So 0x02 decides the speaker, not target_type alone. A START_SCRIPT hands the generic
script its own final source and target, after that same lookup and swap, so the hand-off row
is resolved exactly as a TALK row would be and whoever it resolves to is the chained script's
source: the ender for For The Horde!, the Scarlet Cavalier a guid names for Scarlet Subterfuge.

A quest with several enders is where the two readers part. The addon rejects a line whose NPC
is not the recorded speaker, so picking one would silence the line at every other ender:
`speaker` stays unset and the text alone decides. The corpus has the opposite need - a line
with no speaker has no voice and is never recorded - so `speakers` lists every candidate, and
each gets a row and, where their voices differ, a clip of its own. Anything unresolvable - a
gameobject ender, an item-started quest - leaves both empty rather than guess, because a wrong
voice is worse than the addon's fallback.

WHAT IS LEFT OUT. Emotes (chat types 2, 3 and 7, and say lines written as "%s begins a
rite...") have no voice. A row with dataint2..4 set is a random pick among up to four texts; each alternative is
its own entry at the same delay, since the addon cannot know which one the server chose until
it sees it. That rule reaches chained lines too: every line of Ammo for Rumbleshot's generic
script is a "%s takes aim..." emote, so the quest has none.

STEPS. Every line carries `step`, numbered per quest and event, naming the script step it is
one outcome of: a TALK row's random texts share one, and so do the lines of the scripts one
START_SCRIPT roll chooses between, at the same delay. Once the addon has heard one line of a
step it knows the others will not come. It used to infer that from speaker and delay, which
is wrong for Scarlet Subterfuge: four Scarlet Cavaliers, one entry, each saying their own line
at the same second.
"""

# vmangos ChatType -> the label the addon replays it as. 6 is CHAT_TYPE_ZONE_YELL, which
# MonsterYellToZone sends as CHAT_MSG_MONSTER_YELL to the whole zone. 4 and 5 are
# MonsterWhisper to the player, as CHAT_MSG_MONSTER_WHISPER and CHAT_MSG_RAID_BOSS_WHISPER.
CHAT_TYPES = {0: "say", 1: "yell", 4: "whisper", 5: "whisper", 6: "yell"}
# A TALK row's datalong of 0 means "the broadcast text's own chat_type".
CHAT_TYPE_FROM_TEXT = 0

TARGET_NEAREST_CREATURE_WITH_ENTRY = 10
TARGET_CREATURE_WITH_GUID = 11
SWAP_FINAL_TARGETS = 0x02

#: The corpus `source` of a follow-up line. Frozen with the line ids it names.
SOURCE = "followup"

EVENTS = {
    # event: (script table, quest_template column, relation table naming who runs it)
    "end": ("quest_end_scripts", "CompleteScript", "creature_involvedrelation"),
    "start": ("quest_start_scripts", "StartScript", "creature_questrelation"),
}

# quest_template carries a row per patch for a few quests, and 4265's script changed between
# them; the latest patch is the one a 1.12 server runs.
QUEST_SCRIPTS = """
SELECT entry, Title, {column} FROM (
  SELECT entry, Title, {column},
         ROW_NUMBER() OVER (PARTITION BY entry ORDER BY patch DESC) AS rn
  FROM quest_template
) q WHERE rn = 1 AND {column} <> 0
"""

TALK_ROWS = """
SELECT s.id, s.delay, s.datalong, s.target_type, s.target_param1, s.data_flags,
       s.dataint, s.dataint2, s.dataint3, s.dataint4
FROM {table} s WHERE s.command = 0 AND s.datalong IN ({datalongs})
"""
TALK_KEYS = ("id", "delay", "datalong", "target_type", "target_param1", "data_flags",
             "dataint", "dataint2", "dataint3", "dataint4")

START_SCRIPT_ROWS = """
SELECT s.id, s.delay, s.target_type, s.target_param1, s.data_flags,
       s.datalong, s.datalong2, s.datalong3, s.datalong4,
       s.dataint, s.dataint2, s.dataint3, s.dataint4
FROM {table} s WHERE s.command = 39
"""
START_SCRIPT_KEYS = ("id", "delay", "target_type", "target_param1", "data_flags",
                     "datalong", "datalong2", "datalong3", "datalong4",
                     "dataint", "dataint2", "dataint3", "dataint4")

GENERIC_SCRIPTS = "generic_scripts"

# The longest hand-off chain among generic scripts in the dump is three deep. The cap is only
# there so that no future data can turn the walk into an exponential one: the cycle check
# stops a script re-entering its own chain, but not a fan-out of distinct scripts.
MAX_CHAIN = 8


def fetch(cursor, sql, *args):
    cursor.execute(sql, args)
    return cursor.fetchall()


def resolve_speaker(row, source, guids):
    target_type, param1, flags = row["target_type"], row["target_param1"], row["data_flags"]
    if not target_type or not flags & SWAP_FINAL_TARGETS:
        return source, "source"
    if target_type == TARGET_NEAREST_CREATURE_WITH_ENTRY:
        return param1, "entry"
    if target_type == TARGET_CREATURE_WITH_GUID:
        return guids.get(param1), "guid"
    return None, f"target_type {target_type}"


def chosen_scripts(row):
    """The generic script ids a START_SCRIPT row can pick, each a possible outcome of its roll."""
    return [script for script, chance in ((row["datalong"], row["dataint"]),
                                          (row["datalong2"], row["dataint2"]),
                                          (row["datalong3"], row["dataint3"]),
                                          (row["datalong4"], row["dataint4"]))
            if script and chance > 0]


def script_lines(table, script, source, candidates, scripts, texts, guids, how,
                 delay=0, chain=(), path=(), roll=None):
    """The lines `table`'s `script` says, run by `source`, and those of every script it hands
    off to, `delay` seconds after the quest event.

    `scripts` is {table: (TALK rows by script id, START_SCRIPT rows by script id)}, holding the
    quest script tables and GENERIC_SCRIPTS. `texts` is {broadcast id: (male, female,
    chat_type)}. `candidates` is every creature that could be `source`, for the corpus (see
    WHO SPEAKS). `chain` is the generic scripts already being run on the way here, `path` the
    hand-off rows that led here, and `roll` set when this script is one of several a roll
    picks between. `how` counts how each line's speaker was found.

    Each line's `step` is a tuple naming its script step (see STEPS); collect numbers them.
    """
    talk, starts = scripts[table]
    lines = []
    for index, row in enumerate(talk.get(script, [])):
        # The row itself, reached by this path - two hand-offs into one generic script are
        # two runs of it - unless it is one of a roll's alternatives, where only the delay
        # lines it up with what the other scripts would have said instead.
        step = roll + (delay + row["delay"],) if roll is not None else \
            path + ((table, script, index),)
        speaker, via = resolve_speaker(row, source, guids)
        # Every ender or giver when it is the script's source that talks; otherwise
        # the one creature the target resolved to, which does not depend on who ran it.
        speakers = list(candidates) if via == "source" else \
            [speaker] if speaker is not None else []
        for broadcast in (row["dataint"], row["dataint2"], row["dataint3"], row["dataint4"]):
            if not broadcast or broadcast not in texts:
                continue
            male, female, text_chat_type = texts[broadcast]
            male, female = male or female, female or male
            chat_type = row["datalong"] if row["datalong"] != CHAT_TYPE_FROM_TEXT else text_chat_type
            if chat_type not in CHAT_TYPES or not male or male.startswith("%s "):
                continue
            lines.append({"id": broadcast, "step": step, "speaker": speaker, "speakers": speakers,
                          "delay": delay + row["delay"], "chat": CHAT_TYPES[chat_type],
                          "male": male, "female": female})
            key = (via, speaker is not None)
            how[key] = how.get(key, 0) + 1

    if len(chain) >= MAX_CHAIN:
        return lines
    for index, row in enumerate(starts.get(script, [])):
        # The chained script runs as whoever the hand-off row resolved to, and inherits the
        # several-enders ambiguity only when that is still the quest script's own source.
        runner, via = resolve_speaker(row, source, guids)
        runners = list(candidates) if via == "source" else [runner] if runner is not None else []
        hop = path + ((table, script, "start", index),)
        options = [generic for generic in chosen_scripts(row) if generic not in chain]
        # Already inside a roll's alternative, a further hop stays in that roll's steps.
        choice = roll if roll is not None else hop if len(options) > 1 else None
        for generic in options:
            lines += script_lines(GENERIC_SCRIPTS, generic, runner, runners, scripts, texts,
                                  guids, how, delay + row["delay"], chain + (generic,), hop,
                                  choice)
    return lines


def number_steps(lines):
    """Replace each line's step tuple with 1, 2, ... in the order the steps are first heard."""
    numbers = {}
    for line in lines:
        line["step"] = numbers.setdefault(line["step"], len(numbers) + 1)
    return lines


def collect(connection):
    """{event: {quest: (title, [line, ...])}}, and per event what resolving speakers found.

    A line is {id, step, speaker, speakers, delay, chat, male, female}: `speaker` is the one the
    addon is given, `speakers` every creature the corpus voices it in - see WHO SPEAKS.
    """
    cursor = connection.cursor()
    texts = {int(e): (m or "", f or "", int(t)) for e, m, f, t in
             fetch(cursor, "SELECT entry, male_text, female_text, chat_type FROM broadcast_text")}
    # A spawn whose id2..id5 are set rolls its entry at spawn time; no single voice fits it.
    guids = {int(g): int(i) for g, i, i2 in fetch(cursor, "SELECT guid, id, id2 FROM creature")
             if not i2}

    datalongs = ", ".join(str(t) for t in sorted({CHAT_TYPE_FROM_TEXT, *CHAT_TYPES}))
    scripts = {}
    for table in [t for t, _, _ in EVENTS.values()] + [GENERIC_SCRIPTS]:
        talk, starts = {}, {}
        for sql, keys, by_script in ((TALK_ROWS, TALK_KEYS, talk),
                                     (START_SCRIPT_ROWS, START_SCRIPT_KEYS, starts)):
            for r in fetch(cursor, sql.format(table=table, datalongs=datalongs)):
                row = dict(zip(keys, (int(v) for v in r)))
                by_script.setdefault(row["id"], []).append(row)
        scripts[table] = (talk, starts)

    result, stats = {}, {}
    for event, (table, column, relation) in EVENTS.items():
        sources = {}
        for creature, quest in fetch(cursor, f"SELECT DISTINCT id, quest FROM {relation} ORDER BY id"):
            sources.setdefault(int(quest), []).append(int(creature))

        quests, how = {}, {}
        many_sources = []
        for quest, title, script in fetch(cursor, QUEST_SCRIPTS.format(column=column)):
            quest, script = int(quest), int(script)
            candidates = sources.get(quest, [])
            if len(candidates) > 1:
                many_sources.append(quest)
            source = candidates[0] if len(candidates) == 1 else None
            lines = script_lines(table, script, source, candidates, scripts, texts, guids, how)
            if lines:
                lines.sort(key=lambda line: (line["delay"], line["id"]))
                quests[quest] = (title, number_steps(lines))
        result[event] = quests
        stats[event] = (how, sorted(q for q in many_sources if q in quests))
    return result, stats


def speaker_entries(result) -> set:
    """Every creature some follow-up line is voiced in."""
    return {speaker for quests in result.values() for _, lines in quests.values()
            for line in lines for speaker in line["speakers"]}


def creature_voices(rows) -> dict:
    """sql_queries.query_creature_voices' answer from its rows, which are (entry, name,
    DisplayRaceID, DisplaySexID, npc_sound_name, ModelID) with the race and sex NULL where the
    display has no CreatureDisplayInfoExtra. Here rather than there so it can be tested
    without a database driver.

    A model row is kept only for a creature with no humanoid row at all: one that has both,
    patch variants of one NPC, keeps its humanoid rows alone, as its quest rows do, so a line
    never gains a second voice for one NPC.

    Folded after DISTINCT, which saw ModelID: two patch variants of a humanoid on two models
    of one race are one voice, as they were before the model was selected, and a model voice
    drops the sound name - it is not read from SoundEntries - so two of those can meet too.
    """
    humanoid, by_model = {}, {}
    for entry, name, race, sex, sound, model in rows:
        if race is None:
            voices, voice = by_model, {"name": name, "DisplayRaceID": None, "DisplaySexID": 0,
                                       "npc_sound_name": None, "ModelID": int(model)}
        else:
            voices, voice = humanoid, {"name": name, "DisplayRaceID": int(race),
                                       "DisplaySexID": int(sex), "npc_sound_name": sound,
                                       "ModelID": None}
        if voice not in voices.setdefault(int(entry), []):
            voices[int(entry)].append(voice)
    for entry, voices in by_model.items():
        humanoid.setdefault(entry, voices)
    return dict(sorted(humanoid.items()))


def corpus_rows(result, creatures) -> list:
    """The extraction's dataframe rows for follow-up lines: one per line, quest and speaker.

    `creatures` is {entry: [{name, DisplayRaceID, DisplaySexID, npc_sound_name, ModelID}, ...]},
    the voice facts creature quest rows are built from (sql_queries.query_creature_voices).
    Several entries for one creature are its patch variants and each is a row, as for quest
    rows. A creature missing from it - its display is not in the dump at all - gets no row.

    As for quest rows, a creature with no humanoid display is kept: DisplayRaceID is None and
    ModelID names the voice instead (flavors.model_voice), since a follow-up line is often the
    only thing a Broken, a robot or a ghost says and leaving it out left the addon with nothing
    to play. Such a row reads as male - DisplaySexID 0, the male text - because the display
    has no sex to read and male is what broadcast_text writes first; the gender is only what
    the corpus schema needs, the model is the voice. corpus._skip_reason keeps these rows from
    being generated until a voice is chosen for the model.

    A row per quest rather than per line, even where several quests say the same words:
    tts_cli/factions.py picks a line's pack by its quest, so a line said on both sides has to
    be seen on both sides to land in Shared. The file is the same either way - it is named
    after the words and the voice (tts_cli/naming.py).

    The text is the one the speaker's own sex reads, as for gossip: broadcast_text writes a
    male and a female version of what an NPC says, and the male is the fallback where only one
    is written (collect already swapped an empty side for the other).
    """
    seen, rows = set(), []
    for quest, event, title, line in sorted(
            ((quest, event, title, line)
             for event, quests in result.items()
             for quest, (title, lines) in quests.items()
             for line in lines),
            key=lambda item: (item[0], item[1], item[3]["delay"], item[3]["id"])):
        for speaker in line["speakers"]:
            for creature in creatures.get(speaker, ()):
                text = line["male"] if creature["DisplaySexID"] == 0 else line["female"]
                key = (quest, line["id"], speaker, creature["DisplayRaceID"],
                       creature["DisplaySexID"], creature["npc_sound_name"], creature["name"],
                       creature.get("ModelID"))
                # The start and end scripts of one quest can say the same words, and so can
                # two alternatives of one row; either is one line, not two.
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "source": SOURCE,
                    "quest": quest,
                    "quest_title": title,
                    "text": text,
                    "DisplayRaceID": creature["DisplayRaceID"],
                    "DisplaySexID": creature["DisplaySexID"],
                    "npc_sound_name": creature["npc_sound_name"],
                    "name": creature["name"],
                    "type": "creature",
                    "id": speaker,
                    "original_text": text,
                    "broadcast_text_id": line["id"],
                    "ModelID": creature.get("ModelID"),
                })
    return rows

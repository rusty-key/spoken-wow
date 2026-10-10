import pymysql
import pandas as pd
from tts_cli.env_vars import MYSQL_HOST, MYSQL_PORT, MYSQL_PASSWORD, MYSQL_USER, MYSQL_DATABASE


# Which of its race-gender's several voices each creature speaks with. A CTE of its own
# because two queries need the same answer: the quest and gossip extraction, and the voices
# follow-up lines are recorded in (query_creature_voices). One definition, so a follow-up line
# and a quest line from the same NPC cannot come out in two flavors.
CREATURE_SOUNDS = '''-- Which of its race-gender's several voices each creature speaks with, as the name of its
-- greeting sound: `DwarfFemaleMaternalNPCGreetings`. See tts_cli/flavors.py.
--
-- One row per creature, because creature_template holds a row per content patch and a
-- creature can change voice between them - Nathaniel Dumah is a warrior in one and an
-- official in another. The latest patch is the version a 1.12 server serves. Everything
-- else selected from creature_template happens to be patch-invariant, which is why nothing
-- needed this before.
creature_sounds AS (
    SELECT entry, npc_sound_name FROM (
        SELECT
            ct.entry,
            se.name as npc_sound_name,
            ROW_NUMBER() OVER (PARTITION BY ct.entry ORDER BY ct.patch DESC) as rank_in_entry
        FROM creature_template ct
            JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
            -- LEFT: roughly a tenth of speaking NPCs are hand-made displays with no
            -- NPCSoundID at all, and they must still produce a row.
            LEFT JOIN db_NPCSounds ns ON ns.ID = cdi.NPCSoundID
            LEFT JOIN sound_entries se ON se.id = ns.SoundGreeting
    ) ranked WHERE rank_in_entry = 1
)'''


def make_connection():
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE
    )


def query_dataframe_for_area(x_range, y_range, map_id):
    db = make_connection()
    sql_query = '''
WITH RECURSIVE
filtered_creatures AS (
    SELECT *
    FROM creature
    WHERE
        map = %s
        AND position_x >= %s AND position_x <= %s
        AND position_y >= %s AND position_y <= %s
),
quest_relations AS (
    SELECT 'accept' as source, qr.quest, fc.id as creature_id, fc.position_x, fc.position_y, fc.map
    FROM filtered_creatures fc
    JOIN creature_questrelation qr ON qr.id = fc.id
        UNION ALL
    SELECT 'complete' as source, qr.quest, fc.id as creature_id, fc.position_x, fc.position_y, fc.map
    FROM filtered_creatures fc
    JOIN creature_involvedrelation qr ON qr.id = fc.id
        UNION ALL
    SELECT 'progress' as source, qr.quest, fc.id as creature_id, fc.position_x, fc.position_y, fc.map
    FROM filtered_creatures fc
    JOIN creature_involvedrelation qr ON qr.id = fc.id
),
collected_gossip_menus (base_menu_id, menu_id, text_id, action_menu_id) AS (
    WITH gossip_menu_and_options AS (
        SELECT gm.entry, gm.text_id, NULL as action_menu_id
            FROM gossip_menu gm
        UNION DISTINCT
        SELECT gm.entry, gm.text_id, gmo.action_menu_id
            FROM gossip_menu gm
            LEFT JOIN gossip_menu_option gmo on gmo.menu_id = gm.entry
    )
    SELECT gm.entry as base_menu_id, gm.entry, gm.text_id, gm.action_menu_id
        FROM gossip_menu_and_options gm
    UNION DISTINCT
    SELECT cgm.base_menu_id, gm.entry, gm.text_id, gm.action_menu_id
        FROM gossip_menu_and_options gm
        INNER JOIN collected_gossip_menus cgm ON cgm.action_menu_id = gm.entry
),
creature_data AS (
    SELECT
        filtered_creatures.id,
        ct.name,
        cgm.text_id,
        cdie.DisplaySexID,
        cdie.DisplayRaceID
    FROM filtered_creatures
        JOIN creature_template ct ON filtered_creatures.id = ct.entry
        JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
        JOIN db_CreatureDisplayInfoExtra cdie ON cdi.ExtendedDisplayInfoID = cdie.ID
        LEFT JOIN collected_gossip_menus cgm ON cgm.base_menu_id = ct.gossip_menu_id
),
numbers AS (
    SELECT 0 AS n
    UNION ALL SELECT 1
    UNION ALL SELECT 2
    UNION ALL SELECT 3
    UNION ALL SELECT 4
    UNION ALL SELECT 5
    UNION ALL SELECT 6
    UNION ALL SELECT 7
)
SELECT
    distinct
    qr.source,
    qr.quest,
    qt.Title as quest_title,
    CASE
        WHEN qr.source = 'accept' THEN qt.Details
        WHEN qr.source = 'progress' THEN qt.RequestItemsText
        ELSE qt.OfferRewardText
    END as "text",
    cdie.DisplayRaceID,
    cdie.DisplaySexID,
    ct.name,
    qr.creature_id as id
FROM
    quest_relations qr
JOIN quest_template qt ON qr.quest = qt.entry
JOIN creature_template ct ON qr.creature_id = ct.entry
JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
JOIN db_CreatureDisplayInfoExtra cdie ON cdi.ExtendedDisplayInfoID = cdie.ID
WHERE
    (
        (qr.source = 'accept' AND qt.Details IS NOT NULL AND qt.Details != '')
        OR (qr.source = 'progress' AND qt.RequestItemsText IS NOT NULL AND qt.RequestItemsText != '')
        OR (qr.source = 'complete' AND qt.OfferRewardText IS NOT NULL AND qt.OfferRewardText != '')
    )

UNION ALL

SELECT
    distinct
    'gossip' as source,
    '' as quest,
    '' as quest_title,
    IF(creature_data.DisplaySexID = 0, bt.male_text, bt.female_text) AS text,
    creature_data.DisplayRaceID,
    creature_data.DisplaySexID,
    creature_data.name,
    creature_data.id
FROM creature_data
    CROSS JOIN numbers
    JOIN npc_text nt ON nt.ID = creature_data.text_id
    JOIN broadcast_text bt ON
        CASE numbers.n
            WHEN 0 THEN nt.BroadcastTextID0
            WHEN 1 THEN nt.BroadcastTextID1
            WHEN 2 THEN nt.BroadcastTextID2
            WHEN 3 THEN nt.BroadcastTextID3
            WHEN 4 THEN nt.BroadcastTextID4
            WHEN 5 THEN nt.BroadcastTextID5
            WHEN 6 THEN nt.BroadcastTextID6
            WHEN 7 THEN nt.BroadcastTextID7
        END = bt.entry
WHERE
    (DisplaySexID = 0 AND bt.male_text IS NOT NULL AND bt.male_text != '')
    OR (DisplaySexID = 1 AND bt.female_text IS NOT NULL AND bt.female_text != '')
;
    '''

    with db.cursor() as cursor:
        cursor.execute(
            sql_query, (map_id, x_range[0], x_range[1], y_range[0], y_range[1]))
        data = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]

    db.close()
    df = pd.DataFrame(data, columns=columns)

    return df


def query_spawns():
    """Every creature and gameobject spawn point, as (type, template_id, map, x, y).

    A template can spawn many times, so this is one row per spawn rather than one per
    entity. The type is carried because creature and gameobject IDs are separate spaces
    that overlap - creature 68 is a Stormwind City Guard while gameobject 68 is a Wanted
    Poster - so keying spawns by bare ID silently mixes them.

    Items are absent by design: they are carried in inventory and have no world position.

    Carried into the corpus so zone-based selection stays possible without the database -
    see tts_cli/corpus.py.
    """
    db = make_connection()
    rows = []
    with db.cursor() as cursor:
        for entity_type, table in (("creature", "creature"), ("gameobject", "gameobject")):
            cursor.execute(f"SELECT id, map, position_x, position_y FROM {table}")
            rows.extend((entity_type, *row) for row in cursor.fetchall())
    db.close()
    return rows


def query_dataframe_for_all_quests_and_gossip(lang: int = 0, raw: bool = False):
    """Every quest and gossip line, in English or in the dump's locale column `lang`.

    `raw` is for loading a translation (tts_cli.locale_import): the English columns exactly
    as lang 0 gives them -- which is what line ids and file names are derived from -- plus
    the locale's own title, text and name beside them as loc_title, loc_text and loc_name,
    NULL where the dump has none. The non-raw branch instead falls back to English inside
    the query, which reads an untranslated line as a translation of itself.
    """
    db = make_connection()
    sql_query = '''
WITH RECURSIVE
creature_quest_relations AS (
    SELECT 'accept' as source, qr.quest, ct.entry as creature_id
    FROM creature_template ct
    JOIN creature_questrelation qr ON qr.id = ct.entry
        UNION ALL
    SELECT 'complete' as source, qr.quest, ct.entry as creature_id
    FROM creature_template ct
    JOIN creature_involvedrelation qr ON qr.id = ct.entry
        UNION ALL
    SELECT 'progress' as source, qr.quest, ct.entry as creature_id
    FROM creature_template ct
    JOIN creature_involvedrelation qr ON qr.id = ct.entry
),
gameobject_quest_relations AS (
    SELECT 'accept' as source, qr.quest, gt.entry as gameobject_id
    FROM gameobject_template gt
    JOIN gameobject_questrelation qr ON qr.id = gt.entry
        UNION ALL
    SELECT 'complete' as source, qr.quest, gt.entry as gameobject_id
    FROM gameobject_template gt
    JOIN gameobject_involvedrelation qr ON qr.id = gt.entry
        UNION ALL
    SELECT 'progress' as source, qr.quest, gt.entry as gameobject_id
    FROM gameobject_template gt
    JOIN gameobject_involvedrelation qr ON qr.id = gt.entry
),
item_quest_relations AS (
    SELECT 'accept' as source, it.start_quest as quest, it.entry as item_id
    FROM item_template it
    WHERE it.start_quest
),
''' + CREATURE_SOUNDS + ''',
collected_gossip_menus (base_menu_id, menu_id, text_id, action_menu_id) AS (
    WITH gossip_menu_and_options AS (
        SELECT gm.entry, gm.text_id, NULL as action_menu_id
            FROM gossip_menu gm
        UNION DISTINCT
        SELECT gm.entry, gm.text_id, gmo.action_menu_id
            FROM gossip_menu gm
            LEFT JOIN gossip_menu_option gmo on gmo.menu_id = gm.entry
    )
    SELECT gm.entry as base_menu_id, gm.entry, gm.text_id, gm.action_menu_id
        FROM gossip_menu_and_options gm
    UNION DISTINCT
    SELECT cgm.base_menu_id, gm.entry, gm.text_id, gm.action_menu_id
        FROM gossip_menu_and_options gm
        INNER JOIN collected_gossip_menus cgm ON cgm.action_menu_id = gm.entry
),
creature_data AS (
    SELECT
        ct.entry as id,
        ct.name,
        cgm.text_id,
        IFNULL(cdie.DisplaySexID, 0) as DisplaySexID,
        cdie.DisplayRaceID,
        IF(cdie.ID IS NULL, NULL, cs.npc_sound_name) as npc_sound_name,
        IF(cdie.ID IS NULL, cdi.ModelID, NULL) as ModelID
    FROM creature_template ct
        JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
        LEFT JOIN db_CreatureDisplayInfoExtra cdie ON cdi.ExtendedDisplayInfoID = cdie.ID
        LEFT JOIN creature_sounds cs ON cs.entry = ct.entry
        LEFT JOIN collected_gossip_menus cgm ON cgm.base_menu_id = ct.gossip_menu_id
),
gameobject_data AS (
    SELECT
        gt.entry as id,
        gt.name,
        cgm.text_id
    FROM gameobject_template gt
        LEFT JOIN collected_gossip_menus cgm ON cgm.base_menu_id =
            CASE gt.type
                WHEN 2  THEN data3  -- GAMEOBJECT_TYPE_QUESTGIVER (type 2) has property "gossipID" in data3 field
                WHEN 8  THEN data10 -- GAMEOBJECT_TYPE_SPELL_FOCUS (type 8) has property "gossipID" in data10 field
                WHEN 10 THEN data19 -- GAMEOBJECT_TYPE_GOOBER (type 10) has property "gossipID" in data19 field
            END
    WHERE gt.type IN (2, 10)
),
numbers AS (
    SELECT 0 AS n
    UNION ALL SELECT 1
    UNION ALL SELECT 2
    UNION ALL SELECT 3
    UNION ALL SELECT 4
    UNION ALL SELECT 5
    UNION ALL SELECT 6
    UNION ALL SELECT 7
),
ALL_DATA AS (

-- Creature QuestGivers

SELECT
    distinct
    qr.source,
    qr.quest,
    qt.Title as quest_title,
    CASE
        WHEN qr.source = 'accept' THEN qt.Details
        WHEN qr.source = 'progress' THEN qt.RequestItemsText
        ELSE qt.OfferRewardText
    END as "text",
    0 as broadcast_text_id,
    cdie.DisplayRaceID,
    IFNULL(cdie.DisplaySexID, 0) as DisplaySexID,
    IF(cdie.ID IS NULL, NULL, cs.npc_sound_name) as npc_sound_name,
    ct.name,
    'creature' as type,
    qr.creature_id as id,
    IF(cdie.ID IS NULL, cdi.ModelID, NULL) as ModelID
FROM
    creature_quest_relations qr
JOIN quest_template qt ON qr.quest = qt.entry
JOIN creature_template ct ON qr.creature_id = ct.entry
JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
LEFT JOIN db_CreatureDisplayInfoExtra cdie ON cdi.ExtendedDisplayInfoID = cdie.ID
LEFT JOIN creature_sounds cs ON cs.entry = ct.entry
WHERE
    (
        (qr.source = 'accept' AND qt.Details IS NOT NULL AND qt.Details != '')
        OR (qr.source = 'progress' AND qt.RequestItemsText IS NOT NULL AND qt.RequestItemsText != '')
        OR (qr.source = 'complete' AND qt.OfferRewardText IS NOT NULL AND qt.OfferRewardText != '')
    )

-- GameObject QuestGivers

UNION ALL
SELECT
    distinct
    qr.source,
    qr.quest,
    qt.Title as quest_title,
    CASE
        WHEN qr.source = 'accept' THEN qt.Details
        WHEN qr.source = 'progress' THEN qt.RequestItemsText
        ELSE qt.OfferRewardText
    END as "text",
    0 as broadcast_text_id,
    -1 as DisplayRaceID,
    0 as DisplaySexID,
    NULL as npc_sound_name,
    gt.name,
    'gameobject' as type,
    qr.gameobject_id as id,
    NULL as ModelID
FROM
    gameobject_quest_relations qr
JOIN quest_template qt ON qr.quest = qt.entry
JOIN gameobject_template gt ON qr.gameobject_id = gt.entry
WHERE
    (
        (qr.source = 'accept' AND qt.Details IS NOT NULL AND qt.Details != '')
        OR (qr.source = 'progress' AND qt.RequestItemsText IS NOT NULL AND qt.RequestItemsText != '')
        OR (qr.source = 'complete' AND qt.OfferRewardText IS NOT NULL AND qt.OfferRewardText != '')
    )

-- Item QuestGivers

UNION ALL
SELECT
    distinct
    qr.source,
    qr.quest,
    qt.Title as quest_title,
    qt.Details as "text",
    0 as broadcast_text_id,
    -1 as DisplayRaceID,
    0 as DisplaySexID,
    NULL as npc_sound_name,
    it.name,
    'item' as type,
    qr.item_id as id,
    NULL as ModelID
FROM
    item_quest_relations qr
JOIN quest_template qt ON qr.quest = qt.entry
JOIN item_template it ON qr.item_id = it.entry
WHERE
    (
        (qr.source = 'accept' AND qt.Details IS NOT NULL AND qt.Details != '')
    )

-- Creature Gossip

UNION ALL
SELECT
    distinct
    'gossip' as source,
    '' as quest,
    '' as quest_title,
    IF(creature_data.DisplaySexID = 0, bt.male_text, bt.female_text) AS text,
    bt.entry as broadcast_text_id,
    creature_data.DisplayRaceID,
    creature_data.DisplaySexID,
    creature_data.npc_sound_name,
    creature_data.name,
    'creature' as type,
    creature_data.id,
    creature_data.ModelID
FROM creature_data
    CROSS JOIN numbers
    JOIN npc_text nt ON nt.ID = creature_data.text_id
    JOIN broadcast_text bt ON
        CASE numbers.n
            WHEN 0 THEN nt.BroadcastTextID0
            WHEN 1 THEN nt.BroadcastTextID1
            WHEN 2 THEN nt.BroadcastTextID2
            WHEN 3 THEN nt.BroadcastTextID3
            WHEN 4 THEN nt.BroadcastTextID4
            WHEN 5 THEN nt.BroadcastTextID5
            WHEN 6 THEN nt.BroadcastTextID6
            WHEN 7 THEN nt.BroadcastTextID7
        END = bt.entry
WHERE
    (DisplaySexID = 0 AND bt.male_text IS NOT NULL AND bt.male_text != '')
    OR (DisplaySexID = 1 AND bt.female_text IS NOT NULL AND bt.female_text != '')

-- GameObject Gossip

UNION ALL
SELECT
    distinct
    'gossip' as source,
    '' as quest,
    '' as quest_title,
    IF(bt.male_text IS NOT NULL AND bt.male_text != '', bt.male_text, bt.female_text) AS text,
    bt.entry as broadcast_text_id,
    -1 as DisplayRaceID,
    0 as DisplaySexID,
    NULL as npc_sound_name,
    gameobject_data.name,
    'gameobject' as type,
    gameobject_data.id,
    NULL as ModelID
FROM gameobject_data
    CROSS JOIN numbers
    JOIN npc_text nt ON nt.ID = gameobject_data.text_id
    JOIN broadcast_text bt ON
        CASE numbers.n
            WHEN 0 THEN nt.BroadcastTextID0
            WHEN 1 THEN nt.BroadcastTextID1
            WHEN 2 THEN nt.BroadcastTextID2
            WHEN 3 THEN nt.BroadcastTextID3
            WHEN 4 THEN nt.BroadcastTextID4
            WHEN 5 THEN nt.BroadcastTextID5
            WHEN 6 THEN nt.BroadcastTextID6
            WHEN 7 THEN nt.BroadcastTextID7
        END = bt.entry
WHERE
    bt.male_text IS NOT NULL AND bt.male_text != '' OR
    bt.female_text IS NOT NULL AND bt.female_text != ''

-- Creature QuestGreetings

UNION ALL
SELECT
    distinct
    'gossip' as source,
    '' as quest,
    '' as quest_title,
    qg.content_default AS text,
    0 as broadcast_text_id,
    creature_data.DisplayRaceID,
    creature_data.DisplaySexID,
    creature_data.npc_sound_name,
    creature_data.name,
    'creature' as type,
    creature_data.id,
    creature_data.ModelID
FROM creature_data
    JOIN quest_greeting qg ON qg.entry=creature_data.id AND type=0

-- GameObject QuestGreetings

UNION ALL
SELECT
    distinct
    'gossip' as source,
    '' as quest,
    '' as quest_title,
    qg.content_default AS text,
    0 as broadcast_text_id,
    -1 AS DisplayRaceID,
    0 AS DisplaySexID,
    NULL AS npc_sound_name,
    gameobject_data.name,
    'gameobject' as type,
    gameobject_data.id,
    NULL as ModelID
FROM gameobject_data
    JOIN quest_greeting qg ON qg.entry=gameobject_data.id AND type=1

)
    '''

    localized_text = f'''CASE source
        WHEN 'gossip' THEN (CASE
            WHEN broadcast_text_id = 0 THEN qg.content_loc{lang}
            WHEN ALL_DATA.type = 'creature' THEN IF(DisplaySexID = 0, lbt.male_text_loc{lang}, lbt.female_text_loc{lang})
            ELSE IFNULL(NULLIF(lbt.male_text_loc{lang}, ''), lbt.female_text_loc{lang})
        END)
        WHEN 'accept'   THEN lq.Details_loc{lang}
        WHEN 'progress' THEN lq.RequestItemsText_loc{lang}
        WHEN 'complete' THEN lq.OfferRewardText_loc{lang}
        ELSE NULL
    END'''
    localized_name = f'''CASE ALL_DATA.type
        WHEN 'creature'   THEN lc.name_loc{lang}
        WHEN 'gameobject' THEN lg.name_loc{lang}
        WHEN 'item'       THEN li.name_loc{lang}
        ELSE NULL
    END'''
    localized_joins = f'''
    LEFT JOIN mangos.locales_quest          lq  ON lq .entry = quest
    LEFT JOIN mangos.locales_broadcast_text lbt ON lbt.entry = broadcast_text_id
    LEFT JOIN mangos.locales_creature       lc  ON lc .entry = id AND type = 'creature'
    LEFT JOIN mangos.locales_gameobject     lg  ON lg .entry = id AND type = 'gameobject'
    LEFT JOIN mangos.locales_item           li  ON li .entry = id AND type = 'item'
    LEFT JOIN mangos.quest_greeting         qg  ON qg .entry = id AND qg.type = (CASE ALL_DATA.type WHEN 'creature' THEN 0 WHEN 'gameobject' THEN 1 ELSE -1 END)
        '''

    if raw:
        if lang == 0:
            raise ValueError("raw is for a locale column; English has no loc_ columns")
        sql_query += f'''
SELECT
    source,
    quest,
    quest_title,
    text,
    DisplayRaceID,
    DisplaySexID,
    npc_sound_name,
    name,
    ALL_DATA.type,
    id,
    ModelID,
    text as original_text,
    NULLIF(lq.title_loc{lang}, '') as loc_title,
    NULLIF({localized_text}, '') as loc_text,
    NULLIF({localized_name}, '') as loc_name
FROM ALL_DATA
{localized_joins}'''
    elif lang == 0:
        sql_query += '''
SELECT
    source,
    quest,
    quest_title,
    text,
    DisplayRaceID,
    DisplaySexID,
    npc_sound_name,
    name,
    type,
    id,
    ModelID,
    text as original_text
FROM ALL_DATA
        '''
    else:
        sql_query += f'''
SELECT
    source,
    quest,
    IFNULL(NULLIF(lq.title_loc{lang}, ''), quest_title) as quest_title,
    IFNULL(NULLIF({localized_text}, ''), text) as text,
    DisplayRaceID,
    DisplaySexID,
    npc_sound_name,
    IFNULL(NULLIF({localized_name}, ''), name) as name,
    ALL_DATA.type,
    id,
    ModelID,
    text as original_text
FROM ALL_DATA
{localized_joins}'''

    with db.cursor() as cursor:
        cursor.execute(sql_query)
        data = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]

    db.close()
    df = pd.DataFrame(data, columns=columns)

    return df


def query_creature_voices(connection, entries) -> dict:
    """{entry: [{name, DisplayRaceID, DisplaySexID, npc_sound_name, ModelID}, ...]} for `entries`.

    The same joins a creature quest row is built from in query_dataframe_for_all_quests_and_gossip,
    and for a creature with a humanoid display the same answer, with ModelID None. More than
    one entry is a creature whose display changed between content patches, which is a row
    apiece there too.

    A creature with no CreatureDisplayInfoExtra row - no humanoid race to voice it in - comes
    back with DisplayRaceID None and its display's ModelID, because it is voiced by its model
    (followup.corpus_rows), and only where it has no humanoid variant at all
    (followup.creature_voices). A creature whose display is not in db_CreatureDisplayInfo
    still has no entry.
    """
    if not entries:
        return {}
    placeholders = ", ".join(["%s"] * len(entries))
    sql = f'''
WITH {CREATURE_SOUNDS}
SELECT DISTINCT ct.entry, ct.name, cdie.DisplayRaceID, cdie.DisplaySexID, cs.npc_sound_name,
       cdi.ModelID
FROM creature_template ct
JOIN db_CreatureDisplayInfo cdi ON ct.display_id1 = cdi.ID
LEFT JOIN db_CreatureDisplayInfoExtra cdie ON cdi.ExtendedDisplayInfoID = cdie.ID
LEFT JOIN creature_sounds cs ON cs.entry = ct.entry
WHERE ct.entry IN ({placeholders})
ORDER BY ct.entry, cdie.DisplayRaceID, cdie.DisplaySexID, ct.name, cs.npc_sound_name, cdi.ModelID
'''
    from tts_cli.followup import creature_voices

    with connection.cursor() as cursor:
        cursor.execute(sql, sorted(entries))
        return creature_voices(cursor.fetchall())


def query_followup_dataframe(lang: int = 0, raw: bool = False):
    """The follow-up lines (tts_cli/followup.py) as extraction rows, a row per line and speaker.

    Built in Python and appended to the quest and gossip rows rather than written as another
    UNION branch of that query: which creature speaks a scripted line is data_flags and a
    guid lookup, and the addon's own export has to agree with the answer, so both read it from
    one function.

    `raw` mirrors query_dataframe_for_all_quests_and_gossip: English columns as they are, plus
    loc_title, loc_text and loc_name for tts_cli.locale_import. The text follows the speaker's
    sex as gossip's does, and NULL is untranslated.
    """
    from tts_cli.followup import collect, corpus_rows, speaker_entries

    db = make_connection()
    try:
        result, _ = collect(db)
        rows = corpus_rows(result, query_creature_voices(db, speaker_entries(result)))
        if raw:
            if lang == 0:
                raise ValueError("raw is for a locale column; English has no loc_ columns")
            _localize_followup_rows(db, rows, lang)
    finally:
        db.close()

    columns = ["source", "quest", "quest_title", "text", "DisplayRaceID", "DisplaySexID",
               "npc_sound_name", "name", "type", "id", "original_text", "broadcast_text_id",
               "ModelID"]
    if raw:
        columns += ["loc_title", "loc_text", "loc_name"]
    return pd.DataFrame(rows, columns=columns)


def _localize_followup_rows(db, rows, lang: int) -> None:
    """Fill loc_title, loc_text and loc_name in place from the dump's `lang` columns."""
    def lookup(sql, ids):
        if not ids:
            return {}
        with db.cursor() as cursor:
            cursor.execute(sql.format(ids=", ".join(["%s"] * len(ids))), sorted(ids))
            return {int(row[0]): row[1:] for row in cursor.fetchall()}

    texts = lookup(f"SELECT entry, NULLIF(male_text_loc{lang}, ''), NULLIF(female_text_loc{lang}, '') "
                   "FROM mangos.locales_broadcast_text WHERE entry IN ({ids})",
                   {row["broadcast_text_id"] for row in rows})
    titles = lookup(f"SELECT entry, NULLIF(title_loc{lang}, '') FROM mangos.locales_quest "
                    "WHERE entry IN ({ids})", {row["quest"] for row in rows})
    names = lookup(f"SELECT entry, NULLIF(name_loc{lang}, '') FROM mangos.locales_creature "
                   "WHERE entry IN ({ids})", {row["id"] for row in rows})
    for row in rows:
        male, female = texts.get(row["broadcast_text_id"], (None, None))
        # As English does: the speaker's sex picks, and a side left empty takes the other.
        row["loc_text"] = (male or female) if row["DisplaySexID"] == 0 else (female or male)
        row["loc_title"] = titles.get(row["quest"], (None,))[0]
        row["loc_name"] = names.get(row["id"], (None,))[0]


def query_quest_reachability(patch: int = 10):
    """What the world DB says about how each quest could be reached, unfiltered by patch.

    Deliberately raw: every quest_template patch row, every questgiver relation with its
    patch range, and the entities with at least one spawn valid at `patch`. Deciding what
    that means is tts_cli/reachability.py, so the rules can be tested without MySQL.

    `patch` is only used for the spawn query, where the alternative is shipping every spawn
    point's patch range to Python for the sake of a boolean.

    The relation tables are the same five the extraction reads, so a quest reachable here
    is one the corpus could hold: creature and gameobject questgivers on both sides of a
    quest, plus item_template.start_quest, which has no patch column of its own.
    """
    db = make_connection()
    definitions, relations, spawned = {}, {}, set()

    with db.cursor() as cursor:
        cursor.execute("SELECT entry, patch FROM quest_template")
        for quest, quest_patch in cursor.fetchall():
            definitions.setdefault(quest, []).append(quest_patch)

        for table, kind in (
            ("creature_questrelation", "creature"),
            ("creature_involvedrelation", "creature"),
            ("gameobject_questrelation", "gameobject"),
            ("gameobject_involvedrelation", "gameobject"),
        ):
            cursor.execute(f"SELECT quest, id, patch_min, patch_max FROM {table}")
            for quest, entity_id, patch_min, patch_max in cursor.fetchall():
                relations.setdefault(quest, []).append({
                    "type": kind, "id": entity_id,
                    "patch_min": patch_min, "patch_max": patch_max,
                })

        # No patch columns on item_template.start_quest, so the item is treated as always
        # available - which is what vmangos does with it too.
        cursor.execute("SELECT start_quest, entry FROM item_template WHERE start_quest")
        for quest, item_id in cursor.fetchall():
            relations.setdefault(quest, []).append({
                "type": "item", "id": item_id, "patch_min": 0, "patch_max": 10,
            })

        for table, kind in (("creature", "creature"), ("gameobject", "gameobject")):
            cursor.execute(
                f"SELECT DISTINCT id FROM {table} WHERE %s BETWEEN patch_min AND patch_max",
                (patch,))
            spawned.update((kind, row[0]) for row in cursor.fetchall())

    db.close()

    return {
        quest: {
            "definition_patches": patches,
            "relations": relations.get(quest, []),
            "spawned": spawned,
        }
        for quest, patches in definitions.items()
    }


def query_npc_reachability(patch: int = 10):
    """What the world DB says about whether each speaking entity is in the world.

    Keyed on (type, id) because creature and gameobject ids are separate spaces - the same
    reason spawn_key exists in tts_cli/corpus.py. Only creature_template is versioned by
    patch; a gameobject's template is not, so its patch list comes back empty and
    reachability.classify_npc reads that as "not asked" rather than "no template".

    Every entity in the tables, not only the speaking ones: which of them the corpus voices
    is a question about the corpus, and answering it here would mean passing it in.
    """
    db = make_connection()
    facts = {}

    with db.cursor() as cursor:
        cursor.execute("SELECT entry, patch FROM creature_template")
        for entry, entry_patch in cursor.fetchall():
            key = ("creature", entry)
            facts.setdefault(key, {"template_patches": [], "spawns": False})
            facts[key]["template_patches"].append(entry_patch)

        cursor.execute("SELECT entry FROM gameobject_template")
        for (entry,) in cursor.fetchall():
            facts.setdefault(("gameobject", entry), {"template_patches": [], "spawns": False})

        for table, kind in (("creature", "creature"), ("gameobject", "gameobject")):
            cursor.execute(
                f"SELECT DISTINCT id FROM {table} WHERE %s BETWEEN patch_min AND patch_max",
                (patch,))
            for (entity_id,) in cursor.fetchall():
                key = (kind, entity_id)
                facts.setdefault(key, {"template_patches": [], "spawns": False})
                facts[key]["spawns"] = True

    db.close()
    return facts

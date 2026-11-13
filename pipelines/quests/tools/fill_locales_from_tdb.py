"""
Fill the vmangos world DB's empty translation columns from TrinityCore's database (TDB).

vmangos carries Blizzard's own text for the languages 1.12 shipped in, but unevenly: esMX has
half the quest text, zhTW a third and no book pages, koKR half the pages -- and Brazilian
Portuguese, which the Classic Era client ships, has no column at all. TrinityCore's releases
carry the same tables keyed by the same Blizzard ids:

  * TDB 3.3.5 -- pre-Cataclysm text, the nearest there is to vanilla, for every 1.12 locale;
  * TDB 12.x  -- retail, the only one with ptBR, and complete for gossip (BroadcastText).

This copies their translations into the vmangos locales_* columns the imports read
(tts_cli/locale_import.py, pipelines/readables/tools/import-locale.mjs), so filling a gap is this
followed by the ordinary `make web-import-locale`. Three rules make that safe:

  * ONLY EMPTY CELLS. vmangos's own translation always wins; this never overwrites one.
  * ONLY WHERE THE ENGLISH AGREES. A translation is copied only when the dump it came from has
    the same English text for that id as vmangos does. Quests Cataclysm rewrote, gossip
    reworded since, a page that moved -- their translations translate something else, and
    are left out. It is also what keeps retail's placeholder rows (an English "[DEPRECATED]"
    title) out.
  * ONLY A TRANSLATION. Retail's ptBR quest rows mostly hold English under a Portuguese
    locale; a "translation" made of its English line's words is left out (untranslated()).

Portuguese gets columns of its own, *_loc9, which a fresh dump does not have; this adds them.
pipelines/lib/locales.mjs names 9 as ptBR's column, so run this before importing ptBR.

Local only, like the dump: it changes your MySQL copy of vmangos, never a database the site
reads. Re-running is harmless -- a filled cell is no longer empty.

Usage (TDB dumps from https://github.com/TrinityCore/TrinityCore/releases, extracted):
    python tools/fill_locales_from_tdb.py --tdb335 TDB_full_world_335.sql \\
        --tdb-world TDB_full_world_1210.sql --tdb-hotfixes TDB_full_hotfixes_1210.sql
    python tools/fill_locales_from_tdb.py ... --dry-run    # count, write nothing
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# vmangos's column number for each language this fills. deDE, esES, frFR and ruRU are left
# alone: vmangos is complete for them. 9 is not vmangos's -- this adds it, for ptBR.
TARGETS = {"koKR": 1, "zhCN": 4, "zhTW": 5, "esMX": 7, "ptBR": 9}
ADDED = 9

#------------------------------------------------------------------------------
# Reading a TDB dump
#------------------------------------------------------------------------------

# One value of a mysqldump INSERT: a quoted string, NULL, a number -- or a bracket, which is
# how the rows are told apart. Commas between them carry nothing.
_TOKEN = re.compile(r"'((?:[^'\\]|\\.)*)'|(NULL)|(-?[0-9][0-9.eE+-]*)|(\()|(\))", re.S)
_ESCAPE = re.compile(r"\\(.)", re.S)
_ESCAPES = {"0": "\0", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a", "b": "\b"}


def _unescape(text: str) -> str:
    return _ESCAPE.sub(lambda m: _ESCAPES.get(m.group(1), m.group(1)), text)


def read_tables(path: Path, wanted: dict[str, list[str]], keep=None) -> dict[str, list[dict]]:
    """Rows of `wanted` tables from a mysqldump file, each a dict of the named columns.

    `keep(table, row)` drops a row early, which is what keeps retail's millions of locale
    rows for languages this does not fill out of memory.
    """
    columns: dict[str, list[str]] = {}
    rows: dict[str, list[dict]] = defaultdict(list)
    table = None
    with open(path, encoding="utf-8", errors="replace") as dump:
        for line in dump:
            if line.startswith("CREATE TABLE `"):
                table = line.split("`")[1]
                if table in wanted:
                    columns[table] = []
                continue
            if table in columns and line.startswith("  `"):
                columns[table].append(line.split("`")[1])
                continue
            if not line.startswith("INSERT INTO `"):
                continue
            name = line[13:line.index("`", 13)]
            if name not in wanted:
                continue
            index = {column: columns[name].index(column) for column in wanted[name]}
            values: list = []
            for match in _TOKEN.finditer(line, line.index(" VALUES ")):
                string, null, number, opening, closing = match.groups()
                if opening:
                    values = []
                elif closing:
                    row = {column: values[i] for column, i in index.items()}
                    if keep is None or keep(name, row):
                        rows[name].append(row)
                elif null:
                    values.append(None)
                elif number is not None:
                    values.append(number)
                else:
                    values.append(_unescape(string))
    return rows


#------------------------------------------------------------------------------
# What is copied where
#------------------------------------------------------------------------------

_WORDS = re.compile(r"\w+")


def same(text: str | None) -> str:
    """English text reduced to its words, lowercased.

    What two copies of one line disagree on without saying anything different: the case of a
    token ($n and $N are the same player name), whitespace, and punctuation an editor tidied
    ("well done--I'm" and "well done - I'm"), and $B, the game's line break, which one copy
    keeps as a token and the other has already turned into a newline. A word changed is a
    line changed.
    """
    if not text:
        return ""
    return " ".join(_WORDS.findall(re.sub(r"\$[Bb]", " ", text).lower()))


_LETTERS = re.compile(r"[^\W\d_]+")


def _letter_words(text: str | None) -> list[str]:
    return _LETTERS.findall(re.sub(r"\$[A-Za-z]", " ", text or "").lower())


def untranslated(text: str | None, english: str | None) -> bool:
    """A translation that is really English: most of its words are the English line's own.

    Retail TDB's ptBR quest rows are mostly English -- sometimes the English line verbatim,
    sometimes a later retail wording of it -- so equality alone misses some. A real
    translation shares only names with its English; measured on every ptBR row, the English
    ones share 60% of their words or more and the Portuguese ones 50% at most, the top of
    that being "Olá, $n." and its like, which the word floor keeps out. The floor also lets a
    two-word name through, which may rightly be the English one.
    """
    words = _letter_words(text)
    if len(words) < 3:
        return False
    theirs = set(_letter_words(english))
    return sum(word in theirs for word in words) / len(words) > 0.55


# A field: vmangos's locale table and column stem, the vmangos English it translates, and
# where TDB keeps the translation and its own English. Keys are (id,) or (id, type).
FIELDS = [
    # vmangos locale table, key, column stem, vmangos English (table, column), TDB name
    ("locales_quest", ("entry",), "Title", ("quest_template", "Title"), "quest title"),
    ("locales_quest", ("entry",), "Details", ("quest_template", "Details"), "quest details"),
    ("locales_quest", ("entry",), "Objectives", ("quest_template", "Objectives"), "quest objectives"),
    ("locales_quest", ("entry",), "RequestItemsText", ("quest_template", "RequestItemsText"), "quest progress"),
    ("locales_quest", ("entry",), "OfferRewardText", ("quest_template", "OfferRewardText"), "quest completion"),
    ("locales_broadcast_text", ("entry",), "male_text", ("broadcast_text", "male_text"), "gossip (male)"),
    ("locales_broadcast_text", ("entry",), "female_text", ("broadcast_text", "female_text"), "gossip (female)"),
    ("locales_page_text", ("entry",), "Text", ("page_text", "text"), "book page"),
    ("quest_greeting", ("entry", "type"), "content", ("quest_greeting", "content_default"), "quest greeting"),
    ("locales_creature", ("entry",), "name", ("creature_template", "name"), "creature name"),
    ("locales_gameobject", ("entry",), "name", ("gameobject_template", "name"), "object name"),
    ("locales_item", ("entry",), "name", ("item_template", "name"), "item name"),
]


def tdb_texts(release: str, world: dict, hotfixes: dict) -> dict[str, dict]:
    """field -> {"english": {key: text}, "locale": {(key, lang): text}} for one TDB release."""
    out: dict[str, dict] = {}

    def field(name, english_rows, english_col, locale_rows, locale_col, key=("ID",), locale_key=None):
        locale_key = locale_key or key
        out[name] = {
            "english": {tuple(int(r[k]) for k in key): r[english_col] for r in english_rows},
            "locale": {
                (tuple(int(r[k]) for k in locale_key), r["locale"]): r[locale_col]
                for r in locale_rows
                if r[locale_col]
            },
        }

    quest = world["quest_template"]
    field("quest title", quest, "LogTitle", world["quest_template_locale"], "LogTitle")
    field("quest details", quest, "QuestDescription", world["quest_template_locale"], "QuestDescription")
    field("quest objectives", quest, "LogDescription", world["quest_template_locale"], "LogDescription")
    field("quest progress", world["quest_request_items"], "CompletionText",
          world["quest_request_items_locale"], "CompletionText")
    field("quest completion", world["quest_offer_reward"], "RewardText",
          world["quest_offer_reward_locale"], "RewardText")
    field("book page", world["page_text"], "Text", world["page_text_locale"], "Text")
    greeting_type = "Type" if release == "335" else "type"
    field("quest greeting", world["quest_greeting"], "Greeting", world["quest_greeting_locale"], "Greeting",
          key=("ID", "Type"), locale_key=("ID", greeting_type))
    field("creature name", world["creature_template"], "name",
          world["creature_template_locale"], "Name", key=("entry",))
    field("object name", world["gameobject_template"], "name",
          world["gameobject_template_locale"], "name", key=("entry",))

    if release == "335":
        text, text1 = "Text", "Text1"
        broadcast, broadcast_locale = world["broadcast_text"], world["broadcast_text_locale"]
        field("item name", world["item_template"], "name", world["item_template_locale"], "Name",
              key=("entry",), locale_key=("ID",))
    else:
        text, text1 = "Text_lang", "Text1_lang"
        broadcast = [{"ID": r["ID"], "Text_lang": r["Text"], "Text1_lang": r["Text1"]}
                     for r in hotfixes["broadcast_text"]]
        broadcast_locale = hotfixes["broadcast_text_locale"]
        field("item name", hotfixes["item_sparse"], "Display", hotfixes["item_sparse_locale"], "Display_lang")
    field("gossip (male)", broadcast, text, broadcast_locale, text)
    field("gossip (female)", broadcast, text1, broadcast_locale, text1)
    return out


WORLD_335 = {
    "quest_template": ["ID", "LogTitle", "LogDescription", "QuestDescription"],
    "quest_template_locale": ["ID", "locale", "LogTitle", "LogDescription", "QuestDescription"],
    "quest_request_items": ["ID", "CompletionText"],
    "quest_request_items_locale": ["ID", "locale", "CompletionText"],
    "quest_offer_reward": ["ID", "RewardText"],
    "quest_offer_reward_locale": ["ID", "locale", "RewardText"],
    "broadcast_text": ["ID", "Text", "Text1"],
    "broadcast_text_locale": ["ID", "locale", "Text", "Text1"],
    "page_text": ["ID", "Text"],
    "page_text_locale": ["ID", "locale", "Text"],
    "quest_greeting": ["ID", "Type", "Greeting"],
    "quest_greeting_locale": ["ID", "Type", "locale", "Greeting"],
    "creature_template": ["entry", "name"],
    "creature_template_locale": ["entry", "locale", "Name"],
    "gameobject_template": ["entry", "name"],
    "gameobject_template_locale": ["entry", "locale", "name"],
    "item_template": ["entry", "name"],
    "item_template_locale": ["ID", "locale", "Name"],
}
WORLD_12 = {name: cols for name, cols in WORLD_335.items()
            if not name.startswith(("broadcast_text", "item_template"))}
WORLD_12["quest_greeting_locale"] = ["ID", "type", "locale", "Greeting"]
HOTFIXES_12 = {
    "broadcast_text": ["ID", "Text", "Text1"],
    "broadcast_text_locale": ["ID", "locale", "Text_lang", "Text1_lang"],
    "item_sparse": ["ID", "Display"],
    "item_sparse_locale": ["ID", "locale", "Display_lang"],
}


def _only_targets(_table, row):
    locale = row.get("locale")
    return locale is None or locale in TARGETS


#------------------------------------------------------------------------------
# Writing into vmangos
#------------------------------------------------------------------------------

def add_ptbr_columns(cur) -> None:
    """*_loc9 beside every *_loc8 the imports read, if they are not there yet."""
    for table, stems in {
        "locales_quest": ["Title", "Details", "Objectives", "OfferRewardText", "RequestItemsText", "EndText"],
        "locales_broadcast_text": ["male_text", "female_text"],
        "locales_page_text": ["Text"],
        "locales_creature": ["name", "subname"],
        "locales_gameobject": ["name"],
        "locales_item": ["name", "description"],
        "quest_greeting": ["content"],
    }.items():
        cur.execute(
            "select column_name from information_schema.columns where table_schema = database() "
            "and table_name = %s", (table,))
        present = {row[0] for row in cur.fetchall()}
        for stem in stems:
            if f"{stem}_loc{ADDED}" not in present:
                cur.execute(f"alter table `{table}` add column `{stem}_loc{ADDED}` longtext null")


def vmangos_english(cur, table: str, column: str, key: tuple[str, ...]) -> dict[tuple, set[str]]:
    """Every English text vmangos has for each key -- several, where a row varies by patch."""
    cur.execute(f"select {', '.join(key)}, `{column}` from `{table}`")
    english: dict[tuple, set[str]] = defaultdict(set)
    for row in cur.fetchall():
        english[tuple(int(v) for v in row[:-1])].add(same(row[-1]))
    return english


def current_cells(cur, table: str, stem: str, key: tuple[str, ...]) -> dict[tuple, dict[str, str | None]]:
    """What each target language's column holds now. A column not there yet (ptBR's, before
    the first run) reads as empty."""
    cur.execute(
        "select column_name from information_schema.columns where table_schema = database() "
        "and table_name = %s", (table,))
    present = {row[0] for row in cur.fetchall()}
    columns = [f"`{stem}_loc{n}`" if f"{stem}_loc{n}" in present else "NULL"
               for n in TARGETS.values()]
    cur.execute(f"select {', '.join(key)}, {', '.join(columns)} from `{table}`")
    cells = {}
    for row in cur.fetchall():
        k = tuple(int(v) for v in row[:len(key)])
        cells[k] = dict(zip(TARGETS, row[len(key):]))
    return cells


def fill(conn, releases: list[tuple[str, dict]], dry_run: bool) -> Counter:
    counts: Counter = Counter()
    with conn.cursor() as cur:
        if not dry_run:
            add_ptbr_columns(cur)
        for table, key, stem, (english_table, english_column), name in FIELDS:
            english = vmangos_english(cur, english_table, english_column, key)
            cells = current_cells(cur, table, stem, key)
            writes: dict[tuple, dict[str, str]] = defaultdict(dict)
            for release, texts in releases:
                source = texts.get(name)
                if not source:
                    continue
                for (k, lang), text in source["locale"].items():
                    if lang not in TARGETS or k not in english:
                        continue
                    if (cells.get(k, {}).get(lang) or "").strip() or lang in writes.get(k, {}):
                        continue
                    if same(source["english"].get(k)) not in english[k] or not same(source["english"].get(k)):
                        counts[(name, lang, "english differs")] += 1
                        continue
                    if untranslated(text, source["english"].get(k)):
                        counts[(name, lang, "untranslated")] += 1
                        continue
                    writes[k][lang] = text
                    counts[(name, lang, f"from TDB {release}")] += 1
            if dry_run or not writes:
                continue
            for k, by_lang in writes.items():
                for lang, text in by_lang.items():
                    column = f"`{stem}_loc{TARGETS[lang]}`"
                    where = " and ".join(f"`{c}` = %s" for c in key)
                    cur.execute(f"update `{table}` set {column} = %s where {where}", (text, *k))
                    if cur.rowcount == 0 and table.startswith("locales_"):
                        cur.execute(
                            f"insert into `{table}` (`{key[0]}`, {column}) values (%s, %s)",
                            (k[0], text))
        if not dry_run:
            conn.commit()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tdb335", type=Path, required=True, help="TDB_full_world_335.*.sql")
    parser.add_argument("--tdb-world", type=Path, required=True, help="TDB_full_world_12*.sql (retail)")
    parser.add_argument("--tdb-hotfixes", type=Path, required=True, help="TDB_full_hotfixes_12*.sql (retail)")
    parser.add_argument("--dry-run", action="store_true", help="count what would be filled, write nothing")
    args = parser.parse_args()

    print("reading TDB 3.3.5...", file=sys.stderr, flush=True)
    t335 = read_tables(args.tdb335, WORLD_335, _only_targets)
    print("reading TDB 12 world...", file=sys.stderr, flush=True)
    t12w = read_tables(args.tdb_world, WORLD_12, _only_targets)
    print("reading TDB 12 hotfixes...", file=sys.stderr, flush=True)
    t12h = read_tables(args.tdb_hotfixes, HOTFIXES_12, _only_targets)
    # 3.3.5 first: pre-Cataclysm text is the nearer to what vmangos's English says.
    releases = [("3.3.5", tdb_texts("335", t335, {})), ("12", tdb_texts("12", t12w, t12h))]

    from tts_cli.sql_queries import make_connection
    conn = make_connection()
    try:
        counts = fill(conn, releases, args.dry_run)
    finally:
        conn.close()

    by_lang: dict[str, Counter] = defaultdict(Counter)
    for (name, lang, outcome), n in counts.items():
        by_lang[lang][(name, outcome)] += n
    for lang in TARGETS:
        print(f"\n{lang}{' (dry run)' if args.dry_run else ''}")
        for (name, outcome), n in sorted(by_lang[lang].items()):
            print(f"  {name:18} {outcome:16} {n:7}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

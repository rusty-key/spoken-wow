"""The corpus <-> Postgres round trip, and the seam that makes the table its source of truth.

The site edits lines, records who changed them and keeps what they used to say. None of
that could live in corpus/corpus.json.gz, so it lived in line_override instead: a patch
table keyed by file, with no history. This moves the corpus itself into Postgres beside
lore_line and book_line, and turns the committed file into an EXPORT of that table -- the
same arrangement places has with tools/voice/manifest.json.

WHAT DOES NOT CHANGE: producing audio and building a sound pack still need no database.
tts_cli.build reads the committed file exactly as it always has,
and a clone with no Postgres can still ship a pack. That is the promise requirements.txt
makes, and the reason this is an import/export pair rather than a rewrite of the CLI.

WHY THIS IS PYTHON. The check that proves the table carries everything is that an import
followed by an export leaves corpus.json.gz byte-identical -- `git status` clean. Python
and Node do not produce identical gzip streams for the same input: the headers differ and
so does the deflate output. So the exporter has to be the same write_corpus that writes the
file today, which makes byte-identity true by construction instead of a coincidence between
two zlib builds.

THE CORPUS IS A FLAT LIST AND THIS TRANSCRIBES IT, defects included:

  * 103 lineIds name two different texts and one filename, so only the first is ever
    voiced. `variant` records which is which rather than collapsing them, because
    collapsing would change what ships for those files as a side effect of a schema choice.
  * 34 rows name a speaker that already appears for the same line, 19 identically and 15
    claiming a different voice. They are kept, because the export is what the addon build
    reads and dropping a row changes what ships.

Both are counted on every import and printed. Fixing them is a decision for whoever owns
the extract, made on purpose, in a commit that says so.
"""
import json
import os
from collections import Counter
from datetime import datetime, timezone

from tts_cli.corpus import (GENERIC_TYPES, INVALID_CHARS, NO_VOICE, SCHEMA_VERSION, load_corpus,
                            write_corpus)
from tts_cli.flavors import fallback_flavors, is_model_voice
from tts_cli.naming import moment_of
from tts_cli.npc_bodies import body_name

LANG = "enUS"

# What makes two corpus rows the same LINE rather than the same row: everything except who
# is speaking. Two rows agreeing on all of it are one line said by two NPCs; two rows
# differing anywhere in it are two lines that happen to share an id.
LINE_FIELDS = (
    "source",
    "questId",
    "questTitle",
    "playerGender",
    "text",
    "originalText",
    "fileName",
    "generatable",
    "skipReason",
)

SPEAKER_FIELDS = ("npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")

# The first schema whose export marks a contributed row with its "contributionId". In an older
# file a contributed row looks exactly like the dump's, so nothing in it may overtake one.
CONTRIBUTIONS_MARKED = 3

# Where a speaker the site wrote starts in `ord`: a contribution's (apps/web lib/quests/speakers.ts)
# and one an admin added. The extract numbers its own rows 0..n, and `ord` is unique per language.
ORD_FLOOR = 1_000_000


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "DATABASE_URL is not set -- the corpus lives in Postgres now.\n"
            "Producing audio and building a pack still need no database; this command does."
        )
    # Here rather than at the top, so the module's pure parts (split_contributed) load and are
    # tested without psycopg2, which only requirements-extract.txt installs.
    import psycopg2

    return psycopg2.connect(url)


def _line_key(row):
    return tuple(row[field] for field in LINE_FIELDS)


def answered_models(cur, lines):
    """{(npcType, npcId): (race, gender, flavor, voice)} for the NPCs the dump knows only by
    model but the npc table already names a race and gender for: answers a model answer leaves
    alone. A bare type ("creature") is not one: a speaker row needs a gender."""
    keys = {(row["npcType"], row["npcId"]) for row in lines if is_model_voice(row["voice"])}
    if not keys:
        return {}
    cur.execute(
        """select "npcKind", "npcId", "race", "gender", "flavor",
                  "voice_for"("race", "gender", "flavor")
             from "npc"
            where ("npcKind", "npcId") in %s and "provenance" <> 'none'
              and "race" !~ '^model-[0-9]+$' and "gender" is not null""",
        (tuple(keys),),
    )
    return {(r[0], r[1]): r[2:] for r in cur.fetchall() if r[5]}


def with_answered_voices(lines, answers):
    """The dump's model rows spoken in the voice their NPC is already answered with, as the site
    reads it (apps/web migration 0071). Otherwise a line a contributor voiced would turn to
    no-voice, and its takes would sit under a file its voice no longer names."""
    out = []
    for row in lines:
        answer = answers.get((row["npcType"], row["npcId"])) if is_model_voice(row["voice"]) else None
        if answer is None:
            out.append(row)
            continue
        race, gender, flavor, voice = answer
        reason = row["skipReason"]
        if reason == NO_VOICE:
            reason = "invalid-chars" if any(c in row["text"] for c in INVALID_CHARS) else None
        out.append({**row, "race": race, "gender": gender, "flavor": flavor, "voice": voice,
                    "skipReason": reason, "generatable": reason is None})
    return out


def split_here(variants, live):
    """The dump's plain lines the site split by player gender: (lineId, variant) whose own row
    is not current while its `:m` or `:f` is (apps/web/src/lib/quests/moment-rewrite.ts).

    The site is the corpus. Such a line is left out, never promoted back beside its split, and
    its speakers are written onto the two sides.
    """
    return {
        (line_id, variant)
        for line_id, payloads in variants.items()
        if moment_of(line_id) == line_id
        for variant in range(len(payloads))
        if (line_id, variant) not in live
        and ((f"{line_id}:m", variant) in live or (f"{line_id}:f", variant) in live)
    }


def _variants(lines):
    """lineId -> [line payload, ...], in the order the corpus first mentions each.

    The index into that list is the `variant`, so it is stable for as long as the extract
    keeps producing the rows in the same order -- which it does, being a dataframe walked
    once.
    """
    order = {}
    for row in lines:
        seen = order.setdefault(row["lineId"], [])
        key = _line_key(row)
        if key not in seen:
            seen.append(key)
    return order


def split_contributed(lines, schema_version, known_contributions, contributed_speakers,
                      added_speakers=frozenset()):
    """The file's rows -> (the dump's rows, how many contributed rows were left alone).

    A contributed row is already in the tables, written when a moderator accepted it, and is
    not the import's to write again: importing it as a speaker of its own is how the export
    round trip once doubled every contributed speaker on production (migration 0060).

    In a marked file (CONTRIBUTIONS_MARKED) that is the rows carrying a contributionId this
    database knows. One it does not know -- a fresh database seeded from the committed export,
    as CI is -- has no contribution to hang from, so it is seeded as a plain row, as it always
    was. An older file marks nothing, so a row identical to a contributed speaker
    (`contributed_speakers`: lineId plus SPEAKER_FIELDS) is taken for that speaker's copy.

    A speaker an admin added (apps/web migration 0076) carries its "addedBy" and is left alone
    the same way when the database has it (`added_speakers`: lineId, npcType, npcId). One it does
    not have keeps the key, and is written as an added speaker again.
    """
    marked = schema_version >= CONTRIBUTIONS_MARKED
    extracted, skipped = [], 0
    for row in lines:
        if row.get("addedBy") is not None and (row["lineId"], row["npcType"], row["npcId"]) in added_speakers:
            skipped += 1
            continue
        contribution = row.get("contributionId")
        if marked:
            if contribution is not None and contribution in known_contributions:
                skipped += 1
                continue
        elif (row["lineId"],) + tuple(row[f] for f in SPEAKER_FIELDS) in contributed_speakers:
            skipped += 1
            continue
        extracted.append({k: v for k, v in row.items() if k != "contributionId"})
    return extracted, skipped


def removed_here(row, removed_speakers):
    """Whether a row of the dump names a speaker an admin removed from its moment (apps/web
    migration 0077). `removed_speakers` holds (moment, npcType, npcId)."""
    return (moment_of(row["lineId"]), row["npcType"], row["npcId"]) in removed_speakers


def _progress(message):
    """One line per step, as it happens: the import is a single transaction, so nothing it
    writes is visible from outside until the end, and this is the only way to see it move."""
    print(f"  {datetime.now().strftime('%H:%M:%S')} {message}", flush=True)


def _bulk(cur, what, rows, sql, template=None, page=1000):
    """execute_values in pages of `page` rows, saying how far it has got after each."""
    import psycopg2.extras

    for start in range(0, len(rows), page):
        psycopg2.extras.execute_values(cur, sql, rows[start:start + page], template=template,
                                       page_size=page)
        _progress(f"{what}: {min(start + page, len(rows))}/{len(rows)}")
    if not rows:
        _progress(f"{what}: none")


#: Whether an imported answer {new} lands over the table's {old}.
# A dump answer that knows only the creature's model says less than anybody who named a race,
# a player's client included: it fills an NPC nobody answered and updates its own kind, and
# leaves every other answer, so a voice chosen for the NPC is not taken back to no voice.
_REPLACES = """(case when {new}."race" like 'model-%%'
                     then {old}."provenance" = 'none' or coalesce({old}."race", '') like 'model-%%'
                     when {old}."provenance" = 'moderator'
                     then {old}."doubtful" and {new}."provenance" <> 'none'
                     else "npc_provenance_rank"({old}."provenance")
                          <= "npc_provenance_rank"({new}."provenance") end)"""


def retyped(npcs) -> list:
    """An older file's narrated NPCs as their own types (apps/web migration 0071): the narrator
    is a voice, not something an NPC is."""
    return [{**npc, "race": npc["npcType"] if npc["npcType"] in GENERIC_TYPES else "creature",
             "gender": None}
            if npc["race"] == "narrator" else npc
            for npc in npcs]


def _with_default(answer, defaults) -> tuple:
    """An answer's (flavor, provenance, doubtful): the extract's own flavorless answer takes its
    race-gender's default from `defaults`, marked doubtful; anybody else's is as they gave it."""
    provenance = answer.get("provenance", "corpus")
    guess = None if answer["flavor"] or provenance != "corpus" else \
        defaults.get(f'{answer["race"]}-{answer["gender"]}')
    return answer["flavor"] or guess, provenance, guess is not None


def npc_answers(npcs) -> list:
    """The file's NPCs as npc rows, (kind, id, race, gender, flavor, provenance, doubtful).

    An NPC the game names no flavor for -- a hand-made display like Cairne Bloodhoof's -- is
    given its race-gender's default (flavors.fallback_flavors), marked doubtful, so its lines
    keep the voice they were made in and a moderator finds it under Doubtful to confirm or
    change. Only the extract's own answers: anybody else's is as they gave it. A race-gender
    with no flavors at all, as the narrator's, keeps none.
    """
    npcs = retyped(npcs)
    defaults = fallback_flavors((f'{npc["race"]}-{npc["gender"]}', npc["flavor"]) for npc in npcs)
    rows = []
    for npc in npcs:
        rows.append((npc["npcType"], npc["npcId"], npc["race"], npc["gender"],
                     *_with_default(npc, defaults)))
    return rows


def _import_types(cur, npcs):
    """Every type, flavor and voice the file's NPCs name that the site has none of yet, so the
    npc rows have somewhere to stand -- the file is an export of a site an admin may have
    added types to. Insert-only, and a voice is assigned only to a type or a flavor this import
    added: a flavorless NPC's voice is its line's, made in some flavor, and assigning it to
    the bare race-gender would voice every flavorless NPC of it. A model slot is a voice by
    pattern and never a type."""
    # A few dozen combinations among thousands of NPCs: each once, with the first NPC's voice.
    combinations = {}
    for npc in retyped(npcs):
        combinations.setdefault((npc["race"], npc["gender"], npc["flavor"]), npc.get("voice"))
    for (race, gender, flavor), voice in combinations.items():
        if not race or is_model_voice(race):
            continue
        cur.execute("""insert into "race" ("key") values (%s) on conflict do nothing""", (race,))
        new_race = cur.rowcount > 0
        if gender:
            cur.execute("""insert into "gender" ("race", "gender") values (%s, %s)
                           on conflict do nothing""", (race, gender))
        new_flavor = False
        if flavor:
            cur.execute("""insert into "flavor" ("race", "gender", "flavor") values (%s, %s, %s)
                           on conflict do nothing""", (race, gender, flavor))
            new_flavor = cur.rowcount > 0
        if not (new_race or new_flavor) or not voice or is_model_voice(voice):
            continue
        # The types are every team's, so every team's roster gets the voice. As the table owner
        # with no spoken.team, the column default is null, so each team is named.
        cur.execute("""insert into "voice" ("teamId", "name", "race", "gender")
                       select t."id", %s, %s, %s from "team" t
                       on conflict do nothing""", (voice, race, gender or ""))
        cur.execute("""insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
                       select t."id", %s, %s, %s, %s from "team" t
                       on conflict do nothing""",
                    (race, gender, flavor if new_flavor else None, voice))


def _import_npcs(cur, npc_rows):
    """The file's NPC answers into the npc table (apps/web migration 0070), each under its own
    provenance and only over an answer ranked no higher: the extract's `corpus` answers over a
    display read, a client guess or nothing. A moderator's answer is kept, even against the
    file's own moderator answer, which may be older, unless a moderator marked it doubtful. A
    `corpus` row the file no longer carries goes, so the export gives the file back.

    Returns the file's answers that differed from one kept, as (kind, id, kept, file's), each
    answer a (race, gender, flavor, provenance) tuple.
    """
    cur.execute("""create temporary table "npc_import" ("npcKind" text, "npcId" integer,
                     "race" text, "gender" text, "flavor" text, "provenance" text,
                     "doubtful" boolean) on commit drop""")
    _bulk(cur, "npc_import", npc_rows,
          """insert into "npc_import" ("npcKind", "npcId", "race", "gender", "flavor",
                                       "provenance", "doubtful") values %s""")
    cur.execute(
        """delete from "npc" n
            where n."provenance" = 'corpus'
              and not exists (select 1 from "npc_import" i
                               where i."npcKind" = n."npcKind" and i."npcId" = n."npcId")""")
    cur.execute(
        """select i."npcKind", i."npcId", n."race", n."gender", n."flavor", n."provenance",
                  i."race", i."gender", i."flavor", i."provenance"
             from "npc_import" i
             join "npc" n on n."npcKind" = i."npcKind" and n."npcId" = i."npcId"
            where not ({replaces})
              and (n."race", n."gender", n."flavor", n."provenance")
                  is distinct from (i."race", i."gender", i."flavor", i."provenance")
            order by 1, 2""".format(replaces=_REPLACES.format(old="n", new="i")))
    kept = [(r[0], r[1], tuple(r[2:6]), tuple(r[6:10])) for r in cur.fetchall()]
    cur.execute(
        """insert into "npc" as n ("npcKind", "npcId", "race", "gender", "flavor",
                                    "provenance", "confirmed", "doubtful")
            select "npcKind", "npcId", "race", "gender", "flavor", "provenance",
                   "provenance" in ('corpus', 'display', 'moderator') and not "doubtful", "doubtful"
              from "npc_import"
            on conflict ("npcKind", "npcId") do update
              set "race" = excluded."race", "gender" = excluded."gender",
                  "flavor" = excluded."flavor", "provenance" = excluded."provenance",
                  "confirmed" = excluded."confirmed", "doubtful" = excluded."doubtful",
                  "updatedAt" = now()
            where {replaces}
              and (n."race", n."gender", n."flavor", n."provenance")
                  is distinct from (excluded."race", excluded."gender", excluded."flavor",
                                    excluded."provenance")""".format(
            replaces=_REPLACES.format(old="n", new="excluded")))
    return kept


def _bodies_of(corpus: dict) -> list:
    """The file's bodies: schema 6's npcBodies, or schema 5's npcSexes, each a body of its race."""
    if "npcBodies" in corpus:
        return corpus["npcBodies"]
    return [{**row, "weight": None} for row in corpus.get("npcSexes", [])]


def npc_body_answers(npc_bodies, npcs) -> list:
    """The file's split NPCs as npc_body rows, (kind, id, race, sex, weight, flavor, provenance,
    doubtful). A moderator's answer for the NPC becomes the answer of its own body, so splitting
    never takes back a voice someone chose."""
    chosen = {(npc["npcType"], npc["npcId"]): npc for npc in npcs
              if npc.get("provenance") == "moderator" and npc.get("race")}
    defaults = fallback_flavors(
        [(body_name(npc["race"], npc["gender"]), npc["flavor"]) for npc in retyped(npcs)]
        + [(body_name(row["race"], row["gender"]), row["flavor"]) for row in npc_bodies])
    rows = []
    for row in npc_bodies:
        npc = chosen.get((row["npcType"], row["npcId"]))
        weight = row.get("weight")
        if (row.get("provenance", "corpus") == "corpus" and npc and npc.get("gender") == row["gender"]
                and npc["race"] == row["race"]):
            rows.append((row["npcType"], row["npcId"], row["race"], row["sex"], weight, npc["flavor"],
                         "moderator", bool(npc.get("doubtful"))))
            continue
        rows.append((row["npcType"], row["npcId"], row["race"], row["sex"], weight,
                     *_with_default(row, defaults)))
    return rows


def split_bodies(alias: str) -> str:
    """Whether npc_body row `alias` has a sibling. An NPC is split by two or more npc_body rows;
    one alone (a moderator's body an import kept) splits nothing, so it is left out of
    everything a split NPC is built from."""
    return f"""exists (select 1 from "npc_body" o
                        where o."npcKind" = {alias}."npcKind" and o."npcId" = {alias}."npcId"
                          and (o."race", o."sex") is distinct from ({alias}."race", {alias}."sex"))"""


def _import_npc_bodies(cur, rows):
    """The file's split NPCs into npc_body. An answer lands over one ranked no higher, a
    moderator's stays unless marked doubtful, and a `corpus` body the file no longer carries goes,
    as does a `corpus` body left alone under its id (one body is no split).
    A body of an NPC with no npc row is skipped."""
    cur.execute("""create temporary table "npc_body_import" ("npcKind" text, "npcId" integer,
                     "race" text, "sex" smallint, "weight" real, "flavor" text, "provenance" text,
                     "doubtful" boolean) on commit drop""")
    if rows:
        _bulk(cur, "npc_body_import", rows,
              """insert into "npc_body_import" ("npcKind", "npcId", "race", "sex", "weight",
                                                "flavor", "provenance", "doubtful") values %s""")
    cur.execute(
        """delete from "npc_body" x
            where x."provenance" = 'corpus'
              and not exists (select 1 from "npc_body_import" i
                               where i."npcKind" = x."npcKind" and i."npcId" = x."npcId"
                                 and i."race" = x."race" and i."sex" = x."sex")""")
    cur.execute(
        """insert into "npc_body" as x ("npcKind", "npcId", "race", "sex", "weight", "flavor",
                                         "provenance", "confirmed", "doubtful")
            select i."npcKind", i."npcId", i."race", i."sex", i."weight", i."flavor", i."provenance",
                   i."provenance" in ('corpus', 'display', 'moderator') and not i."doubtful",
                   i."doubtful"
              from "npc_body_import" i
              join "npc" n on n."npcKind" = i."npcKind" and n."npcId" = i."npcId"
            on conflict ("npcKind", "npcId", "race", "sex") do update
              set "weight" = coalesce(excluded."weight", x."weight"), "flavor" = excluded."flavor",
                  "provenance" = excluded."provenance", "confirmed" = excluded."confirmed",
                  "doubtful" = excluded."doubtful", "updatedAt" = now()
            where {replaces}
              and (x."weight", x."flavor", x."provenance", x."doubtful")
                  is distinct from (coalesce(excluded."weight", x."weight"), excluded."flavor",
                                    excluded."provenance", excluded."doubtful")""".format(
            replaces=_REPLACES.format(old="x", new="excluded")))
    cur.execute("""delete from "npc_body" x where x."provenance" = 'corpus' and not """
                + split_bodies("x"))



def export_npc_bodies(cur) -> list:
    """npc_body as the file's npcBodies, for the NPCs it splits."""
    cur.execute(
        """select "npcKind", "npcId", "race", "sex", "gender", "weight",
                  case when "provenance" = 'corpus' and "doubtful" then null else "flavor" end,
                  "provenance", voice_for("race", "gender", "flavor") from "npc_body" b
            where """ + split_bodies("b") + """
            order by "npcKind", "npcId", "sex", "weight" desc nulls last, "updatedAt", "race" """
    )
    return [{"npcType": kind, "npcId": npc_id, "race": race, "sex": sex, "gender": gender,
             "weight": weight, "flavor": flavor, "provenance": provenance, "voice": voice}
            for kind, npc_id, race, sex, gender, weight, flavor, provenance, voice in cur.fetchall()]


def import_npc_bodies(display_rows, verbose=True) -> list:
    """The world database's split NPCs into a filled database's npc_body, without a whole
    extract. Returns the rows written."""
    from tts_cli.npc_bodies import npc_bodies

    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""select "npcKind", "npcId", "race", "gender", "flavor", "provenance",
                                  "doubtful"
                             from "npc" where "npcKind" = 'creature' order by "npcId" """)
            npcs = [{"npcType": kind, "npcId": npc_id, "race": race, "gender": gender,
                     "flavor": flavor, "provenance": provenance, "doubtful": doubtful}
                    for kind, npc_id, race, gender, flavor, provenance, doubtful in cur.fetchall()]
            rows = npc_body_answers(npc_bodies(display_rows, npcs), npcs)
            _import_npc_bodies(cur, rows)
    finally:
        conn.close()
    if verbose:
        print(f"{len({(row[0], row[1]) for row in rows})} NPCs split by body, {len(rows)} bodies")
    return rows


class DatabaseNotEmpty(Exception):
    """import-corpus was pointed at a database that already holds the corpus."""


def import_corpus(path, verbose=True, force=False):
    """corpus.json.gz -> Postgres, ONCE: to seed an empty database (CI's, a new local one) from
    the committed export.

    Dangerous anywhere else. The file is only an export, so it lags the database: importing it
    into a live one puts back the file's older text over newer extracted lines and replaces
    every speaker the dump gave with the file's list. A filled database takes new dump text
    through extract instead.
    `force` is for rebuilding a database deliberately, never for keeping one up to date.
    """
    if not force:
        conn = connect()
        try:
            with conn, conn.cursor() as cur:
                cur.execute("""select exists (select 1 from "quest_line")""")
                filled = cur.fetchone()[0]
        finally:
            conn.close()
        if filled:
            raise DatabaseNotEmpty(
                "quest_line already holds the corpus. import-corpus only seeds an empty "
                "database; take a new dump in with extract. --force overwrites it anyway.")
    return import_corpus_data(load_corpus(path), verbose)


def import_corpus_data(corpus, verbose=True):
    """A corpus -> quest_line, quest_line_speaker, quest_spawn: the committed export, or a
    fresh extract of the world database.

    Rerunnable by construction, and the rule for a line that already exists is the one
    pipelines/readables/tools/lib/promote.mjs states: unchanged text is skipped, changed text
    is promoted UNLESS somebody has edited it here, in which case the extract's version is
    recorded but not promoted. An import that could overwrite a correction is an import
    nobody dares run, and an import nobody runs means the corpus stops tracking the dump.

    Speakers and spawns are replaced wholesale rather than promoted: who speaks a line and
    where they stand are facts about the dump, not versions of anything, and 0026 makes the
    same argument for a book page's structure.
    """
    marked = corpus["schemaVersion"] >= CONTRIBUTIONS_MARKED

    counts = Counter()
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""select "id" from "contribution" """)
            known_contributions = {r[0] for r in cur.fetchall()}
            cur.execute(
                """select "lineId", "npcType", "npcId", "npcName", "race", "gender", "flavor",
                          "voice"
                     from "quest_line_speaker"
                    where "lang" = %s and "contributionId" is not null""",
                (LANG,),
            )
            contributed_speakers = {tuple(r) for r in cur.fetchall()}
            cur.execute(
                """select "lineId", "npcType", "npcId" from "quest_line_speaker"
                    where "lang" = %s and "addedBy" is not null""",
                (LANG,),
            )
            added_speakers = {tuple(r) for r in cur.fetchall()}
            # Only rows this database lacks: a fresh extract carries none, and a removal is
            # taken back by adding the speaker again, never by an import.
            if corpus.get("removedSpeakers"):
                _bulk(cur, "quest_line_speaker_removed", [
                          (r["moment"], r["npcType"], r["npcId"], r["removedBy"])
                          for r in corpus["removedSpeakers"]],
                      """insert into "quest_line_speaker_removed"
                           ("moment", "npcType", "npcId", "removedBy")
                         values %s on conflict do nothing""")
            cur.execute("""select "moment", "npcType", "npcId" from "quest_line_speaker_removed" """)
            removed_speakers = {tuple(r) for r in cur.fetchall()}
            lines, contributed = split_contributed(
                corpus["lines"], corpus["schemaVersion"], known_contributions,
                contributed_speakers, added_speakers,
            )
            answers = answered_models(cur, lines)
            answered = sum(1 for row in lines
                           if is_model_voice(row["voice"]) and (row["npcType"], row["npcId"]) in answers)
            lines = with_answered_voices(lines, answers)
            variants = _variants(lines)

            # The extract's own timestamp, kept so the export can reproduce it. Without it
            # every export would differ from the file it replaced in exactly one field.
            cur.execute(
                """insert into "quest_corpus_meta" ("id", "schemaVersion", "generatedAt")
                   values (true, %s, %s)
                   on conflict ("id") do update set
                     "schemaVersion" = excluded."schemaVersion",
                     "generatedAt" = excluded."generatedAt" """,
                (corpus["schemaVersion"], corpus["generatedAt"]),
            )

            # Everything the decisions need, in two reads. The import used to ask per line --
            # its live version, then its highest number -- which is three round trips for each
            # of fourteen thousand lines: seconds against a local database, and over an ssh
            # tunnel to production, most of an hour. Now it reads once, decides in memory and
            # writes in bulk, so its time no longer depends on the distance to the database.
            _progress("reading what quest_line holds")
            cur.execute(
                """select "lineId", "variant", "origin", "text", "originalText"
                     from "quest_line" where "lang" = %s and "isCurrent" """,
                (LANG,),
            )
            live = {(r[0], r[1]): r[2:] for r in cur.fetchall()}
            cur.execute(
                """select "lineId", "variant", max("version") from "quest_line"
                    where "lang" = %s group by 1, 2""",
                (LANG,),
            )
            highest = {(r[0], r[1]): r[2] for r in cur.fetchall()}

            unchanged, retire, inserts = [], [], []
            split = split_here(variants, live)
            for line_id, payloads in variants.items():
                for variant, payload in enumerate(payloads):
                    row = dict(zip(LINE_FIELDS, payload))
                    current = live.get((line_id, variant))

                    if (line_id, variant) in split:
                        # Not recorded either: with no current version to compare against,
                        # every import would add the same text again.
                        counts["split"] += 1
                        continue
                    if current is None:
                        action = "promote"
                    elif current[1] == row["text"] and current[2] == row["originalText"]:
                        action = "skip"
                    else:
                        action = "record" if current[0] == "edited" else "promote"
                    counts[action] += 1

                    structure = (
                        row["source"], row["questId"], row["questTitle"],
                        row["playerGender"], row["fileName"], row["generatable"],
                        row["skipReason"],
                    )
                    if action == "skip":
                        # The structural fields still move: an edit changes what is said,
                        # never which quest it belongs to or what file it is written to.
                        unchanged.append((line_id, variant) + structure)
                        continue
                    if action == "promote" and current is not None:
                        retire.append((line_id, variant))
                    inserts.append(
                        (line_id, variant, LANG, highest.get((line_id, variant), 0) + 1,
                         action == "promote", row["source"], row["questId"],
                         row["questTitle"], row["playerGender"], row["fileName"],
                         row["text"], row["originalText"], row["generatable"],
                         row["skipReason"])
                    )

            _bulk(cur, "quest_line: structure of unchanged lines", unchanged,
                  """update "quest_line" q
                        set "source" = v.source, "questId" = v.qid, "questTitle" = v.title,
                            "playerGender" = v.gender, "fileName" = v.file,
                            "generatable" = v.gen, "skipReason" = v.skip
                       from (values %s)
                         as v(lid, var, source, qid, title, gender, file, gen, skip)
                      where q."lineId" = v.lid and q."variant" = v.var
                        and q."lang" = '""" + LANG + """' and q."isCurrent" """,
                  "(%s, %s::smallint, %s, %s::integer, %s, %s, %s, %s::boolean, %s)")
            # Before the inserts: the new live version would otherwise collide with the old
            # one on quest_line_current_idx.
            _bulk(cur, "quest_line: retired versions", retire,
                  """update "quest_line" q set "isCurrent" = false
                       from (values %s) as v(lid, var)
                      where q."lineId" = v.lid and q."variant" = v.var
                        and q."lang" = '""" + LANG + """' and q."isCurrent" """,
                  "(%s, %s::smallint)")
            _bulk(cur, "quest_line: new versions", inserts,
                  """insert into "quest_line"
                       ("lineId", "variant", "lang", "version", "isCurrent", "origin",
                        "source", "questId", "questTitle", "playerGender", "fileName",
                        "text", "originalText", "generatable", "skipReason")
                     values %s""",
                  "(%s, %s, %s, %s, %s, 'extracted', %s, %s, %s, %s, %s, %s, %s, %s, %s)")

            # Speakers, wholesale. `ord` is the row's place in the corpus's own list, which
            # is what lets the export reproduce the file rather than a reordering of it.
            #
            # Except a player's: a speaker row with a contributionId was written when a
            # moderator accepted a contribution (apps/web migration 0034), is not the
            # extract's, and would otherwise vanish -- line and all -- on the next import.
            # Those rows take an `ord` from 1,000,000 up, so the extract's 0..n never meets them.
            # Until the dump has the same NPC on the same line: then the dump is the source of
            # truth, and the contribution has done its job (below). The same goes for a speaker
            # an admin added by hand (migration 0076), marked by its "addedBy".
            cur.execute(
                """delete from "quest_line_speaker"
                    where "lang" = %s and "contributionId" is null and "addedBy" is null""",
                (LANG,),
            )
            # A line split here is spoken by the dump's speakers on both of its sides. The
            # sides' `ord`s follow the dump's own, which are only ever as many as its rows.
            # A row added by hand keeps the line it was added to, split side or not.
            # A speaker an admin removed (migration 0077) is left out here and nowhere earlier:
            # its row may be the only one carrying the line's text into quest_line.
            speaker_rows, added_rows, removed = [], [], 0
            for ord_, row in enumerate(lines):
                variant = variants[row["lineId"]].index(_line_key(row))
                speaker = tuple(row[field] for field in SPEAKER_FIELDS)
                if row.get("addedBy") is not None:
                    added_rows.append((row["lineId"], variant, LANG) + speaker + (row["addedBy"],))
                    continue
                if removed_here(row, removed_speakers):
                    removed += 1
                    continue
                if (row["lineId"], variant) not in split:
                    speaker_rows.append((row["lineId"], variant, LANG, ord_) + speaker)
                    continue
                for side in ("m", "f"):
                    speaker_rows.append(
                        (f'{row["lineId"]}:{side}', variant, LANG, len(lines) + len(speaker_rows))
                        + speaker
                    )
            _bulk(cur, "quest_line_speaker", speaker_rows,
                  """insert into "quest_line_speaker"
                       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName",
                        "race", "gender", "flavor", "voice")
                     values %s""")
            # Only from a file seeding a database that lacks them: clear of the extract's
            # numbering, after every speaker the site already wrote, in the file's order.
            if added_rows:
                cur.execute(
                    """select greatest(coalesce(max("ord") + 1, 0), %s) from "quest_line_speaker"
                        where "lang" = %s""",
                    (ORD_FLOOR, LANG),
                )
                first = cur.fetchone()[0]
                added_rows = [row[:3] + (first + i,) + row[3:] for i, row in enumerate(added_rows)]
                _bulk(cur, "quest_line_speaker: added by hand", added_rows,
                      """insert into "quest_line_speaker"
                           ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName",
                            "race", "gender", "flavor", "voice", "addedBy")
                         values %s""")

            npc_rows = npc_answers(corpus.get("npcs", []))
            kept_npcs = []
            if "npcs" in corpus:
                _import_types(cur, corpus["npcs"])
                kept_npcs = _import_npcs(cur, npc_rows)
                # The site reads an NPC's voice from npc alone (apps/web migration 0071).
                cur.execute("""select "npc_from_speakers"()""")
            body_rows = npc_body_answers(_bodies_of(corpus), corpus.get("npcs", []))
            if "npcBodies" in corpus or "npcSexes" in corpus:
                _import_npc_bodies(cur, body_rows)

            # A contributed speaker only from a marked file: in an older one, the rows that
            # would match are its own round-tripped copies, skipped above or not. A speaker added
            # by hand is marked in every file that carries one, so needs no schema check.
            cur.execute(
                """delete from "quest_line_speaker" c
                    where c."lang" = %s
                      and (c."addedBy" is not null or (%s and c."contributionId" is not null))
                      and exists (
                        select 1 from "quest_line_speaker" e
                         where e."contributionId" is null and e."addedBy" is null
                           and e."lang" = c."lang"
                           and e."lineId" = c."lineId" and e."variant" = c."variant"
                           and e."npcType" = c."npcType" and e."npcId" = c."npcId")
                    returning c."addedBy" is not null""",
                (LANG, bool(marked)),
            )
            overtaken = [row[0] for row in cur.fetchall()]
            superseded_added = sum(overtaken)
            superseded = len(overtaken) - superseded_added

            cur.execute("""delete from "quest_spawn" """)
            spawn_rows = []
            for key, spawns in corpus["spawns"].items():
                npc_type, npc_id = key.split(":")
                for spawn in spawns:
                    spawn_rows.append(
                        (npc_type, int(npc_id), spawn["map"], spawn["x"], spawn["y"])
                    )
            if spawn_rows:
                # No on-conflict clause: nine of these points are listed twice in the dump
                # and both copies are kept, for the reason the duplicate speakers are.
                _bulk(cur, "quest_spawn", spawn_rows,
                      """insert into "quest_spawn" ("npcType", "npcId", "map", "x", "y")
                         values %s""")
            _progress("committing")
        # Until autovacuum gets to the rows just written, a freshly seeded database (CI's, a new
        # local one) plans the translated catalogue's joins blind and builds it ten times slower.
        with conn, conn.cursor() as cur:
            cur.execute("""analyze "quest_line", "quest_line_speaker", "npc", "entity_name",
                                   "quest_spawn" """)
    finally:
        conn.close()

    if verbose:
        collisions = sum(1 for payloads in variants.values() if len(payloads) > 1)
        duplicates = len(lines) - len({
            (row["lineId"], _line_key(row)) + tuple(row[field] for field in SPEAKER_FIELDS)
            for row in lines
        })
        print(
            f"{len(lines)} rows: {counts['promote']} promoted, "
            f"{counts['record']} recorded without promoting (edited here), "
            f"{counts['split']} left out (split by player gender here), "
            f"{counts['skip']} unchanged"
        )
        print(f"{len(speaker_rows)} speakers, {len(npc_rows)} NPCs ({len(body_rows)} bodies of split "
              f"ones), {len(spawn_rows)} spawn points")
        print(f"{answered} model rows spoken in the voice their NPC is already answered with")
        print(f"{len(kept_npcs)} NPC answers kept over a different one in the file"
              + (":" if kept_npcs else ""))
        for kind, npc_id, kept, theirs in kept_npcs:
            print(f"  {kind} {npc_id}: kept {'/'.join(map(str, kept))}, "
                  f"file had {'/'.join(map(str, theirs))}")
        print(
            f"{contributed} contributed rows left as they are, {superseded} contributed "
            f"speakers overtaken by the dump"
            + ("" if marked else " (none: the file predates marking them)")
        )
        print(f"{superseded_added} speakers added by hand overtaken by the dump, "
              f"{removed} of the dump's speakers left out as removed by hand")
        print(
            f"defects carried over unchanged: {collisions} lineIds naming two different "
            f"lines, {duplicates} duplicate rows"
        )
    return counts


def _with_contribution(row, contribution_id, added_by=None):
    """A contributed row carries its contributionId, last, so the import can tell it from the
    dump's, and a speaker an admin added carries its addedBy the same way. The dump's rows have
    no such key, which keeps them as the extract writes them."""
    if contribution_id is not None:
        row["contributionId"] = contribution_id
    if added_by is not None:
        row["addedBy"] = added_by
    return row


def _speaker_rows(cur):
    """Every exported row: a line and one NPC speaking it, in the corpus's row order."""
    # A line's speakers are every language's: English's where it has any, otherwise
    # the ones a language wrote when it accepted the moment first, each NPC once. The
    # web catalogue reads them the same way (catalogue.ts SPEAKERS). Ordered by the
    # corpus's own row order, which is what `ord` records, English's first.
    cur.execute(
        """select s."npcType", s."npcId",
                  -- Another language's row names the NPC as its client did: English's name
                  -- stands in where English has one (catalogue.ts SPEAKER_NAME).
                  case when s."lang" = %(lang)s then s."npcName" else coalesce(
                    (select n."name" from "entity_name" n
                      where n."kind" = s."npcType" and n."entityId" = s."npcId"::text
                        and n."lang" = %(lang)s and n."isCurrent"), s."npcName") end,
                  s."race", s."gender", s."flavor", s."voice", s."contributionId", s."addedBy",
                  l."lineId", l."source", l."questId", l."questTitle",
                  l."playerGender", l."text", l."originalText", l."fileName",
                  l."generatable", l."skipReason"
             from (
               select * from (
                 select s.*,
                        bool_or(s."lang" = %(lang)s)
                          over (partition by s."lineId", s."variant") as "hasEnglish",
                        row_number() over (
                          partition by s."lineId", s."variant", s."npcType", s."npcId",
                                       s."lang" = %(lang)s
                          order by s."ord", s."id") as "nth"
                   from "quest_line_speaker" s
               ) ranked
               where case when "hasEnglish" then "lang" = %(lang)s else "nth" = 1 end
             ) s
             join "quest_line" l
               on l."lineId" = s."lineId" and l."variant" = s."variant"
              and l."lang" = %(lang)s and l."isCurrent"
            order by s."lang" <> %(lang)s, s."ord" """,
        {"lang": LANG},
    )
    return cur.fetchall()


def export_corpus(path, check=False, verbose=True):
    """quest_line + quest_line_speaker + quest_spawn -> corpus.json.gz.

    The only writer of the committed file: a new dump goes into the table (extract), and the
    file follows from it, so the database stays the one source of truth. With `check` it
    compares instead of writing, which is what CI runs: if an import followed by an export
    does not reproduce the file byte for byte, the table is not carrying everything the
    build needs, and that is worth failing a build over.
    """
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """select "schemaVersion", "generatedAt" from "quest_corpus_meta"
                    where "id" """
            )
            meta = cur.fetchone()
            if meta is None:
                raise SystemExit(
                    "quest_line has not been seeded -- run: make quests-import-corpus"
                )

            rows = _speaker_rows(cur)

            cur.execute(
                """select "npcType", "npcId", "map", "x", "y" from "quest_spawn"
                    order by "id" """
            )
            spawn_rows = cur.fetchall()

            # Every NPC answer, in the order build_corpus writes them: a pack is voiced in
            # whatever the site answered, and a pack build reads no database.
            # The import's default for the extract's flavorless NPC is not the file's (npc_answers),
            # but the voice is the one it reads with, default flavor and all: the site's.
            cur.execute(
                """select "npcKind", "npcId", "race", "gender",
                          case when "provenance" = 'corpus' and "doubtful" then null else "flavor" end,
                          "provenance", voice_for("race", "gender", "flavor") from "npc"
                    order by "npcKind", "npcId" """
            )
            npc_rows = cur.fetchall()

            body_rows = export_npc_bodies(cur)

            cur.execute(
                """select "moment", "npcType", "npcId", "removedBy"
                     from "quest_line_speaker_removed" order by 1, 2, 3"""
            )
            removed_rows = cur.fetchall()
    finally:
        conn.close()

    # The key order is the one tts_cli.corpus.build_corpus writes. It is load-bearing here
    # and nowhere else: json.dumps preserves insertion order, and a different order is a
    # different file even when it is the same data.
    lines = [
        _with_contribution({
            "lineId": line_id,
            "source": source,
            "questId": quest_id,
            "questTitle": quest_title,
            "npcId": npc_id,
            "npcName": npc_name,
            "npcType": npc_type,
            "race": race,
            "gender": gender,
            "flavor": flavor,
            "voice": voice,
            "playerGender": player_gender,
            "text": text,
            "originalText": original_text,
            "fileName": file_name,
            "generatable": generatable,
            "skipReason": skip_reason,
        }, contribution_id, added_by)
        for (npc_type, npc_id, npc_name, race, gender, flavor, voice, contribution_id, added_by,
             line_id, source, quest_id, quest_title, player_gender, text, original_text,
             file_name, generatable, skip_reason) in rows
    ]

    spawns = {}
    for npc_type, npc_id, map_id, x, y in spawn_rows:
        spawns.setdefault(f"{npc_type}:{npc_id}", []).append(
            {"map": map_id, "x": x, "y": y}
        )

    # This code's schema rather than the one the last import recorded: what the export writes
    # is defined here, and a file that marks its contributions must say that it does.
    corpus = {
        "schemaVersion": SCHEMA_VERSION,
        # Postgres is the corpus; this file is its export and nothing else writes it.
        "producedBy": "export-corpus",
        "generatedAt": meta[1],
        "lineCount": len(lines),
        "lines": lines,
        "spawns": spawns,
        "npcs": [
            {"npcType": kind, "npcId": npc_id, "race": race, "gender": gender, "flavor": flavor,
             "provenance": provenance, "voice": voice}
            for kind, npc_id, race, gender, flavor, provenance, voice in npc_rows
        ],
        "npcBodies": body_rows,
    }
    # Only once there is one, so the files exported before the table existed stay identical.
    if removed_rows:
        corpus["removedSpeakers"] = [
            {"moment": moment, "npcType": kind, "npcId": npc_id, "removedBy": by}
            for moment, kind, npc_id, by in removed_rows
        ]

    if check:
        existing = load_corpus(path)
        same = json.dumps(existing, sort_keys=False) == json.dumps(corpus, sort_keys=False)
        if verbose:
            print("identical" if same else "DIFFERENT from the committed corpus")
        return same

    write_corpus(path, corpus)
    if verbose:
        print(f"wrote {path}: {len(lines)} lines, {len(spawns)} spawn keys")
    return True


def export_ignores(path, check=False, verbose=True):
    """line_ignore -> corpus/ignored.json.

    The same shape deploy/web/sql/export_ignores.sql produced, and the reason that file and
    a `require-droplet` Makefile target can go: the ignore list used to be exported over ssh
    from the droplet, because the droplet's database was the only one that had it. The
    corpus lives in Postgres now and `make quests-sync` brings the rows home, so this is a
    local read like every other export here.

    Sorted by lineId and carrying no author: the file is read by the Python CLI and by
    rsync, which want a stable diff and have no use for an account. Provenance stays in the
    table, which is the authority.

    `exportedAt` moves on every run by design -- unlike the corpus, nothing compares this
    file byte for byte, and the timestamp is what tells you how old a committed list is.
    """
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            # The English pack's list: ignored everywhere, or in English. Another language's
            # decision is its own and does not reach this pack. A line ignored at both levels
            # is listed once, with the global reason.
            cur.execute(
                """select distinct on ("lineId") "lineId", "reason" from "line_ignore"
                    where "lang" is null or "lang" = 'enUS'
                    order by "lineId", "lang" nulls first"""
            )
            ignored = [{"lineId": line_id, "reason": reason} for line_id, reason in cur.fetchall()]
    finally:
        conn.close()

    if check:
        existing = json.load(open(path)) if os.path.isfile(path) else {"ignored": []}
        same = existing.get("ignored") == ignored
        if verbose:
            print("identical" if same else "DIFFERENT from the committed list")
        return same

    # Key order and indentation match what jsonb_pretty produced, so replacing the SQL
    # export with this one does not rewrite the committed file from top to bottom for no
    # reason. The diff of a real change stays readable, which is the point of committing it.
    document = {
        "ignored": ignored,
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as out:
        json.dump(document, out, ensure_ascii=False, indent=4)
        out.write("\n")

    if verbose:
        print(f"wrote {path}: {len(ignored)} ignored lines")
    return True


def export_locale_text(lang, path, verbose=True):
    """One language's gossip text as its client shows it -> `path` (tts_cli/locale_text.py).

    `localeText` is the line as the world database has it, which is what that language's
    client puts on screen and so what the addon matches. It is taken from the newest version
    that has one rather than the live row: a translator's correction changes what is voiced,
    not what the client shows. It is paired with the English original text, which is what the
    corpus knows the line by. A line with no localeText (written on the site, not imported)
    is left out: there is nothing to match it on.

    Both of a gendered line's variants are kept. They read differently on screen and name
    the same file, to which the addon adds the player's gender itself.
    """
    from tts_cli.locale_text import write_locale_text

    if lang == LANG:
        raise SystemExit("English is the corpus itself -- export-corpus writes it")
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """select distinct on ("lineId", "variant")
                          "lineId", "originalText", "localeText"
                     from "quest_line"
                    where "lang" = %s and "source" = 'gossip'
                      and coalesce("localeText", '') <> ''
                    order by "lineId", "variant", "version" desc""",
                (lang,),
            )
            lines = [{"lineId": line_id, "originalText": original, "localeText": text}
                     for line_id, original, text in cur.fetchall()]
    finally:
        conn.close()

    write_locale_text(path, lang, lines)
    if verbose:
        print(f"wrote {path}: {len(lines)} {lang} gossip lines with client text")
    return lines


def export_giver_names(corpus_path, out_dir, verbose=True):
    """Every other language's quest-giver names -> one addon Lua file per language.

    See tts_cli/giver_names.py. The name is the newest *extracted* version rather than the
    live one, for the reason export_locale_text takes localeText: a translator's edit changes
    how a name is spoken, and what the addon shows must be what the client shows.
    """
    from tts_cli.giver_names import KINDS, givers, write_every_language
    from tts_cli.ignores import load_pack_ignored

    corpus = load_corpus(corpus_path)
    found = givers(corpus, load_pack_ignored(corpus))
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """select distinct on ("lang", "kind", "entityId")
                          "lang", "kind", "entityId", "name"
                     from "entity_name"
                    where "lang" <> %s and "origin" = 'extracted'
                      and "kind" = any(%s)
                    order by "lang", "kind", "entityId", "version" desc""",
                (LANG, list(KINDS)),
            )
            by_lang = {}
            for lang, kind, entity_id, name in cur.fetchall():
                by_lang.setdefault(lang, {})[(kind, entity_id)] = name
    finally:
        conn.close()

    written, removed, checked = write_every_language(out_dir, found, by_lang)
    if verbose:
        for path, table in written:
            print(f"wrote {path}: {sum(len(t) for t in table.values())} of {len(found)} givers")
        for path in removed:
            print(f"removed {path}: no names in that language any more")
        if not checked:
            print(f"no Spoken_Quests.toc above {out_dir}: Forever's names lines were not checked")


def _client_texts(cur, sources, locales):
    """(english, translations, natives) of the current lines of `sources`, as
    gossip_text.gossip_text_tables takes them: English's template by lineId; each locale's
    newest translation with localeText, as (lineId, the English it translates, its text); and
    each locale's own text by lineId, for a line English lacks."""
    cur.execute(
        """select "lineId", "originalText" from "quest_line"
            where "isCurrent" and "source" = any(%s) and "lang" = %s""", (list(sources), LANG))
    english = dict(cur.fetchall())

    cur.execute(
        """select distinct on ("lineId", "variant", "lang")
                  "lang", "lineId", "originalText", "localeText"
             from "quest_line"
            where "lang" = any(%s) and "source" = any(%s)
              and coalesce("localeText", '') <> ''
            order by "lineId", "variant", "lang", "version" desc""",
        (list(locales), list(sources)))
    translations = {}
    for lang, line_id, original, text in cur.fetchall():
        translations.setdefault(lang, []).append((line_id, original, text))

    cur.execute(
        """select "lang", "lineId", "originalText" from "quest_line"
            where "isCurrent" and "source" = any(%s) and "lang" = any(%s)""",
        (list(sources), list(locales)))
    natives = {}
    for lang, line_id, text in cur.fetchall():
        natives.setdefault(lang, {})[line_id] = text
    return english, translations, natives


def export_gossip_text(out_dir, aliases_path, verbose=True):
    """Every client locale's gossip text, and the moments' aliases -> the addon's Gossip/.

    See tts_cli/gossip_text.py. A translation is the newest one with localeText, for
    export_locale_text's reason, and is kept only while it translates the current English.
    """
    from tts_cli.gossip_text import (CLIENT_LOCALES, gossip_aliases, gossip_text_tables,
                                     quest_wording_tables, write_aliases_json, write_gossip_text)
    from tts_cli.ignores import ignored_line_ids

    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """select distinct l."lineId", s."npcType", s."npcId", s."race", s."gender",
                          s."flavor"
                     from "quest_line" l
                     join "quest_line_speaker" s using ("lineId", "variant", "lang")
                    where l."isCurrent" and l."source" = 'gossip'""")
            speakers = {}
            for line_id, *speaker in cur.fetchall():
                speakers.setdefault(line_id, []).append(tuple(speaker))

            # A split NPC shows each sex its own form of a BroadcastText row.
            cur.execute("""select distinct "npcKind", "npcId", "gender" from "npc_body" b
                            where """ + split_bodies("b") + """ order by 1, 2, 3""")
            sexes = {}
            for kind, npc_id, gender in cur.fetchall():
                sexes.setdefault((kind, npc_id), []).append(gender)

            english, translations, natives = _client_texts(cur, ("gossip",), CLIENT_LOCALES)

            cur.execute("""select "lineId", "broadcastTextId" from "gossip_broadcast"
                            order by 1, 2""")
            broadcast_ids = {}
            for line_id, broadcast_id in cur.fetchall():
                broadcast_ids.setdefault(line_id, []).append(broadcast_id)

            cur.execute(
                """select b."lang", b."broadcastTextId", b."text", b."text1"
                     from "broadcast_text" b
                    where b."lang" = any(%s)
                      and b."broadcastTextId" in (select "broadcastTextId" from "gossip_broadcast")""",
                (list(CLIENT_LOCALES),))
            broadcast_texts = {}
            for lang, broadcast_id, text, text1 in cur.fetchall():
                broadcast_texts.setdefault(lang, {})[broadcast_id] = (text, text1)

            cur.execute("""select "lineId", "mergedInto" from "gossip_merge" order by 1""")
            merges = cur.fetchall()

            # Quest text in every client locale, for the moments shown in more than one wording.
            quest_english, quest_translations, quest_natives = _client_texts(
                cur, ("accept", "complete"), CLIENT_LOCALES)
    finally:
        conn.close()

    ignored = ignored_line_ids()
    shown = {line_id: rows + [(kind, npc_id, race, other, flavor)
                              for kind, npc_id, race, gender, flavor in rows
                              for other in sexes.get((kind, npc_id), ()) if other != gender]
             for line_id, rows in speakers.items()}
    tables = gossip_text_tables(shown, english, translations, natives, broadcast_ids,
                                broadcast_texts, ignored)
    aliases = gossip_aliases(speakers, broadcast_ids, ignored, merges)
    wordings = quest_wording_tables(quest_english, quest_translations, quest_natives, ignored)
    write_gossip_text(out_dir, tables, aliases, wordings)
    write_aliases_json(aliases_path, aliases)
    if verbose:
        for lang in CLIENT_LOCALES:
            count = sum(len(texts) for kind in tables[lang].values() for texts in kind.values())
            print(f"wrote {lang}.lua: {count} texts, "
                  f"{len(wordings[lang])} quest moments in several wordings")
        print(f"wrote Aliases.lua: {len(aliases)} stems with aliases")

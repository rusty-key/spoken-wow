"""Forever's mission export: a translation's CSV, matched onto the corpus.

No client runs in Vietnamese, so neither the world database nor a player's client has any
Vietnamese to give. It comes as Forever's translation export
(forever-mission-<lang>-<stamp>.csv), which tools/import_forever_csv.py reads and writes as
'community' rows the site then edits like any other translation.

ONE ROW IS ONE PARAGRAPH of one field of one quest: `resource_id` is the quest id, `segment`
the field, `line_nb` the paragraph. The English beside each translation is the text the
Forever client showed, which is not the corpus's template:

  * $B$B is a paragraph break, and runs of spaces are one;
  * $N, $C and $R are <name>, <class> and <race>, and $Gmale:female; is <male/female>;
  * the class and race names some lines spell out are <class> and <race> too, the way
    QuestIT folds them (tts_cli/questit.py), so they compare as tokens on both sides;
  * a progress text ends with the items the quest asks for, "Thunder Ale (1)", appended to
    its last paragraph.

HOW A TRANSLATION FINDS ITS LINE. By quest id and field, and only where that English, put in
the shape above, is our `originalText` in the same shape. A quest Forever rewrote, or a line
where it resolved $G to one gender (its English says "boy" where ours says $Gboy:girl;), is
left out: the Vietnamese beside it was translated from the one form, and would say it to
every reader.

WHAT IS LEFT OUT. OBJECTIVE and SUBOBJECTIVE (not voiced here), and a field whose
translation is its English, which nobody translated.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

# Forever segment -> quest_line source.
SEGMENTS = {"DESCRIPTION": "accept", "PROGRESS": "progress", "COMPLETION": "complete"}

# QuestIT's Names_en.lua: the classes and races Forever's client can show, longest first.
CLASSES = ["Paladin", "Warlock", "Warrior", "Hunter", "Priest", "Shaman", "Druid", "Rogue", "Mage"]
RACES = ["High Order Skyborne", "Windshaper Skyborne", "Night Elf", "Skyborne", "Tauren", "Undead",
         "Dwarf", "Gnome", "Human", "Troll", "Orc"]


def _word(name: str) -> re.Pattern:
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.I)


_FOLDS = [(_word(n), "<class>") for n in CLASSES] + [(_word(n), "<race>") for n in RACES]
_GENDER = re.compile(r"\$[Gg]\s*([^:;]*?)\s*:\s*([^:;]*?)\s*;")
_PLAYER = re.compile(r"\$([NnCcRr])")
_TOKENS = {"n": "<name>", "c": "<class>", "r": "<race>"}
_BREAKS = re.compile(r"(?:\$[Bb])+")
_SHOWN_GENDER = re.compile(r"<([^<>/]+)/([^<>/]+)>")
_SHOWN_PLAYER = re.compile(r"<(name|class|race)>", re.I)
_COUNT = re.compile(r"\(\d+\)")
# What ends the sentence before a progress text's item list: the list starts after it.
_SENTENCE_END = re.compile(r"(?:[.!?…:]+[\"'”’»)]*\s+|\n)")
_ITEMS = re.compile(r"^(?: [^()]+? \(\d+\))+$")


def load(path: str | Path) -> dict:
    """An export -> {language, stamp, quests: {questId: {segment: [(english, translation)]}}}.

    Each field's paragraphs are in `line_nb` order. `stamp` is the export's own, from its
    file name, so a later export's rows are told from this one's.
    """
    path = Path(path).expanduser()
    quests: dict = defaultdict(lambda: defaultdict(list))
    languages = set()
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            languages.add(row["language"])
            quests[row["resource_id"]][row["segment"]].append(
                (int(row["line_nb"]), row["source_text_en_read_only"], row["translation_text_fill_here"]))
    if len(languages) != 1:
        raise SystemExit(f"{path.name}: expected one language, found {sorted(languages) or 'none'}")
    for fields in quests.values():
        for segment, rows in fields.items():
            fields[segment] = [(en, tr) for _, en, tr in sorted(rows)]
    stamp = re.search(r"(\d{8}-\d{6})", path.name)
    return {"language": languages.pop(), "stamp": stamp.group(1) if stamp else path.stem,
            "quests": {k: dict(v) for k, v in quests.items()}}


def shown(template: str) -> str:
    """Our English template as Forever's client shows it, one paragraph a line."""
    text = _GENDER.sub(r"<\1/\2>", template)
    text = _PLAYER.sub(lambda m: _TOKENS[m.group(1).lower()], text)
    text = _BREAKS.sub("\n", text)
    return "\n".join(re.sub(r"\s+", " ", p).strip() for p in text.split("\n") if p.strip())


def _key(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    for pattern, token in _FOLDS:
        text = pattern.sub(token, text)
    return text.lower()


def strip_items(paragraphs: list[str], count: int) -> list[str] | None:
    """The paragraphs without the `count` items a progress text ends with, or None where they
    cannot be told from the text: no sentence before them, or fewer counts than asked."""
    text = "\n".join(paragraphs)
    counts = list(_COUNT.finditer(text))
    if len(counts) < count:
        return None
    first = counts[-count].start()
    ends = [m.end() for m in _SENTENCE_END.finditer(text, 0, first)]
    if not ends:
        return None
    kept = text[:ends[-1]].rstrip()
    return [p for p in kept.split("\n") if p.strip()] or None


def _without_items(ours: str, english: list[str], translation: list[str]) -> list[str] | None:
    """A progress text's translation without its item list, where the English is ours plus
    one: the same cut has to give our English back, or the translation's cut is a guess."""
    theirs = _key(" ".join(english))
    if not theirs.startswith(ours) or not _ITEMS.match(theirs[len(ours):]):
        return None
    count = len(_COUNT.findall(theirs[len(ours):]))
    cut = strip_items(english, count)
    if cut is None or _key(" ".join(cut)) != ours:
        return None
    return strip_items(translation, count)


def template(paragraphs: list[str], english_template: str) -> str:
    """A translation's paragraphs as quest_line stores text: $B$B between them, and the
    player's tokens as tokens. <male/female> is $G only where our English branches there;
    elsewhere a slash in angle brackets is the translator's own."""
    text = "$B$B".join(p.strip() for p in paragraphs)
    text = _SHOWN_PLAYER.sub(lambda m: "$" + m.group(1)[0].upper(), text)
    if _GENDER.search(english_template):
        text = _SHOWN_GENDER.sub(lambda m: f"$G{m.group(1).strip()}:{m.group(2).strip()};", text)
    return text


def match_quest_line(entry: dict | None, source: str, original: str) -> tuple[str | None, str]:
    """(translation, outcome) for one English quest line.

    outcome is 'matched', 'untranslated' (the export has no such field, or its translation
    is the English) or 'changed' (it has one, of English this corpus does not have).
    """
    segment = next((s for s, src in SEGMENTS.items() if src == source), None)
    rows = (entry or {}).get(segment) if segment else None
    if not rows:
        return None, "untranslated"
    english = [en for en, _ in rows]
    translation = [tr for _, tr in rows]
    if not any(tr.strip() for tr in translation) or translation == english:
        return None, "untranslated"
    ours = _key(shown(original))
    if _key(" ".join(english)) != ours:
        if source != "progress":
            return None, "changed"
        translation = _without_items(ours, english, translation)
        if translation is None:
            return None, "changed"
    return template(translation, original), "matched"


def match_title(entry: dict | None, english: str) -> str | None:
    """The translated title, where the export's English title is ours."""
    rows = (entry or {}).get("TITLE")
    if not rows:
        return None
    en, tr = rows[0]
    if _key(en) != _key(english) or not tr.strip() or tr == en:
        return None
    return tr.strip()

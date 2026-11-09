"""The client's localized quest wording for Azeroth's Compendium.

The website corpus is authoritative here.  The database exporter writes a small per-language
snapshot, and the sound-pack builder turns that snapshot into a client-locale guarded Lua table.
"""
import sys
from pathlib import Path

from tts_cli.corpus import load_corpus, write_corpus
from tts_cli.factions import DEFAULT_COMPENDIUM_PATH, compendium_sides
from tts_cli.naming import moment_of, split_voice
from tts_cli.quest_text import (AMOUNT, MOMENTS, PROGRESS, SOURCES, fill_amounts,
                                objective_amounts, select_moments)


def compendium_ids(path=DEFAULT_COMPENDIUM_PATH) -> set[int]:
    """Quest ids present in the generated Compendium index."""
    sides = compendium_sides(str(path))
    if not sides:
        raise ValueError(f"{path}: could not find the Compendium quests table")
    return set(sides)


def clean(text: str | None) -> str | None:
    # Stripped before the line breaks become $B, which strip() would not take off the ends.
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text.replace("\n", "$B").replace("$b", "$B") or None


def needs_amounts(rows: list[dict]) -> bool:
    """Whether any row has a `$<n>oa` token, so the objective amounts are worth loading."""
    return any(AMOUNT.search(row.get("localeText") or "") for row in rows)


def forever_amounts() -> dict:
    """Each quest's objective amounts in Forever's client data."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    from export_compendium import eg_datasets
    return objective_amounts(eg_datasets("quests.enUS"))


def localized_quest_text(rows: list[dict], names: dict[int, str], quest_ids: set[int],
                         corpus: dict, ignored=(), amounts=None) -> dict:
    """Select the Compendium's localized title, accept and complete text.

    Accept and complete are the page's moments. Progress is used as accept only for a quest
    whose English has neither: where the English has an offer, a translated progress line is
    not one. Ignored lines are left out and `$<n>oa` is written in, since no client fills it. A
    title identical to the English is left out, so the client's own title answers for it.
    """
    with_moments, english_titles = set(), {}
    for line in corpus["lines"]:
        quest_id = line.get("questId")
        if not quest_id or line.get("source") not in SOURCES:
            continue
        english_titles.setdefault(quest_id, set()).add(line.get("questTitle"))
        if line["source"] in MOMENTS and line.get("originalText") \
                and split_voice(line["lineId"])[0] not in ignored:
            with_moments.add(quest_id)

    texts: dict[int, dict[str, list[str]]] = {}
    for row in rows:
        quest_id = int(row["questId"])
        source = row["source"]
        # A language's own $G can split a line English has as one, so its ids carry :m and :f.
        line_id = split_voice(row["lineId"])[0]
        if quest_id not in quest_ids or source not in SOURCES \
                or line_id in ignored or moment_of(line_id) in ignored \
                or (source == PROGRESS and quest_id in with_moments):
            continue
        text = clean(row.get("localeText"))
        if text:
            text = fill_amounts(text, (amounts or {}).get(quest_id))
            texts.setdefault(quest_id, {}).setdefault(source, []).append(text)

    out = {}
    for quest_id in (set(texts) | set(names)) & quest_ids:
        chosen = select_moments(texts.get(quest_id, {}))
        title = names.get(quest_id)
        if title and title not in english_titles.get(quest_id, ()):
            chosen["title"] = title
        if chosen:
            out[quest_id] = chosen
    return out


def write_compendium_text(path: str, lang: str, quests: dict) -> None:
    write_corpus(path, {"lang": lang,
                        "quests": {str(key): value for key, value in sorted(quests.items())}})


def load_compendium_text(path: str) -> tuple[str, dict]:
    document = load_corpus(path)
    return document["lang"], {int(key): value for key, value in document["quests"].items()}

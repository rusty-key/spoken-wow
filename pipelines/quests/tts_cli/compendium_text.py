"""The client's localized quest wording for Azeroth's Compendium.

The website corpus is authoritative here.  The database exporter writes a small per-language
snapshot, and the sound-pack builder turns that snapshot into a client-locale guarded Lua table.
"""
import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

from tts_cli.naming import split_voice
from tts_cli.quest_text import AMOUNT, MOMENTS, PROGRESS, fill_amounts, objective_amounts

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_COMPENDIUM_PATH = ROOT / "addons" / "Spoken_Quests" / "Data" / "Compendium.lua"
SOURCES = MOMENTS + (PROGRESS,)


def compendium_ids(path=DEFAULT_COMPENDIUM_PATH) -> set[int]:
    """Quest ids present in the generated Compendium index."""
    text = Path(path).read_text(encoding="utf-8")
    quests = re.search(r"^\tquests = \{\n(?P<body>.*?)^\t\},\n(?:\n)?\tsorts = \{", text,
                       re.MULTILINE | re.DOTALL)
    if not quests:
        raise ValueError(f"{path}: could not find the Compendium quests table")
    return {int(match.group(1)) for match in re.finditer(
        r"^\s*\[(\d+)\]\s*=\s*\{", quests.group("body"), re.MULTILINE)}


def clean(text: str | None) -> str | None:
    if not text:
        return None
    # Stripped before the line breaks become $B, which strip() would not take off the ends.
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return None
    return re.sub(r"\$b", "$B", text.replace("\n", "$B"))


def needs_amounts(rows: list[dict]) -> bool:
    """Whether any row has a `$<n>oa` token, so the objective amounts are worth loading."""
    return any(AMOUNT.search(row.get("localeText") or "") for row in rows)


def forever_amounts() -> dict:
    """objective_amounts from the Efficient Games data QuestText.lua's export reads, fetched
    once and cached by export_compendium."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    from export_compendium import eg_datasets
    return objective_amounts(eg_datasets("quests.enUS"))


def localized_quest_text(rows: list[dict], names: dict[int, str], quest_ids: set[int],
                         corpus: dict, ignored=(), amounts=None) -> dict:
    """Select the Compendium's localized title, accept and complete text.

    Accept and complete are the page's moments. Progress is used as accept only for a quest
    whose English has neither, matching tts_cli.quest_text.quest_text(): where the English has
    an offer, a translated progress line is not one. Multiple corpus rows are reduced to the
    wording most often present, with input order breaking ties. Ignored lines are left out
    and `$<n>oa` is written in, as quest_text() does for the English. A title identical to the
    English is left out, so the client's own title answers for it.
    """
    with_moments, english_titles = set(), {}
    for line in corpus["lines"]:
        quest_id = line.get("questId")
        if not quest_id or line.get("source") not in SOURCES:
            continue
        english_titles.setdefault(quest_id, set()).add(line.get("questTitle"))
        if line["source"] in MOMENTS and (line.get("originalText") or "") \
                and split_voice(line["lineId"])[0] not in ignored:
            with_moments.add(quest_id)

    texts: dict[int, dict[str, list[str]]] = {}
    for row in rows:
        quest_id = int(row["questId"])
        source = row["source"]
        if quest_id not in quest_ids or source not in SOURCES \
                or split_voice(row["lineId"])[0] in ignored:
            continue
        text = clean(row.get("localeText"))
        if text:
            text = fill_amounts(text, (amounts or {}).get(quest_id))
            texts.setdefault(quest_id, {}).setdefault(source, []).append(text)

    out = {}
    for quest_id in sorted((set(texts) | set(names)) & quest_ids):
        moments = texts.get(quest_id, {})
        chosen = {}
        for moment in MOMENTS:
            candidates = moments.get(moment, [])
            if candidates:
                chosen[moment] = Counter(candidates).most_common(1)[0][0]
        if not chosen and quest_id not in with_moments and moments.get(PROGRESS):
            chosen["accept"] = Counter(moments[PROGRESS]).most_common(1)[0][0]
        title = names.get(quest_id)
        if title and title not in english_titles.get(quest_id, ()):
            chosen["title"] = title
        if chosen:
            out[quest_id] = {
                key: chosen[key] for key in ("title", "accept", "complete") if key in chosen
            }
    return out


def write_compendium_text(path: str, lang: str, quests: dict) -> str:
    document = {"lang": lang, "quests": {str(key): value for key, value in sorted(quests.items())}}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(path, "wb", mtime=0) as raw:
        raw.write(json.dumps(document, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":")).encode("utf-8"))
    return path


def load_compendium_text(path: str) -> tuple[str, dict]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        document = json.load(source)
    return document["lang"], {int(key): value for key, value in document["quests"].items()}

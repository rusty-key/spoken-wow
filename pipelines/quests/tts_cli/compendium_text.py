"""The client's localized quest wording for Azeroth's Compendium.

The website corpus is authoritative here.  The database exporter writes a small per-language
snapshot, and the sound-pack builder turns that snapshot into a client-locale guarded Lua table.
"""
import gzip
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_COMPENDIUM_PATH = ROOT / "addons" / "Spoken_Quests" / "Data" / "Compendium.lua"
MOMENTS = ("accept", "complete")
SOURCES = MOMENTS + ("progress",)


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
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", "$B")
    text = re.sub(r"\$b", "$B", text)
    return text.strip() or None


def localized_quest_text(rows: list[dict], names: dict[int, str], quest_ids: set[int]) -> dict:
    """Select the Compendium's localized title, accept and complete text.

    Accept and complete are the page's moments. Progress is used as accept only for a quest
    that has neither of those moments, matching tts_cli.quest_text.quest_text(). Multiple
    corpus rows are reduced to the wording most often present, with input order breaking ties.
    """
    texts: dict[int, dict[str, list[str]]] = {}
    for row in rows:
        quest_id = int(row["questId"])
        source = row["source"]
        if quest_id not in quest_ids or source not in SOURCES:
            continue
        text = clean(row.get("localeText"))
        if text:
            texts.setdefault(quest_id, {}).setdefault(source, []).append(text)

    out = {}
    for quest_id in sorted((set(texts) | set(names)) & quest_ids):
        moments = texts.get(quest_id, {})
        chosen = {}
        for moment in MOMENTS:
            candidates = moments.get(moment, [])
            if candidates:
                chosen[moment] = Counter(candidates).most_common(1)[0][0]
        if not chosen and moments.get("progress"):
            chosen["accept"] = Counter(moments["progress"]).most_common(1)[0][0]
        if quest_id in names:
            chosen["title"] = names[quest_id]
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

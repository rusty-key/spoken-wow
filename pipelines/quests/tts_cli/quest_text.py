"""Each quest's words, for its page in Azeroth's Compendium (addons/Spoken_Quests/UI/QuestsTab.lua).

tools/export_quest_text.py writes them to addons/Spoken_Quests/Data/QuestText.lua. The client
gives a quest's words only while its window is open, so a quest done before Spoken Quests was
installed would have none to show: the English ships with the addon instead.

The page shows the offer and the hand-in, so those are kept (accept, complete); the progress
line, said while a quest is under way, is not, save for a quest the corpus has no other words
for, whose progress is kept as its offer so its page has words. The corpus has a line per giver
and per player gender, so a moment can have several. One text is kept for each:

- `originalText`, the world database's, with the game's placeholders left in ($N, $C, $R,
  $G male:female; and $B) for the addon to fill for the player as the client does. A quest's
  gendered pair (`:m`, `:f`) has one such text, so the pair is one entry.
- `$<n>oa`, the amount of the quest's nth objective (a Craftsman's Writ's "requesting $2oa
  Crafted Solid Shot"), is the same for every player, so it is written in here from Forever's
  client data (`objective_amounts`). A quest whose amount is not known keeps the token.
- Where givers' words differ (the Runecloth donations, quest ids the database reuses), the
  text most of the moment's lines have; on a tie, the one that comes first in the corpus.
- An ignored line (corpus/ignored.json) is left out, as it is from every pack.
- A quest the Compendium leaves out (`left_out`) has none: its page does not exist.
"""
import json
import os
import re
from collections import Counter

#: The moments a quest's page shows, in the order a player meets them.
MOMENTS = ("accept", "complete")
#: Read only for a quest with neither of those.
PROGRESS = "progress"
#: `$2oa`: the amount of the quest's second objective.
AMOUNT = re.compile(r"\$(\d+)oa")


def objective_amounts(quest_sets: dict) -> dict:
    """{questID: [each objective's amount, in the client's order]} from Efficient Games'
    quests.enUS datasets ({build: data}, oldest first); a later build's record wins."""
    amounts = {}
    for data in quest_sets.values():
        for qid, quest in data.get("quests", {}).items():
            amounts[int(qid)] = [o.get("amount") for o in quest.get("objectives") or []]
    return amounts


def fill_amounts(text: str, amounts) -> str:
    """`text` with each `$<n>oa` it has an amount for written in; the rest are left."""
    def amount(match):
        n = int(match.group(1))
        known = amounts[n - 1] if amounts and 0 < n <= len(amounts) else None
        return str(known) if known is not None else match.group(0)
    return AMOUNT.sub(amount, text)


def in_game(quest_id: int, title: str) -> bool:
    """False for Blizzard's own debris: quest 1, the developers' test, and the ones marked
    not yet implemented. Neither the index nor the words list them."""
    return quest_id != 1 and "<NYI>" not in (title or "")


def removed_quests(overrides_path: str) -> set:
    """The quests the Compendium's hand corrections leave out, or none where there is no file."""
    if not os.path.isfile(overrides_path):
        return set()
    with open(overrides_path, encoding="utf-8") as f:
        entries = json.load(f).get("quests", [])
    return {qid for e in entries if e.get("remove") for qid in ([e["id"]] if "id" in e else e["ids"])}


def left_out(corpus: dict, ignored=(), removed=()) -> set:
    """The quests the Compendium does not list, by one rule its index and its words both read:
    Blizzard's debris (in_game), a quest every line of which is ignored (corpus/ignored.json,
    the site's line_ignore), and `removed`, the hand corrections' removals. Those are the list
    until line_ignore holds them; a quest ignored there needs no removal here."""
    out, ignored_only = set(removed), {}
    for line in corpus["lines"]:
        quest = line.get("questId")
        if not quest or line["source"] not in MOMENTS + (PROGRESS,):
            continue
        if not in_game(quest, line.get("questTitle")):
            out.add(quest)
        ignored_only[quest] = ignored_only.get(quest, True) and line["lineId"] in ignored
    return out | {quest for quest, every in ignored_only.items() if every}


def quest_text(corpus: dict, ignored=(), removed=(), amounts=None) -> dict:
    """{questID: {moment: text}} for every quest the corpus has words for, save those
    left_out. `amounts` is objective_amounts'."""
    dropped = left_out(corpus, ignored, removed)
    texts = {}
    for line in corpus["lines"]:
        moment = line["source"]
        if moment not in MOMENTS + (PROGRESS,) or line["lineId"] in ignored or line["questId"] in dropped:
            continue
        text = (line.get("originalText") or "").replace("\r\n", "\n").replace("\r", "\n")
        text = fill_amounts(text, (amounts or {}).get(line["questId"]))
        if text:
            texts.setdefault(line["questId"], {}).setdefault(moment, []).append(text)
    out = {}
    for quest, moments in texts.items():
        if not any(moment in moments for moment in MOMENTS):
            moments = {"accept": moments[PROGRESS]}
        out[quest] = {}
        for moment in MOMENTS:
            if moment in moments:
                counts = Counter(moments[moment])
                # max keeps the first of equals, and a Counter keeps the order texts were met in.
                out[quest][moment] = max(counts, key=counts.get)
    return out


def lua_string(text: str) -> str:
    out = []
    for ch in text:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ord(ch) < 32 or ord(ch) == 127:
            out.append(f"\\{ord(ch):03d}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


HEADER = """-- AUTO-GENERATED by pipelines/quests/tools/export_quest_text.py. Do not edit by hand.
--
-- What each quest's NPC says when it is offered and when it is handed in, in English, for the
-- quest's page in Azeroth's Compendium (UI/QuestsTab.lua). From the committed corpus
-- (pipelines/quests/corpus/corpus.json.gz), so it needs no database. Regenerate with:
--   make quests-compendium-text
--
-- The game's placeholders are kept ($N, $C, $R, $G male:female; and $B): the addon fills them in
-- for the player. An objective's amount ($2oa) is written in from Forever's client data (Efficient
-- Games, CC BY 4.0). Where a quest's givers say different words, the words most of them say.
--
-- A global rather than a private namespace: a data file cannot reach into the addon's environment.

SpokenQuestsText = {
"""


def render(texts: dict) -> str:
    out = [HEADER]
    for quest in sorted(texts):
        out.append(f"\t[{quest}] = {{\n")
        for moment in MOMENTS:
            text = texts[quest].get(moment)
            if text:
                out.append(f"\t\t{moment} = {lua_string(text)},\n")
        out.append("\t},\n")
    out.append("}\n")
    return "".join(out)

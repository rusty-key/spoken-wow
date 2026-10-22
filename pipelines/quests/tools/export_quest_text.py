"""Every quest's words, for the Quests tab of Azeroth's Compendium.

Writes addons/Spoken_Quests/Data/QuestText.lua from the committed corpus and its ignores; which
text is kept for each quest is tts_cli/quest_text.py's. Needs no database. An objective's
amount ($2oa) comes from Efficient Games' Forever data, read from export_compendium's cache
(fetched once at its pinned commit); --without-efficient-games leaves those tokens in:

    make quests-compendium-text
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
QUESTS = os.path.dirname(HERE)
sys.path.insert(0, QUESTS)

from tts_cli.corpus import load_corpus  # noqa: E402
from tts_cli.ignores import ignored_line_ids  # noqa: E402
from tts_cli.quest_text import objective_amounts, quest_text, removed_quests, render  # noqa: E402

DEFAULT_OUT = os.path.join(QUESTS, "..", "..", "addons", "Spoken_Quests", "Data", "QuestText.lua")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", default=os.path.join(QUESTS, "corpus", "corpus.json.gz"))
    parser.add_argument("--ignored", default=os.path.join(QUESTS, "corpus", "ignored.json"))
    parser.add_argument("--overrides", default=os.path.join(QUESTS, "corpus", "compendium_overrides.json"))
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--without-efficient-games", action="store_true",
                        help="leave objective amounts ($2oa) unfilled: the corpus alone")
    args = parser.parse_args()

    amounts = {}
    if not args.without_efficient_games:
        from export_compendium import eg_datasets
        amounts = objective_amounts(eg_datasets("quests.enUS"))
    texts = quest_text(load_corpus(args.corpus), ignored_line_ids(args.ignored),
                       removed_quests(args.overrides), amounts)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(texts))

    moments = sum(len(each) for each in texts.values())
    print(f"wrote {os.path.normpath(args.out)}: {len(texts)} quests, {moments} texts, "
          f"{os.path.getsize(args.out) // 1024} KB")

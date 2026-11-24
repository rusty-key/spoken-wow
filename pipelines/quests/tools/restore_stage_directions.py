"""Recover the stage directions the pipeline deleted before synthesis.

`preprocess_dataframe` strips `<.*?>\\s` from every line before it is spoken, so 305 lines
ship with their stage direction silently missing: the NPC says its words and the game's
narration is simply gone. The web app can now voice a direction (a narrator reads it), so
those lines can be restored.

WHY NO CORPUS REBUILD. The direction was never lost - only the *cleaned* text lost it, and
`originalText` in the committed corpus still carries it. So the restored text is recovered by
re-running the same cleaning against `originalText` and omitting the one strip. That is
reproduced here from tts_cli, not reimplemented: written_text and the `$G` pattern are
imported, so a change there changes this.

THE SAFETY INVARIANT, and the reason to trust the output: for every line emitted, stripping
the restored text again must reproduce the corpus's `text` exactly. If it does not, this
script has changed something other than putting the direction back, and the line is dropped
rather than guessed at. On the current corpus every line either satisfies that or is excluded
for the reason below.

WHAT IS DELIBERATELY EXCLUDED. Six lines hold a lowercase *sound* rather than a direction -
`<cough>`, `<hic>`, `<yawn>`, `<drool>`, `<sigh>`. Nothing voices those yet, so restoring one
would turn a line with working audio into a line the gate refuses. Capitalisation is what
tells a direction from a sound; see web/src/lib/generation/narration.ts.

This writes nothing. It prints a JSON artifact for review; web/scripts/apply-overrides.mjs is what
puts the rows in Postgres.

    python tools/restore_stage_directions.py > /tmp/restored.json
"""

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_cli.tts_utils import written_text  # noqa: E402

CORPUS = Path(__file__).resolve().parent.parent / "corpus" / "corpus.json.gz"

#: The strip this script exists to undo, from preprocess_dataframe.
STRIP = re.compile(r"<.*?>\s")

#: `$Gmale:female;`, from handle_gender_options.
GENDER = re.compile(r"\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;")

#: A bracketed span the narrator reads. Lowercase spans are sounds and are left alone.
DIRECTION = re.compile(r"<[A-Z][^<>]*>")

#: Any bracketed span at all, for deciding what a line carries.
ANY_SPAN = re.compile(r"<([^<>]*)>")


def cleaned(text: str, player_gender: str | None) -> str:
    """The pipeline's cleaning, minus the strip."""
    text = written_text(text)
    if player_gender == "m":
        text = GENDER.sub(r"\1", text)
    elif player_gender == "f":
        text = GENDER.sub(r"\2", text)
    return text


def spans(text: str) -> list[str]:
    return [span.strip() for span in ANY_SPAN.findall(text) if span.strip()]


def restorable(line: dict) -> tuple[str, str] | None:
    """The restored text and why it was kept, or None with the reason printed to stderr."""
    if not ANY_SPAN.search(line["originalText"]):
        return None
    # Only lines the pipeline stripped: one that kept its brackets was never missing anything.
    if ANY_SPAN.search(line["text"]):
        return None

    restored = cleaned(line["originalText"], line.get("playerGender"))
    found = spans(restored)
    if not found:
        return None

    if any(span[0].islower() for span in found):
        return None, "sound"

    # The invariant: putting the direction back must be the *only* difference.
    if STRIP.sub("", restored) != line["text"]:
        return None, "not-reproducible"

    if not DIRECTION.search(restored):
        return None, "no-direction"

    return restored, "ok"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=CORPUS)
    args = parser.parse_args()

    corpus = json.loads(gzip.open(args.corpus).read())

    kept: list[dict] = []
    counts = {"sound": 0, "not-reproducible": 0, "no-direction": 0}

    for line in corpus["lines"]:
        outcome = restorable(line)
        if outcome is None:
            continue
        restored, why = outcome
        if restored is None:
            counts[why] += 1
            continue

        subfolder = "gossip" if line["source"] == "gossip" else "quests"
        kept.append(
            {
                "file": f"{subfolder}/{line['fileName']}.mp3",
                "lineId": line["lineId"],
                "npcId": line["npcId"],
                "npcName": line["npcName"],
                "was": line["text"],
                "text": restored,
            }
        )

    # One file, one override. A file shared by several lines can have several restorations -
    # five quests give Captain Shatterskull's line both with and without a full stop inside
    # the direction - so the lowest npcId wins, which is the rule canonicalNpcId already uses
    # to decide how a shared file regenerates.
    by_file: dict[str, dict] = {}
    conflicts = 0
    for entry in kept:
        seen = by_file.get(entry["file"])
        if seen is None:
            by_file[entry["file"]] = entry
            continue
        if seen["text"] != entry["text"]:
            conflicts += 1
        if entry["npcId"] < seen["npcId"]:
            by_file[entry["file"]] = entry
    kept = sorted(by_file.values(), key=lambda entry: entry["file"])

    print(
        f"restorable: {len(kept)} files  "
        f"({conflicts} shared files disagreed and took the lowest npcId)  "
        f"excluded - sound: {counts['sound']}, "
        f"not reproducible: {counts['not-reproducible']}, "
        f"no direction: {counts['no-direction']}",
        file=sys.stderr,
    )
    json.dump(kept, sys.stdout, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()

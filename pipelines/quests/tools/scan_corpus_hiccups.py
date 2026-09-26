"""Scan the corpus for text a TTS engine is likely to mangle.

RETIRED AS IT STANDS. Nothing reads corpus/hiccups.json.gz any more: the `line_issue`
table it fed, the /issues review queue and the Issue column on the explorer were all
removed in favour of feedback, which is now the only way a problem with a line is
recorded. The scan itself is still the useful half -- it finds what nobody has complained
about yet -- so the plan is to point it at `report` instead, filing what it finds the way
a listener would. Until then it writes two files nothing loads.

The table and its rows are still there; migrations here are forward-only and drop
nothing.

Two outputs, same findings:

  docs/corpus-hiccups.csv    one row per finding, for reading offline. Gitignored.
  corpus/hiccups.json.gz     the same findings with every line each one occurs on, which
                             is what the web app loads into Postgres. Committed, and it
                             ships inside a release beside the corpus.

Name rows are token-level; line-level findings (role-play, abbreviations, source bugs)
carry the offending fragment in `item`. docs/corpus-hiccups.md explains the columns.

Nothing here is filtered by the lexicon. A name that has a pronunciation entry is still a
detection - it is just a resolved one - and only the live lexicon row knows which those
are. So findings carry `grapheme` and the web app decides coverage when it loads them;
the CSV's `in_lexicon` column reports what the *seeded* lexicon covered, which is a
reading aid and nothing more.

Only generatable lines are scanned - lines holding $ < > are already excluded upstream by
tts_cli.corpus, so flagging them would be noise.

Needs `wordfreq` and macOS's /usr/share/dict. Run from the repo root:

    python3 tools/scan_corpus_hiccups.py
"""
import argparse, csv, gzip, json, re
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter, defaultdict
from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--csv", type=Path, default=ROOT / "docs" / "corpus-hiccups.csv")
parser.add_argument("--json", type=Path, default=ROOT / "corpus" / "hiccups.json.gz")
args = parser.parse_args()

SCHEMA_VERSION = 1

corpus = json.load(gzip.open(ROOT / "corpus" / "corpus.json.gz"))
lines = [l for l in corpus["lines"] if l["generatable"]]
by_id = {l["lineId"]: l for l in corpus["lines"]}

sql = open(ROOT / "web" / "migrations" / "0008_seed_pronunciation_lexicon.sql").read()
lex = set(g.lower() for g in re.findall(r'"grapheme": "(.*?)"', sql))

web2 = set(w.strip().lower() for w in open("/usr/share/dict/web2"))
web2 |= set(w.strip().lower() for w in open("/usr/share/dict/web2a"))

TOKEN = re.compile(r"[A-Za-z][A-Za-z'\-]*[A-Za-z]|[A-Za-z]")
PART = {"s", "t", "re", "ve", "ll", "d", "m", "n", "em"}
SUFFIX = (("s", ""), ("es", ""), ("ed", ""), ("ing", ""), ("s", "e"), ("ed", "e"),
          ("ing", "e"), ("ies", "y"), ("ly", ""), ("er", ""), ("ers", ""))


def real_word(w):
    if zipf_frequency(w, "en") >= 2.6 or w in web2:
        return True
    return any(w.endswith(s) and (w[: -len(s)] + a) in web2 for s, a in SUFFIX)


def english(w):
    if real_word(w):
        return True
    parts = [p for p in re.split(r"['\-]", w) if p]
    return len(parts) > 1 and all(p in PART or real_word(p) for p in parts)


def compound(w):
    lo = w.rstrip("'").removesuffix("'s")
    for i in range(3, len(lo) - 2):
        if zipf_frequency(lo[:i], "en") >= 3.3 and zipf_frequency(lo[i:], "en") >= 3.3:
            return f"{lo[:i]}+{lo[i:]}"
    return None


count, where, cased = Counter(), defaultdict(set), defaultdict(set)
for ln in lines:
    for tok in TOKEN.findall(ln["text"]):
        base = tok.lower().rstrip("'").removesuffix("'s")
        if english(base):
            continue
        count[base] += 1
        cased[base].add(tok)
        where[base].add(ln["lineId"])

npc_words = {t.lower().rstrip("'").removesuffix("'s")
             for ln in corpus["lines"] for t in TOKEN.findall(ln["npcName"] or "")}
covered = {b for b in count if b in lex or b.rstrip("s") in lex
           or any(len(g) > 5 and (b.startswith(g) or g.startswith(b)) for g in lex)}

ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def drift_targets(w):
    """Common English words one edit away — what a model will "correct" the name into."""
    edits = {w[:i] + w[i + 1:] for i in range(len(w))}
    edits |= {w[:i] + c + w[i + 1:] for i in range(len(w)) for c in ALPHABET}
    edits |= {w[:i] + c + w[i:] for i in range(len(w) + 1) for c in ALPHABET}
    return sorted(e for e in edits - {w}
                  if zipf_frequency(e, "en") >= 3.1
                  and not (w.startswith(e) or e.startswith(w)))

rows = []


def add(category, item, n, priority, note, line_ids=(), variants="", grapheme=""):
    ids = sorted(set(line_ids))
    rows.append({
        "category": category, "item": item, "occurrences": n, "priority": priority,
        "variants_in_source": variants, "example_line": ids[0] if ids else "",
        "example_npc": by_id[ids[0]]["npcName"] if ids else "",
        "in_lexicon": "seed" if grapheme and grapheme in covered else "",
        "note": note, "verdict": "", "ipa": "",
        # Not a CSV column: every line the finding occurs on, which is what the web app
        # needs to mark a row and what the CSV has no room for.
        "line_ids": ids, "grapheme": grapheme,
    })


for base, n in count.most_common():
    variants = "/".join(sorted(cased[base]))
    # A proper noun one edit from a common word is the risky case: the model does not
    # guess, it "corrects". Inflections of the same stem (cauldrons/cauldron) are not.
    proper = all(v[:1].isupper() for v in cased[base])
    drift = drift_targets(base) if proper and len(base) > 4 else []
    tag = " (also an NPC name)" if base in npc_words else ""
    if "'" in base:
        add("name-apostrophe", variants.split("/")[0], n, 1,
            f"apostrophe name{tag}", where[base], variants, base)
    elif (c := compound(base)):
        add("name-compound", variants.split("/")[0], n, 3,
            f"compound of English words ({c}){tag}", where[base], variants, base)
    elif drift:
        add("name-drifts-to-english", variants.split("/")[0], n, 1,
            f"one edit from {', '.join(drift[:3])}{tag}", where[base], variants, base)
    else:
        add("name-invented", variants.split("/")[0], n, 2 if n >= 5 else 3,
            f"not English{tag}", where[base], variants, base)

# ------------------------------------------------------------- line-level findings
LINE_PATTERNS = [
    ("roleplay-asterisk", r"\*[^*\n]{1,80}\*", 1, "stage direction / sound effect read aloud"),
    ("roleplay-parenthetical", r"\([^)\n]{1,120}\)", 2, "parenthetical aside"),
    ("abbrev-initial", r"\b(?:[A-Z]\.){2,}|\b[A-Z]\.\s?(?=[A-Z])", 2, "initials"),
    ("abbrev-title", r"\b(?:Mr|Mrs|Ms|Dr|St|Lt|Sgt|Capt|Gen|Col|Prof|Jr|Sr|Inc|Co|Ltd|No)\.", 2,
     "abbreviation with a period"),
    ("abbrev-code", r"\b[A-Z]{2,}[-:/][A-Z0-9]+", 1, "alphanumeric designation"),
    ("abbrev-roman", r"\b(?:I{2,}|IV|VI{0,3}|IX|XI{0,2})\b(?<!\bI\b)", 3, "roman numeral"),
    ("number-binary", r"[01]{8}(?:\s[01]{8})+", 1, "raw binary read digit by digit"),
    ("number-time", r"\d\s?[AP]M\b", 2, "time of day"),
    ("number-bare", r"\b\d[\d,]*\b", 3, "numeral"),
    ("punct-double-hyphen", r"\S*--\S*", 2, "-- used as an em dash"),
    ("punct-ellipsis", r"\.{4,}", 3, "four or more dots"),
    ("punct-repeat", r"[?!]{2,}", 3, "repeated terminal punctuation"),
    ("punct-symbol", r"[&/%#~^_{}\\|]+", 2, "symbol spoken or dropped"),
    ("sfx-elongation", r"\b[A-Za-z]*([a-zA-Z])\1\1+[A-Za-z]*\b", 2, "elongated vowel / onomatopoeia"),
    ("sfx-stutter", r"\b([A-Za-z])-\1[a-z]+", 2, "stutter"),
    ("dialect-contraction", r"\bye'(?:ll|re|ve|d)\b|\byerself\b|\byer\b", 1,
     "dialect form a model normalises to we'll / herself"),
    ("bug-glued-substitution", r"\b(?:adventurer|Adventurer)(?!s\b|'|\b)[A-Za-z]+", 1,
     "$N substituted with no following space"),
]

for cat, pat, prio, note in LINE_PATTERNS:
    hits = defaultdict(list)
    for ln in lines:
        for m in re.finditer(pat, ln["text"]):
            hits[m.group(0)].append(ln["lineId"])
    for frag, ids in sorted(hits.items(), key=lambda kv: -len(kv[1])):
        add(cat, frag[:120], len(ids), prio, f"{note} ({len(set(ids))} lines)", ids)

TYPOS = [
    ("Exellent", "Excellent", 1), ("Ferelas", "Feralas", 1), ("Erelas", "Feralas", 1),
    ("Cenarian", "Cenarion", 2), ("Smokeywood", "Smokywood", 2), ("Ungoro", "Un'Goro", 2),
    ("Lakshire", "Lakeshire", 2), ("Proudmore", "Proudmoore", 2),
    ("Bag'thera", "Bhag'thera", 2), ("Thal'danis", "Thel'danis", 2),
]
for wrong, right, prio in TYPOS:
    ids = [l["lineId"] for l in lines if re.search(rf"\b{re.escape(wrong)}\b", l["text"])]
    if ids:
        add("bug-source-typo", wrong, len(ids), prio,
            f"misspelling of {right} in Blizzard's text, voiced verbatim", ids)

for lid, note in [("q:1155:accept", 'line text is literally "x"'),
                  ("q:3646:accept", "line text is a single newline"),
                  ("q:257:complete", "$Nama name gag becomes 'adventurerama'"),
                  ("q:258:accept", "$Nath name gag becomes 'adventurerath'"),
                  ("q:258:progress", "$Nah name gag becomes 'adventurerah'")]:
    add("bug-degenerate-line", lid, 1, 1, note, [lid])

rows.sort(key=lambda r: (r["priority"], -r["occurrences"], r["category"]))

CSV_COLUMNS = ["priority", "category", "item", "occurrences", "variants_in_source",
               "example_line", "example_npc", "note", "in_lexicon", "verdict", "ipa"]

with open(args.csv, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)

# mtime=0 so re-running without a corpus change produces a byte-identical file. gzip
# stamps the source mtime by default, which would make every scan look like a change.
with gzip.GzipFile(args.json, "wb", mtime=0) as f:
    f.write(json.dumps({
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpusGeneratedAt": corpus["generatedAt"],
        "findings": [{
            "category": r["category"],
            "item": r["item"],
            "severity": r["priority"],
            "note": r["note"],
            "occurrences": r["occurrences"],
            "variants": r["variants_in_source"] or None,
            "grapheme": r["grapheme"] or None,
            "lineIds": r["line_ids"],
        } for r in rows],
    }, separators=(",", ":")).encode())

pairs = sum(len(r["line_ids"]) for r in rows)
print(f"{len(rows)} findings over {pairs} finding-line pairs")
print(f"  -> {args.csv}")
print(f"  -> {args.json}")
print(Counter(r["category"] for r in rows).most_common())

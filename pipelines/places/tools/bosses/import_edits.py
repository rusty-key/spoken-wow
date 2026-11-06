"""Positions set by hand in the game (/spokenbosscam) into Data/CameraNudges.lua.

The game saves them in Spoken_Developer's saved variable, WTF/Account/<account>/SavedVariables/Spoken_Developer.lua:
SpokenDeveloperDB.cameraEdits[place][model file] = { right, up, zoom, turn }, for the places "compendium" and
"story", on top of the camera TextView frames for each boss. This merges them into addons/Spoken_Bosses/Data/CameraNudges.lua,
which the addon loads before the saved variables. What was there and is not in the game's file stays. A saved row
that is no change at all (the boss where its camera puts it) is a reset: it takes that model's row out.

    python import_edits.py              the first Spoken_Developer.lua under the Forever client's WTF
    python import_edits.py <file>       that file
    SPOKEN_DEVELOPER_LUA=<file> python import_edits.py     the same, from the environment (make bosses-nudges)
    python import_edits.py --force      merge although TextView frames bosses differently from when the rows were made

Log out or /reload in the game first, so the file is written. A nudge is a change to the framing, so a change
to how TextView frames a boss (FIT, ASPECT, the field of view) changes what every nudge means. The file records
how its rows were framed, and the import stops when that is no longer how TextView frames: move the bosses again
in the game instead of importing old edits.
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
OUT = os.path.join(ROOT, "addons/Spoken_Bosses/Data/CameraNudges.lua")
TEXTVIEW = os.path.join(ROOT, "addons/Spoken/UI/TextView.lua")
CAMERAS = os.path.join(ROOT, "addons/Spoken_Bosses/Data/Cameras.lua")
FRAMED = re.compile(r"^-- Framed with: (.+)$", re.M)
WTF = r"C:\Program Files (x86)\World of Warcraft\_forever_\WTF\Account\*\SavedVariables\Spoken_Developer.lua"
ENV = "SPOKEN_DEVELOPER_LUA"
PLACES = ("compendium", "story")

TOKEN = re.compile(r"""
    (?P<space>\s+)
  | (?P<comment>--(?:\[(?P<ceq>=*)\[.*?\](?P=ceq)\]|[^\n]*))
  | (?P<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')
  | (?P<long>\[(?P<leq>=*)\[.*?\](?P=leq)\])
  | (?P<number>-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))
  | (?P<name>[A-Za-z_]\w*)
  | (?P<punct>[{}\[\]=,;])
""", re.X | re.S)
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "\n": "\n"}


def unescape(raw):
    def one(e):
        c = e.group(1)
        return chr(int(c)) if c.isdigit() else ESCAPES.get(c, c)

    return re.sub(r"\\(\d{1,3}|.)", one, raw, flags=re.S)


def tokens(text):
    """(kind, value) of each token in a saved-variables file; comments and spaces are dropped."""
    out, at = [], 0
    while at < len(text):
        m = TOKEN.match(text, at)
        if not m:
            raise ValueError("cannot read the Lua at character %d: %r" % (at, text[at:at + 30]))
        at = m.end()
        if m.group("comment") is not None or m.group("space") is not None:
            continue
        if m.group("string") is not None:
            out.append(("string", unescape(m.group("string")[1:-1])))
        elif m.group("long") is not None:
            out.append(("string", m.group("long")))
        elif m.group("number") is not None:
            raw = m.group("number")
            out.append(("number", float(int(raw, 16)) if "x" in raw.lower() else float(raw)))
        elif m.group("name") is not None:
            out.append(("name", m.group("name")))
        else:
            out.append(("punct", m.group("punct")))
    return out


def parse(text):
    """The top-level assignments of a saved-variables file: { name: value }. A table is a dict; the items it
    lists without a key are under 1, 2, 3, ... as in Lua."""
    toks = tokens(text)
    pos = [0]

    def peek(k=0):
        return toks[pos[0] + k] if pos[0] + k < len(toks) else (None, None)

    def take():
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def expect(value):
        if take()[1] != value:
            raise ValueError("expected %r in the Lua, token %d" % (value, pos[0]))

    def value():
        kind, v = take()
        if kind == "punct" and v == "{":
            return table()
        if kind in ("string", "number"):
            return v
        if kind == "name" and v in ("true", "false", "nil"):
            return {"true": True, "false": False, "nil": None}[v]
        raise ValueError("a value was expected, got %r (token %d)" % (v, pos[0]))

    def table():
        out, n = {}, 0
        while True:
            kind, v = peek()
            if kind is None:
                raise ValueError("a table is never closed")
            if (kind, v) == ("punct", "}"):
                take()
                return out
            if kind == "punct" and v in (",", ";"):
                take()
                continue
            if (kind, v) == ("punct", "["):
                take()
                key = value()
                expect("]")
                expect("=")
                out[int(key) if isinstance(key, float) and key == int(key) else key] = value()
            elif kind == "name" and peek(1) == ("punct", "="):
                take()
                take()
                out[v] = value()
            else:
                n += 1
                out[n] = value()

    result = {}
    while pos[0] < len(toks):
        kind, name = take()
        if kind != "name":
            raise ValueError("a name was expected at the top level, got %r" % (name,))
        expect("=")
        result[name] = value()
    return result


def row_of(table):
    """{ right, up, zoom, turn } from a parsed row of 3 or 4 numbers (the turn was added later), else None."""
    if not isinstance(table, dict):
        return None
    items = [table.get(i) for i in range(1, len(table) + 1)]
    if len(items) not in (3, 4) or not all(isinstance(x, float) for x in items):
        return None
    return (items + [0.0])[:4]


def is_identity(row):
    """A row that leaves the boss where its camera puts it. The importer and the writer use the same test."""
    r, u, z, t = row
    return abs(r) < 1e-4 and abs(u) < 1e-4 and abs(z - 1) < 1e-4 and abs(t) < 1e-4


def saved_edits(text):
    """{ place: { model file: row } } from SpokenDeveloperDB.cameraEdits in a Spoken_Developer.lua; {} where it has none."""
    db = parse(text).get("SpokenDeveloperDB")
    edits = db.get("cameraEdits") if isinstance(db, dict) else None
    out = {}
    for place in PLACES:
        models = edits.get(place) if isinstance(edits, dict) else None
        out[place] = {}
        for group, v in (models or {}).items():
            row = row_of(v)
            if row is not None and isinstance(group, int):
                out[place][group] = row
    return out


def kept_nudges(text):
    """{ place: { model file: row } } from the SpokenBossCameraNudges already in CameraNudges.lua."""
    table = parse(text).get("SpokenBossCameraNudges") or {}
    out = {}
    for place in PLACES:
        out[place] = {}
        for group, v in (table.get(place) or {}).items():
            row = row_of(v)
            if row is not None:
                out[place][group] = row
    return out


def merge(kept, saved):
    """(nudges, counts): the kept rows, with each saved row that differs from no change put over its model's row,
    and the row of each model the game file has reset taken out. counts is how many rows were replaced, added,
    removed and left as they were, and how many saved rows were no change for a model with no row."""
    result = {p: dict(kept.get(p, {})) for p in PLACES}
    counts = {"replaced": 0, "added": 0, "removed": 0, "ignored": 0}
    for place in PLACES:
        for group, row in saved.get(place, {}).items():
            if is_identity(row):
                if result[place].pop(group, None) is not None:
                    counts["removed"] += 1
                else:
                    counts["ignored"] += 1
            elif group not in result[place]:
                result[place][group] = row
                counts["added"] += 1
            elif any(abs(a - b) >= 5e-5 for a, b in zip(result[place][group], row)):
                result[place][group] = row
                counts["replaced"] += 1
    counts["kept"] = sum(len(rows) for rows in kept.values()) - counts["replaced"] - counts["removed"]
    return result, counts


def framing(textview, cameras):
    """How TextView frames a boss, from its source and Data/Cameras.lua: what a nudge is relative to."""
    fit = re.search(r"local FIT, ASPECT = ([\d.]+), ([\w.]+)", textview)
    wide = re.search(r"local MODEL_MOST, MODEL_GAP, MODEL_WIDE = [\d.]+, [\d.]+, ([\d.]+)", textview)
    fov = re.search(r"fov = ([\d.]+)", cameras)
    if not (fit and fov and (wide or fit.group(2) != "MODEL_WIDE")):
        raise ValueError("TextView's FIT and ASPECT, or Cameras.lua's fov, are not where the importer looks")
    aspect = wide.group(1) if fit.group(2) == "MODEL_WIDE" else fit.group(2)
    return "fit=%g aspect=%g fov=%g" % (float(fit.group(1)), float(aspect), float(fov.group(1)))


def write(nudges, path=OUT, framed=None):
    lines = ["-- AUTO-GENERATED by pipelines/places/tools/bosses/import_edits.py (make bosses-nudges) from what was moved by hand",
             "-- in the game (/spokenbosscam, kept in Spoken_Developer's saved variables). Do not edit by hand.",
             "-- SpokenBossCameraNudges[place][model key] = { right, up, zoom, turn }, applied to the camera TextView frames for the boss:",
             "-- right and up in frame heights, zoom as a factor, turn in radians. The places are \"compendium\" and \"story\"."]
    if framed:
        lines.append("-- Framed with: %s" % framed)
    lines.append("SpokenBossCameraNudges = {")
    for place in PLACES:
        lines.append("\t%s = {" % place)
        for group in sorted(nudges[place]):
            row = nudges[place][group]
            if is_identity(row):
                continue
            lines.append("\t\t[%d] = { %.4f, %.4f, %.4f, %.4f }," % ((group,) + tuple(row)))
        lines.append("\t},")
    lines.append("}")
    with open(path, "w", encoding="utf8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def find_saved(argument=None):
    path = argument or os.environ.get(ENV) or (sorted(glob.glob(WTF)) or [None])[0]
    if not path or not os.path.exists(path):
        sys.exit("no Spoken_Developer.lua saved variables found (give the file, or set %s): "
                 "move a boss with /spokenbosscam, then /reload or log out in the game" % ENV)
    return path


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--force"]
    path = find_saved(args[0] if args else None)
    with open(path, encoding="utf8", errors="replace") as f:
        saved = saved_edits(f.read())
    with open(OUT, encoding="utf8") as f:
        kept_text = f.read()
    kept = kept_nudges(kept_text)
    with open(TEXTVIEW, encoding="utf8") as f, open(CAMERAS, encoding="utf8") as g:
        now = framing(f.read(), g.read())
    was = FRAMED.search(kept_text)
    if was and was.group(1) != now and "--force" not in sys.argv:
        sys.exit("the rows in %s were framed with %s, and TextView now frames with %s: move the bosses again in the game, "
                 "or pass --force to merge anyway" % (OUT, was.group(1), now))
    nudges, counts = merge(kept, saved)
    write(nudges, framed=now)
    print("from", path)
    print("replaced %(replaced)d rows, added %(added)d, removed %(removed)d, kept %(kept)d as they were, "
          "ignored %(ignored)d saved rows that change nothing" % counts)
    print({p: len(nudges[p]) for p in PLACES}, "models in", OUT)

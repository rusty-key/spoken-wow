"""QuestIT: the Italian community's quest translation, matched onto the corpus.

No client runs in Italian, so neither the world database nor a player's client has any
Italian text to give. QuestIT (by Drakanast, MIT; the quest text is
Blizzard's) translates it in an addon of its own and keeps doing so; tools/import_questit.py
reads a release of that addon and writes it as 'community' rows the site then edits like any
other translation.

HOW A TRANSLATION FINDS ITS LINE. QuestIT keys a quest's fields by quest id, and gossip and
book pages by a hash of the English text as the client shows it ("impronta", Text.lua's
Core.EnglishHash). Every quest field carries the same hash as `enHash`, which is what says
the Italian was translated from the English this corpus has: a quest Cataclysm rewrote, or
text that changed since, hashes differently and is left out. So every match here is by hash,
over our English `originalText` put into the shape the client would have shown:

  * $B is a line break, and $G is resolved -- once per gender, since a client shows one;
  * the player's name, class and race are the tokens again ($N, $C, $R), and so is any
    class or race name the text spells out (Core.GenericPlaceholders: "Mage" -> $C);
  * trailing whitespace and \\r go (Core.NormalizeText), ASCII letters are lowercased
    (Core.FoldCase), and the bytes are hashed h = h*31 + b mod 2^32 (Core.TextHash).

Our raw $N/$C/$R fold to the same $n/$c/$r the client-side substitution produces, so the
template and the screen agree without knowing who the player was.

WHAT IS LEFT OUT. `objectives` (not voiced here), OptionsIT (gossip buttons, not stored),
and everything from the Forever server's own content, which this corpus does not have.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

# QuestIT field -> quest_line source.
FIELDS = {"text": "accept", "progress": "progress", "reward": "complete"}

# Serialises the tables Data_it.lua and Names_en.lua build into JSON on stdout. Run by LuaJIT
# (or any Lua 5.1), which `make test-player` already needs: the files are Lua, and reading
# them with Lua is the one parser certain to agree with the addon that ships them.
_DUMP = r"""
QuestIT = {}
local dir = ...
assert(loadfile(dir .. "/Names_en.lua"))()
assert(loadfile(dir .. "/Data_it.lua"))()

local function str(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\"
    elseif c == "\n" then return "\\n" elseif c == "\r" then return "\\r"
    elseif c == "\t" then return "\\t" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function encode(v)
  local t = type(v)
  if t == "string" then return str(v) end
  if t == "number" then return string.format("%.17g", v) end
  if t == "boolean" then return tostring(v) end
  if t ~= "table" then error("cannot encode " .. t) end
  if #v > 0 then
    local out = {}
    for i = 1, #v do out[i] = encode(v[i]) end
    return "[" .. table.concat(out, ",") .. "]"
  end
  local out = {}
  for k, x in pairs(v) do out[#out + 1] = str(tostring(k)) .. ":" .. encode(x) end
  return "{" .. table.concat(out, ",") .. "}"
end

io.write(encode({
  names = QuestIT.NamesEN,
  quests = QuestIT.DataIT or {},
  gossip = QuestIT.GossipIT or {},
  books = QuestIT.BooksIT or {},
}))
"""


def load(directory: str | Path) -> dict:
    """A QuestIT release folder -> {version, names, quests, gossip, books}.

    `quests` is keyed by the quest id as a string, as JSON keys are.
    """
    directory = Path(directory).expanduser()
    lua = shutil.which("luajit") or shutil.which("lua5.1") or shutil.which("lua")
    if not lua:
        raise SystemExit("reading QuestIT needs a Lua interpreter (luajit), as make test-player does")
    out = subprocess.run([lua, "-", str(directory)], input=_DUMP, capture_output=True,
                         text=True, check=True).stdout
    data = json.loads(out)
    data["version"] = _version(directory / "QuestIT.toc")
    return data


def _version(toc: Path) -> str:
    for line in toc.read_text(encoding="utf-8").splitlines():
        if line.startswith("## Version:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


#------------------------------------------------------------------------------
# The hash
#------------------------------------------------------------------------------

_GENDER = re.compile(r"\$[Gg]\s*([^:;]*?)\s*:\s*([^:;]*?)\s*;")


def _word(name: str) -> re.Pattern:
    """Core.ciPattern: the name, any case, between Lua's %w frontiers (ASCII alphanumerics)."""
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.I)


class Hasher:
    """Core.EnglishHash over a corpus template, for one QuestIT release's names list."""

    def __init__(self, names: dict):
        # Already longest first in Names_en.lua, which is the order the addon applies them in.
        self._classes = [_word(n) for n in names.get("classes", [])]
        self._races = [_word(n) for n in names.get("races", [])]

    def forms(self, template: str, player_gender: str | None = None) -> list[str]:
        """The text a client shows for `template`, one per gender where the line has $G
        and the English row does not already say which."""
        text = template.replace("$b", "\n").replace("$B", "\n")
        if not _GENDER.search(text):
            return [text]
        genders = [player_gender] if player_gender in ("m", "f") else ["m", "f"]
        return [_GENDER.sub(r"\2" if g == "f" else r"\1", text) for g in genders]

    def hash(self, shown: str) -> str:
        for pattern in self._classes:
            shown = pattern.sub("$C", shown)
        for pattern in self._races:
            shown = pattern.sub("$R", shown)
        shown = shown.replace("\r\n", "\n")
        shown = re.sub(r"[ \t\n\r\v\f]+$", "", shown)
        shown = re.sub(r"[A-Z]", lambda m: m.group(0).lower(), shown)
        h = 0
        for byte in shown.encode("utf-8"):
            h = (h * 31 + byte) % 4294967296
        return f"{h:08x}"

    def hashes(self, template: str, player_gender: str | None = None) -> set[str]:
        return {self.hash(form) for form in self.forms(template, player_gender)}


def _hashes_of(entry: dict) -> set[str]:
    """An entry's enHash: one hash, or a list of them (one per form of the English)."""
    value = entry.get("enHash")
    if value is None:
        return set()
    return set(value) if isinstance(value, list) else {value}


#------------------------------------------------------------------------------
# Turning Italian into what quest_line stores
#------------------------------------------------------------------------------

_NPC_GENDER = re.compile(r"\$[Pp]\s*([^:;]*?)\s*:\s*([^:;]*?)\s*;")


def speak_npc_gender(text: str, npc_gender: str | None) -> str:
    """QuestIT's $Pmale:female; -- the speaker's gender, which Blizzard has no token for.

    The speaker is known per line (quest_line_speaker), so it is resolved here; the male
    form where nobody is.
    """
    return _NPC_GENDER.sub(r"\2" if npc_gender == "female" else r"\1", text)


#------------------------------------------------------------------------------
# Matching
#------------------------------------------------------------------------------

def quest_candidates(entry: dict, field: str) -> list[dict]:
    """A quest's translations of one field: the field itself, then "text#2", "text#3"...
    (a field whose English differs by who reads it, translated once per form)."""
    out = [entry[field]] if isinstance(entry.get(field), dict) else []
    prefix = field + "#"
    out += [v for k, v in sorted(entry.items()) if k.startswith(prefix) and isinstance(v, dict)]
    return out


def match_quest_line(hasher: Hasher, entry: dict | None, source: str, original: str,
                     player_gender: str | None) -> tuple[str | None, str]:
    """(Italian text, outcome) for one English quest line.

    outcome is 'matched', 'untranslated' (QuestIT has no such field) or 'changed' (it has
    one, translated from English this corpus does not have).
    """
    field = next((f for f, s in FIELDS.items() if s == source), None)
    if entry is None or field is None:
        return None, "untranslated"
    candidates = quest_candidates(entry, field)
    if not candidates:
        return None, "untranslated"
    ours = hasher.hashes(original, player_gender)
    for candidate in candidates:
        if ours & _hashes_of(candidate):
            return candidate["it"], "matched"
    return None, "changed"


def match_by_hash(hasher: Hasher, table: dict, original: str,
                  player_gender: str | None = None) -> str | None:
    """Italian for a gossip line or book page: QuestIT keys those by the hash alone."""
    for h in hasher.hashes(original, player_gender):
        if h in table:
            return table[h]["it"]
    return None

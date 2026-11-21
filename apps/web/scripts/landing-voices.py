"""
Builds the front page's voice samples for each language from the live site.

    py -3 -X utf8 apps/web/scripts/landing-voices.py [--hero] [lang ...]        (default: every language)

For each language it takes the same lines the English set uses (quests, gossip, places,
readables) plus four boss stories, by id, from spoken.quest's public API in that language.
A line is used only when the site holds a current recording of it, its text has no `$` token and
Whisper's word times match its words (MATCH_GATE). A quest or gossip line a language lacks is
replaced by a rule (same kind of speaker, next line with a recording); a place, readable or boss
that is missing is left out.

Writes public/landing/voice/<lang>/<part>-<n>.mp3 and src/components/landing/voices/<lang>.json.
Responses and audio are cached in $LANDING_VOICES_CACHE (default: temp dir), so a re-run asks the
site for nothing it has already been given.
"""
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = "https://spoken.quest/api"
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
AUDIO_OUT = os.path.join(WEB, "public", "landing", "voice")
DATA_OUT = os.path.join(WEB, "src", "components", "landing", "voices")
HERO_OUT = os.path.join(WEB, "src", "components", "landing", "hero")
CACHE = os.environ.get("LANDING_VOICES_CACHE") or os.path.join(tempfile.gettempdir(), "landing-voices")
LANGS = ["enUS", "deDE", "esES", "esMX", "frFR", "itIT", "plPL", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "viVN"]
CJK = {"zhCN", "zhTW"}  # written without spaces between words


def whisper_lang(lang):
    return lang[:2]


def bcp47(lang):
    return f"{lang[:2]}-{lang[2:]}"


MATCH_GATE = 0.85
# Whisper answers Chinese in Simplified characters unless told otherwise; the clips' text is Traditional.
PROMPT = {"zhTW": "以下是繁體中文的句子。"}
BARS = 96
PAUSE = 0.25
I = "/landing/icons/"
ICON_VOICES = {("orc", "male"), ("nightelf", "female"), ("dwarf", "male"), ("tauren", "female"),
               ("human", "male"), ("human", "female")}

# The lines the English set uses, in order.
QUESTS = ["f:8566:orc-male-shady", "f:1282:nightelf-female-standard", "f:3503:dwarf-male-guard", "f:765:tauren-female-official"]
GOSSIP = ["g:072bbffeb611bfaace92898c40fcf12c", "g:0131cac34dfe2c78da45684a609b5c32",
          "g:06c875e93cfe3fa732719481017369a8", "g:01054e0f81cd813f7dd94d9b5ab20dcc"]
PLACES = [("Mirage Flats", "zone-badlands.png"), ("Razor Hill Barracks", "zone-durotar.png"),
          ("Circle of West Binding", "zone-arathi.png"), ("Stonebull Lake", "zone-mulgore.png")]
READABLES = [("b:48", "Letter", "game-letter.png"), ("b:62", "Tablet", "game-tablet.png"),
             ("b:1151", "Journal", "game-journal.png"), ("b:911", "Scroll", "game-quests.png")]
BOSSES = {"boss:36:captain greenskin": "boss-captain-greenskin.png", "boss:33:baron silverlaine": "boss-baron-silverlaine.png",
          "boss:43:mutanus the devourer": "boss-mutanus.png", "boss:90:grubbis": "boss-grubbis.png"}


def log(*a):
    print(*a, flush=True)


def fetch(url, binary=False):
    """GET with an on-disk cache. Returns parsed JSON (or bytes), or None on a 404."""
    os.makedirs(CACHE, exist_ok=True)
    key = re.sub(r"[^A-Za-z0-9._-]+", "_", url.replace(API, ""))[:180]
    path = os.path.join(CACHE, key + (".bin" if binary else ".json"))
    if os.path.exists(path):
        data = open(path, "rb").read()
        if data == b"404":
            return None
        return data if binary else json.loads(data.decode("utf-8"))
    time.sleep(PAUSE)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "spoken-landing-voices"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (404, 400):
            open(path, "wb").write(b"404")
            return None
        raise
    open(path, "wb").write(data)
    return data if binary else json.loads(data.decode("utf-8"))


def q(**params):
    return urllib.parse.urlencode(params)


def lines(kind, lang, **params):
    d = fetch(f"{API}/{kind}/search?{q(lang=lang, **params)}")
    return (d or {}).get("lines", [])


def line_by_id(kind, lang, line_id):
    found = lines(kind, lang, line=line_id)
    return found[0] if found else None


def usable_text(text):
    return bool(text) and "$" not in text and "�" not in text


# ---------------------------------------------------------------- Whisper alignment
_model = None


def whisper_model():
    global _model
    if _model is None:
        import site
        for base in site.getsitepackages():
            for sub in ("cublas", "cudnn", "cuda_nvrtc"):
                d = os.path.join(base, "nvidia", sub, "bin")
                if os.path.isdir(d):
                    os.add_dll_directory(d)
                    os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]
        from faster_whisper import WhisperModel
        try:
            _model = WhisperModel("large-v3", device="cuda", compute_type="float16")
        except Exception as e:  # no GPU: slower but the same answer
            log("cuda unavailable, using cpu:", e)
            _model = WhisperModel("large-v3", device="cpu", compute_type="int8")
    return _model


def norm(word):
    word = unicodedata.normalize("NFKC", word).lower()
    return "".join(c for c in word if unicodedata.category(c)[0] in "LN")


def display_words(text, lang):
    """The words the page lights, one per entry. Chinese has no spaces: one character each."""
    if lang in CJK:
        return [c for c in re.sub(r"\s+", "", text) if c]
    return text.split()


def align(path, text, lang):
    """Start time of each display word, and the share of words Whisper matched."""
    words = display_words(text, lang)
    model = whisper_model()
    segs, _ = model.transcribe(path, language=whisper_lang(lang), word_timestamps=True, vad_filter=False,
                               condition_on_previous_text=False, beam_size=5,
                               initial_prompt=PROMPT.get(lang))
    heard = []  # (normalized, start)
    for seg in segs:
        for w in seg.words or []:
            if lang in CJK:
                for ch in w.word.strip():
                    if norm(ch):
                        heard.append((norm(ch), w.start))
            elif norm(w.word):
                heard.append((norm(w.word), w.start))
    mine = [norm(w) for w in words]
    sm = difflib.SequenceMatcher(None, [h[0] for h in heard], mine, autojunk=False)
    times = [None] * len(words)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            if mine[b + k]:
                times[b + k] = heard[a + k][1]
    matched = sum(1 for t in times if t is not None) / max(1, sum(1 for m in mine if m))
    known = [i for i, t in enumerate(times) if t is not None]
    if not known:
        return words, [0.0] * len(words), 0.0
    import numpy as np
    times = np.interp(range(len(times)), known, [times[k] for k in known]).tolist()
    for i in range(1, len(times)):  # never backwards
        times[i] = max(times[i], times[i - 1])
    return words, times, matched


# ---------------------------------------------------------------- audio
def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    base = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
    for root, _, files in os.walk(base):
        if "ffmpeg.exe" in files:
            return os.path.join(root, "ffmpeg.exe")
    raise SystemExit("ffmpeg not found")


FF = None


def encode(src, dst):
    global FF
    FF = FF or ffmpeg()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    r = subprocess.run([FF, "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "32000", "-b:a", "56k", dst])
    if r.returncode:
        raise SystemExit("ffmpeg failed on " + src)
    r = subprocess.run([FF, "-v", "error", "-i", dst, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], capture_output=True)
    import numpy as np
    pcm = np.frombuffer(r.stdout, dtype=np.float32)
    n = len(pcm)
    segs = (pcm[i * n // BARS:(i + 1) * n // BARS] for i in range(BARS))
    peaks = [float(np.abs(seg).max()) if len(seg) else 0.0 for seg in segs]
    top = max(peaks) or 1.0
    return round(len(pcm) / 8000, 2), [round(max(0.06, (p / top) ** 0.7), 2) for p in peaks]


# ---------------------------------------------------------------- one clip
def build_clip(lang, part, n, audio_url, text, name, sub, icon):
    """The clip's data, or None when its audio is missing or its words do not line up."""
    if not usable_text(text):
        return None
    raw = fetch(audio_url, binary=True)
    if not raw:
        return None
    src = os.path.join(CACHE, "audio", lang, f"{part}-{n}.src")
    os.makedirs(os.path.dirname(src), exist_ok=True)
    open(src, "wb").write(raw)
    words, times, matched = align(src, text, lang)
    if matched < MATCH_GATE:
        log(f"    reject {name!r}: only {matched:.0%} of the words matched")
        return None
    mp3 = os.path.join(AUDIO_OUT, lang, f"{part}-{n}.mp3")
    duration, peaks = encode(src, mp3)
    times = [round(min(t, duration), 2) for t in times]
    voice = {"label": name, "name": name, "sub": sub, "icon": icon,
             "audio": f"/landing/voice/{lang}/{part}-{n}.mp3", "duration": duration, "peaks": peaks,
             "words": words, "times": times, "lang": bcp47(lang)}
    if lang in CJK:
        voice["joiner"] = ""
    log(f"    ok {name!r} ({matched:.0%}, {duration}s)")
    return voice


def good_line(l):
    return l and l.get("hasAudio") and not l.get("stale") and not l.get("dirty") and usable_text(l.get("text", ""))


def icon_for(l):
    if os.path.exists(os.path.join(WEB, "public", "landing", "icons", f"npc-{l['npcId']}.png")):
        return f"{I}npc-{l['npcId']}.png"
    key = (l.get("race"), l.get("gender"))
    return f"{I}voice-{key[0]}-{key[1]}.png" if key in ICON_VOICES else None


def quest_like(lang, part, ids):
    out, used, speakers = [], set(), set()
    # A Chinese character says about what three Latin letters do; one bound for both drops most Chinese lines.
    low, high = (20, 140) if lang in CJK else (60, 420)

    def take(l):
        icon = icon_for(l)
        if not icon or l["lineId"] in used or l["npcName"] in speakers or not good_line(l) or not low <= len(l["text"]) <= high:
            return False
        sub = "Gossip" if part == "gossip" else (l.get("questTitle") or "Gossip")
        v = build_clip(lang, part, len(out) + 1, f"{API}/quests/audio/{l['audioPath']}?{q(lang=lang)}" if lang != "enUS"
                       else f"{API}/quests/audio/{l['audioPath']}", l["text"], l["npcName"], sub, icon)
        if v:
            used.add(l["lineId"])
            speakers.add(l["npcName"])
            out.append(v)
        return bool(v)

    for lid in ids:
        l = line_by_id("quests", lang, lid)
        if l:
            take(l)
        if len(out) == 4:
            return out
    for page in (1, 2, 3):  # replacements: the next lines with a recording, by the same rule
        for l in lines("quests", lang, source=("accept,complete,followup" if part == "quests" else "gossip"), limit=100, page=page):
            if len(out) == 4:
                return out
            take(l)
    return out


def current(l):
    return l and l.get("take") and l.get("state") == "current" and not l.get("dirty") and usable_text(l.get("spoken", ""))


def spoken_part(lang, part, items):
    """Clips for a part whose lines have one take each. items: (line id, field holding the name, sub, icon)."""
    out = []
    for lid, name_field, sub, icon in items:
        l = line_by_id(part, lang, lid)
        if not current(l):
            continue
        v = build_clip(lang, part, len(out) + 1, f"{API}/{part}/audio/{l['file']}.mp3?{q(lang=lang)}",
                       l["spoken"], l[name_field], sub(l), I + icon)
        if v:
            out.append(v)
    return out


def places(lang):
    items = []
    for name_en, icon in PLACES:
        found = [l for l in lines("places", "enUS", q=name_en) if l["name"] == name_en]
        if found:
            items.append((found[0]["id"], "name", lambda l: l["zoneName"], icon))
    return spoken_part(lang, "places", items)


def readables(lang):
    return spoken_part(lang, "readables", [(lid, "title", lambda l, kind=kind: kind, icon) for lid, kind, icon in READABLES])


def bosses(lang):
    return spoken_part(lang, "bosses", [(lid, "name", lambda l: l["instanceName"], icon) for lid, icon in BOSSES.items()])


# ---------------------------------------------------------------- the hero's subtitle lines
HERO = [("quests", "quests", "q:33:accept"), ("spoken", "gossip", "g:206f059d0c629c5d37a5efc62769a4a3"),
        ("zones", "places", "z:1429")]


def short_text(text, lang):
    """The first sentences of a line that fit the subtitle box: 40 to 110 characters, 20 to 50 in Chinese."""
    cjk = lang in CJK
    low, high = (20, 50) if cjk else (40, 110)
    text = re.sub(r"\s+", " ", text).strip()
    # Chinese stops are not followed by a space, so they end a sentence on their own.
    parts = re.findall(r".+?(?:[.!?…]+[\"'”’」』)]*(?:\s+|$)|[。！？]+[”’」』)]*|$)", text)
    out = ""
    for part in parts:
        if out and len(out) + len(part) > high:
            break
        out += part
        if len(out) >= low:
            break
    out = out.strip()
    if len(out) > high + high // 5:  # one long sentence: cut it at a comma, or else at a space
        cut = max(out.rfind(c, 0, high) for c in (",", "，", "、", ";"))
        if cut < low:
            cut = out.rfind(" ", 0, high) if not cjk else high
        out = out[:cut].rstrip(",;，、 ") + "…"
    return out


def hero(lang):
    """Three subtitle lines for the hero in the page's language, from the same corpus as the players."""
    out = []
    cjk = lang in CJK
    for icon, kind, lid in HERO:
        l = line_by_id("places" if kind == "places" else "quests", lang, lid)
        if not l:
            return None
        if kind == "places":
            name, sub, text = l["name"], None, l["spoken"]
        else:
            name, sub, text = l["npcName"], l.get("questTitle") if kind == "quests" else None, l["text"]
        if not name or not usable_text(text or ""):
            return None
        text = short_text(text, lang)
        words = [text[i:i + 2] for i in range(0, len(text), 2)] if cjk else text.split(" ")
        line = {"icon": icon, "name": name, "subtitle": sub, "kind": kind, "words": words}
        if cjk:
            line["joiner"] = ""
        out.append(line)
    return out


def write_json(folder, lang, data):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, lang + ".json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def write_hero(lang):
    lines_ = hero(lang)
    if lines_:
        write_json(HERO_OUT, lang, lines_)
    else:
        log("  hero: no lines, the page keeps English")


def build(lang):
    log(f"== {lang}")
    # Clip numbers are reused on every run: a run with fewer clips would leave the old files shipped.
    shutil.rmtree(os.path.join(AUDIO_OUT, lang), ignore_errors=True)
    data = {}
    if lang != "enUS":  # English's quests, gossip, places and readables stay in voices.ts
        for part, fn in (("quests", lambda: quest_like(lang, "quests", QUESTS)),
                         ("gossip", lambda: quest_like(lang, "gossip", GOSSIP)),
                         ("places", lambda: places(lang)), ("readables", lambda: readables(lang))):
            log("  " + part)
            data[part] = fn()
    log("  bosses")
    data["bosses"] = bosses(lang)
    write_json(DATA_OUT, lang, data)
    log("  ->", {k: len(v) for k, v in data.items()})
    write_hero(lang)


if __name__ == "__main__":
    args = sys.argv[1:]
    only_hero = "--hero" in args  # the subtitle lines alone, without the clips
    for code in [a for a in args if a != "--hero"] or LANGS:
        write_hero(code) if only_hero else build(code)

-- The envelope a contribution travels in. Run with `make test-player`.
--
-- The reader is in TypeScript (apps/web/src/lib/contributions/envelope.ts) and the two must
-- agree exactly, which is why this file also writes the fixtures that one is tested against.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
local env = stub.LoadSpoken(SPOKEN)
local C = env.Spoken.Contribute

local fields = { { "addon", "SpokenQuests/1.4.2" }, { "locale", "enUS" }, { "quest", "9123" } }

local written = C:Envelope("quests", fields, "First line.\nSecond line.")

Expect("the first line names the version and the source",
    written:match("^!SPOKEN1 quests\n") ~= nil, true)
Expect("a field is one key=value line", written:match("\nquest=9123\n") ~= nil, true)
Expect("the text is fenced", written:match("\ntext<<\nFirst line%.\nSecond line%.\n>>\n") ~= nil, true)
Expect("the checksum closes it", written:match("\nsum=%d+\n$") ~= nil, true)

-- The checksum covers everything before its own line, so a tampered byte is visible.
local body, sum = written:match("^(.*\n)sum=(%d+)\n$")
Expect("the checksum is the checksum of the body", C:Checksum(body), tonumber(sum))

local tampered = body:gsub("9123", "9124")
Expect("...and does not match a changed body", C:Checksum(tampered) ~= tonumber(sum), true)

-- A page whose own words are ">>" would otherwise end the block early.
local fenced = C:Envelope("readables", { { "page", "1" } }, "before\n>>\nafter")
Expect("a >> line in the text is escaped", fenced:match("\n\\>>\n") ~= nil, true)
Expect("...and the real fence still closes the block", fenced:match("\nafter\n>>\nsum=") ~= nil, true)

local none = C:Envelope("places", { { "map", "1537" } }, nil)
Expect("an envelope with no text has no fence", none:match("text<<") == nil, true)

Expect("an unknown source is refused", C:Envelope("mail", { { "page", "1" } }, "x"), nil)

------------------------------------------------------------------------------- whole words
-- A name next to punctuation of any script is the name: a guillemet and its no-break space, the
-- ellipsis, a curly apostrophe, the dash, the fullwidth comma and the ideographic stop. Next to a
-- letter it is part of a longer word, except in Hangul and Han, which put no space between words.
local function Swap(text) return C:ReplaceWord(text, "Grimbalor", "$N") end
Expect("a name in guillemets with no-break spaces is swapped",
    Swap("\194\171\194\160Grimbalor\194\160\194\187"), "\194\171\194\160$N\194\160\194\187")
Expect("...before an ellipsis", Swap("Grimbalor\226\128\166 ok"), "$N\226\128\166 ok")
Expect("...before a curly apostrophe", Swap("Grimbalor\226\128\153s axe"), "$N\226\128\153s axe")
Expect("...between dashes", Swap("\226\128\148Grimbalor\226\128\148"), "\226\128\148$N\226\128\148")
Expect("...before a fullwidth comma", Swap("Grimbalor\239\188\140\228\189\160\229\165\189"), "$N\239\188\140\228\189\160\229\165\189")
Expect("...before an ideographic stop and in corner brackets",
    Swap("\227\128\140Grimbalor\227\128\141\227\128\130"), "\227\128\140$N\227\128\141\227\128\130")
Expect("...before an exclamation mark", Swap("Grimbalor! ok"), "$N! ok")
Expect("...but not inside a word with an accented letter", Swap("Grimbalor\195\161"), "Grimbalor\195\161")
Expect("...a Cyrillic one before it", Swap("\208\144Grimbalor"), "\208\144Grimbalor")
Expect("...but beside a Han character it is swapped", Swap("Grimbalor\228\189\160"), "$N\228\189\160")
Expect("a Korean name before a particle is swapped",
    C:ReplaceWord("\237\153\141\234\184\184\235\143\153\235\139\152, ok", "\237\153\141\234\184\184\235\143\153", "$N"), "$N\235\139\152, ok")
Expect("an accented name is swapped before the multiplication sign",
    C:ReplaceWord("Z\195\182pf\195\151", "Z\195\182pf", "$N"), "$N\195\151")
Expect("a field value never spans lines",
    C:Envelope("quests", { { "title", "A\nB" } }, nil):match("\ntitle=A B\n") ~= nil, true)

-- An empty string is deliberately folded into "no text", the same as nil: a fence around
-- nothing would tell the reader nothing the fields don't already say.
local emptyText = C:Envelope("readables", { { "page", "1" } }, "")
Expect("an empty string text has no fence, like nil", emptyText:match("text<<") == nil, true)

------------------------------------------------------------------------------- the fence, exactly
-- A line only *starting* with ">>" is not the fence and must survive untouched -- escaping it
-- would corrupt a contributed line like ">>see attached", and the reader's exact-match
-- unescape (only a line that IS "\+>>" loses one backslash) would never undo it.
local trailer = C:Envelope("readables", { { "page", "1" } }, "before\n>>trailer\nafter")
Expect("a line only starting with >> is not escaped", trailer:match("\n>>trailer\n") ~= nil, true)
Expect("...and gains no backslash", trailer:match("\\>>trailer") == nil, true)

-- A line that was already "\>>" in the player's own text must come back out as "\>>": the
-- reader strips exactly one backslash from a line matching ^\+>>$, so the writer adds exactly
-- one every time, however many backslashes were already there.
local already = C:Envelope("readables", { { "page", "1" } }, "before\n" .. "\\>>" .. "\nafter")
Expect("an already-escaped \\>> line gains one more backslash", already:match("\n\\\\>>\n") ~= nil, true)

local doubled = C:Envelope("readables", { { "page", "1" } }, "before\n" .. "\\\\>>" .. "\nafter")
Expect("two backslashes before >> become three", doubled:match("\n\\\\\\>>\n") ~= nil, true)

-- CRLF normalises to \n before a line is tested against the fence pattern, same as Flatten.
local crlf = C:Envelope("readables", { { "page", "1" } }, "line1\r\n>>\r\nline2")
Expect("a \\r\\n-terminated >> line is still recognised and escaped",
    crlf:match("\nline1\n\\>>\nline2\n>>\nsum=") ~= nil, true)

-- No trailing newline in the text closes the fence directly under the last line; a trailing
-- newline in the text is data and survives as a blank line before the fence.
local noTrailing = C:Envelope("readables", { { "page", "1" } }, "a\nb")
Expect("no trailing newline in the text: the fence follows the last line directly",
    noTrailing:match("\na\nb\n>>\n") ~= nil, true)

local trailingNewline = C:Envelope("readables", { { "page", "1" } }, "a\nb\n")
Expect("a trailing newline in the text becomes a blank line before the fence",
    trailingNewline:match("\na\nb\n\n>>\n") ~= nil, true)

------------------------------------------------------------------------------- Encode / Link
-- Known base64 vectors (RFC 4648's own "f"/"fo"/"foo"... examples), unpadded: none of them
-- contain a "+" or "/", so the "url-safe" alphabet swap makes no visible difference here, but a
-- wrong bit-shuffle would still show up as a wrong letter.
local vectors = {
    { "", "" }, { "f", "Zg" }, { "fo", "Zm8" }, { "foo", "Zm9v" }, { "foob", "Zm9vYg" },
    { "fooba", "Zm9vYmE" }, { "foobar", "Zm9vYmFy" },
}
for _, v in ipairs(vectors) do
    Expect(("base64url(%q) matches the known vector"):format(v[1]), C:Base64URL(v[1]), v[2])
end


local function RoundTrips(label, envelope)
    local encoded = C:Encode(envelope)
    Expect(label .. ": Encode produces something", type(encoded) == "string" and encoded ~= "", true)
    Expect(label .. ": the alphabet is base64url only", encoded:match("^[A-Za-z0-9%-_]+$") ~= nil, true)
    local inflated = H.DecodeFragment(encoded)
    Expect(label .. ": deflate-raw round trips to the exact envelope", inflated, envelope)
end

RoundTrips("plain quest envelope", written)
RoundTrips("Cyrillic quest envelope", C:Envelope("quests", { { "quest", "1" } }, "Убей шестерых.\n\nПотом возвращайся."))
RoundTrips("an escaped >> fence line", fenced)

Expect("Encode refuses a nil envelope", C:Encode(nil), nil)
Expect("Encode refuses an empty envelope", C:Encode(""), nil)

local link = C:Link("https://spoken.rusty.one/contribute", written)
Expect("Link carries the base URL", link:match("^https://spoken%.rusty%.one/contribute#e1=") ~= nil, true)
Expect("Link's fragment is exactly Encode's output", link, "https://spoken.rusty.one/contribute#e1=" .. C:Encode(written))
Expect("Link refuses when Encode would", C:Link("https://x", nil), nil)

-- A cap with no boundary is not a cap: this pins that an oversized encode is refused rather
-- than handed to the player as a URL nothing can reliably paste. Genuine randomness, not a
-- repeated phrase or a hand-rolled PRNG -- deflate erases both of those down to almost nothing
-- (tried first; a naive LCG's low bits, and even a Checksum-driven sequence, both turned out
-- patterned enough to compress to a few percent of their size), which would never reach the
-- cap this is supposed to test.
-- /dev/urandom where the system has one; on Windows, which has none, LuaJIT's own generator, a
-- Tausworthe whose output deflate cannot shrink the way it shrinks an LCG's.
local noise = {}
local urandom = io.open("/dev/urandom", "rb")
if urandom then
    local bytes = urandom:read(50000)
    urandom:close()
    for i = 1, #bytes do
        noise[i] = string.char(33 + (bytes:byte(i) % 90))
    end
else
    math.randomseed(os.time())
    for i = 1, 50000 do
        noise[i] = string.char(33 + math.random(0, 89))
    end
end
local huge = C:Envelope("readables", { { "page", "1" } }, table.concat(noise))
Expect("Link refuses a result over its cap", C:Link("https://x", huge), nil)

-- The fixture Encode itself produces, so the TypeScript decoder is pinned against the exact
-- same bytes the Lua encoder emits -- not a second, hand-rolled encoding of the same fixture.
if os.getenv("SPOKEN_WRITE_FIXTURES") then
    local dir = here .. "/../fixtures/contributions/"
    local bookFixture = assert(io.open(dir .. "readables-page.txt", "r")):read("*a")
    local file = assert(io.open(dir .. "readables-page.e1.txt", "w"))
    file:write(C:Encode(bookFixture))
    file:close()
end

-- The fixtures the TypeScript reader is tested against.
--
-- Written by the writer itself, so the two implementations are held together by a file rather
-- than by two people reading the same paragraph. `make contribute-fixtures` rewrites them;
-- a diff in that output is the format changing, and the reader's tests fail in the same commit.
if os.getenv("SPOKEN_WRITE_FIXTURES") then
    local dir = here .. "/../fixtures/contributions/"
    local function Write(name, body)
        local file = assert(io.open(dir .. name, "w"))
        file:write(body)
        file:close()
    end

    Write("quests-accept.txt", C:Envelope("quests", {
        { "addon", "SpokenQuests/1.4.2" }, { "build", "1.12.1/5875" }, { "locale", "ruRU" },
        { "quest", "9123" }, { "event", "accept" }, { "npc", "12345 Deathguard Linnea" },
        { "title", "A Rough Start" },
    }, "Убей шестерых.\n\nПотом возвращайся."))

    Write("readables-page.txt", C:Envelope("readables", {
        { "addon", "SpokenBooks/1.1.0" }, { "build", "3.3.5/12340" }, { "locale", "enUS" },
        { "page", "1839201" }, { "book", "Ledger of Nothing" }, { "number", "2" },
    }, "A page no corpus has ever held.\n\nWritten for this test alone."))

    Write("places-subzone.txt", C:Envelope("places", {
        { "addon", "SpokenZones/2.0.1" }, { "build", "11509" }, { "locale", "enUS" },
        { "map", "1537" }, { "zone", "Ironforge" }, { "subzone", "A Nook With No Lore" },
        { "x", "0.55" }, { "y", "0.47" },
    }, nil))

    -- The main places gap, not an edge case: GetSubZoneText() returns "" for the open part of a
    -- zone, and Spoken_Places/Contribute.lua always writes the field (CaptureContribution never
    -- omits "subzone" the way it omits "x"/"y"), so the wire shape is subzone="" rather than
    -- the field being absent -- pinning that shape is the whole point of this fixture.
    Write("places-zone.txt", C:Envelope("places", {
        { "addon", "SpokenZones/2.0.1" }, { "build", "11509" }, { "locale", "enUS" },
        { "map", "1537" }, { "zone", "Ironforge" }, { "subzone", "" },
    }, nil))

    Write("quests-fenced.txt", C:Envelope("quests", {
        { "addon", "SpokenQuests/1.4.2" }, { "build", "1.12.1/5875" }, { "locale", "enUS" },
        { "quest", "1" }, { "event", "accept" },
    }, "before\n>>\nafter"))

    -- Carries the observation fields a modern client sends and an old one does not: kind,
    -- model, sex, creature. model=122055 maps to tauren/male in character-models.json, which
    -- is what pins the route test's client-provenance resolution to a known answer.
    Write("quests-observed.txt", C:Envelope("quests", {
        { "addon", "SpokenQuests/2.0.4" }, { "build", "1.60.1/69913" }, { "locale", "enUS" },
        { "quest", "76156" }, { "event", "progress" }, { "npc", "9123 Boarton Shadetotem" },
        { "kind", "creature" }, { "model", "122055" }, { "sex", "2" }, { "creature", "Humanoid" },
        { "title", "Stalk With The Earthmother" },
    }, "We'll need to work on your stealth skills, druid."))
end

------------------------------------------------------------------------------- reading one back
-- Parse gives back what Envelope was built from, so a kept line can be rewritten and built
-- again byte for byte: fences, escapes, an empty field and a value with "=" in it.
local function RoundTrip(source, fields, text)
    local built = C:Envelope(source, fields, text)
    local readSource, readFields, readText = C:Parse(built)
    return readSource == source and C:Envelope(readSource, readFields, readText) == built, readFields, readText
end
local same, readFields, readText = RoundTrip("quests",
    { { "quest", "3117" }, { "npc", "" }, { "title", "a=b" } }, "before\n>>\n\\>>\n>>trailer\nafter")
Expect("Parse reads an envelope back into the same envelope", same, true)
Expect("...its text unescaped", readText, "before\n>>\n\\>>\n>>trailer\nafter")
Expect("...an empty field kept", readFields[2][1] .. "=" .. readFields[2][2], "npc=")
Expect("...a value keeping its =", readFields[3][2], "a=b")
Expect("an envelope with no text reads back with none", select(3, C:Parse(C:Envelope("places", { { "map", "1" } }, nil))), nil)
Expect("anything else is not an envelope", C:Parse("hello"), nil)
do
    local built = C:Envelope("quests", { { "quest", "3117" } }, "Well met.")
    Expect("an envelope whose words changed after it was signed is not read", C:Parse((built:gsub("Well met", "Ill met"))), nil)
    Expect("...nor one whose field did", C:Parse((built:gsub("quest=3117", "quest=3118"))), nil)
    Expect("...nor one cut short", C:Parse(built:sub(1, -3)), nil)
    Expect("a text that holds a sum= line of its own reads back whole",
        select(3, C:Parse(C:Envelope("quests", {}, "a\nsum=5\nb"))), "a\nsum=5\nb")
end

os.exit(Failures() == 0 and 0 or 1)

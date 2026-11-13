setfenv(1, SpokenEnv)

-- The format a contribution leaves the game in.
--
-- Plain text, not serialised and not compressed. An envelope is a few kilobytes, and
-- LibDeflate plus LibSerialize would be two vendored libraries and a pure-Lua inflate to save
-- bytes nobody pays for. It also lets the player read what they are about
-- to send, which matters when the payload is their own client's text.
--
-- THE READER IS apps/web/src/lib/contributions/envelope.ts AND THE TWO MUST AGREE. Fixtures
-- written by tests/lua/contribute_envelope_test.lua are what holds them together; the failure
-- mode otherwise is the one Checksum.lua describes -- silent, and indistinguishable from a
-- corpus that simply has nothing.

local VERSION = 1
local SOURCES = { quests = true, places = true, readables = true }

local MODULUS = 2147483647
local FACTOR = 31

local byte, len, format = string.byte, string.len, string.format
local gsub = gsub or string.gsub
local floor = math.floor

Contribute = {}
Spoken.Contribute = Contribute

-- The alphabet a browser's atob can read once '-'/'_' are swapped back to '+'/'/': RFC 4648's
-- "base64url", unpadded. CHARS[0..63] rather than repeated string.sub calls, since every byte
-- triplet below needs four lookups and Lua 5.1 has no bitwise operators to make those lookups
-- with anything faster than a table index.
local BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local BASE64URL_CHARS = {}
for i = 1, len(BASE64URL_ALPHABET) do
    BASE64URL_CHARS[i - 1] = BASE64URL_ALPHABET:sub(i, i)
end

--- Arithmetic base64url (RFC 4648 section 5), no padding.
---
--- Multiply/floor/mod in place of the shifts and masks a bitwise base64 would use, the same
--- trade Checksum makes: Lua 5.1 -- every client this ships to -- has no bitwise operators, and
--- every intermediate here (at most 16777215, three bytes wide) stays exact in a double. No
--- padding, because a fragment and atob's own '+/' swap both work without a trailing '=' to
--- strip first, and stripping it is one more thing the browser side would have to remember.
function Contribute:Base64URL(data)
    local out, n, i = {}, len(data), 1
    while i <= n do
        local b1, b2, b3 = byte(data, i), byte(data, i + 1), byte(data, i + 2)
        local group = b1 * 65536 + (b2 or 0) * 256 + (b3 or 0)
        out[#out + 1] = BASE64URL_CHARS[floor(group / 262144) % 64]
        out[#out + 1] = BASE64URL_CHARS[floor(group / 4096) % 64]
        if b2 then
            out[#out + 1] = BASE64URL_CHARS[floor(group / 64) % 64]
        end
        if b3 then
            out[#out + 1] = BASE64URL_CHARS[group % 64]
        end
        i = i + 3
    end
    return table.concat(out)
end

-- The full URL, including the "https://.../contribute#e1=" prefix, above which Link refuses to
-- hand the player a link at all.
--
-- Not chosen against a server or nginx limit -- the fragment never reaches either, which is the
-- whole reason for putting the payload there instead of a query string. It exists only to catch
-- a runaway encode: a 6 KB English book page, the longest thing this feature carries, measured
-- under 1.5 KB of URL at level-5 deflate, so a result past this cap is not a big page, it is
-- deflate failing to help at all -- most likely already-compressed or near-random bytes reaching
-- Encode. Ten times that measured case, rounded up, leaves headroom for a genuinely long page
-- while still refusing to ship a link nobody could reliably paste.
local LINK_CAP = 15000

--- The base64url form of the compressed envelope, or nil when either step fails.
---
--- CompressDeflate, not CompressZlib: the browser's DecompressionStream only speaks
--- "deflate-raw", and a zlib header/checksum it would never read would only cost bytes for
--- nothing. Level 5 measured enough ratio to matter (a synthetic 6 KB English page compresses to
--- roughly a fifth its size; a Cyrillic sample compresses further, being 2 bytes/character in
--- UTF-8) at a cost cheap enough that Show() -- never HasGap/Refresh; see the perf comment at
--- each addon's own Show() -- can pay it once per click without the player noticing.
function Contribute:Encode(envelope)
    if type(envelope) ~= "string" or envelope == "" then
        return nil
    end
    local lib = LibStub and LibStub:GetLibrary("LibDeflate", true)
    if not lib then
        return nil
    end
    local compressed = lib:CompressDeflate(envelope, { level = 5 })
    if type(compressed) ~= "string" or compressed == "" then
        return nil
    end
    return self:Base64URL(compressed)
end

--- The full contribute URL for an envelope, or nil when Encode fails or the URL would exceed
--- LINK_CAP -- either way, the caller's job is to fall back to the raw envelope and address.
function Contribute:Link(baseURL, envelope)
    local encoded = self:Encode(envelope)
    if not encoded then
        return nil
    end
    local url = format("%s#e1=%s", baseURL, encoded)
    if len(url) > LINK_CAP then
        return nil
    end
    return url
end

--- The integrity check on a pasted envelope.
---
--- Deliberately not SpokenReadables:ChecksumOf, whose number is a frozen page id: coupling an id
--- format to a transport format means neither can change without the other. The arithmetic is
--- the same because the constraint is the same -- Lua 5.1 has no bitwise operators and the
--- modulus is the largest signed 32-bit prime, so every intermediate stays exact in a double.
function Contribute:Checksum(text)
    if type(text) ~= "string" then
        return 0
    end
    local sum = len(text) % MODULUS
    for i = 1, len(text) do
        sum = (sum * FACTOR + byte(text, i)) % MODULUS
    end
    return sum
end

-- A value is one line. A newline inside one would be read as the end of the field, so it
-- becomes a space rather than being dropped: a title that loses a word reads as a typo, while
-- a title that loses its line break reads as a title.
local function Flatten(value)
    value = gsub(tostring(value or ""), "\r\n", "\n")
    value = gsub(value, "[\r\n]", " ")
    value = gsub(value, "^%s+", "")
    value = gsub(value, "%s+$", "")
    return value
end

-- A line that is *entirely* backslashes-then-closing-angles gains one more backslash, so the
-- fence below is the only ">>" the reader can meet at the start of a line. The reader strips
-- exactly one backslash from a line matching ^\+>>$ -- so a line already read "\>>" must come
-- back as "\>>" untouched by anything else on it, which is why this only ever touches a line
-- whose entire content is backslashes then ">>": a line merely starting with ">>" (">>trailer")
-- is not the fence and must survive unescaped, or the reader's exact-match unescape would
-- leave a stray backslash in front of it.
local function Fence(text)
    text = gsub(tostring(text), "\r\n", "\n")
    text = gsub(text, "\r", "\n")

    local lines = {}
    local pos = 1
    while true do
        local nl = string.find(text, "\n", pos, true)
        local line = text:sub(pos, nl and nl - 1 or nil)
        if line:match("^\\*>>$") then
            line = "\\" .. line
        end
        lines[#lines + 1] = line
        if not nl then
            break
        end
        pos = nl + 1
    end

    return table.concat(lines, "\n")
end

---@param source string  "quests" | "places" | "readables"
---@param fields table   array of { key, value }, in the order they are written
---@param text string|nil the one multi-line field, or nil where the source has none
---@return string|nil     the envelope, or nil for a source this format does not carry
function Contribute:Envelope(source, fields, text)
    if not SOURCES[source] then
        return nil
    end

    local out = { format("!SPOKEN%d %s", VERSION, source) }
    for _, field in ipairs(fields or {}) do
        local key = Flatten(field[1])
        if key ~= "" then
            out[#out + 1] = format("%s=%s", key, Flatten(field[2]))
        end
    end

    -- An empty string is treated the same as nil: a fence around nothing would carry no
    -- information the fields don't already, and the reader would have to special-case an
    -- empty body anyway. Deliberate, not an oversight -- see contribute_envelope_test.lua.
    if type(text) == "string" and text ~= "" then
        out[#out + 1] = "text<<"
        out[#out + 1] = Fence(text)
        out[#out + 1] = ">>"
    end

    local body = table.concat(out, "\n") .. "\n"
    return body .. format("sum=%d\n", self:Checksum(body))
end

-- The code points past ASCII that end a word: Latin-1 punctuation and signs (not ª, µ, º, which are
-- letters), general punctuation and spaces, currency, arrows, shapes, CJK punctuation, fullwidth
-- ASCII punctuation and emoji. Hangul, kana and Han too: those scripts put no space before a
-- particle or the next word, so a name runs straight into it ("홍길동님").
local SEPARATORS = {
    { 0x80, 0xA9 }, { 0xAB, 0xB4 }, { 0xB6, 0xB9 }, { 0xBB, 0xBF }, { 0xD7, 0xD7 }, { 0xF7, 0xF7 },
    { 0x2000, 0x206F }, { 0x20A0, 0x20CF }, { 0x2190, 0x23FF }, { 0x2500, 0x27BF }, { 0x2E00, 0x2E7F },
    { 0x3000, 0x3004 }, { 0x3008, 0x3020 }, { 0x3030, 0x3030 }, { 0x303D, 0x303F },
    { 0xFE30, 0xFE6F }, { 0xFF00, 0xFF0F }, { 0xFF1A, 0xFF20 }, { 0xFF3B, 0xFF40 }, { 0xFF5B, 0xFF65 },
    { 0xFFE0, 0xFFEE }, { 0x1F000, 0x1FAFF },
    { 0x1100, 0x11FF }, { 0x3040, 0x30FF }, { 0x3130, 0x318F }, { 0x3400, 0x4DBF }, { 0x4E00, 0x9FFF },
    { 0xAC00, 0xD7AF }, { 0xF900, 0xFAFF },
}

--- The code point of the UTF-8 character whose first byte is at i, nil where the bytes are not one.
local function CodePointAt(text, i)
    local lead = byte(text, i)
    local more = lead >= 0xF0 and 3 or lead >= 0xE0 and 2 or lead >= 0xC0 and 1 or nil
    if not more then
        return nil
    end
    local point = lead - (more == 3 and 0xF0 or more == 2 and 0xE0 or 0xC0)
    for k = 1, more do
        local following = byte(text, i + k)
        if not following or following < 0x80 or following > 0xBF then
            return nil
        end
        point = point * 64 + (following - 0x80)
    end
    return point
end

-- Whether the byte at i belongs to a word. Byte-wise because %w knows only ASCII: a high byte is
-- judged by its whole character, and bytes that are no character count as a letter's.
local function IsWordByte(text, i)
    local b = byte(text, i)
    if b == nil then
        return false
    end
    if b < 128 then
        return (b >= 48 and b <= 57) or (b >= 65 and b <= 90) or (b >= 97 and b <= 122)
    end
    local first, at = i, b
    while first > 1 and i - first < 3 and at < 0xC0 do
        first = first - 1
        at = byte(text, first)
    end
    local point = CodePointAt(text, first)
    if not point then
        return true
    end
    for _, range in ipairs(SEPARATORS) do
        if point >= range[1] and point <= range[2] then
            return false
        end
    end
    return true
end

--- Every whole-word occurrence of `word` in `text` replaced by `token`, so a player called Mist
--- leaves "Mistwood" alone but not "Mist's". A plain find: a pattern would need the player's input
--- escaped, and %f is not safe on every client's Lua.
function Contribute:ReplaceWord(text, word, token)
    local out, pos = {}, 1
    while true do
        local first, last = string.find(text, word, pos, true)
        if not first then
            break
        end
        if IsWordByte(text, first - 1) or IsWordByte(text, last + 1) then
            out[#out + 1] = string.sub(text, pos, last)
        else
            out[#out + 1] = string.sub(text, pos, first - 1)
            out[#out + 1] = token
        end
        pos = last + 1
    end
    out[#out + 1] = string.sub(text, pos)
    return table.concat(out)
end

--- `text` in capitals: ASCII, the accented Latin letters (à to þ) and Cyrillic (а to я, ѐ to џ).
--- string.upper alone knows only ASCII, and a name the client writes in capitals is "ZÖPF".
local function Upper(text)
    text = gsub(string.upper(text), "\195([\160-\190])", function(c)
        local b = byte(c)
        return b ~= 183 and "\195" .. string.char(b - 32) or nil
    end)
    text = gsub(text, "\208([\176-\191])", function(c)
        return "\208" .. string.char(byte(c) - 32)
    end)
    text = gsub(text, "\209([\128-\159])", function(c)
        local b = byte(c)
        return b < 144 and "\208" .. string.char(b + 32) or "\208" .. string.char(b - 16)
    end)
    return text
end

--- The words a text may write the player's name as: the name whole or any one part of it ("Valaas
--- Dawnsight" is greeted "Valaas"), as written and in capitals, as the client writes it into some
--- pages ("GRIMBALOR,"). For the caller to swap for $N with ReplaceWord, among its other swaps in
--- order of length.
---@param name string|nil  UnitName("player")
---@return string[]
function Contribute:NameWords(name)
    local words = {}
    if type(name) ~= "string" or name == "" then
        return words
    end
    for _, form in ipairs({ name, Upper(name) }) do
        words[#words + 1] = form
        for part in string.gmatch(form, "%S+") do
            if part ~= form then
                words[#words + 1] = part
            end
        end
    end
    return words
end

--- An envelope read back: its source, its fields in order and its text, so a feature addon can
--- rewrite a line Gather kept and build it again with Envelope. Nil for anything Envelope did
--- not write, and for one whose checksum is wrong: built again it would be signed afresh, and
--- pass for what it is not.
---@param envelope string
---@return string|nil source
---@return table|nil  fields  array of { key, value }
---@return string|nil text
function Contribute:Parse(envelope)
    if type(envelope) ~= "string" then
        return nil
    end
    local signed, sum = string.match(envelope, "^(.*\n)sum=(%d+)\n$")
    if not signed or self:Checksum(signed) ~= tonumber(sum) then
        return nil
    end
    local source, body = string.match(signed, "^!SPOKEN%d+ (%a+)\n(.*)$")
    if not source then
        return nil
    end
    local fields, text = {}, nil
    local pos = 1
    while pos <= len(body) do
        local nl = string.find(body, "\n", pos, true)
        if not nl then
            return nil
        end
        local line = string.sub(body, pos, nl - 1)
        if line == "text<<" then
            -- The fence is the first line that is exactly ">>": Fence escaped every other.
            local close = string.find(body, "\n>>\n", nl, true)
            if not close then
                return nil
            end
            local lines = {}
            for each in string.gmatch(string.sub(body, nl + 1, close - 1) .. "\n", "(.-)\n") do
                lines[#lines + 1] = string.match(each, "^\\(\\*>>)$") or each
            end
            text = table.concat(lines, "\n")
            pos = close + 4
        else
            local key, value = string.match(line, "^([^=]*)=(.*)$")
            if not key then
                return nil
            end
            fields[#fields + 1] = { key, value }
            pos = nl + 1
        end
    end
    return source, fields, text
end

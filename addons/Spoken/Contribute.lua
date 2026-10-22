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
local SOURCES = { quests = true, zones = true, books = true }

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
--- Deliberately not SpokenBooks:ChecksumOf, whose number is a frozen page id: coupling an id
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

---@param source string  "quests" | "zones" | "books"
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

-- The Lua half of pipelines/readables/tools/lib/naming.mjs.
--
-- THE TWO MUST AGREE EXACTLY. The exporter keys Data/Books.lua on this number, so a page
-- whose checksum differs by one is a page this addon can never find -- and it fails
-- silently, as a book that simply does not narrate.
--
-- Multiply, add, modulo, and nothing else: the clients this ships to run Lua 5.1, which has
-- no bitwise operators, and string.byte walks UTF-8 bytes, which is why the exporter hashes
-- bytes rather than characters. The modulus is the largest signed 32-bit prime, so every
-- intermediate value stays exact in the doubles Lua stores numbers as.

local ADDON_NAME, SpokenReadables = ...

local MODULUS = 2147483647
local FACTOR = 31

local byte, len, lower = string.byte, string.len, string.lower
-- The client provides these as globals and the test stub mirrors it; `or string.*` is what
-- keeps this file loadable in a plain Lua that does neither.
local gsub = gsub or string.gsub
local strfind = strfind or string.find

local function Sum(text)
	local sum = len(text) % MODULUS
	for i = 1, len(text) do
		sum = (sum * FACTOR + byte(text, i)) % MODULUS
	end
	return sum
end

---@param text string the page as the client is showing it
---@return number
function SpokenReadables:ChecksumOf(text)
	if type(text) ~= "string" then
		return 0
	end

	-- The exporter normalises before hashing: CRLF and WoW's $B become newlines, trailing
	-- spaces go, runs of blank lines collapse, the ends are trimmed and a signed page's HTML
	-- is laid out as lines. The client hands us text that has been through none of the last.
	return Sum(self:Normalise(text))
end

--- A signed page's checksum over its HTML, as packs built before the corpus stored the
--- page without it are keyed. Nil for any other page, whose two checksums are the same.
---@param text string the page as the client is showing it
---@return number|nil
function SpokenReadables:MarkedChecksumOf(text)
	if type(text) ~= "string" then
		return nil
	end
	local marked = self:Normalise(text, true)
	local plain = self:Normalise(text)
	return marked ~= plain and Sum(marked) or nil
end

-- The tags of a signed page, as MARKUP in tools/lib/text.mjs lists them. Anything else in
-- brackets is the book's own words.
local MARKUP = {
	html = true, body = true, p = true, br = true, img = true, a = true, span = true, b = true,
	h1 = true, h2 = true, h3 = true, h4 = true, h5 = true, h6 = true,
}

local ENTITIES = { amp = "&", quot = "\"", apos = "'", nbsp = " " }
local SHOWN_ENTITIES = { amp = "&", lt = "<", gt = ">", quot = "\"", apos = "'", nbsp = " " }
-- NUL terminates Lua's C strings, so use the next control byte as the temporary marker.
local PAGE_BREAK = "\001"
local NAME_PLACEHOLDER = "<[Nn][Oo][Mm][Bb][Rr][Ee]>"

local function IsMarkup(name)
	return MARKUP[lower(name)] == true
end

--- unmark in tools/lib/text.mjs. Whitespace is ASCII on both sides: JavaScript's \s would
--- also take an ideographic space that Lua's %s does not.
local function Unmark(text)
	text = gsub(text, "[ \t\n\r\f\v]+", " ")
	text = gsub(text, PAGE_BREAK, "\n")
	text = gsub(text, "<(/?)([%w_]+)[^>]*>", function(slash, name)
		if not IsMarkup(name) then return nil end
		name = lower(name)
		if (slash == "" and name == "br") or (slash == "/" and (name == "p" or strfind(name, "^h%d$"))) then
			return "\n"
		end
		return ""
	end)
	text = gsub(text, "&(%a+);", function(name) return ENTITIES[name] end)
	text = gsub(text, " +", " ")
	text = gsub(text, " \n", "\n")
	text = gsub(text, "\n ", "\n")
	text = gsub(text, "^ ", "")
	text = gsub(text, " $", "")
	while strfind(text, "\n\n\n") do
		text = gsub(text, "\n\n\n", "\n\n")
	end
	text = gsub(text, "^\n+", "")
	text = gsub(text, "\n+$", "")
	return text
end

local function IsSigned(text)
	for _, name in string.gmatch(text, "<(/?)([%w_]+)[^>]*>") do
		if IsMarkup(name) then return true end
	end
	return false
end

--- The storage form the exporter hashes. Mirrors normaliseText in tools/lib/text.mjs.
--- `keepMarkup` stops before the HTML is laid out, for MarkedChecksumOf.
function SpokenReadables:Normalise(text, keepMarkup)
	text = gsub(text, "\r\n", "\n")
	text = gsub(text, "\r", "\n")
	-- `$B` is a real break inside signed HTML, not HTML whitespace. Keep a placeholder
	-- through Unmark so its surrounding spaces are trimmed as line whitespace. Plain pages
	-- retain the historical path, where `$B` becomes a newline before line cleanup.
	if not keepMarkup and IsSigned(text) then
		return Unmark(gsub(text, "%$[Bb]", PAGE_BREAK))
	end
	text = gsub(text, "%$[Bb]", "\n")
	-- Trailing whitespace per line, then runs of blank lines, then the ends. Done in that
	-- order because trimming first would leave a "   \n" in the middle looking blank.
	text = gsub(text, "[ \t]+\n", "\n")
	text = gsub(text, "[ \t]+$", "")
	while strfind(text, "\n\n\n") do
		text = gsub(text, "\n\n\n", "\n\n")
	end
	text = gsub(text, "^%s+", "")
	text = gsub(text, "%s+$", "")
	return text
end

--- The page as the client draws it: normalised layout, locale name marker removed and entities decoded.
function SpokenReadables:ShownText(text)
	text = self:Normalise(text)
	text = gsub(text, NAME_PLACEHOLDER, "")
	return (gsub(text, "&(%a+);", function(name) return SHOWN_ENTITIES[name] end))
end

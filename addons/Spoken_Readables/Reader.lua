-- Which page the client is showing, if any.
--
-- ItemTextFrame is the whole of the book UI on all three targets, and it serves MAIL as
-- well: the same frame, the same events, the same getters. So the first question here is
-- never "which page is this" but "is this a book at all" -- a reader who opens a letter
-- from another player and hears it read aloud has been given somebody else's post by a
-- narrator, which is worse than hearing nothing.
--
-- Identification order, and each step earns its place:
--
--   1. title + page number + checksum   -- the normal path
--   2. checksum alone                   -- for a client whose object name differs from the
--                                          corpus's; only for checksums no other page shares,
--                                          and a server's other wording of a page (variants)
--   3. the words, layout ignored       -- for a server that breaks the lines differently;
--                                          by title and number, then words no other page has
--   4. words around the tokens          -- for a page the client filled with the reader's
--                                          name, class or gender word; only where one fits
--   5. nothing                          -- silently, because the alternative is reading the
--                                          wrong page's words aloud

local ADDON_NAME, SpokenBooks = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

--- Whether the frame is showing mail rather than something the world wrote.
---
--- Two tests, because they catch different things. A creator is a player's name, and only
--- mail has one. And MailFrame being open is what catches a piece of mail with no creator
--- at all -- a returned letter, or one the server sent.
function SpokenBooks:IsMail()
	if ItemTextGetCreator and NotSecret(ItemTextGetCreator()) then
		return true
	end

	local mail = _G.MailFrame
	if mail and mail.IsShown and mail:IsShown() then
		return true
	end

	return false
end

--- A page id from one language's index, or nil.
local function Find(index, title, number, checksum)
	local byTitle = title and index.index and index.index[title]
	local byNumber = byTitle and byTitle[number]
	local found = byNumber and byNumber[checksum]
	if found then
		return found
	end

	-- The fallback. `loose` holds only checksums no other page shares, so a hit here is
	-- the page, not a guess between candidates.
	found = index.loose and index.loose[checksum]
	if found then
		return found
	end

	-- A page a server shows in other words than the corpus's (Data/Variants.lua), as the page
	-- it stands for.
	found = index.variants and index.variants[checksum]
	if found then
		return found
	end

	-- A pack's own pages, which the corpus module does not have.
	byTitle = title and index.extraIndex and index.extraIndex[title]
	byNumber = byTitle and byTitle[number]
	return (byNumber and byNumber[checksum]) or (index.extraLoose and index.extraLoose[checksum])
end

-- $N, $C and $R (either case): the name, class and race the client writes in for the reader.
local PLAYER_TOKEN = "%$[nNcCrR]"
-- $gmale:female; -- the client keeps one side for the reader's sex.
local GENDER_TOKEN = "%$[gG]([^:;]*):([^;]*);"

--- Letters and digits only, in lower case: a page with its layout, spacing and punctuation
--- gone, so the client's text and the corpus caption compare as words. Bytes past ASCII stay,
--- so a name or a page in any script keeps its letters.
local function Flat(text)
	text = string.gsub(text, "%$[Bb]", " ")
	return (string.gsub(string.lower(text), "[^%w\128-\255]", ""))
end

--- The corpus pages that hold a token, each as the words between its tokens, once per side
--- of its $g branches. Built once: Books.lua does not change while the game runs.
function SpokenBooks:TokenPages()
	if self.tokenPages then
		return self.tokenPages
	end
	local pages = {}
	local data = self:Data()
	for pageId, place in pairs(data and data.pages or {}) do
		local text = place.text
		if type(text) == "string" and (string.find(text, PLAYER_TOKEN) or string.find(text, GENDER_TOKEN)) then
			for side = 1, 2 do
				local said = string.gsub(text, GENDER_TOKEN, function(male, female)
					return side == 1 and male or female
				end)
				local pieces = {}
				for piece in string.gmatch(said .. "$N", "(.-)" .. PLAYER_TOKEN) do
					pieces[#pieces + 1] = Flat(piece)
				end
				pages[#pages + 1] = { id = pageId, pieces = pieces }
			end
		end
	end
	self.tokenPages = pages
	return pages
end

--- Whether `flat` is the pieces in order with anything between them: a token's words are the
--- reader's own, and a whole name, a surname or a class in any case all fill it.
local function Fits(flat, pieces)
	local first, last = pieces[1], pieces[#pieces]
	if #pieces == 1 then
		return flat == first
	end
	if string.sub(flat, 1, #first) ~= first then
		return false
	end
	local pos = #first + 1
	for i = 2, #pieces - 1 do
		local _, finish = string.find(flat, pieces[i], pos, true)
		if not finish then
			return false
		end
		pos = finish + 1
	end
	return #flat - #last + 1 >= pos and (last == "" or string.sub(flat, -#last) == last)
end

--- The corpus page whose caption, with its tokens as the client fills them, is the text on
--- screen. The client writes the reader's name, class and gender word into a page, while the
--- index is keyed on the page as stored, tokens and all, so no checksum finds it. Nil where no
--- page or more than one fits.
function SpokenBooks:TokenPageOf(text)
	local flat = Flat(text)
	local found
	for _, page in ipairs(self:TokenPages()) do
		if Fits(flat, page.pieces) then
			if found and found ~= page.id then
				return nil
			end
			found = page.id
		end
	end
	return found
end

--- A caption with its tokens filled in for this character, as the client fills them on the
--- page: name, class, race, the side of a $g branch for the character's sex, $B as a line break.
--- The same as FillPlayerTokens in Spoken_Quests/Utils.lua.
function SpokenBooks:FillPlayerTokens(text)
	local name = UnitName and UnitName("player") or ""
	local class = UnitClass and UnitClass("player") or ""
	local race = UnitRace and UnitRace("player") or ""
	local female = UnitSex and UnitSex("player") == 3
	text = string.gsub(text, GENDER_TOKEN, function(male, femaleForm)
		return (string.gsub(female and femaleForm or male, "^%s*(.-)%s*$", "%1"))
	end)
	-- Function replacements, so a % in a name is never read as a capture.
	text = string.gsub(text, "%$[bB]", "\n")
	text = string.gsub(text, "%$[nN]", function() return name end)
	text = string.gsub(text, "%$[cC]", function() return class end)
	text = string.gsub(text, "%$[rR]", function() return race end)
	return text
end

-- What a recording says for each token: one file is everybody's, so it names nobody. The
-- site's words for English (speakPlayerTokens in apps/web/src/lib/player-words.ts).
local SAID = { n = "adventurer", c = "adventurer", r = "traveler" }

--- A caption with its tokens as the narrator says them: the first side of a $g branch,
--- "adventurer" for the name and class, "traveler" for the race, capitalised where a sentence
--- starts. A token glued to a letter is left, as the site leaves it.
function SpokenBooks:SaidTokens(text)
	text = string.gsub(text, GENDER_TOKEN, function(male)
		return (string.gsub(male, "^%s*(.-)%s*$", "%1"))
	end)
	return (string.gsub(text, "()%$([nNcCrR])(%a?)", function(at, token, glued)
		if glued ~= "" then
			return nil
		end
		local word = SAID[string.lower(token)]
		local before = string.sub(text, 1, at - 1)
		if string.find(before, "^[%s\"']*$") or string.find(before, "[%.!?\n][%s\"']*$")
			or string.find(before, "\226\128\166[%s\"']*$") then
			word = string.upper(string.sub(word, 1, 1)) .. string.sub(word, 2)
		end
		return word
	end))
end

--- The page id the client is showing, or nil.
function SpokenBooks:PageOnScreen()
	local data = self:Data()
	if not data or self:IsMail() then
		return nil
	end

	local text = ItemTextGetText and NotSecret(ItemTextGetText())
	if type(text) ~= "string" or text == "" then
		return nil
	end

	local checksums = { self:ChecksumOf(text), self:MarkedChecksumOf(text) }
	local title = ItemTextGetItem and NotSecret(ItemTextGetItem())
	local number = (ItemTextGetPage and NotSecret(ItemTextGetPage())) or 1
	local function FindAny(index)
		for _, checksum in ipairs(checksums) do
			local found = Find(index, title, number, checksum)
			if found then return found end
		end
	end

	-- The client's own locale first: the title and the words are what this client shows, and
	-- a German client's are German. A language's index ships in that language's pack, in the
	-- shape of the English one, because a client in that locale is the only one it can match
	-- and a player there who wants the language installs its pack. A pack in another language
	-- is not asked: its words are not the ones on this screen. Without one, every client is
	-- left on the English index, as before.
	local client = self:GetClientLanguage()
	for _, pack in ipairs(self:GetAudioPacks()) do
		if (type(pack.index) == "table" or type(pack.extraIndex) == "table")
			and self:PackLanguage(pack) == client then
			local found = FindAny(pack)
			if found then
				self:RememberPageText(found, client, text, title)
				return found
			end
		end
	end
	local found = FindAny(data) or self:PageByWords(data, title, number, text) or self:TokenPageOf(text)
	if found then self:RememberPageText(found, self.BASE_LANGUAGE, text, title) end
	return found
end

--- A corpus page with the same words as the page on screen, laid out differently. The last
--- step, after every checksum has missed: a server that breaks a line where the corpus has a
--- space shows the same page under another checksum, and the packs are keyed on the page id
--- this finds, so its clip plays. The title and number's pages first; then the words alone,
--- only where no other page has them, as `loose` is for checksums.
function SpokenBooks:PageByWords(data, title, number, text)
	local pages = data.pages
	if type(pages) ~= "table" then
		return nil
	end
	local words = self:FlatWords(self:Normalise(text))
	-- A picture page has no words, and every other picture page would match it.
	if words == "" then
		return nil
	end

	local byTitle = title and data.index and data.index[title]
	local byNumber = byTitle and byTitle[number]
	local best
	for _, pageId in pairs(byNumber or {}) do
		local page = pages[pageId]
		-- The lowest id, as the index keeps the lowest book, so the answer is not pairs' order.
		if page and type(page.text) == "string" and self:FlatWords(page.text) == words
			and (not best or (type(pageId) == type(best) and pageId < best)) then
			best = pageId
		end
	end
	if best then
		return best
	end

	-- Built on the first page a checksum misses, not at load: most sessions never need it.
	if not self.pageByWords then
		local byWords = {}
		for pageId, page in pairs(pages) do
			local key = type(page.text) == "string" and self:FlatWords(page.text) or ""
			if key ~= "" then
				local seen = byWords[key]
				byWords[key] = (seen == nil or seen == pageId) and pageId or false
			end
		end
		self.pageByWords = byWords
	end
	return self.pageByWords[words] or nil
end

-- Older translated packs have an index but no caption text. Remember only pages
-- identified as books, in the language of the matching index, for those packs.
-- The title is the book's, so the pages queued after this one carry it too: the corpus has
-- only the English one.
function SpokenBooks:RememberPageText(pageId, language, text, title)
	self.pageText = self.pageText or {}
	self.pageText[language] = self.pageText[language] or {}
	self.pageText[language][pageId] = text:gsub("\r\n?", "\n"):gsub("%$[Bb]", "\n")
		:gsub("<[^>]+>", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
	local book = self:PlaceOf(pageId)
	if book and type(title) == "string" and title ~= "" then
		self.bookTitle = self.bookTitle or {}
		self.bookTitle[language] = self.bookTitle[language] or {}
		self.bookTitle[language][book] = title
	end
end

--- Where a page sits: its book and its number. The corpus module's place, or a pack's for a
--- page only it has. Nil for a page nothing carries.
function SpokenBooks:PlaceOf(pageId)
	local data = self:Data()
	local place = data and data.pages[pageId]
	if not place then
		for _, pack in ipairs(self:GetAudioPacks()) do
			place = type(pack.places) == "table" and pack.places[pageId]
			if place then break end
		end
	end
	if not place then
		return nil, nil
	end
	return place.book, place.number
end

--- A book's title and its pages in reading order, by book id. A pack adds the pages Books.lua
--- lacks, so the list merges both, ordered by page number; a book only a pack has is its own.
function SpokenBooks:BookById(bookId)
	local data = self:Data()
	local book = data and data.books[bookId]
	local packs = self:GetAudioPacks()
	local hasBooks = false
	for _, pack in ipairs(packs) do
		if type(pack.books) == "table" then hasBooks = true break end
	end
	if not hasBooks then
		return book
	end

	local extra = {}
	local seen = {}
	for _, id in ipairs(book and book.pages or {}) do seen[id] = true end
	for _, pack in ipairs(packs) do
		local entry = type(pack.books) == "table" and pack.books[bookId]
		for _, id in ipairs(entry and entry.pages or {}) do
			if not seen[id] then
				seen[id] = true
				table.insert(extra, id)
			end
		end
	end
	if #extra == 0 then
		return book
	end

	local pages = {}
	for _, id in ipairs(book and book.pages or {}) do table.insert(pages, id) end
	for _, id in ipairs(extra) do table.insert(pages, id) end
	local order = {}
	for position, id in ipairs(pages) do
		local _, number = self:PlaceOf(id)
		order[id] = { number or math.huge, position }
	end
	table.sort(pages, function(a, b)
		if order[a][1] ~= order[b][1] then return order[a][1] < order[b][1] end
		return order[a][2] < order[b][2]
	end)
	return { title = book and book.title, pages = pages }
end

--- The book a page belongs to: its title and its pages in reading order.
function SpokenBooks:BookOf(pageId)
	local book = self:PlaceOf(pageId)
	return book and self:BookById(book) or nil
end

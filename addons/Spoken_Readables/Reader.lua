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
--                                          corpus's; only for checksums no other page shares
--   3. words around the tokens          -- for a page the client filled with the reader's
--                                          name, class or gender word; only where one fits
--   4. the item or object that opened   -- for a server that lays out or words a page
--      it, and the page number             differently; Opener.lua says what was clicked
--   5. title + page number + most of    -- the same, where the client said nothing; the words
--      the words                           keep a different book of the same name out
--   6. nothing                          -- silently, because the alternative is reading the
--                                          wrong page's words aloud

local ADDON_NAME, SpokenReadables = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

--- Whether the frame is showing mail rather than something the world wrote.
---
--- Two tests, because they catch different things. A creator is a player's name, and only
--- mail has one. And MailFrame being open is what catches a piece of mail with no creator
--- at all -- a returned letter, or one the server sent.
function SpokenReadables:IsMail()
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

	-- A pack's own pages, which the corpus module does not have.
	byTitle = title and index.extraIndex and index.extraIndex[title]
	byNumber = byTitle and byTitle[number]
	return (byNumber and byNumber[checksum]) or (index.extraLoose and index.extraLoose[checksum])
end

-- $N, $C and $R (either case): the name, class and race the client writes in for the reader.
local PLAYER_TOKEN = "%$[nNcCrR]"
-- $gmale:female; -- the client keeps one side for the reader's sex.
local GENDER_TOKEN = "%$[gG]([^:;]*):([^;]*);"

--- A page in lower case, with $B, the client's line break, as a space.
local function Unmarked(text)
	return string.lower((string.gsub(text, "%$[Bb]", " ")))
end

--- Letters and digits only, in lower case: a page with its layout, spacing and punctuation
--- gone, so the client's text and the corpus caption compare as words. Bytes past ASCII stay,
--- so a name or a page in any script keeps its letters.
local function Flat(text)
	return (string.gsub(Unmarked(text), "[^%w\128-\255]", ""))
end

--- The corpus pages that hold a token, each as the words between its tokens, once per side
--- of its $g branches. Built once: Books.lua does not change while the game runs.
function SpokenReadables:TokenPages()
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
function SpokenReadables:TokenPageOf(text)
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
function SpokenReadables:FillPlayerTokens(text)
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
function SpokenReadables:SaidTokens(text)
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

--- The page at `number` in a book, or nil where the book is shorter.
local function PageAt(data, bookId, number)
	local book = data.books and data.books[bookId]
	for _, pageId in ipairs(book and book.pages or {}) do
		local place = data.pages[pageId]
		if place and place.number == number then
			return pageId
		end
	end
end

--- A page's words as a set, in lower case: letters and digits, and bytes past ASCII so any
--- script keeps its letters. Its count beside it.
local function Words(text)
	local words, count = {}, 0
	for word in string.gmatch(Unmarked(text), "[%w\128-\255]+") do
		if not words[word] then
			words[word] = true
			count = count + 1
		end
	end
	return words, count
end

-- The share of words two texts must have in common to be one page. A page laid out differently
-- has them all; a reworded sentence or two keeps most; a different book of the same name
-- shares little beyond "the" and "of".
local SAME_WORDS = 0.6

-- Close enough that the next-page arrow is not asked: the server ends some chains early, as
-- Forever does the Hillsbrad Town Registry's, and a page this close is that page whatever
-- follows it.
local NEAR_EXACT = 0.9

--- How much of two texts is the same words: those both have, over the larger count.
local function Overlap(a, aCount, b, bCount)
	if aCount == 0 or bCount == 0 then
		return 0
	end
	local shared = 0
	for word in pairs(a) do
		if b[word] then shared = shared + 1 end
	end
	return shared / math.max(aCount, bCount)
end

--- How much of a corpus page's words are the ones on screen, 0 for a page without text.
local function Score(data, pageId, screen, screenCount)
	local place = data.pages[pageId]
	if not place or type(place.text) ~= "string" then
		return 0
	end
	return Overlap(screen, screenCount, Words(place.text))
end

--- Of these pages, the one with the most of the words on screen, if it has at least
--- SAME_WORDS of them and `fits` (given the page and its score) does not refuse it. The lower id
--- on a tie.
local function Closest(data, pageIds, screen, screenCount, fits)
	local best, bestScore
	for _, pageId in pairs(pageIds or {}) do
		local score = Score(data, pageId, screen, screenCount)
		if score >= SAME_WORDS and (not fits or fits(pageId, score)) and (not best or score > bestScore
			or (score == bestScore and type(pageId) == type(best) and pageId < best)) then
			best, bestScore = pageId, score
		end
	end
	return best
end

--- The page the item or object that opened the frame holds at `number`. Refused where the
--- title on screen is another corpus book's: the candidate was something touched before the
--- click, not what was clicked.
---
--- The number is the server's, and a server whose chain skips a page shows every later one a
--- place early: Forever's Sargeras and the Betrayal has no 1774. So where the page at the
--- number has few of the words on screen and another page of the book has most, that one.
--- Text in another language has most of no page's words and keeps the number.
function SpokenReadables:OwnerPageOf(title, number, text)
	local data = self:Data()
	local owners = data and data.owners
	if not owners then
		return nil
	end
	local screen, screenCount = Words(text)
	for _, opener in ipairs(self.openedBy or {}) do
		local bookId = owners[opener.kind] and owners[opener.kind][opener.id]
		local book = bookId and data.books[bookId]
		local pageId = book and PageAt(data, bookId, number)
		if pageId and (not title or title == book.title or not (data.index and data.index[title])) then
			if Score(data, pageId, screen, screenCount) < SAME_WORDS then
				return Closest(data, book.pages, screen, screenCount) or pageId
			end
			return pageId
		end
	end
end

--- The corpus page with this title and number whose words are mostly the ones on screen. A
--- title and number alone do not name a page: the server may hold a book of the same name the
--- corpus does not, as "Proof of Deed" is many bosses' deeds. Nil where none is close enough;
--- of several, the closest, and the lower id on a tie. Where none at the number is, the numbers
--- either side, for a server whose chain skips or adds a page.
function SpokenReadables:TitlePageOf(title, number, text)
	local data = self:Data()
	local byTitle = title and data and data.index and data.index[title]
	if not byTitle then
		return nil
	end
	local hasNext = ItemTextHasNextPage and NotSecret(ItemTextHasNextPage())
	local screen, screenCount = Words(text)
	local function At(at)
		return Closest(data, byTitle[at], screen, screenCount, function(pageId, score)
			-- A book that ends here while the screen offers a next page, or the reverse, is
			-- another book, unless the words all but settle it.
			local book = data.books[data.pages[pageId].book]
			return book and (hasNext == nil or hasNext == (at < #book.pages) or score >= NEAR_EXACT)
		end)
	end
	return At(number) or At(number - 1) or At(number + 1)
end

--- The page id the client is showing, or nil. True beside it where the text is the corpus's
--- own, by checksum or tokens; false where the page was only told by what opened it or by most
--- of its words, so the words on screen are still news to the corpus.
function SpokenReadables:PageOnScreen()
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
				self:RememberPageText(found, client, text, title, true)
				return found, true
			end
		end
	end
	local found, language, exact = FindAny(data) or self:TokenPageOf(text), self.BASE_LANGUAGE, true
	if not found then
		-- What the reader clicked: right whatever the text, in the client's own language.
		found, language, exact = self:OwnerPageOf(title, number, text), client, false
	end
	if not found then
		found, language = self:TitlePageOf(title, number, text), self.BASE_LANGUAGE
	end
	if not found then
		return nil
	end
	self:RememberPageText(found, language, text, title, exact)
	return found, exact
end

-- The page as the client drew it, in the language of the matching index, and whether its words
-- matched (see PageTextIn).
-- The title is the book's, so the pages queued after this one carry it too: the corpus has
-- only the English one.
function SpokenReadables:RememberPageText(pageId, language, text, title, exact)
	self.pageText = self.pageText or {}
	self.pageText[language] = self.pageText[language] or {}
	self.pageText[language][pageId] = { text = self:ShownText(text), exact = exact == true }
	local book = self:PlaceOf(pageId)
	if book and type(title) == "string" and title ~= "" then
		self.bookTitle = self.bookTitle or {}
		self.bookTitle[language] = self.bookTitle[language] or {}
		self.bookTitle[language][book] = title
	end
end

--- A page's words in the first pack recorded in `language` that has them, or nil.
function SpokenReadables:PackPageText(pageId, language)
	for _, pack in ipairs(self:GetAudioPacks()) do
		local entry = self:PackLanguage(pack) == language and pack.pages[pageId]
		if entry and type(entry.text) == "string" and entry.text ~= "" then
			return entry.text
		end
	end
	return nil
end

--- The page as the client showed it this session in `language`, or nil, and whether it was matched
--- by its words rather than placed by its owner or title.
local function KeptText(self, pageId, language)
	local kept = self.pageText and self.pageText[language] and self.pageText[language][pageId]
	if not kept or kept.text == "" then return nil end
	return kept.text, kept.exact
end

--- A page's words in `language`: the page as the client showed it this session if matched by its
--- words, else the words of a pack recorded in it, else the page as the client showed it however
--- it was placed. Nil where none has them.
function SpokenReadables:PageTextIn(pageId, language)
	-- An exact page beats the pack: a pack made before layout was kept has the same words as one
	-- line, while the client still has its paragraph breaks. A guessed page must not replace a pack.
	local kept, exact = KeptText(self, pageId, language)
	if exact then return kept end
	return self:PackPageText(pageId, language) or kept
end

--- A page's words in this client's language, or nil. Page by page, so a readable can be in two
--- languages: the pages Spoken has this client's words for, and the rest in English. Nil on an
--- English client: Books.lua is its words.
function SpokenReadables:ClientPageText(pageId)
	local client = self:GetClientLanguage()
	if client == self.BASE_LANGUAGE then
		return nil
	end
	return self:PageTextIn(pageId, client)
end

--- A page's words in `language` as a caption shows them, and whether they are the words of an
--- English recording. English is the corpus's, its tokens as the narrator says them, unless a pack
--- has the page's words.
local function CaptionWords(self, pageId, language)
	if language ~= self.BASE_LANGUAGE then
		return self:PageTextIn(pageId, language)
	end
	local packed = self:PackPageText(pageId, language)
	if packed then
		return packed
	end
	-- Some pages have no words in the corpus: "" would caption a recording with nothing.
	local place = self:Data() and self:Data().pages[pageId]
	if place and type(place.text) == "string" and place.text ~= "" then
		return self:SaidTokens(place.text), true
	end
	return (KeptText(self, pageId, language))
end

local function CaptionIn(self, pageId, language, clipLanguage, clipText)
	if language == clipLanguage and type(clipText) == "string" and clipText ~= "" then
		return clipText, language, true
	end
	local text, corpus = CaptionWords(self, pageId, language)
	if text then
		-- An English pack records the corpus's words, so they are this recording's when it is English.
		return text, language, corpus == true and language == clipLanguage
	end
end

--- The words a page's caption shows, the language they are in, and whether they are the words the
--- recording says. They are in the client's language whatever the voice, as the game shows the
--- page, and in the clip's only where the client's has none. A voice no client runs in (Italian,
--- Vietnamese) comes first: its players are on another language's client. `clipText`, the playing
--- pack's own words, beats another pack's. Nil where neither has any.
function SpokenReadables:CaptionText(pageId, clipLanguage, clipText)
	local first, second = self:GetClientLanguage(), clipLanguage
	if not self:IsClientLanguage(clipLanguage) then
		first, second = clipLanguage, first
	end
	local text, shown, recorded = CaptionIn(self, pageId, first, clipLanguage, clipText)
	if not text and second ~= first then
		text, shown, recorded = CaptionIn(self, pageId, second, clipLanguage, clipText)
	end
	if not text then
		return nil, clipLanguage, false
	end
	return text, shown, recorded
end

--- A readable's title in `language`: the one the client showed this session, else the one a pack
--- in it gives `pageId` in its index. Nil where Spoken has none: the corpus's title is English.
function SpokenReadables:TitleIn(book, pageId, language)
	local kept = self.bookTitle and self.bookTitle[language] and self.bookTitle[language][book]
	return kept or self:PackTitleOf(pageId, language)
end

local titles = setmetatable({}, { __mode = "k" })

--- The title a pack recorded in `language` gives the page's book, from its index, which is keyed
--- by the titles that language's client shows. Nil where no such pack has an index with the page,
--- and for English, whose titles are the corpus's.
function SpokenReadables:PackTitleOf(pageId, language)
	if language == self.BASE_LANGUAGE then
		return nil
	end
	for _, pack in ipairs(self:GetAudioPacks()) do
		if self:PackLanguage(pack) == language then
			local byPage = titles[pack]
			if not byPage then
				byPage = {}
				for _, index in ipairs({ pack.index or {}, pack.extraIndex or {} }) do
					for title, byNumber in pairs(index) do
						for _, byChecksum in pairs(byNumber) do
							for _, id in pairs(byChecksum) do
								-- The first in order, not pairs()', so a page under two titles keeps one.
								if not byPage[id] or title < byPage[id] then byPage[id] = title end
							end
						end
					end
				end
				titles[pack] = byPage
			end
			if byPage[pageId] then
				return byPage[pageId]
			end
		end
	end
	return nil
end

--- Where a page sits: its book and its number. The corpus module's place, or a pack's for a
--- page only it has. Nil for a page nothing carries.
function SpokenReadables:PlaceOf(pageId)
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
function SpokenReadables:BookById(bookId)
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
function SpokenReadables:BookOf(pageId)
	local book = self:PlaceOf(pageId)
	return book and self:BookById(book) or nil
end

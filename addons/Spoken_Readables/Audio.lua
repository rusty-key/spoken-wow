-- What a page sounds like: which pack narrates it, where the file is, how long it runs.
--
-- Narration ships in a separate sound-pack addon because it is a large download, and it is
-- optional: without one there is nothing to play, so the addon stays quiet and says why.
--
-- THERE IS NO STAND-IN CLIP, for the reason addons/Spoken_Places/Audio.lua gives at length:
-- substituting unrelated audio is worse than silence, because silence is honest about what
-- is missing and a borrowed clip is not.

local ADDON_NAME, SpokenReadables = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

local L = SpokenReadables.L

-- The pack table shape this version knows how to read. A pack declaring anything else is
-- ignored with a warning: refusing to read it is recoverable, guessing at an unknown layout
-- plays silence and reports nothing.
local PACK_FORMAT = 1

-- The player's own book art. Pointed at rather than copied: Spoken is installed
-- alongside this addon by definition -- it is what the clips are queued through -- and a
-- second copy of the same texture is a second thing to keep in step.
local BOOK_TEXTURE = [[Interface\AddOns\Spoken\Textures\Book]]

-- A page's picture: a bag item's own icon, else the material it is on, else the book.
local ICON_CROP = { 0.08, 0.92, 0.08, 0.92 }
local MATERIALS = {
	Stone = [[Interface\Icons\INV_Misc_StoneTablet_01]],
	Marble = [[Interface\Icons\INV_Misc_StoneTablet_07]],
	Bronze = [[Interface\Icons\INV_Misc_StoneTablet_03]],
	Silver = [[Interface\Icons\INV_Misc_StoneTablet_11]],
	Valentine = [[Interface\Icons\INV_Letter_15]],
}
SpokenReadables.MATERIALS = MATERIALS

-- What a kind of writing is written on where no page is open to ask the game (a readable played
-- from Azeroth's Compendium): gravestones and tablets in stone, plaques and exhibits in bronze,
-- the rest on paper. The book window draws the stone ones in stone.
local KIND_MATERIAL = { grave = "Stone", tablet = "Stone", plaque = "Bronze", exhibit = "Bronze" }

-- Whether `pageId` is a page of the book open in the world, whose item and material the game can
-- tell: they are the same on every page, and the next page is built while another is open.
local function IsOpen(self, pageId)
	return self.lastPage ~= nil and (pageId == nil or self:PlaceOf(pageId) == self:PlaceOf(self.lastPage))
end

--- What `pageId`'s readable is written on by its kind, or nil for paper.
function SpokenReadables:KindMaterial(pageId)
	local place = pageId and self:Data() and self:Data().pages[pageId]
	local places = _G.SpokenReadablesPlaces and SpokenReadablesPlaces.books
	local entry = place and places and places[place.book]
	return entry and KIND_MATERIAL[entry.type] or nil
end

--- Open is what the item text events say, not the game's frame, which DialogueUI hides. A page
--- not open (of another book than the one open, or nothing open) takes what its kind is written
--- on, else the book.
function SpokenReadables:PagePicture(pageId)
	if IsOpen(self, pageId) then
		local item = ItemTextGetItem and NotSecret(ItemTextGetItem())
		local icon, crop
		if Spoken and Spoken.BagItemIcon then icon, crop = Spoken:BagItemIcon(item) end
		if icon then return { kind = "texture", texture = icon, texCoord = crop } end
		local material = ItemTextGetMaterial and NotSecret(ItemTextGetMaterial())
		if self.Explain then self:Explain("picture: %s is not in the bags; its material is %s", tostring(item), tostring(material)) end
		if material and MATERIALS[material] then
			return { kind = "texture", texture = MATERIALS[material], texCoord = ICON_CROP }
		end
	end
	local material = not IsOpen(self, pageId) and self:KindMaterial(pageId)
	if material then return { kind = "texture", texture = MATERIALS[material], texCoord = ICON_CROP } end
	return { kind = "texture", texture = BOOK_TEXTURE }
end

--- What `pageId` is written on (ItemTextGetMaterial: Parchment, Stone, Marble...): the game's
--- word for the page open, else its kind's (KindMaterial), else nil.
function SpokenReadables:PageMaterial(pageId)
	if IsOpen(self, pageId) then return ItemTextGetMaterial and NotSecret(ItemTextGetMaterial()) or nil end
	return self:KindMaterial(pageId)
end

-- What a readable can be (Data/Places.lua's `type`), in the order the Compendium lists them,
-- and the keys of its names: `one` of it, over its line in the queue, and `all`, the Compendium's.
SpokenReadables.TYPES = { "book", "journal", "letter", "note", "scroll", "tablet", "plaque", "grave", "exhibit",
	"picture", "other" }
SpokenReadables.TYPE_NAMES = {
	book = { one = "READABLE_BOOK", all = "TYPE_BOOK" },
	journal = { one = "READABLE_JOURNAL", all = "TYPE_JOURNAL" },
	letter = { one = "READABLE_LETTER", all = "TYPE_LETTER" },
	note = { one = "READABLE_NOTE", all = "TYPE_NOTE" },
	scroll = { one = "READABLE_SCROLL", all = "TYPE_SCROLL" },
	tablet = { one = "READABLE_TABLET", all = "TYPE_TABLET" },
	plaque = { one = "READABLE_PLAQUE", all = "TYPE_PLAQUE" },
	grave = { one = "READABLE_GRAVE", all = "TYPE_GRAVE" },
	exhibit = { one = "READABLE_EXHIBIT", all = "TYPE_EXHIBIT" },
	picture = { one = "READABLE_PICTURE", all = "TYPE_PICTURE" },
	other = { one = "READABLE_OTHER", all = "TYPE_OTHER" },
}

--- What `book` is (a book, a letter, a gravestone...), as the Compendium sorts it.
function SpokenReadables:KindOf(book)
	local places = _G.SpokenReadablesPlaces and SpokenReadablesPlaces.books
	local place = places and places[book]
	return L[(self.TYPE_NAMES[place and place.type] or self.TYPE_NAMES.other).one]
end

--- Whether a book is one line in the queue (Read Book as One Line), rather than a line per page.
function SpokenReadables:OneLine()
	return not (SpokenReadablesSettings and SpokenReadablesSettings.bookAsOneLine == false)
end

--- Every installed pack this version can read, newest format first. Packs released as
--- SpokenBooksAudio write SpokenBooksAudioPacks, and stay on players' disks, so it is read too; one
--- whose SpokenReadablesAudio replacement is installed beside it is the same pack, one release older.
--- The list is kept for as long as the registries hold the same packs: it is asked for on every
--- readable the Compendium lists, and every page of one.
local listed
local NONE = {}
local function Listable(pack)
	return type(pack) == "table" and pack.version == PACK_FORMAT and type(pack.pages) == "table"
end
-- What the list takes from a registered pack: its pages, while it can be listed. A pack registered
-- before it can be, or changed after, is listed again.
local function Shape(pack)
	return Listable(pack) and pack.pages or false
end
-- How many packs `registry` holds; nil where one is not as `seen` has it. With `note`, `seen` is
-- filled in instead.
local function Walk(registry, seen, note)
	local count = 0
	for _, pack in pairs(registry or NONE) do
		count = count + 1
		if note then
			seen[pack] = Shape(pack)
		elseif seen[pack] ~= Shape(pack) then
			return nil
		end
	end
	return count
end
function SpokenReadables:GetAudioPacks()
	local current, legacy = _G.SpokenReadablesAudioPacks, _G.SpokenBooksAudioPacks
	if listed and listed.current == current and listed.legacy == legacy then
		local count = Walk(current, listed.seen)
		local more = count and Walk(legacy, listed.seen)
		if more and count + more == listed.count then return listed.packs end
	end
	local seen = {}
	listed = { current = current, legacy = legacy, seen = seen,
		count = Walk(current, seen, true) + Walk(legacy, seen, true), packs = self:BuildAudioPacks() }
	return listed.packs
end

function SpokenReadables:BuildAudioPacks()
	local packs = {}
	local current = _G.SpokenReadablesAudioPacks or {}
	local function Collect(registry, renamed)
		for name, pack in pairs(registry or {}) do
			if Listable(pack)
				and not (renamed and current[(name:gsub("^SpokenBooksAudio", "SpokenReadablesAudio"))]) then
				pack.addon = pack.addon or name
				table.insert(packs, pack)
			end
		end
	end
	Collect(current)
	Collect(_G.SpokenBooksAudioPacks, true)
	table.sort(packs, function(a, b) return (a.addon or "") < (b.addon or "") end)
	return packs
end

-- The buttons the player shows under a book clip: Report, and nothing else. There is no Read
-- button here, unlike the places strip -- the page is already open on screen, and a button
-- that re-read what the reader is looking at would answer a question nobody asked.
--
-- One table, shared by every clip. The player tells the button which clip it now stands
-- beside; the action holds no state of its own.
local ACTIONS = {
	{
		id = "report",
		-- An icon in the corner rather than a word beside the line, as the places action is.
		icon = [[Interface\HelpFrame\HelpIcon-Bug]],
		label = L.REPORT_PROBLEM,
		anchor = "topright",
		tooltip = function(tooltip)
			tooltip:SetText(L.REPORT_PROBLEM)
		end,
		onClick = function(clip)
			if not clip then
				return
			end
			SpokenReadables:ShowReport(clip.pageId)
		end,
	},
}

local function PageStopped(clip, finished)
	if finished then
		SpokenReadables:OnPageFinished(clip)
	end
end

--- The clip for a page, as the player's queue wants it, or nil when no pack carries it.
---
--- Language before pack order: a pack in the voice language answers before any other, and a
--- page it lacks falls back to the fallback language's packs -- page by page, so a partial
--- translation still reads what it has.
-- Letters and digits only, for asking whether a page opens with its own title.
local function Bare(text)
	return (string.gsub(string.lower(text or ""), "[%s%p]", ""))
end

--- When each word of a book's first page is read. Its narration reads the title first, then a
--- pause, unless the page opens with it (pipelines/readables/tools/lib/text.mjs, spokenWithTitle), so
--- the words start after the title's share of the recording, each at its share of the rest as the
--- captions estimate it. Nil where nothing comes before the words, or the length is not known.
local function TitleFirstTimings(title, text, length)
	if not (length and length > 0 and title ~= "" and text and Spoken and Spoken.CaptionWords) then return nil end
	local bare = Bare(title)
	if bare == "" or string.sub(Bare(text), 1, string.len(bare)) == bare then return nil end
	local words, total = Spoken:CaptionWords(text)
	local _, heading = Spoken:CaptionWords(title .. ".")
	if not (words and words[1] and total and total > 0 and heading and heading > 0) then return nil end
	local lead = length * heading / (heading + total)
	local timings = {}
	for i, word in ipairs(words) do
		timings[i] = lead + (length - lead) * word.start / total
	end
	return timings
end

function SpokenReadables:ClipFor(pageId)
	local bookId, number = self:PlaceOf(pageId)
	if not bookId then
		return nil
	end
	local place = (self:Data() and self:Data().pages[pageId]) or { book = bookId, number = number }

	local packs = self:GetAudioPacks()
	for _, language in ipairs(self:LanguageOrder()) do
		for _, pack in ipairs(packs) do
			local entry = self:PackLanguage(pack) == language and pack.pages[pageId]
			if entry then
				local book = self:BookOf(pageId)
				local oneLine = self:OneLine()
				-- `shown` is the language the words are in, and the title is in it too.
				local text, shown, recorded = self:CaptionText(pageId, language, entry.text)
				local title = self:TitleIn(place.book, pageId, shown) or (book and book.title) or ""
				local length = (entry.len and entry.len > 0) and entry.len or nil
				return {
					key = "b:" .. pageId,
					path = [[Interface\AddOns\]] .. pack.addon .. [[\Sounds\]] .. entry.file .. ".mp3",
					-- 0 means the pack recorded no duration -- an imported take rather than one
					-- this project cut. The player falls back to its own timer; a wrong number
					-- here would reset the Play button mid-sentence.
					length = length,
					pageId = pageId,
					-- A line per page: one book is one item to the player, its pages read on
					-- with no pause or cue between.
					group = not oneLine and "book:" .. tostring(place.book) or nil,
					-- What the report is filed under: a fallback page is an English take even
					-- under a German selection, and its report is about that.
					language = language,
					present = {
						-- One line: what it is over its name, as a speaker over a quest's title,
						-- whatever page of it this is. A line per page: the book over its page,
						-- counted only where there is more than one ("page 1 of 1" is noise on
						-- a letter, which is most of this corpus).
						header = oneLine and self:KindOf(place.book) or title,
						transcript = text,
						-- The first page's words start after its title is read. Only where the words
						-- are the ones the recording says: any others have another length.
						timings = place.number == 1 and recorded
							and TitleFirstTimings(title, text, length) or nil,
						label = oneLine and (title ~= "" and title or nil)
							or ((book and #book.pages > 1)
								and format(L.OPT_PAGE_COUNT_FMT, place.number, #book.pages) or nil),
						bullet = "book",
						material = self:PageMaterial(pageId),
						portrait = self:PagePicture(pageId),
						actions = ACTIONS,
					},
					stopCallback = PageStopped,
				}
			end
		end
	end

	return nil
end

--- A page's length in seconds, from the pack ClipFor would read it from; nil where that pack
--- recorded none.
function SpokenReadables:PageLength(pageId)
	local packs = self:GetAudioPacks()
	for _, language in ipairs(self:LanguageOrder()) do
		for _, pack in ipairs(packs) do
			local entry = self:PackLanguage(pack) == language and pack.pages[pageId]
			if entry then
				return (entry.len and entry.len > 0) and entry.len or nil
			end
		end
	end
	return nil
end

--- Why there is no clip, phrased for the player. Distinguishes "you have no sound pack"
--- from "your pack does not cover this page": the first is a download and the second is
--- nothing they can do, and telling them apart is the point of saying anything at all.
function SpokenReadables:DescribeMissingAudio()
	if #self:GetAudioPacks() == 0 then
		return L.OPT_NO_PACK_INSTALLED
	end
	return L.OPT_NO_PACK_AUDIO
end

--- Whether ClipFor would find a clip, without building one.
function SpokenReadables:HasAudio(pageId)
	if not self:PlaceOf(pageId) then
		return false
	end
	local packs = self:GetAudioPacks()
	for _, language in ipairs(self:LanguageOrder()) do
		for _, pack in ipairs(packs) do
			if self:PackLanguage(pack) == language and pack.pages[pageId] then
				return true
			end
		end
	end
	return false
end

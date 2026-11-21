-- SpokenReadables -- books, letters and notes read aloud.
--
-- Client targets: Classic Era 1.15.9 (11509), Anniversary 2.5.6 (20506) and
-- Forever 1.60 (16001). Nothing here branches on the client: the book UI is the same API
-- on all three -- ITEM_TEXT_BEGIN/READY/CLOSED and the ItemTextGet* family -- which was
-- checked against all three branches of the client UI source before any of this was built.
--
-- This addon is one *source* on the Spoken player: its clips wait their turn behind
-- whatever another Spoken addon queued, and stopping here stops narration of a book rather
-- than a quest line that happens to be speaking.

local ADDON_NAME, SpokenReadables = ...

-- Other addons reach the module here; docs/readables/README.md lists the functions they call.
-- PlayFrom does not check CompendiumHas, so callers do, and they call PlayFrom(pageId, true, true):
-- without `browsing` the book counts as read in the world.
_G.SpokenReadables = SpokenReadables

local L = SpokenReadables.L

-- C_AddOns is the modern home of GetAddOnMetadata; the global is the older one. Reading
-- through whichever exists removes a class of load-time failure on a client this has not
-- been run on.
local GetAddOnMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
SpokenReadables.GetAddOnMeta = GetAddOnMeta

SpokenReadables.name = ADDON_NAME
SpokenReadables.version = GetAddOnMeta and GetAddOnMeta(ADDON_NAME, "Version") or "dev"

-- The API version this addon was written against: what lets an older Spoken and this addon
-- disagree safely.
local REQUIRED_API = 1

local defaults = {
	-- On, unlike the places addon's area autoplay: opening a book is already a deliberate
	-- act, so a player who opened one has asked to read it. The switch is for whoever
	-- would rather press play themselves.
	autoplay = true,
	-- Whole book rather than the page on screen. A twenty-page journal read one button
	-- press at a time is a worse experience than one that reads on while you turn pages.
	readWholeBook = true,
	-- A book is one line in the queue: Skip skips the rest of it and the progress bar runs
	-- across it. Off, each page waits in the queue on its own, with its page count.
	bookAsOneLine = true,
	-- Off, because a reader who has not asked for it should hear a book whenever they open
	-- it. On, a book is narrated the first time it is opened and stays quiet after that.
	readOnce = false,
	-- As Quests' Stop When Window Closes: off, a book carries on being read after it is shut.
	stopOnClose = false,
	-- Off: a reader may still be reading along when the voice ends. On, the book shuts after its
	-- last page has been heard, which also gives back the interface DialogueUI's book view hides.
	closeWhenRead = false,
	-- Why a page was or was not read, in chat (/spr debug).
	debug = false,
	-- Follow the client, and fall back on English: every pack that exists today is English,
	-- so a player with the pack they already have hears what they heard before.
	voiceLanguage = "auto",
	fallbackLanguage = "enUS",
	-- Azeroth's Compendium (UI/Readables.lua): every readable openable, found or not; and the
	-- list leaving out those not found.
	unlockUnfound = false,
	compendiumFoundOnly = true,
	compendiumVoicedOnly = false,
	-- On, its tree is zones then types; off, the types alone.
	compendiumByZone = true,
}

--- Every setting back to its default. What this character has heard is not a setting, and
--- stays: Forget is the button for that.
function SpokenReadables:ResetOptions()
	if not SpokenReadablesSettings then return end
	-- Unlock Unfound Readables is on Spoken's page where Spoken is installed, and not this one's.
	local elsewhere = Spoken and Spoken.ShowsCompendium and { unlockUnfound = true } or {}
	for key, value in pairs(defaults) do
		if not elsewhere[key] then SpokenReadablesSettings[key] = value end
	end
end

local function FillDefaults()
	SpokenReadablesSettings = SpokenReadablesSettings or {}
	for key, value in pairs(defaults) do
		if SpokenReadablesSettings[key] == nil then
			SpokenReadablesSettings[key] = value
		end
	end
	-- A Found Only saved off before it was on by default would read as the player's choice: turned
	-- on once behind this marker. An off set after that is kept.
	if not SpokenReadablesSettings.foundOnlyDefaultOn then
		SpokenReadablesSettings.foundOnlyDefaultOn = true
		SpokenReadablesSettings.compendiumFoundOnly = true
	end
end

function SpokenReadables:InitDB()
	-- The saved variables were SpokenBooksSettings and SpokenBooksCharacter before the module was
	-- Readables. The .toc lists the old names after the new, so they are loaded once more and
	-- carried over here; left nil, they are not saved again.
	if SpokenReadablesSettings == nil then SpokenReadablesSettings = SpokenBooksSettings end
	if SpokenReadablesCharacter == nil then SpokenReadablesCharacter = SpokenBooksCharacter end
	SpokenBooksSettings, SpokenBooksCharacter = nil, nil
	FillDefaults()
	-- The settings live in Spoken's profile, copied from SpokenBooksSettings the first time. The
	-- table bound is the one read from now on, and again whenever another profile is chosen.
	if Spoken and Spoken.BindModuleSettings then
		Spoken:BindModuleSettings("Readables", SpokenReadablesSettings, function(settings)
			SpokenReadablesSettings = settings
			FillDefaults()
		end)
	end

	-- What has been heard is the character's, not the account's: the settings above are how
	-- you like the addon to behave and belong to you, while "I have read this" is something
	-- a particular character did. An alt walking into the same library hears it fresh.
	SpokenReadablesCharacter = SpokenReadablesCharacter or {}
	SpokenReadablesCharacter.read = SpokenReadablesCharacter.read or {}
	-- Opened, heard or not: what Azeroth's Compendium counts as found. Kept apart from `read`,
	-- which Read Only Once goes by, so opening a book with autoplay off does not stop it being
	-- read the next time, and Play in the Compendium does not find one. A character from before
	-- `found` was kept had only `read` to say what it opened, so that is carried over once.
	if not SpokenReadablesCharacter.found then
		SpokenReadablesCharacter.found = {}
		for book in pairs(SpokenReadablesCharacter.read) do SpokenReadablesCharacter.found[book] = true end
	end

	return SpokenReadablesSettings
end

--- A setting by name.
function SpokenReadables:Get(key)
	return SpokenReadablesSettings and SpokenReadablesSettings[key]
end

function SpokenReadables:Set(key, value)
	if SpokenReadablesSettings then SpokenReadablesSettings[key] = value end
end

--- Whether this character has already been read `book` -- the book key from PlaceOf, not a
--- page. Answers false for a nil book so the caller does not have to check twice.
function SpokenReadables:HasReadBook(book)
	if not book or not SpokenReadablesCharacter then
		return false
	end
	return SpokenReadablesCharacter.read[book] == true
end

--- Remember that this character has heard `book`.
---
--- Called when narration STARTS rather than when it finishes. The addon is not told when a
--- clip ends -- the player owns the queue -- so "finished" would have to be inferred from a
--- queue that a zone change or `/spr stop` can empty early, and a book abandoned halfway
--- would count as read anyway. Starting is the moment this addon actually observes.
function SpokenReadables:MarkBookRead(book)
	if not book or not SpokenReadablesCharacter then
		return
	end
	SpokenReadablesCharacter.read[book] = true
end

--- Remember that this character has opened `book`, whether or not it was read aloud.
function SpokenReadables:MarkBookFound(book)
	if not book or not SpokenReadablesCharacter then
		return
	end
	SpokenReadablesCharacter.found = SpokenReadablesCharacter.found or {}
	if SpokenReadablesCharacter.found[book] then return end
	SpokenReadablesCharacter.found[book] = true
	-- The Readables tab open meanwhile ticks it and counts it now, not when it is next opened.
	if self.readables and self.readables:IsVisible() and self.RefreshReadables then self:RefreshReadables() end
end

--- Whether this character has found `book`: opened it in the world. Hearing it from the
--- Compendium does not count.
function SpokenReadables:IsBookFound(book)
	if not book or not SpokenReadablesCharacter then
		return false
	end
	return (SpokenReadablesCharacter.found and SpokenReadablesCharacter.found[book]) == true
end

--- Forget everything this character has heard, and say how much that was. What `/spr forget`
--- and the settings panel's button reach: a reader who turns the setting on, then wants the
--- library back, has no other way to undo it.
function SpokenReadables:ForgetRead()
	local count = 0
	if not SpokenReadablesCharacter then
		return count
	end
	for _ in pairs(SpokenReadablesCharacter.read) do
		count = count + 1
	end
	SpokenReadablesCharacter.read = {}
	return count
end

--- Whether the player addon is present and speaks a version this addon understands.
function SpokenReadables:PlayerAvailable()
	return _G.Spoken ~= nil and Spoken.IsCompatible ~= nil and Spoken:IsCompatible(REQUIRED_API)
end

--- Whether the player has this part of Spoken switched on (Spoken's settings). Without the
--- player there is no switch to read, and the part counts as on. Off, no play button shows.
function SpokenReadables:IsPartOn()
	return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("readables")
end

--- Whether the player offers background gathering this panel can switch: present with
--- the Gather table, absent on older players and where contributing is off.
function SpokenReadables:GatherAvailable()
	return _G.Spoken ~= nil and Spoken.Gather ~= nil
		and type(Spoken.Gather.IsEnabled) == "function"
		and type(Spoken.Gather.SetEnabled) == "function"
end

--- Registers this addon with the player. Returns the source, or nil when there is no
--- player to register with -- which is not an error: the addon loads, and says so.
function SpokenReadables:SetupSource()
	-- PLAYER_ENTERING_WORLD fires again on every loading screen, and a second registration
	-- would hand back a source the playlist is not holding -- so a book queued before a zone
	-- change could no longer be stopped by the one this addon kept.
	if self.source then
		return self.source
	end

	if not self:PlayerAvailable() then
		self.compatible = false
		return nil
	end
	self.compatible = true

	self.source = Spoken:RegisterSource("readables", {
		title = L.OPT_PAGE_TITLE,
		addon = ADDON_NAME,
		order = 4,
		-- No limit, unlike the places source. Zone lore arrives in bursts nobody asked for --
		-- crossing a cluster of small subzones queues narration about places the player has
		-- already left -- so it caps the backlog and drops the oldest. A readable is one the
		-- player opened, and each queues after the one being read: they pile up on purpose, a
		-- gravestone read on the way waiting for the book, and a cap would drop what was opened.
		queueLimit = nil,
		-- Durations come from a generated lookup and are exact, so the gap only has to
		-- separate two pages of prose rather than absorb a bad measurement.
		interClipGap = 0.35,
		-- A page whose file the client cannot find (a pack updated without a restart, a partial
		-- install) is refused at the door, so the book reads on from the next page.
		testBeforeQueue = true,
		-- Printed after Spoken's own by its Show Diagnostics.
		diagnostics = function() SpokenReadables:ShowStatus() end,
		-- What Spoken's settings show on this part's card: which voice packs are installed.
		packs = function()
			local names = {}
			for _, pack in ipairs(SpokenReadables:GetAudioPacks()) do table.insert(names, pack.title or pack.addon) end
			return names
		end,
	})

	-- Switchable from the player's settings, named there by this addon. The other two
	-- declare the same id, so one setting covers whichever is speaking.
	if Spoken.RegisterOptionalAction then
		Spoken:RegisterOptionalAction("report", L.REPORT)
	end

	-- The row bullet the clips ask for. Registered rather than assumed: an unregistered id
	-- draws nothing, which looks like a rendering bug rather than a missing declaration.
	if Spoken.RegisterBullet then
		Spoken:RegisterBullet("book", [[Interface\AddOns\Spoken\Textures\Book]], 14)
	end

	-- Switched off or on in Spoken's settings: the Play button on the page follows, and so does the
	-- Compendium's Readables tab.
	if Spoken.RegisterCallback then
		Spoken:RegisterCallback("PART_SWITCHED", function(key)
			if key ~= "readables" then return end
			SpokenReadables:RefreshPlayButton()
			if SpokenCompendium and SpokenCompendium.Relayout then SpokenCompendium:Relayout() end
		end)
	end

	if Spoken.Minimap then
		-- No "read this book" entry: it only did anything with a book already open, and an
		-- open book has its own Play button.
		Spoken.Minimap:AddEntry("readables", { id = "Options", text = L.MENU_BOOK_SETTINGS,
			order = 2, onClick = function() SpokenReadables:OpenOptions() end })
	end

	return self.source
end

--- The corpus, as Data/Books.lua left it. Nil only when that file failed to load, which is
--- worth answering for rather than indexing into nil from four call sites.
function SpokenReadables:Data()
	return _G.SpokenReadablesData
end

--- Spoken's site, or nil when Spoken is not loaded: no page is read aloud without it, so there
--- is no report to send.
function SpokenReadables:SiteURL()
	return _G.Spoken and _G.Spoken.SITE_URL
end

--- The page to send a reader to when they want to complain about a page or its narration.
---
--- Built from the page id alone, and that is the whole reason the address has this shape:
--- the id is frozen -- `b:{pageTextID}` per docs/readables/AGENTS.md -- so the addon can build
--- the link from what it already has, with no per-page table to ship and nothing to escape.
--- The places landing page makes the same trade with its {mapID}/{slug} path.
function SpokenReadables:ReportURL(pageId, language)
	local key = type(pageId) == "number" and format("%d", pageId)
		or (type(pageId) == "string" and pageId:match("^n[%x%-]+$"))
	if not key or not self:SiteURL() then
		return nil
	end
	-- Filed under the language of the clip being reported.
	return _G.Spoken:ReportURL("readables", key, language)
end

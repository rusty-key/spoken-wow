-- SpokenBooks -- books, letters and notes read aloud.
--
-- Client targets: Classic Era 1.15.9 (11509), Anniversary 2.5.6 (20506) and
-- Forever 1.60 (16001). Nothing here branches on the client: the book UI is the same API
-- on all three -- ITEM_TEXT_BEGIN/READY/CLOSED and the ItemTextGet* family -- which was
-- checked against all three branches of the client UI source before any of this was built.
--
-- This addon is one *source* on the Spoken player: its clips wait their turn behind
-- whatever another Spoken addon queued, and stopping here stops narration of a book rather
-- than a quest line that happens to be speaking.

local ADDON_NAME, SpokenBooks = ...

local L = SpokenBooks.L

-- C_AddOns is the modern home of GetAddOnMetadata; the global is the older one. Reading
-- through whichever exists removes a class of load-time failure on a client this has not
-- been run on.
local GetAddOnMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata

SpokenBooks.name = ADDON_NAME
SpokenBooks.version = GetAddOnMeta and GetAddOnMeta(ADDON_NAME, "Version") or "dev"

-- The API version this addon was written against. A player bundled into a legacy-client zip
-- can lag the one an addon manager installs, and this is what lets the two disagree safely.
local REQUIRED_API = 1

local defaults = {
	-- On, unlike the zones addon's area autoplay: opening a book is already a deliberate
	-- act, so a player who opened one has asked to read it. The switch is for whoever
	-- would rather press play themselves.
	autoplay = true,
	-- Whole book rather than the page on screen. A twenty-page journal read one button
	-- press at a time is a worse experience than one that reads on while you turn pages.
	readWholeBook = true,
	-- Off, because a reader who has not asked for it should hear a book whenever they open
	-- it. On, a book is narrated the first time it is opened and stays quiet after that.
	readOnce = false,
	-- As Quests' Stop When Window Closes: off, a book carries on being read after it is shut.
	stopOnClose = false,
	-- Off: a reader may still be reading along when the voice ends. On, the book shuts after its
	-- last page has been heard, which also gives back the interface DialogueUI's book view hides.
	closeWhenRead = false,
	-- Why a page was or was not read, in chat (/spb debug).
	debug = false,
	-- Follow the client, and fall back on English: every pack that exists today is English,
	-- so a player with the pack they already have hears what they heard before.
	voiceLanguage = "auto",
	fallbackLanguage = "enUS",
	-- Azeroth's Compendium (UI/Readables.lua): every readable openable, found or not; and the
	-- list leaving out those not found.
	unlockUnfound = false,
	compendiumFoundOnly = false,
	compendiumVoicedOnly = false,
	-- On, its tree is zones then types; off, the types alone.
	compendiumByZone = true,
}

--- Every setting back to its default. What this character has heard is not a setting, and
--- stays: Forget is the button for that.
function SpokenBooks:ResetOptions()
	if not SpokenBooksSettings then return end
	-- Unlock Unfound Books is on Spoken's page where Spoken is installed, and not this one's.
	local elsewhere = Spoken and Spoken.ShowsCompendium and { unlockUnfound = true } or {}
	for key, value in pairs(defaults) do
		if not elsewhere[key] then SpokenBooksSettings[key] = value end
	end
end

function SpokenBooks:InitDB()
	SpokenBooksSettings = SpokenBooksSettings or {}
	for key, value in pairs(defaults) do
		if SpokenBooksSettings[key] == nil then
			SpokenBooksSettings[key] = value
		end
	end

	-- What has been heard is the character's, not the account's: the settings above are how
	-- you like the addon to behave and belong to you, while "I have read this" is something
	-- a particular character did. An alt walking into the same library hears it fresh.
	SpokenBooksCharacter = SpokenBooksCharacter or {}
	SpokenBooksCharacter.read = SpokenBooksCharacter.read or {}
	-- Opened, heard or not: what Azeroth's Compendium counts as found. Kept apart from `read`,
	-- which Read Only Once goes by, so opening a book with autoplay off does not stop it being
	-- read the next time, and Play in the Compendium does not find one. A character from before
	-- `found` was kept had only `read` to say what it opened, so that is carried over once.
	if not SpokenBooksCharacter.found then
		SpokenBooksCharacter.found = {}
		for book in pairs(SpokenBooksCharacter.read) do SpokenBooksCharacter.found[book] = true end
	end

	return SpokenBooksSettings
end

--- A setting by name, for the files carried from Spoken Zones (UI/TextView.lua asks the words'
--- size): Zones' own where it is installed, so the two tabs of the Compendium read alike.
function SpokenBooks:Get(key)
	if key == "fontSize" then
		return (SpokenZonesSettings and SpokenZonesSettings.fontSize) or 12
	end
	return SpokenBooksSettings and SpokenBooksSettings[key]
end

--- Whether this character has already been read `book` -- the book key from PlaceOf, not a
--- page. Answers false for a nil book so the caller does not have to check twice.
function SpokenBooks:HasReadBook(book)
	if not book or not SpokenBooksCharacter then
		return false
	end
	return SpokenBooksCharacter.read[book] == true
end

--- Remember that this character has heard `book`.
---
--- Called when narration STARTS rather than when it finishes. The addon is not told when a
--- clip ends -- the player owns the queue -- so "finished" would have to be inferred from a
--- queue that a zone change or `/spb stop` can empty early, and a book abandoned halfway
--- would count as read anyway. Starting is the moment this addon actually observes.
function SpokenBooks:MarkBookRead(book)
	if not book or not SpokenBooksCharacter then
		return
	end
	SpokenBooksCharacter.read[book] = true
end

--- Remember that this character has opened `book`, whether or not it was read aloud.
function SpokenBooks:MarkBookFound(book)
	if not book or not SpokenBooksCharacter then
		return
	end
	SpokenBooksCharacter.found = SpokenBooksCharacter.found or {}
	SpokenBooksCharacter.found[book] = true
end

--- Whether this character has found `book`: opened it in the world. Hearing it from the
--- Compendium does not count.
function SpokenBooks:IsBookFound(book)
	if not book or not SpokenBooksCharacter then
		return false
	end
	return (SpokenBooksCharacter.found and SpokenBooksCharacter.found[book]) == true
end

--- Forget everything this character has heard, and say how much that was. What `/spb forget`
--- and the settings panel's button reach: a reader who turns the setting on, then wants the
--- library back, has no other way to undo it.
function SpokenBooks:ForgetRead()
	local count = 0
	if not SpokenBooksCharacter then
		return count
	end
	for _ in pairs(SpokenBooksCharacter.read) do
		count = count + 1
	end
	SpokenBooksCharacter.read = {}
	return count
end

--- Whether the player addon is present and speaks a version this addon understands.
function SpokenBooks:PlayerAvailable()
	return _G.Spoken ~= nil and Spoken.IsCompatible ~= nil and Spoken:IsCompatible(REQUIRED_API)
end

--- Whether the player has this part of Spoken switched on (Spoken's settings). Without the
--- player there is no switch to read, and the part counts as on. Off, no play button shows.
function SpokenBooks:IsPartOn()
	return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("books")
end

--- Whether the player offers background gathering this panel can switch: present with
--- the Gather table, absent on older players and where contributing is off.
function SpokenBooks:GatherAvailable()
	return _G.Spoken ~= nil and Spoken.Gather ~= nil
		and type(Spoken.Gather.IsEnabled) == "function"
		and type(Spoken.Gather.SetEnabled) == "function"
end

--- Registers this addon with the player. Returns the source, or nil when there is no
--- player to register with -- which is not an error: the addon loads, and says so.
function SpokenBooks:SetupSource()
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

	self.source = Spoken:RegisterSource("books", {
		title = "Spoken Books",
		addon = ADDON_NAME,
		order = 3,
		-- NO LIMIT, unlike the zones source, and the difference is what the limit is for.
		-- Zone lore arrives in bursts nobody asked for -- crossing a cluster of small
		-- subzones queues narration about places the player has already left -- so it caps
		-- the backlog and drops the oldest. A book is the opposite: a bounded sequence
		-- somebody deliberately opened, whose pages are only meaningful in order. Capped at
		-- one, queueing a four-page book keeps the first page and the last and silently
		-- discards the middle, which is how this was found.
		--
		-- Nothing accumulates regardless, even though closing the book no longer stops this
		-- source: turning to -- or opening -- a page that is not already queued rebuilds this
		-- source's queue from there, so what waits behind the voice is one book and never a
		-- session's worth of them.
		queueLimit = nil,
		-- Durations come from a generated lookup and are exact, so the gap only has to
		-- separate two pages of prose rather than absorb a bad measurement.
		interClipGap = 0.35,
		-- A book's pages read on as one text: no pause between lines between them.
		continuous = true,
		-- What Spoken's settings show on this part's card: which voice packs are installed.
		packs = function()
			local names = {}
			for _, pack in ipairs(SpokenBooks:GetAudioPacks()) do table.insert(names, pack.title or pack.addon) end
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
	-- Compendium's Books tab.
	if Spoken.RegisterCallback then
		Spoken:RegisterCallback("PART_SWITCHED", function(key)
			if key ~= "books" then return end
			SpokenBooks:RefreshPlayButton()
			if SpokenCompendium and SpokenCompendium.Relayout then SpokenCompendium:Relayout() end
		end)
	end

	if Spoken.Minimap then
		-- No "read this book" entry: it only did anything with a book already open, and an
		-- open book has its own Play button.
		Spoken.Minimap:AddEntry("books", { id = "Options", text = L.MENU_BOOK_SETTINGS,
			order = 2, onClick = function() SpokenBooks:OpenOptions() end })
	end

	if Spoken.AddSettingsLink then
		Spoken:AddSettingsLink(L.MENU_BOOK_SETTINGS,
			function() SpokenBooks:OpenOptions() end)
	end

	return self.source
end

--- The corpus, as Data/Books.lua left it. Nil only when that file failed to load, which is
--- worth answering for rather than indexing into nil from four call sites.
function SpokenBooks:Data()
	return _G.SpokenBooksData
end

--- Where a report goes. The books section is on the new domain from the start, unlike the
--- quests and zones addons, which point at the two frozen sites they shipped with.
SpokenBooks.SITE_URL = "https://spoken.rusty.one"

--- The page to send a reader to when they want to complain about a page or its narration.
---
--- Built from the page id alone, and that is the whole reason the address has this shape:
--- the id is frozen -- `b:{pageTextID}` per docs/books/AGENTS.md -- so the addon can build
--- the link from what it already has, with no per-page table to ship and nothing to escape.
--- The zones landing page makes the same trade with its {mapID}/{slug} path.
function SpokenBooks:ReportURL(pageId, language)
	if type(pageId) ~= "number" then
		return nil
	end
	-- Filed under the language of the clip being reported, which the site reads off its
	-- /{lang}/ prefix. English keeps the address it always had.
	if language and language ~= "enUS" then
		return format("%s/%s/books/r/%d", self.SITE_URL, language, pageId)
	end
	return format("%s/books/r/%d", self.SITE_URL, pageId)
end

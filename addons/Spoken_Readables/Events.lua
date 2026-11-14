-- The client's book frame, wired to the playlist -- and the login that wires the addon up
-- at all.
--
-- ADDON_LOADED is where the saved variables become readable: SpokenReadablesSettings is nil until the
-- client has restored it, so Commands.lua indexing it before then is an error rather than a
-- default. PLAYER_ENTERING_WORLD is where the source is claimed, late on purpose -- the
-- player addon builds its API at its own load, and waiting for the world is what the places
-- addon does for the same reason. Without both, every function below returns 0 on a missing
-- source and the addon is silent while looking installed.
--
-- Three book events, the same three on all three targets:
--
--   ITEM_TEXT_BEGIN    the frame is opening; the text is not there yet
--   ITEM_TEXT_READY    a page's words are available, on open AND on every page turn
--   ITEM_TEXT_CLOSED   the frame is gone
--
-- READY is the only one that can identify a page, because it is the only one at which
-- ItemTextGetText() answers. It fires again for every turn, which is what makes a page turn
-- and an opening indistinguishable here -- and they should be: both mean "this is the page
-- now", and SyncTo decides whether that changes anything.

local ADDON_NAME, SpokenReadables = ...

local frame = CreateFrame("Frame")
SpokenReadables.eventFrame = frame

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("BAG_UPDATE")
frame:RegisterEvent("ITEM_TEXT_BEGIN")
frame:RegisterEvent("ITEM_TEXT_READY")
frame:RegisterEvent("ITEM_TEXT_CLOSED")

local function BagSlots(bag)
	if C_Container and C_Container.GetContainerNumSlots then
		return C_Container.GetContainerNumSlots(bag) or 0
	end
	return GetContainerNumSlots and GetContainerNumSlots(bag) or 0
end

local function ItemID(bag, slot)
	if C_Container and C_Container.GetContainerItemID then
		return C_Container.GetContainerItemID(bag, slot)
	end
	if GetContainerItemID then
		return GetContainerItemID(bag, slot)
	end
	if C_Container and C_Container.GetContainerItemInfo then
		local info = C_Container.GetContainerItemInfo(bag, slot)
		local link = info and info.hyperlink
		return link and tonumber(string.match(link, "item:(%d+)"))
	end
	if GetContainerItemInfo then
		local _, _, _, _, _, _, link = GetContainerItemInfo(bag, slot)
		return link and tonumber(string.match(link, "item:(%d+)"))
	end
end

local function ItemCount(bag, slot)
	if C_Container and C_Container.GetContainerItemInfo then
		local info = C_Container.GetContainerItemInfo(bag, slot)
		return info and info.stackCount or 1
	end
	if GetContainerItemInfo then
		local _, count = GetContainerItemInfo(bag, slot)
		return count or 1
	end
	return 1
end

-- Bump when the quest-to-readable lookup changes so characters that already ran an older
-- backfill are rescanned automatically after an addon update.
local QUEST_BACKFILL_VERSION = 5

local function CompletedQuests()
	local completed = {}
	if C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs then
		local quests = C_QuestLog.GetAllCompletedQuestIDs()
		if not quests then return nil end
		for _, questID in ipairs(quests) do
			completed[questID] = true
		end
		return completed
	end
	if GetQuestsCompleted then
		local quests = GetQuestsCompleted({})
		if not quests then return nil end
		for questID, isCompleted in pairs(quests or {}) do
			if isCompleted then completed[questID] = true end
		end
		return completed
	end
	return nil
end

--- Backfill readable items received from direct quest rewards before this feature existed.
function SpokenReadables:BackfillQuestReadables()
	if not SpokenReadablesCharacter or SpokenReadablesCharacter.questReadableBackfill == QUEST_BACKFILL_VERSION then
		return
	end
	local completed = CompletedQuests()
	local places = _G.SpokenReadablesPlaces and SpokenReadablesPlaces.books
	if not completed then return end
	if places then
		for book, place in pairs(places) do
			for _, questID in ipairs(place.quests or {}) do
				if completed[questID] and self:HasBookText(book) then
					self:MarkBookFound(book)
					break
				end
			end
		end
	end

	-- Questie is optional, but when installed it can fill this in before Places.lua has been
	-- regenerated with quest metadata. Its quest index identifies source items exactly; do not
	-- use the item reverse index because it may include a choice reward the player did not take.
	local questie = _G.QuestieDB
	local data = self:Data()
	local owners = data and data.owners and data.owners.item
	local questQuery = questie and questie.QueryQuestSingle
	if not questQuery and _G.LibQuestieDB and _G.LibQuestieDB.Quest then
		questQuery = _G.LibQuestieDB.Quest.Get
	end
	if owners then
		if questQuery then
			for questID in pairs(completed) do
				local itemID = questQuery(questID, "sourceItemId")
				local book = itemID and owners[itemID]
				if book and self:HasBookText(book) then self:MarkBookFound(book) end
			end
		end
	end
	SpokenReadablesCharacter.questReadableBackfill = QUEST_BACKFILL_VERSION
end

--- The readable items currently in the player's bags, counted by item ID.
function SpokenReadables:ReadableItemSnapshot()
	local current = {}
	for bag = 0, NUM_BAG_SLOTS or 4 do
		for slot = 1, BagSlots(bag) do
			local itemID = ItemID(bag, slot)
			if self:BookForItem(itemID) then
				current[itemID] = (current[itemID] or 0) + ItemCount(bag, slot)
			end
		end
	end
	return current
end

--- Remember text-bearing notes as soon as they enter the bags, without opening or reading them.
function SpokenReadables:OnBagUpdate()
	local current = self:ReadableItemSnapshot()
	if not self.readableItemCounts then
		self.readableItemCounts = current
		return
	end
	local previous = self.readableItemCounts or {}
	for itemID, count in pairs(current) do
		if count > (previous[itemID] or 0) then
			self:MarkBookFound(self:BookForItem(itemID))
		end
	end
	self.readableItemCounts = current
end

--- A page became available. The addon's whole in-game entry point.
function SpokenReadables:OnTextReady()
	if not self.source then
		return 0
	end

	local pageId = self:PageOnScreen()
	if not pageId then
		-- Mail, or a page this corpus does not carry. Neither is worth saying anything
		-- about unasked: one is deliberate and the other is a gap the reader cannot act on.
		self:Explain("not read: this page is not one Spoken knows")
		return 0
	end

	self.lastPage = pageId
	-- Found the moment it is open, whatever autoplay says.
	self:MarkBookFound(self:PlaceOf(pageId))

	if not SpokenReadablesSettings or SpokenReadablesSettings.autoplay == false then
		-- The reader turned autoplay off, so nothing starts by itself -- but the page is
		-- remembered, which is what lets `/spr read` play the one in front of them.
		self:Explain("not read: Read Automatically is off (press Play to hear it)")
		return 0
	end

	-- Read once, and this character has read this one. Only autoplay is refused: `/spr read`
	-- and the button on the frame go straight to SyncTo, because a reader who presses play
	-- has asked for this book again in so many words.
	if SpokenReadablesSettings.readOnce then
		local book = self:PlaceOf(pageId)
		if self:HasReadBook(book) and not self:IsNarrating(book) then
			self:Explain("not read: Read Only Once is on and this character has heard it")
			return 0
		end
	end

	local queued = self:SyncTo(pageId)
	if queued > 0 then
		self:Explain("reading page %s (%d queued)", tostring(pageId), queued)
	else
		self:Explain("not read: no voice pack has page %s", tostring(pageId))
	end
	return queued
end

--- A line in chat saying what was decided and why, while /spr debug has it on.
function SpokenReadables:Explain(message, ...)
	if SpokenReadablesSettings and SpokenReadablesSettings.debug and self.Print then
		self:Print(message, ...)
	end
end

--- The frame is gone. Narration is not, unless the reader asked for it with Stop When Book
--- Closes: one who has heard three pages of a journal and shuts it to carry on walking is
--- usually still listening. `/spr stop` stops it either way.
---
--- The page is still forgotten, because it is the page *on screen* and there is no longer
--- one. That is what keeps `/spr read` with no book open a no-op rather than a re-reading of
--- whatever was last closed.
function SpokenReadables:OnTextClosed()
	local book = self:PlaceOf(self.lastPage)
	self.lastPage = nil
	if book and SpokenReadablesSettings and SpokenReadablesSettings.stopOnClose then
		self:StopReading(book)
	end
end

--- A page was heard to its end. With Close Book When Done Reading on, the book shuts once
--- nothing of it is left to hear and it is still the one open. A later page with a voice keeps
--- it open: with Read Whole Book off, the reader is about to turn to it. CloseItemText reaches
--- DialogueUI's book view too, through the ITEM_TEXT_CLOSED every book window listens to.
function SpokenReadables:OnPageFinished(clip)
	if not (SpokenReadablesSettings and SpokenReadablesSettings.closeWhenRead) then
		return
	end
	local book = self:PlaceOf(clip.pageId)
	if self:PlaceOf(self.lastPage) ~= book or self:IsNarrating(book) then
		return
	end
	local later = self:PagesFrom(clip.pageId)
	for i = 2, #later do
		if self:HasAudio(later[i]) then
			return
		end
	end
	self:Explain("closing the book: its last page has been read")
	CloseItemText()
end

frame:SetScript("OnEvent", function(_, name, payload, second)
	if name == "ITEM_TEXT_BEGIN" then
		-- Guarded, as the UI files are: Opener.lua only helps Reader.lua find a page.
		if SpokenReadables.OnTextBegin then
			SpokenReadables:OnTextBegin()
		end
	elseif name == "PLAYER_SOFT_INTERACT_CHANGED" then
		SpokenReadables:NoteSoftInteract(second)
	elseif name == "ITEM_TEXT_READY" then
		SpokenReadables:OnTextReady()
		-- Guarded: Contribute.lua is absent where contributing is off.
		if SpokenReadables.GatherContribution then
			SpokenReadables:GatherContribution()
		end
		-- After, not before: the button's label is "Stop" only once the page has queued, and
		-- built here as well as at login so a client that makes ItemTextFrame late still
		-- gets one. The button needs no hiding on ITEM_TEXT_CLOSED -- it is the frame's
		-- child and goes with it.
		if SpokenReadables.SetupPlayButton then
			SpokenReadables:SetupPlayButton()
			SpokenReadables:RefreshPlayButton()
		end
	elseif name == "ITEM_TEXT_CLOSED" then
		SpokenReadables:OnTextClosed()
		if SpokenReadables.OnOpenerClosed then
			SpokenReadables:OnOpenerClosed()
		end
	elseif name == "ADDON_LOADED" then
		-- Every addon's load fires this; only this addon's own restores SpokenReadablesSettings.
		if payload == ADDON_NAME then
			SpokenReadables:InitDB()
			frame:UnregisterEvent("ADDON_LOADED")
		end
	elseif name == "PLAYER_LOGIN" then
		-- Listing the packs tells Spoken's registry the language of each one whose .toc names none,
		-- which every pack released before that key is. Not at this addon's own load: the language
		-- and community packs load after it and have declared nothing yet. Every addon has loaded
		-- by now, and no menu has been built.
		SpokenReadables:GetAudioPacks()
		SpokenReadables.hasLoggedIn = true
		-- Establish the starting inventory so items already owned when the character logs in are
		-- not treated as newly received. Later BAG_UPDATE events record newly acquired notes.
		SpokenReadables.readableItemCounts = SpokenReadables:ReadableItemSnapshot()
		SpokenReadables:BackfillQuestReadables()
	elseif name == "BAG_UPDATE" then
		SpokenReadables:OnBagUpdate()
		-- Completed-quest history can be unavailable during login on some clients. A later bag
		-- event is a reliable same-session opportunity to retry the still-pending backfill.
		if SpokenReadables.hasLoggedIn then SpokenReadables:BackfillQuestReadables() end
	elseif name == "PLAYER_ENTERING_WORLD" then
		SpokenReadables:SetupSource()
		if SpokenReadables.SetupOpeners then
			SpokenReadables:SetupOpeners()
		end
		-- Both guarded, and for the same reason: UI/PlayButton.lua and UI/Options.lua are
		-- the two files this addon reads books without. The .toc loads them, so a guard here
		-- is not about the shipped addon -- it is what keeps narration working when one of
		-- them is missing, and what lets a test load the wiring without the UI.
		if SpokenReadables.SetupPlayButton then
			SpokenReadables:SetupPlayButton()
		end
		if SpokenReadables.SetupDialogueUIBook then
			SpokenReadables:SetupDialogueUIBook()
		end
		-- The panel is registered here rather than at ADDON_LOADED because the Settings API
		-- is what the client offers late, and because a panel nobody opens costs nothing to
		-- build once the world is up.
		if SpokenReadables.SetupOptions then
			SpokenReadables:SetupOptions()
		end
		-- The readables' tab in Azeroth's Compendium, built the first time it is opened.
		if SpokenReadables.SetupReadables then
			SpokenReadables:SetupReadables()
		end
		if SpokenReadables.hasLoggedIn then SpokenReadables:BackfillQuestReadables() end
	end
end)

--- Read the page in front of the reader now, whatever autoplay says. What the player's own
--- play control and `/spr read` reach.
function SpokenReadables:ReadCurrent()
	local pageId = self:PageOnScreen() or self.lastPage
	if not pageId then
		return 0
	end
	return self:SyncTo(pageId, nil, true)
end

-- The client's book frame, wired to the playlist -- and the login that wires the addon up
-- at all.
--
-- ADDON_LOADED is where the saved variables become readable: SpokenBooksSettings is nil until the
-- client has restored it, so Commands.lua indexing it before then is an error rather than a
-- default. PLAYER_ENTERING_WORLD is where the source is claimed, late on purpose -- the
-- player addon builds its API at its own load, and waiting for the world is what the zones
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

local ADDON_NAME, SpokenBooks = ...

local frame = CreateFrame("Frame")
SpokenBooks.eventFrame = frame

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ITEM_TEXT_BEGIN")
frame:RegisterEvent("ITEM_TEXT_READY")
frame:RegisterEvent("ITEM_TEXT_CLOSED")

--- A page became available. The addon's whole in-game entry point.
function SpokenBooks:OnTextReady()
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

	if not SpokenBooksSettings or SpokenBooksSettings.autoplay == false then
		-- The reader turned autoplay off, so nothing starts by itself -- but the page is
		-- remembered, which is what lets `/spb read` play the one in front of them.
		self:Explain("not read: Read Automatically is off (press Play to hear it)")
		return 0
	end

	-- Read once, and this character has read this one. Only autoplay is refused: `/spb read`
	-- and the button on the frame go straight to SyncTo, because a reader who presses play
	-- has asked for this book again in so many words.
	if SpokenBooksSettings.readOnce then
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

--- A line in chat saying what was decided and why, while /spb debug has it on.
function SpokenBooks:Explain(message, ...)
	if SpokenBooksSettings and SpokenBooksSettings.debug and self.Print then
		self:Print(message, ...)
	end
end

--- The frame is gone. Narration is not, unless the reader asked for it with Stop When Book
--- Closes: one who has heard three pages of a journal and shuts it to carry on walking is
--- usually still listening. `/spb stop` stops it either way.
---
--- The page is still forgotten, because it is the page *on screen* and there is no longer
--- one. That is what keeps `/spb read` with no book open a no-op rather than a re-reading of
--- whatever was last closed.
function SpokenBooks:OnTextClosed()
	self.lastPage = nil
	if SpokenBooksSettings and SpokenBooksSettings.stopOnClose then
		self:StopReading()
	end
end

--- A page was heard to its end. With Close Book When Done Reading on, the book shuts once
--- nothing of it is left to hear and it is still the one open. A later page with a voice keeps
--- it open: with Read Whole Book off, the reader is about to turn to it. CloseItemText reaches
--- DialogueUI's book view too, through the ITEM_TEXT_CLOSED every book window listens to.
function SpokenBooks:OnPageFinished(clip)
	if not (SpokenBooksSettings and SpokenBooksSettings.closeWhenRead) then
		return
	end
	local book = self:PlaceOf(clip.pageId)
	if not book or self:PlaceOf(self.lastPage) ~= book or self:IsNarrating(book) then
		return
	end
	local later = self:PagesFrom(clip.pageId)
	for i = 2, #later do
		if self:HasAudio(later[i]) then
			return
		end
	end
	self:Explain("closing the book: its last page has been read")
	if CloseItemText then
		CloseItemText()
	end
end

frame:SetScript("OnEvent", function(_, event, arg1)
	-- 1.12's frames call OnEvent with the event in the global `event` rather than as an
	-- argument, and its payload in `arg1` the same way. Reading through whichever exists is
	-- what the other two addons do. The frame itself is the upvalue rather than the first
	-- argument, which 1.12 passes in the global `this` and not at all.
	local name = event or _G.event
	local payload = arg1 or _G.arg1
	if name == "ITEM_TEXT_READY" then
		SpokenBooks:OnTextReady()
		-- Guarded: Contribute.lua is absent where contributing is off.
		if SpokenBooks.GatherContribution then
			SpokenBooks:GatherContribution()
		end
		-- After, not before: the button's label is "Stop" only once the page has queued, and
		-- built here as well as at login so a client that makes ItemTextFrame late still
		-- gets one. The button needs no hiding on ITEM_TEXT_CLOSED -- it is the frame's
		-- child and goes with it.
		if SpokenBooks.SetupPlayButton then
			SpokenBooks:SetupPlayButton()
			SpokenBooks:RefreshPlayButton()
		end
	elseif name == "ITEM_TEXT_CLOSED" then
		SpokenBooks:OnTextClosed()
	elseif name == "ADDON_LOADED" then
		-- Every addon's load fires this; only this addon's own restores SpokenBooksSettings.
		if payload == ADDON_NAME then
			SpokenBooks:InitDB()
			frame:UnregisterEvent("ADDON_LOADED")
		end
	elseif name == "PLAYER_ENTERING_WORLD" then
		SpokenBooks:SetupSource()
		-- Both guarded, and for the same reason: UI/PlayButton.lua and UI/Options.lua are
		-- the two files this addon reads books without. The .toc loads them, so a guard here
		-- is not about the shipped addon -- it is what keeps narration working when one of
		-- them is missing, and what lets a test load the wiring without the UI.
		if SpokenBooks.SetupPlayButton then
			SpokenBooks:SetupPlayButton()
		end
		-- The panel is registered here rather than at ADDON_LOADED because the Settings API
		-- is what the client offers late, and because a panel nobody opens costs nothing to
		-- build once the world is up.
		if SpokenBooks.SetupOptions then
			SpokenBooks:SetupOptions()
		end
		-- The readables' tab in Azeroth's Compendium, built the first time it is opened.
		if SpokenBooks.SetupReadables then
			SpokenBooks:SetupReadables()
		end
	end
end)

--- Read the page in front of the reader now, whatever autoplay says. What the player's own
--- play control and `/spb read` reach.
function SpokenBooks:ReadCurrent()
	local pageId = self:PageOnScreen() or self.lastPage
	if not pageId then
		return 0
	end
	return self:SyncTo(pageId)
end

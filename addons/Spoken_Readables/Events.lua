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
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ITEM_TEXT_BEGIN")
frame:RegisterEvent("ITEM_TEXT_READY")
frame:RegisterEvent("ITEM_TEXT_CLOSED")

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

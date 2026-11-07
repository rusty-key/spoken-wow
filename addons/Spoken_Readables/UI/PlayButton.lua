-- The Play/Stop button on the client's book frame.
--
-- What a reader reaches for when autoplay is off, or when read-once has already counted this
-- book: the addon's two settings both mean "do not start by yourself", and neither should
-- mean "give me no way to start it".
--
-- A round Play/Stop icon, shared with Spoken's other playback controls.
--
-- IN THE HEADER STRIP, under the close button. The same strip is where the quest and gossip
-- controls live, so the readable controls belong there too rather than on top of the page.
--
-- The page arrows and page number remain below it, in their own row. The controls are kept
-- together left-to-right as Compendium, Play/Stop, then Copy Text when visible.
--
local _, SpokenReadables = ...
local L = SpokenReadables.L
local SharedL = _G.SpokenEnv and _G.SpokenEnv.L or {}

local GAP = 4
local STRIP_OFFSET = 12
local CORNER_INSET = 32

local function PlaybackLabel(state)
	if state == "stop" then
		return SharedL.OPT_STOP or L.STOP
	elseif state == "replay" then
		return SharedL.OPT_REPLAY or SharedL.REPLAY or L.PLAY
	end
	return SharedL.OPT_PLAY or L.PLAY
end

--- Open in Azeroth's Compendium: the Compendium's tome in the player's round button, as Quests
--- and Places have it, opening the tab on writing `bookId`. `tooltip`, where given, returns the
--- tooltip to use: DialogueUI hides the game's with the rest of the interface.
function SpokenReadables:NewOpenButton(parent, tooltip)
	if not (_G.Spoken and Spoken.CreateRoundButton) then return nil end
	local icon = _G.SpokenCompendium and SpokenCompendium.ICON or 5341597
	local button = Spoken:CreateRoundButton(parent, "icon", nil, icon)
	button:SetScript("OnClick", function(self)
		if self.bookId then
			if self.beforeOpen then self.beforeOpen() end
			SpokenReadables:ShowReadables(self.bookId)
		end
	end)
	button:HookScript("OnEnter", function(self)
		local tip = tooltip and tooltip() or GameTooltip
		if not tip then return end
		tip:SetOwner(self, "ANCHOR_LEFT")
		tip:SetText(L.OPEN_IN_COMPENDIUM)
		tip:Show()
		self.tooltip = tip
	end)
	button:HookScript("OnLeave", function(self)
		if self.tooltip then self.tooltip:Hide() end
	end)
	button:Hide()
	return button
end

--- Open in Azeroth's Compendium on the book frame, for a writing whose page the Compendium would
--- show. PositionReadableButtons places it in the shared header row.
function SpokenReadables:RefreshOpenButton()
	local open = self.openButton
	if not open then return end
	local book = self:IsPartOn() and self:PlaceOf(self:PageOnScreen()) or nil
	local shown = self.CompendiumHas ~= nil and self:CompendiumHas(book)
	open.bookId = shown and book or nil
	open:SetShown(shown)
end

local function CloseButtonOf(frame)
	if frame and type(frame.CloseButton) == "table" then
		return frame.CloseButton
	end
	return _G.ItemTextCloseButton or _G.ItemTextFrameCloseButton
end

--- Put the standard readable controls in the strip below the title bar. The visible controls
--- are laid out from right to left so the text button never covers either icon.
function SpokenReadables:PositionReadableButtons()
	local frame = _G.ItemTextFrame
	if not frame then return end

	local controls = {}
	local function Add(button)
		if button and button:IsShown() then
			table.insert(controls, button)
		end
	end
	Add(self.copyButton)
	Add(self.playButton)
	Add(self.openButton)
	if #controls == 0 then return end

	local close = CloseButtonOf(frame)
	local frameTop = frame.GetTop and frame:GetTop()
	local closeBottom = close and close.GetBottom and close:GetBottom()
	local right = controls[1]
	right:ClearAllPoints()
	if type(frameTop) == "number" and type(closeBottom) == "number" then
		right:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -11,
			-(frameTop - closeBottom + STRIP_OFFSET))
	elseif close then
		right:SetPoint("TOPRIGHT", close, "BOTTOMRIGHT", -GAP, -STRIP_OFFSET)
	else
		right:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET)
	end

	for i = 2, #controls do
		local button = controls[i]
		button:ClearAllPoints()
		button:SetPoint("RIGHT", right, "LEFT", -GAP, 0)
		right = button
	end
end

--- Show, hide and re-label the button for whatever is on screen now.
---
--- Hidden rather than disabled when there is nothing to play or send. A greyed-out button on
--- every letter and every page this corpus does not carry is a permanent invitation to wonder
--- what is broken; an absent one says the addon has nothing to offer here.
local function RefreshPlay(self)
	local button = self.playButton
	if not button then
		return
	end
	-- Switched off in Spoken's settings, the part puts nothing on the book.
	if not SpokenReadables:IsPartOn() then
		button:Hide()
		return
	end

	local pageId = self:PageOnScreen()
	if pageId and self:HasAudio(pageId) then
		button:Show()
		self.playButtonMode = "play"

		local book = self:PlaceOf(pageId)
		if self.replayBook and self.replayBook ~= book then
			self.replayBook = nil
		end
		local state = self:IsNarrating(book) and "stop"
			or self.replayBook == book and "replay" or "play"
		button:SetState(state)
		return
	end
	self.replayBook = nil

	-- No clip to play. The other thing this corner can mean: a page this corpus never saw,
	-- offered back as something to send instead of something to hear. Guarded the same way
	-- Events.lua guards SetupPlayButton -- Contribute.lua is what defines this, and a test
	-- that loads the book-event wiring without it must not error for lacking a file it never
	-- asked to load.
	if self.HasContributionGap and self:HasContributionGap() then
		button:Show()
		button:SetState("play")
		self.playButtonMode = "contribute"
		return
	end

	button:Hide()
end

--- Play, then Open in Azeroth's Compendium beside it.
function SpokenReadables:RefreshPlayButton()
	RefreshPlay(self)
	self:RefreshOpenButton()
	if self.RefreshCopyButton then self:RefreshCopyButton() end
	self:PositionReadableButtons()
end

--- Build the button, once, as soon as the client has a book frame to hang it on.
---
--- Called on every page as well as at login: ItemTextFrame is FrameXML on all three targets
--- and should exist by then, but a client that builds it later still gets its button rather
--- than going without for the session.
function SpokenReadables:SetupPlayButton()
	if self.playButton then
		return self.playButton
	end

	local frame = _G.ItemTextFrame
	if not frame or not CreateFrame then
		return nil
	end

	local button = Spoken:CreateRoundButton(frame, "play")
	button:Hide()

	button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET)

	button:SetScript("OnClick", function()
		if SpokenReadables.playButtonMode == "contribute" then
			SpokenReadables:ShowContribution()
			return
		end

		local book = SpokenReadables:PlaceOf(SpokenReadables:PageOnScreen())
		if book and button.state == "stop" and SpokenReadables:IsNarrating(book) then
			SpokenReadables:StopReading(book)
			SpokenReadables.replayBook = book
		else
			-- The same call `/spr read` makes, so a page with no clip explains itself here
			-- exactly as it does in the chat frame.
			SpokenReadables.replayBook = nil
			SpokenReadables:ReadOrExplain()
		end
		SpokenReadables:RefreshPlayButton()
	end)

	button:SetScript("OnEnter", function(self)
		if not GameTooltip then
			return
		end
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		if SpokenReadables.playButtonMode == "contribute" then
			GameTooltip:SetText(L.NO_LINE)
			GameTooltip:AddLine(L.NO_LINE_TIP, 1, 0.8, 0.2, true)
		else
			GameTooltip:SetText(PlaybackLabel(self.state))
		end
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		if GameTooltip then
			GameTooltip:Hide()
		end
	end)

	self.playButton = button

	local open = SpokenReadables:NewOpenButton(frame)
	if open then
		open:SetFrameLevel(button:GetFrameLevel())
		self.openButton = open
		-- Before ItemTextFrame closes: the Compendium opens beside the game's windows.
		open.beforeOpen = function() if _G.CloseItemText then CloseItemText() end end
	end
	local copy = SpokenReadables.NewCopyButton and SpokenReadables:NewCopyButton(frame)
	if copy then
		copy:SetFrameLevel(button:GetFrameLevel())
		self.copyButton = copy
	end

	-- Toggling the hide setting in the Spoken settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			SpokenReadables:RefreshPlayButton()
		end)
	end

	return button
end

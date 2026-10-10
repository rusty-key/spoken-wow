-- The Play/Stop button on the client's book frame.
--
-- What a reader reaches for when autoplay is off, or when read-once has already counted this
-- book: the addon's two settings both mean "do not start by yourself", and neither should
-- mean "give me no way to start it".
--
-- A TEXT button, not an icon, for the reason UI/AudioButton.lua gives on the zones side: an
-- icon path cannot be verified without launching the client, and a texture that does not
-- exist on 11509 draws nothing at all -- an invisible button is a worse failure than a plain
-- one. Spoken carries QuestLogPlayButton.blp, but it is that addon's file and this one
-- must work with the player absent.
--
-- ON THE PAGE, in its bottom-right corner. Two placements came before it and both were on
-- the strip of frame above the page: outside the top-right corner, where it read as floating
-- beside the book rather than belonging to it, and then beside the previous-page arrow.
--
-- THAT ROW HAS NO FREE SPACE, which is the reason this one is not on it. Reading the
-- measurements out of ItemTextFrame.xml in Gethe/wow-ui-source: the arrows are 32x32 centred
-- 75 in from the left and 23 in from the right; each carries a PREV / NEXT FontString
-- anchored to its inner edge, so the labels eat the space either side of them; and
-- ItemTextCurrentPage, which looks like the free middle, is a 192-wide FontString centred
-- across the row -- the digit you see sits in the middle of it while its left edge reaches
-- back under the previous-page arrow. Every part of that row is spoken for once a book has
-- more than one page, which the frame does not show you while you are looking at page one.
--
-- ItemTextScrollFrame is the page itself, and the scrollbar hangs OUTSIDE its right edge:
-- the bar's textures anchor TOPLEFT to the frame's TOPRIGHT. So its bottom-right corner is
-- on the parchment, clear of the bar and clear of both arrows. Present and named the same in
-- the Classic frame Era and Anniversary load and the Mainline one Forever loads, so this
-- stays one anchor for three clients with no shims.
--
-- A long page's last line runs under the button. The alternative is a row where the button
-- collides with one of Blizzard's own controls on page two of every book.
--
-- ONE BUTTON, TWO STATES, not two buttons: this corner is the only free one on the frame (see
-- above), so a Contribute button would need it too. The two states never fight over it --
-- Contribute.lua's HasContributionGap is true only when PageOnScreen found nothing, and this
-- button's Play/Stop state exists only once PageOnScreen found a page with audio -- so
-- re-labelling what is already here is the honest arrangement rather than a second control
-- stacked on space that does not exist.

local ADDON_NAME, SpokenBooks = ...
local L = SpokenBooks.L

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 22
-- Room the button's end caps take either side of its label.
local LABEL_PADDING = 24

--- Widen the button to fit the widest label it will ever show, never below BUTTON_WIDTH.
--- Measured once over every label rather than on each SetText, so flipping between Play,
--- Stop and Contribute keeps one width. BUTTON_WIDTH was sized to the English labels; a
--- translated one can be twice as long. The button is pinned by its right edge, so it
--- grows into the page, not off it.
local function FitToLabels(button, labels)
	local widest = 0
	for _, label in ipairs(labels) do
		button:SetText(label)
		widest = math.max(widest, button:GetTextWidth())
	end
	button:SetWidth(math.max(BUTTON_WIDTH, widest + LABEL_PADDING))
end

--- Show, hide and re-label the button for whatever is on screen now.
---
--- Hidden rather than disabled when there is nothing to play or send. A greyed-out button on
--- every letter and every page this corpus does not carry is a permanent invitation to wonder
--- what is broken; an absent one says the addon has nothing to offer here.
function SpokenBooks:RefreshPlayButton()
	local button = self.playButton
	if not button then
		return
	end
	-- Switched off in Spoken's settings, the part puts nothing on the book.
	if not SpokenBooks:IsPartOn() then
		button:Hide()
		return
	end

	local pageId = self:PageOnScreen()
	if pageId and self:HasAudio(pageId) then
		button:Show()
		self.playButtonMode = "play"

		local book = self:PlaceOf(pageId)
		if self:IsNarrating(book) then
			button:SetText(L.STOP)
		else
			button:SetText(L.PLAY)
		end
		return
	end

	-- No clip to play. The other thing this corner can mean: a page this corpus never saw,
	-- offered back as something to send instead of something to hear. Guarded the same way
	-- Events.lua guards SetupPlayButton -- Contribute.lua is what defines this, and a test
	-- that loads the book-event wiring without it must not error for lacking a file it never
	-- asked to load.
	if self.HasContributionGap and self:HasContributionGap() then
		button:Show()
		button:SetText(L.CONTRIBUTE)
		self.playButtonMode = "contribute"
		return
	end

	button:Hide()
end

--- Build the button, once, as soon as the client has a book frame to hang it on.
---
--- Called on every page as well as at login: ItemTextFrame is FrameXML on all three targets
--- and should exist by then, but a client that builds it later still gets its button rather
--- than going without for the session.
function SpokenBooks:SetupPlayButton()
	if self.playButton then
		return self.playButton
	end

	local frame = _G.ItemTextFrame
	if not frame or not CreateFrame then
		return nil
	end

	local button = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
	button:SetHeight(BUTTON_HEIGHT)
	FitToLabels(button, { L.PLAY, L.STOP, L.CONTRIBUTE })
	button:SetText(L.PLAY)
	button:Hide()

	local page = _G.ItemTextScrollFrame
	if page then
		button:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -6, 6)
		-- The parchment is a texture layer of ItemTextFrame and a child frame always draws
		-- over its parent's layers, but the page text lives in this scroll frame, which is
		-- this button's SIBLING -- and siblings draw in frame-level order.
		if button.SetFrameLevel and page.GetFrameLevel then
			button:SetFrameLevel(page:GetFrameLevel() + 2)
		end
	else
		-- A client whose book frame is built some other way. Derived from the same file, so
		-- it lands where the corner would be rather than somewhere invented: the page is
		-- anchored 33 in from the frame's top-right and 63 down, and is 355 tall.
		button:SetPoint("BOTTOMRIGHT", frame, "TOPRIGHT", -39, -412)
	end

	button:SetScript("OnClick", function()
		if SpokenBooks.playButtonMode == "contribute" then
			SpokenBooks:ShowContribution()
			return
		end

		local book = SpokenBooks:PlaceOf(SpokenBooks:PageOnScreen())
		if book and SpokenBooks:IsNarrating(book) then
			SpokenBooks:StopReading(book)
		else
			-- The same call `/spb read` makes, so a page with no clip explains itself here
			-- exactly as it does in the chat frame.
			SpokenBooks:ReadOrExplain()
		end
		SpokenBooks:RefreshPlayButton()
	end)

	button:SetScript("OnEnter", function(self)
		if not GameTooltip then
			return
		end
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		if SpokenBooks.playButtonMode == "contribute" then
			GameTooltip:SetText(L.NO_LINE)
			GameTooltip:AddLine(L.NO_LINE_TIP, 1, 0.8, 0.2, true)
		elseif self:GetText() == L.STOP then
			GameTooltip:SetText(L.STOP_TIP)
		else
			GameTooltip:SetText(L.PLAY_TIP)
		end
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		if GameTooltip then
			GameTooltip:Hide()
		end
	end)

	self.playButton = button

	-- Toggling the hide setting in the Spoken settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			SpokenBooks:RefreshPlayButton()
		end)
	end

	return button
end

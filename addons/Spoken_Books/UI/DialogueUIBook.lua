-- DialogueUI's book view (DUIBookFrame), as Spoken Quests does its quest window: Spoken's controls
-- on it, Play (Stop while this book is read), Skip and Report, the player's round buttons as
-- large on screen as Place Lore draws them, in a row left of the book's close button, in place
-- of DialogueUI's own speaker; and the page being read marked in its text, the word being read
-- lit and the words typed out as the voice reaches them. Left alone without DialogueUI or without
-- the player.
--
-- DialogueUI loads every page of a book as it opens it and leaves the game on the last, so Play
-- reads the book from its first page, not from the page the game is on.

local ADDON_NAME, SpokenBooks = ...
local L = SpokenBooks.L

local ROUND, ROUND_GAP = 24, 4
-- DialogueUI's speaker, as it draws it, given back when the row goes.
local THEIRS_ALPHA = 0.6
-- How often the row looks again at what plays while the book is open.
local LOOK_EVERY = 0.1

local Book = {}
SpokenBooks.DialogueUIBook = Book

local function View()
	return _G.DUIBookFrame
end

--- The book open in the view: its key in the corpus and its first page, or nil for a page the
--- corpus does not carry.
local function OpenBook()
	local pageId = SpokenBooks.lastPage
	local key = pageId and SpokenBooks:PlaceOf(pageId)
	local data = key and SpokenBooks:Data()
	local entry = data and data.books[key]
	if not entry then
		return nil, nil
	end
	return key, entry.pages[1] or pageId
end

--- The page of book `key` being read, else its first: another readable can be read ahead of the
--- one open in the view.
local function ReadingPage(key, first)
	local head = Spoken.GetCurrent and Spoken:GetCurrent()
	if key and head and head.pageId and SpokenBooks:IsQueued(head.pageId)
		and SpokenBooks:PlaceOf(head.pageId) == key then
		return head.pageId, head.language
	end
	return first, nil
end

local function ReportsHidden()
	return Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden() or false
end

--- A tooltip on the view itself: the game's is a child of UIParent, which DialogueUI hides.
function Book:Tooltip()
	local view = View()
	local tooltip = self.tooltip
	if not tooltip then
		tooltip = CreateFrame("GameTooltip", "SpokenBooksDialogueUITooltip", view, "GameTooltipTemplate")
		tooltip:SetFrameStrata("TOOLTIP")
		self.tooltip = tooltip
	end
	tooltip:SetScale(UIParent:GetEffectiveScale() / view:GetEffectiveScale())
	return tooltip
end

local function HideTooltip(button)
	if button.tooltip then
		button.tooltip:Hide()
	end
end

--- What a click on Play does now, and Read Automatically, which a right-click switches.
function Book:ShowPlayTooltip(button)
	local tooltip = self:Tooltip()
	local key = OpenBook()
	local reading = key and SpokenBooks:IsNarrating(key)
	tooltip:SetOwner(button, "ANCHOR_RIGHT")
	tooltip:SetText(reading and L.STOP_TIP or L.PLAY_TIP)
	local on = SpokenBooksSettings and SpokenBooksSettings.autoplay
	tooltip:AddDoubleLine(L.OPT_AUTOPLAY, on and L.DUI_ON or L.DUI_OFF, 1, 1, 1,
		on and 0.1 or 1, on and 1 or 0.125, on and 0.1 or 0.125)
	tooltip:AddLine(L.DUI_PLAY_RIGHT_CLICK, 1, 0.82, 0, true)
	tooltip:Show()
	button.tooltip = tooltip
end

--- The row, built the first time the view opens: a child of the view, drawn over it.
function Book:Row()
	if self.row then
		return self.row
	end
	local view = View()
	local holder = CreateFrame("Frame", nil, view)
	holder:SetFrameStrata("FULLSCREEN")
	holder:SetSize(ROUND, ROUND)
	local play = Spoken:CreateRoundButton(holder, "play")
	play:SetFrameStrata("FULLSCREEN")
	play:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	play:SetScript("OnClick", function(_, mouse)
		if mouse == "RightButton" then
			if SpokenBooksSettings then
				SpokenBooksSettings.autoplay = not SpokenBooksSettings.autoplay
			end
		else
			local key, first = OpenBook()
			if key and SpokenBooks:IsNarrating(key) then
				SpokenBooks:StopReading(key)
			elseif first then
				SpokenBooks:SyncTo(first)
			end
		end
		Book:Draw()
		if play.tooltip and play.tooltip:IsShown() then
			Book:ShowPlayTooltip(play)
		end
	end)
	-- Skips by itself.
	local skip = Spoken:CreateRoundButton(holder, "skip")
	skip:SetFrameStrata("FULLSCREEN")
	local report = Spoken:CreateRoundButton(holder, "report")
	report:SetFrameStrata("FULLSCREEN")
	report:SetScript("OnClick", function()
		local pageId, language = ReadingPage(OpenBook())
		local url = pageId and SpokenBooks:ReportURL(pageId, language)
		if url and Spoken.ShowContribution then
			Spoken:ShowContribution(url, nil, true)
		end
	end)
	local tips = {
		[play] = function() Book:ShowPlayTooltip(play) end,
		[skip] = function()
			local tooltip = Book:Tooltip()
			tooltip:SetOwner(skip, "ANCHOR_RIGHT")
			tooltip:SetText(SpokenEnv and SpokenEnv.L and SpokenEnv.L.BIND_SKIP or "Skip")
			tooltip:Show()
			skip.tooltip = tooltip
		end,
		[report] = function()
			local tooltip = Book:Tooltip()
			tooltip:SetOwner(report, "ANCHOR_RIGHT")
			tooltip:SetText(L.REPORT_PROBLEM)
			tooltip:AddLine(L.REPORT_LINE_TIP, 1, 0.8, 0.2, true)
			tooltip:Show()
			report.tooltip = tooltip
		end,
	}
	-- Brighter under the pointer as the ring's own hover has it, and the tooltip on the view's.
	for button, Show in pairs(tips) do
		button:SetScript("OnEnter", function(self)
			if self:IsEnabled() then self.glyph:SetAlpha(1) end
			Show()
		end)
		button:SetScript("OnLeave", function(self)
			if self:IsEnabled() then self.glyph:SetAlpha(0.85) end
			HideTooltip(self)
		end)
	end
	local since = 0
	holder:SetScript("OnUpdate", function(_, elapsed)
		since = since + elapsed
		if since >= LOOK_EVERY then
			since = 0
			Book:Draw()
		end
	end)
	holder:Hide()
	self.row = { frame = holder, play = play, skip = skip, report = report }
	return self.row
end

--- DialogueUI's speaker, kept out of sight while the row stands in for it.
local function CoverTheirs(cover)
	local view = View()
	local theirs = view and view.TTSButton
	if type(theirs) ~= "table" or not theirs.SetAlpha then
		return
	end
	if cover then
		if (theirs:GetAlpha() or 0) > 0 then theirs:SetAlpha(0) end
		Book.covering = true
	elseif Book.covering then
		theirs:SetAlpha(THEIRS_ALPHA)
		Book.covering = false
	end
end

local function SetEnabled(button, on)
	if (button:IsEnabled() and true or false) ~= on then
		if on then button:Enable() else button:Disable() end
	end
end

-- The book's close button, as DialogueUI draws it: 64 of the book art's pixels across, 26 in from
-- the right; its title 90 under the top (its PADDING_V), all in the same pixels.
local CLOSE_SIZE, CLOSE_INSET, TITLE_TOP = 64, 26, 90
-- Room above the line of the close button and the controls and below it, in UIParent's units, as
-- the buttons' 24 are: the same on DialogueUI's quest window (Spoken Quests' DialogueUIBridge).
-- The title and the text under it move down to make it.
local LINE_ROOM = 36

--- DialogueUI's title, the line under it and the text moved down so the controls' line has
--- LINE_ROOM over and under it, as on the quest window: a short page's frame taller by as much, a
--- long one's scroll longer. Run after DialogueUI lays the book out (SetScrollContentHeight),
--- which puts all but the title back where it had them.
function Book:Lower()
	local view = View()
	local close, header, scroll = view.CloseButton, view.Header, view.ScrollFrame
	if not (SpokenBooks:IsPartOn() and type(close) == "table" and close.GetWidth and type(header) == "table"
		and type(header.Title) == "table" and type(scroll) == "table") then
		return
	end
	local pixel = (close:GetWidth() or CLOSE_SIZE) / CLOSE_SIZE
	local scale = UIParent:GetEffectiveScale() / math.max(0.01, view:GetEffectiveScale() or 1)
	local shift = math.max(0, (2 * LINE_ROOM + ROUND) * scale - TITLE_TOP * pixel)
	if shift <= 0 then
		return
	end
	header.Title:SetPoint("TOP", view, "TOP", 0, -(TITLE_TOP * pixel + shift))
	-- The line under the title, where DialogueUI hangs it off the top rather than the title.
	local divider = header.HeaderDivider
	if type(divider) == "table" then
		local point, relativeTo, relativePoint, x, y = divider:GetPoint(1)
		if relativeTo == view and y then
			divider:SetPoint(point, view, relativePoint, x, y - shift)
		end
	end
	local _, _, _, scrollX, scrollY = scroll:GetPoint(1)
	scroll:SetPoint("TOPLEFT", view, "TOPLEFT", scrollX or 0, (scrollY or 0) - shift)
	if view.scrollable then
		if scroll.SetScrollRange then scroll:SetScrollRange((tonumber(scroll.range) or 0) + shift) end
	else
		local content = view.ContentFrame
		if type(content) == "table" then
			local _, _, _, x, y = content:GetPoint(1)
			content:SetPoint("TOP", view, "TOP", x or 0, (y or 0) - shift)
		end
		if view.SetFrameHeight then view:SetFrameHeight((view:GetHeight() or 0) + shift, false) end
	end
end

--- The close button's middle halfway between the view's top and its title's (or the place named
--- over the title), so it and the row beside it stand as far from the title as from the edge, as
--- on DialogueUI's quest window (Spoken Quests). Set again whenever DialogueUI lays it out anew.
function Book:PlaceClose()
	local view = View()
	local close = view.CloseButton
	if type(close) ~= "table" or not close.GetWidth then
		return
	end
	local header = type(view.Header) == "table" and view.Header
	local top, below = view:GetTop(), nil
	for _, key in ipairs({ "Title", "Location" }) do
		local part = header and header[key]
		local partTop = type(part) == "table" and part.IsShown and part:IsShown() and part:GetTop()
		if partTop and (not below or partTop > below) then
			below = partTop
		end
	end
	if not (top and below) then
		return
	end
	local pixel = (close:GetWidth() or CLOSE_SIZE) / CLOSE_SIZE
	local middle = (below - top) / 2
	local point, relativeTo, _, _, y = close:GetPoint(1)
	if point ~= "RIGHT" or relativeTo ~= view or y ~= middle then
		close:ClearAllPoints()
		close:SetPoint("RIGHT", view, "TOPRIGHT", -CLOSE_INSET * pixel, middle)
		self.closeMoved = true
	end
end

--- Back where DialogueUI puts it, once the row goes.
function Book:RestoreClose()
	local view = View()
	local close = view and view.CloseButton
	if not (self.closeMoved and type(close) == "table" and close.GetWidth) then
		return
	end
	self.closeMoved = false
	local pixel = (close:GetWidth() or CLOSE_SIZE) / CLOSE_SIZE
	close:ClearAllPoints()
	close:SetPoint("TOPRIGHT", view, "TOPRIGHT", -CLOSE_INSET * pixel, -CLOSE_INSET * pixel)
end

--- Right to left from the book's close button, centred on it: Report, Skip, Play, whichever show,
--- as large on screen as Place Lore draws them, whatever DialogueUI's book size.
function Book:Place()
	local view, row = View(), self.row
	local scale = UIParent:GetEffectiveScale() / math.max(0.01, view:GetEffectiveScale() or 1)
	local list = {}
	for _, button in ipairs({ row.report, row.skip, row.play }) do
		if button:IsShown() then table.insert(list, button) end
	end
	local key = #list .. " " .. format("%.3f", scale)
	if key == self.placedKey then
		return
	end
	self.placedKey = key
	row.frame:SetSize(math.max(1, (#list * ROUND + (#list - 1) * ROUND_GAP) * scale), ROUND * scale)
	local right
	for _, button in ipairs(list) do
		button:SetScale(scale)
		button:SetSize(ROUND, ROUND)
		button:ClearAllPoints()
		if right then
			button:SetPoint("RIGHT", right, "LEFT", -ROUND_GAP, 0)
		else
			button:SetPoint("RIGHT", row.frame, "RIGHT", 0, 0)
		end
		right = button
	end
	row.frame:ClearAllPoints()
	local close = view.CloseButton
	if type(close) == "table" and close.GetObjectType then
		row.frame:SetPoint("RIGHT", close, "LEFT", -ROUND_GAP, 0)
	else
		row.frame:SetPoint("TOPRIGHT", view, "TOPRIGHT", -48, -19)
	end
end

--- DialogueUI's Copy Text left of the row, on its middle, as on the quest window (Spoken Quests'
--- DialogueUIBridge); in its own corner again once the row goes. Again whenever DialogueUI lays
--- its buttons out (LayoutWidgets).
function Book:PlaceTheirs()
	local view, row = View(), self.row
	local copy = view and view.CopyTextButton
	if type(copy) ~= "table" or not copy.GetPoint then
		return
	end
	if row and row.frame:IsShown() then
		if copy:IsShown() and select(2, copy:GetPoint(1)) ~= row.frame then
			copy:ClearAllPoints()
			copy:SetPoint("RIGHT", row.frame, "LEFT", -ROUND_GAP, 0)
			self.theirsMoved = true
		end
	elseif self.theirsMoved then
		self.theirsMoved = false
		if type(view.LayoutWidgets) == "function" then view:LayoutWidgets() end
	end
end

--- Show the row while the view is open with the part on: Play greyed with no recording of this
--- book and Stop while it is read, Skip greyed with nothing speaking, Report while this book has
--- a recording (unless Hide Report Buttons is on).
function Book:Draw()
	local view = View()
	if not (view and view:IsShown() and SpokenBooks:IsPartOn()) then
		CoverTheirs(false)
		self:RestoreClose()
		if self.row and self.row.frame:IsShown() then
			self.row.frame:Hide()
			HideTooltip(self.row.play)
			HideTooltip(self.row.skip)
			HideTooltip(self.row.report)
		end
		self:PlaceTheirs()
		return
	end
	local row = self:Row()
	row.frame:Show()
	CoverTheirs(true)
	self:PlaceClose()
	local key, first = OpenBook()
	local voiced = first ~= nil and SpokenBooks:HasAudio(first)
	SetEnabled(row.play, voiced)
	local state = key and SpokenBooks:IsNarrating(key) and "stop" or "play"
	if row.play.state ~= state then
		row.play:SetState(state)
	end
	SetEnabled(row.skip, Spoken.GetCurrent ~= nil and Spoken:GetCurrent() ~= nil)
	row.report:SetShown(voiced and not ReportsHidden())
	self:Place()
	self:PlaceTheirs()
end

--------------------------------------------------------------------------------
-- The words
--------------------------------------------------------------------------------
--
-- The page being read marked as the captions mark it (Spoken:WordMarks), by Spoken's own Highlight
-- Words and Type Out settings. DialogueUI lays the whole book out as one column of paragraphs
-- (ScrollFrame.content) and draws only those in view, on FontStrings it hands from one paragraph
-- to another as it scrolls (contentIndexObject, SetObjectData). So what each paragraph should
-- show is kept by paragraph, and set again on whichever FontString draws it.

local TICK = 0.05

-- paragraphs: { index (in the view's content), text, words }; byIndex: paragraph by index.
-- clip, map, span: the caption last matched against them; lit, neighbor, cutP, cutByte: what is
-- marked; want[p]: what paragraph p shows where that is not its own text.
local words = { want = {} }

local function Marks()
	return Spoken.WordMarks and Spoken:WordMarks()
end

local function Scroll()
	local view = View()
	return view and type(view.ScrollFrame) == "table" and view.ScrollFrame or nil
end

local function FontStringOf(index)
	local scroll = Scroll()
	local objects = scroll and scroll.contentIndexObject
	return type(objects) == "table" and objects[index] or nil
end

--- Paragraph p as it should show, on the FontString drawing it, if any is.
local function Apply(p)
	local para = words.paragraphs[p]
	local fs = FontStringOf(para.index)
	local want = words.want[p] or para.text
	if fs and (fs:GetText() or "") ~= want then
		fs:SetText(want)
	end
end

--- Every paragraph's own text back.
local function Restore()
	for p in pairs(words.want) do
		words.want[p] = nil
		if words.paragraphs and words.paragraphs[p] then Apply(p) end
	end
	words.lit, words.neighbor, words.cutP, words.cutByte = nil, nil, nil, nil
end

--- The book laid out again, or closed: what was matched against it goes.
function Book:Invalidate()
	words.want = {}
	words.paragraphs, words.byIndex, words.clip, words.map, words.span = nil, nil, nil, nil, nil
	words.lit, words.neighbor, words.cutP, words.cutByte, words.scrolledTo = nil, nil, nil, nil, nil
end

local function Collect(marks)
	local paragraphs, byIndex = {}, {}
	local scroll = Scroll()
	for index, data in ipairs(scroll and type(scroll.content) == "table" and scroll.content or {}) do
		local text = type(data) == "table" and data.text
		local split = type(text) == "string" and text ~= "" and Spoken:SplitCaption(text)
		if split and table.getn(split) > 0 then
			table.insert(paragraphs, { index = index, text = text, words = marks.MarkLinks(text, split) })
			byIndex[index] = table.getn(paragraphs)
		end
	end
	return paragraphs, byIndex
end

--- A clip of the book open in the view.
local function Mine(clip)
	local key = clip and clip.pageId and SpokenBooks:PlaceOf(clip.pageId)
	return key ~= nil and key == OpenBook()
end

--- Keep the voice in view: a paragraph not wholly in the view is scrolled to.
local function FollowVoice(p)
	local view, scroll = View(), Scroll()
	local para = words.paragraphs[p]
	if not (para and scroll and view.ScrollToContent) then
		return
	end
	local fs = FontStringOf(para.index)
	local top = fs and fs:IsShown() and fs:GetTop()
	local bottom = fs and fs:GetBottom()
	local viewTop, viewBottom = scroll:GetTop(), scroll:GetBottom()
	if top and bottom and viewTop and viewBottom and top <= viewTop and bottom >= viewBottom then
		return
	end
	view:ScrollToContent(para.index)
end

--- Mark the page being read, run while the view is open.
function Book:Mark()
	local marks, view = Marks(), View()
	if not (marks and view and view:IsShown() and Spoken.GetCaption and Spoken.SplitCaption and Scroll()) then
		return
	end
	if not words.paragraphs then
		words.paragraphs, words.byIndex = Collect(marks)
		words.clip = nil
	end
	local caption = Spoken:GetCaption()
	local clip = caption and caption.clip
	if Mine(clip) then
		if clip ~= words.clip then
			-- Put back and marked again in this one call: nothing shows in between.
			Restore()
			words.clip, words.scrolledTo = clip, nil
			words.map, words.span = marks.Align(caption.words, words.paragraphs)
		end
	elseif words.clip then
		Restore()
		words.clip, words.map = nil, nil
	end
	if not (words.map and (caption.highlight or caption.typewriter)) then
		if next(words.want) then Restore() end
		return
	end
	local lit, neighbor
	if caption.highlight then
		lit, neighbor = marks.Pick(words.map, caption.speaking and caption.activeWord or nil)
	end
	local cutP, cutByte = marks.Cut(caption, words.map, words.span, words.paragraphs)
	if lit == words.lit and neighbor == words.neighbor and cutP == words.cutP and cutByte == words.cutByte then
		return
	end
	-- Gold on the stone, deep red on the paper, as on the quest window.
	local color = view.textureKitID == 2 and marks.ON_DARK or marks.ON_LIGHT
	local spans = marks.Spans(words.map, words.paragraphs, lit, neighbor)
	for p, para in ipairs(words.paragraphs) do
		local want = marks.Want(para, p, words.span, cutP, cutByte, spans, color)
		words.want[p] = want ~= para.text and want or nil
		Apply(p)
	end
	words.lit, words.neighbor, words.cutP, words.cutByte = lit, neighbor, cutP, cutByte
	local target = lit and words.map[lit] and words.map[lit].p or cutP
	if target and target ~= words.scrolledTo then
		words.scrolledTo = target
		FollowVoice(target)
	end
end

--- A FontString handed to a paragraph as the view scrolls: it shows that paragraph as marked.
local function Handed(_, fs, _, index)
	local p = words.byIndex and words.byIndex[index]
	local want = p and words.want[p]
	if want and fs and fs.SetText then
		fs:SetText(want)
	end
end

--- Hooked once the view's scroll frame exists, which it does from the first book DialogueUI opens.
function Book:HookScroll()
	local view, scroll = View(), Scroll()
	if self.scrollHooked or not scroll or type(scroll.SetObjectData) ~= "function" then
		return
	end
	self.scrollHooked = true
	hooksecurefunc(scroll, "SetObjectData", Handed)
	if type(view.RebuildContentFromCache) == "function" then
		hooksecurefunc(view, "RebuildContentFromCache", function() Book:Invalidate() end)
	end
end

--- Hooked once DialogueUI's book view exists, with the player there to draw the buttons.
function SpokenBooks:SetupDialogueUIBook()
	local view = View()
	if Book.hooked or not (view and view.HookScript and _G.Spoken and Spoken.CreateRoundButton) then
		return
	end
	Book.hooked = true
	-- Told by a child of the view, as Spoken Quests is by one of the quest window's: a hook on the
	-- view's own scripts goes when DialogueUI sets them anew.
	local watch = CreateFrame("Frame", nil, view)
	watch:SetScript("OnShow", function()
		if Spoken.SetContributeHost then Spoken:SetContributeHost(view) end
		Book:Draw()
	end)
	watch:SetScript("OnHide", function()
		if Spoken.SetContributeHost then Spoken:SetContributeHost(nil) end
		Book:Invalidate()
		Book:Draw()
	end)
	local since = 0
	watch:SetScript("OnUpdate", function(_, elapsed)
		since = since + elapsed
		if since < TICK then return end
		since = 0
		Book:HookScroll()
		Book:Mark()
	end)
	Book.watch = watch
	-- Copy Text beside the row whenever DialogueUI lays its buttons out.
	if type(view.LayoutWidgets) == "function" then
		hooksecurefunc(view, "LayoutWidgets", function() Book:PlaceTheirs() end)
	end
	-- Room for the controls' line whenever DialogueUI lays the book out.
	if type(view.SetScrollContentHeight) == "function" then
		hooksecurefunc(view, "SetScrollContentHeight", function() Book:Lower() end)
	end
	-- Hide Report Buttons, in Spoken's settings, fires no game event.
	if Spoken.RegisterCallback then
		Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function() Book:Draw() end)
	end
end

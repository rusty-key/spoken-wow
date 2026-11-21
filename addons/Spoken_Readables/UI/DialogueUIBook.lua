-- Spoken's Play, Skip and Report on DialogueUI's book view (DUIBookFrame), in a row left of its
-- close button in place of DialogueUI's own speaker, and the page being read marked in the book's
-- text. Does nothing without DialogueUI or the player.
--
-- DialogueUI loads every page of a book as it opens it and leaves the game on the last, so Play
-- reads the book from its first page, not from the page the game is on.

local _, SpokenReadables = ...
local L = SpokenReadables.L

local ROUND, ROUND_GAP = 24, 4
-- DialogueUI's speaker, as it draws it, given back when the row goes.
local THEIRS_ALPHA = 0.6
local LOOK_EVERY = 0.1

local Book = {}
SpokenReadables.DialogueUIBook = Book

local function View()
	return _G.DUIBookFrame
end

--- The book open in the view: its key and its first page, or nil for a page nothing
--- carries.
local function OpenBook()
	local pageId = SpokenReadables.lastPage
	local key = pageId and SpokenReadables:PlaceOf(pageId)
	local entry = key and SpokenReadables:BookById(key)
	if not entry then
		return nil, nil
	end
	return key, entry.pages[1] or pageId
end

--- The page of book `key` being read, else its first: another readable can be read ahead of the
--- one open in the view.
local function ReadingPage(key, first)
	local head = Spoken.GetCurrent and Spoken:GetCurrent()
	if key and head and head.pageId and SpokenReadables:IsQueued(head.pageId)
		and SpokenReadables:PlaceOf(head.pageId) == key then
		return head.pageId
	end
	return first
end

local function ReportsHidden()
	return Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden() or false
end

--- A tooltip on the view itself: the game's is a child of UIParent, which DialogueUI hides.
function Book:Tooltip()
	local view = View()
	local tooltip = self.tooltip
	if not tooltip then
		tooltip = CreateFrame("GameTooltip", "SpokenReadablesDialogueUITooltip", view, "GameTooltipTemplate")
		tooltip:SetFrameStrata("TOOLTIP")
		self.tooltip = tooltip
	end
	tooltip:SetScale(UIParent:GetEffectiveScale() / view:GetEffectiveScale())
	return tooltip
end

--- What a click on Play does now, and Read Automatically, which a right-click switches.
local function PlayTip(tooltip)
	local key = OpenBook()
	local reading = key and SpokenReadables:IsNarrating(key)
	tooltip:SetText(reading and L.STOP_TIP or L.PLAY_TIP)
	local on = SpokenReadablesSettings and SpokenReadablesSettings.autoplay
	tooltip:AddDoubleLine(L.OPT_AUTOPLAY, on and L.DUI_ON or L.DUI_OFF, 1, 1, 1,
		on and 0.1 or 1, on and 1 or 0.125, on and 0.1 or 0.125)
	tooltip:AddLine(L.DUI_PLAY_RIGHT_CLICK, 1, 0.82, 0, true)
end

--- Spoken's row (Spoken:CreateDialogueUIRow), built the first time the view opens.
function Book:Row()
	if self.row then
		return self.row
	end
	local row = Spoken:CreateDialogueUIRow(View(), function() return Book:Tooltip() end, true)
	local play, report = row.play, row.report
	row:SetTip(play, PlayTip)
	play:SetScript("OnClick", function(_, mouse)
		if mouse == "RightButton" then
			if SpokenReadablesSettings then
				SpokenReadablesSettings.autoplay = not SpokenReadablesSettings.autoplay
			end
		else
			local key, first = OpenBook()
			if key and SpokenReadables:IsNarrating(key) then
				SpokenReadables:StopReading(key)
			elseif first then
				SpokenReadables:SyncTo(first, nil, true)
			end
		end
		Book:Draw()
		row:RefreshTip(play)
	end)
	report:SetScript("OnClick", function()
		local pageId = ReadingPage(OpenBook())
		if pageId then SpokenReadables:ShowReport(pageId) end
	end)
	row:SetTip(report, function(tooltip)
		tooltip:SetText(L.REPORT_PROBLEM)
	end)
	local since = 0
	-- Open in Azeroth's Compendium, on a writing it lists. The view is a child of UIParent, which
	-- DialogueUI hides while it is open, so the view closes first.
	local open = SpokenReadables.NewOpenButton and SpokenReadables:NewOpenButton(row.frame, function() return Book:Tooltip() end)
	if open then
		open:SetFrameStrata("FULLSCREEN")
		open.beforeOpen = function()
			local view = View()
			if view then view:Hide() end
		end
	end
	row.open = open
	row.frame:SetScript("OnUpdate", function(_, elapsed)
		since = since + elapsed
		if since >= LOOK_EVERY then
			since = 0
			Book:Draw()
		end
	end)
	self.row = row
	return row
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
-- Room above and below the line of the close button and the controls, in UIParent's units as
-- ROUND is. The title and the text under it move down to make it.
local LINE_ROOM = 36

local lowering = false

--- DialogueUI's title, the line under it and the text moved down so the controls' line has
--- LINE_ROOM over and under it. Run after SetScrollContentHeight, which puts all but the title back
--- where DialogueUI had them. The page is laid out again with its content taller by the move, so
--- DialogueUI itself decides whether it still fits or now scrolls: a frame at its tallest cannot
--- grow, and a page that only just fitted would lose its last lines under the footer.
function Book:Lower(contentHeight, maxPage)
	if lowering then
		return
	end
	local view = View()
	local close, header, scroll = view.CloseButton, view.Header, view.ScrollFrame
	if not (SpokenReadables:IsPartOn() and type(close) == "table" and close.GetWidth and type(header) == "table"
		and type(header.Title) == "table" and type(scroll) == "table") then
		return
	end
	local pixel = (close:GetWidth() or CLOSE_SIZE) / CLOSE_SIZE
	local scale = UIParent:GetEffectiveScale() / math.max(0.01, view:GetEffectiveScale() or 1)
	local shift = math.max(0, (2 * LINE_ROOM + ROUND) * scale - TITLE_TOP * pixel)
	if shift <= 0 then
		return
	end
	if type(contentHeight) == "number" then
		lowering = true
		local ok, err = pcall(view.SetScrollContentHeight, view, contentHeight + shift, maxPage)
		lowering = false
		if not ok then
			geterrorhandler()(err)
			return
		end
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
	if not view.scrollable then
		local content = view.ContentFrame
		if type(content) == "table" then
			local _, _, _, x, y = content:GetPoint(1)
			content:SetPoint("TOP", view, "TOP", x or 0, (y or 0) - shift)
		end
	end
end

--- The close button's middle halfway between the view's top and its title's (or the place named
--- over the title), so it and the row beside it stand as far from the title as from the edge.
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

-- Reused on every Draw, which runs while the book view is open.
local list = {}

--- Right to left from the book's close button, centred on it: Report, Skip, Play, whichever show.
function Book:Place()
	local view, row = View(), self.row
	for i = #list, 1, -1 do
		list[i] = nil
	end
	if row.report:IsShown() then table.insert(list, row.report) end
	if row.skip:IsShown() then table.insert(list, row.skip) end
	if row.play:IsShown() then table.insert(list, row.play) end
	if row.open and row.open:IsShown() then table.insert(list, row.open) end
	local close = view.CloseButton
	row:Place(list, type(close) == "table" and close.GetObjectType and close or nil)
end

--- DialogueUI's Copy Text left of the row, on its middle; in its own corner again once the row goes.
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

--- The row while the view is open with the part on; DialogueUI's own buttons back otherwise.
function Book:Draw()
	local view = View()
	if not (view and view:IsShown() and SpokenReadables:IsPartOn()) then
		CoverTheirs(false)
		self:RestoreClose()
		if self.row and self.row.frame:IsShown() then
			self.row.frame:Hide()
			self.row:HideTips()
		end
		self:PlaceTheirs()
		return
	end
	local row = self:Row()
	row.frame:Show()
	CoverTheirs(true)
	self:PlaceClose()
	local key, first = OpenBook()
	local voiced = first ~= nil and SpokenReadables:HasAudio(first)
	SetEnabled(row.play, voiced)
	local state = key and SpokenReadables:IsNarrating(key) and "stop" or "play"
	if row.play.state ~= state then
		row.play:SetState(state)
	end
	SetEnabled(row.skip, Spoken.GetCurrent ~= nil and Spoken:GetCurrent() ~= nil)
	row.report:SetShown(voiced and not ReportsHidden())
	if row.open then
		local shown = SpokenReadables.CompendiumHas ~= nil and SpokenReadables:CompendiumHas(key) or false
		row.open.bookId = shown and key or nil
		if (row.open:IsShown() and true or false) ~= shown then row.open:SetShown(shown) end
	end
	self:Place()
	self:PlaceTheirs()
end

--------------------------------------------------------------------------------
-- The words
--------------------------------------------------------------------------------
--
-- The page being read marked as the captions mark it (Spoken:WordMarks). DialogueUI lays the book
-- out as one column of paragraphs (ScrollFrame.content) and draws only those in view, on
-- FontStrings it hands from one paragraph to another as it scrolls (contentIndexObject,
-- SetObjectData), so what each paragraph should show is kept by paragraph.

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
		if split and #split > 0 then
			table.insert(paragraphs, { index = index, text = text, words = marks.MarkLinks(text, split) })
			byIndex[index] = #paragraphs
		end
	end
	return paragraphs, byIndex
end

--- A clip of the book open in the view.
local function Mine(clip)
	local key = clip and clip.pageId and SpokenReadables:PlaceOf(clip.pageId)
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

function Book:Mark()
	local marks, view = Marks(), View()
	if not (marks and view and view:IsShown() and Spoken.GetCaption and Spoken.SplitCaption and Scroll()) then
		return
	end
	local caption = Spoken:GetCaption()
	local clip = caption and caption.clip
	if Mine(clip) then
		if clip ~= words.clip then
			-- Split only once this book is read: one opened and not listened to never is.
			if not words.paragraphs then
				words.paragraphs, words.byIndex = Collect(marks)
			end
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
	-- Gold on the stone, deep red on the paper.
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
--- One DialogueUI makes anew comes without it and shows the paragraph unmarked until the next
--- word is read, a moment at most.
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
function SpokenReadables:SetupDialogueUIBook()
	local view = View()
	if Book.hooked or not (view and view.HookScript and _G.Spoken and Spoken.CreateDialogueUIRow) then
		return
	end
	Book.hooked = true
	-- A child of the view, not a hook on the view's own scripts: DialogueUI sets those anew.
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
	if type(view.LayoutWidgets) == "function" then
		hooksecurefunc(view, "LayoutWidgets", function() Book:PlaceTheirs() end)
	end
	if type(view.SetScrollContentHeight) == "function" then
		hooksecurefunc(view, "SetScrollContentHeight", function(_, contentHeight, maxPage)
			Book:Lower(contentHeight, maxPage)
		end)
	end
	-- Hide Report Buttons, in Spoken's settings, fires no game event.
	if Spoken.RegisterCallback then
		Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function() Book:Draw() end)
	end
end

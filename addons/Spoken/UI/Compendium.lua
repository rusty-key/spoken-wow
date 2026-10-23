-- Azeroth's Compendium: one window, a tab for each Spoken part that has something to browse --
-- the quests (Spoken Quests), the places (Spoken Places), the writings (Spoken Readables) -- each a
-- list on the left and a page on the right.
--
-- Spoken's, so every module's tab shares one window. The window is the game's portrait frame, resizable from its corner
-- and folding down to the list. The list is a search box over an inset of rows, with the tab's
-- switches (Started Only, Discovered Only, Found Only and the like) in the filter menu beside the
-- search. Its rows are drawn in the game's own art: the objective tracker's campaign bar across
-- the list for a banner (a continent, a section, a type of writing), and a line for everything
-- else: a group of lines (a place, a chain, a kind of quest or of writing) with its plus or minus
-- and numbers, and each single thing with its tick, quest mark or padlock. What is inside an open
-- group is indented under it, a faint gold line down its left. What the rows are, what a click
-- does and the page beside them are each
-- tab's own.
--
-- A tab: SpokenCompendium:Register(key, { label, order, build(panel), onShow(panel), open(),
-- enabled(), unlock = { get(), set(value) } }). build lays the tab out in `panel`, which fills the
-- window, and sets panel.pageInset, folded away with the window. open shows the tab as its part
-- wants it opened, enabled says whether its part is on, and unlock is its Unlock switch, which Spoken's page shows
-- (SpokenCompendium:Toggle opens the window from there and from the minimap menu). Shared
-- with the tabs too: the zones' tree (C.MapName, C.ContinentOf, C.CITY_IN, C.BATTLEGROUNDS and
-- C.OpenAround, C.OpenZone, C.PlayerZone, C.PlayerContinent to open it where the player stands),
-- the page's inset (C.PageHolder) and the parchment page (C.NewPage). The window's size is kept in
-- Spoken's settings.
--
-- Not under setfenv(1, SpokenEnv): the frames are built here, and the client's mixins are looked
-- up in the calling function's environment.

local C = { tabs = {} }
SpokenCompendium = C

--- Runs `dress(skin)`, with EllesmereUI's skinning API, while Spoken's windows wear its look
--- (UI/Ellesmere.lua); never otherwise. The tabs' modules dress their own frames with it too.
function C.Ellesmere(dress)
	local ellesmere = SpokenEnv and SpokenEnv.Ellesmere
	if ellesmere then ellesmere:When(dress) end
end

--- `frame`'s title in EllesmereUI's font and white, as its own windows have theirs.
function C.EllesmereTitle(skin, frame)
	local container = type(frame.TitleContainer) == "table" and frame.TitleContainer
	local title = container and container.TitleText or frame.TitleText or frame.titleText
	if type(title) ~= "table" or not title.SetTextColor then return end
	skin.Font(title)
	skin.White(title)
end

local WINDOW_WIDTH = 920
local WINDOW_HEIGHT = 600
local WINDOW_MIN_HEIGHT = 360
-- Room for the longest zone name in any language (Portuguese's Cordilheira das Torres de
-- Pedra) beside its count, found out of all and the share: 27/27 • 100%.
local LIST_WIDTH = 345
-- The narrowest the page beside the list lays out at.
local PAGE_MIN_WIDTH = 278
local BANNER_ROW = 36
local BANNER_GAP = 14         -- above each banner but the first
local BANNER_IN = 10          -- a banner's plus or minus from its left
local BANNER_DROP = 1.5       -- the banner's art sits this much under its row's middle
local BANNER_TEXT = 32        -- a banner's name from its left
local FIRST_GAP = 2           -- above the first row
local LEAF_ROW = 22
-- A group (a place, a quest chain, a zone's dungeons, a zone's letters): one line, its plus or
-- minus on the line down its contents, its name over theirs, its numbers on the right.
local GROUP_ROW = 24
local GROUP_FOOT = 0          -- the line down its contents starts under the row, clear of its light
-- The quest log's plus and minus are drawn 2 left of their picture's middle: the picture moves
-- right by that, so the sign sits on the line down what it opens.
local TOGGLE_SHIFT = 2
local LEAF_GAP = 4            -- between a banner and the first line under it
local NEST_AFTER = 2          -- more under an open group's contents, for each one closed there
local NEST_STEP = 16          -- what an open group holds, this far in under it
-- The line down an open group's contents, this far into the step.
local RAIL_X = 12
local FOOT, BANNER_FOOT = 3, 2.5
local LIST_LEFT, LIST_RIGHT = 3, 2
-- What a banner holds sits this far in from it, one step down the tree; with no banners, nothing
-- is set in.
local UNDER_BANNER_IN = 20.4
-- The line down what a banner holds, this far in.
local BANNER_RAIL_X = 16.4
local LIST_TOP, LIST_FOOT = 6, 8
local SCROLL_STEP = 60
local GRABBER_SIZE = 16
local FILTER_ROOM = 26       -- what the search box gives up for the filter menu's arrow beside it
local NAME = "SpokenCompendiumWindow"
-- The window's portrait: a tome from the game, the Compendium's own rather than any one part's.
-- inv_toy_booklibrary, by file id.
local ICON = 5341597
C.ICON = ICON

local GRABBER_UP = [[Interface\ChatFrame\UI-ChatIM-SizeGrabber-Up]]
local GRABBER_DOWN = [[Interface\ChatFrame\UI-ChatIM-SizeGrabber-Down]]
local GRABBER_HIGHLIGHT = [[Interface\ChatFrame\UI-ChatIM-SizeGrabber-Highlight]]
local SMALLER_UP = [[Interface\Buttons\UI-Panel-SmallerButton-Up]]
local SMALLER_DOWN = [[Interface\Buttons\UI-Panel-SmallerButton-Down]]
local BIGGER_UP = [[Interface\Buttons\UI-Panel-BiggerButton-Up]]
local BIGGER_DOWN = [[Interface\Buttons\UI-Panel-BiggerButton-Down]]
local PANEL_HI = [[Interface\Buttons\UI-Panel-MinimizeButton-Highlight]]

--------------------------------------------------------------------------------
-- Art with a way out
--------------------------------------------------------------------------------

local function HasAtlas(name)
	return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) ~= nil or false
end

-- Paint `texture` with the game's atlas and say so, or leave it alone and say not: a missing
-- atlas draws nothing at all.
local function Atlas(texture, atlas, useAtlasSize)
	if texture.SetAtlas and HasAtlas(atlas) then
		texture:SetAtlas(atlas, useAtlasSize)
		return true
	end
	return false
end
C.Atlas = Atlas

-- Where `atlas` sits in its file, for drawing a piece of it: nil where the client has not got it,
-- or does not say.
local function AtlasSpot(atlas)
	local info = C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(atlas)
	local file = info and (info.file or info.filename)
	if not file or not info.leftTexCoord or not info.rightTexCoord or not info.topTexCoord
		or not info.bottomTexCoord or (info.width or 0) <= 0 or (info.height or 0) <= 0 then
		return nil
	end
	return info
end

-- `texture` showing the part of the atlas at `spot` from x1 to x2 and y1 to y2, in the atlas's own
-- pixels; turned left to right with `mirror`.
local function AtlasCut(texture, spot, x1, x2, y1, y2, mirror)
	local l, r, t, b = spot.leftTexCoord, spot.rightTexCoord, spot.topTexCoord, spot.bottomTexCoord
	local u1, u2 = l + (r - l) * x1 / spot.width, l + (r - l) * x2 / spot.width
	if mirror then u1, u2 = u2, u1 end
	texture:SetTexture(spot.file or spot.filename)
	texture:SetTexCoord(u1, u2, t + (b - t) * y1 / spot.height, t + (b - t) * y2 / spot.height)
end

local function Sound(kit)
	if SpokenLayout and SpokenLayout.Sound then SpokenLayout.Sound(kit) end
end

--------------------------------------------------------------------------------
-- The tabs
--------------------------------------------------------------------------------

local window, tabButtons
-- In EllesmereUI's look, the panel colour the tabs are boxes of (FlatTab); nil otherwise.
local flatTabs
local active
-- Whether the player has chosen a tab with the tabs along the window's foot this session: until
-- then the window opens on the first tab (C:Toggle), not on whichever a part opened it on last.
local picked = false
local minimized = false
local resizer, minimizeButton, minimizeFrame

local function Ordered()
	local list = {}
	for key, tab in pairs(C.tabs) do
		tab.key = key
		table.insert(list, tab)
	end
	table.sort(list, function(a, b)
		if (a.order or 0) ~= (b.order or 0) then return (a.order or 0) < (b.order or 0) end
		return a.key < b.key
	end)
	return list
end

-- Spoken's settings, where the window's size is kept: nil before they have loaded.
local function Profile()
	local addon = SpokenEnv and SpokenEnv.Addon
	return addon and addon.db and addon.db.profile
end
local SIZE_KEYS = { width = "CompendiumWidth", height = "CompendiumHeight" }

-- The list's margins inside the window, left and right, and how far below its top the tab's
-- content starts: a templated frame's portrait takes the top-left corner.
function C.Margins()
	if window and window.templated then
		return 6, 6, -24
	end
	return 14, 12, -36
end

--------------------------------------------------------------------------------
-- The window's size
--------------------------------------------------------------------------------

local function CollapsedWidth()
	local left, right = C.Margins()
	return LIST_WIDTH + left + right
end

local function MinWidth()
	local left, right = C.Margins()
	return LIST_WIDTH + left + right + PAGE_MIN_WIDTH
end

local function ScreenMaxWidth()
	return math.floor((UIParent:GetWidth() or 1920) * 0.95)
end

local function ScreenMaxHeight()
	return math.floor((UIParent:GetHeight() or 1080) * 0.95)
end

local function ApplyResizeBounds()
	local maxW = minimized and CollapsedWidth() or ScreenMaxWidth()
	local minW = minimized and CollapsedWidth() or MinWidth()
	if window.SetResizeBounds then
		window:SetResizeBounds(minW, WINDOW_MIN_HEIGHT, maxW, ScreenMaxHeight())
	else
		window:SetMinResize(minW, WINDOW_MIN_HEIGHT)
		window:SetMaxResize(maxW, ScreenMaxHeight())
	end
end

-- StartSizing does not hold the opposite corner still. Anchored at CENTER, that corner moves
-- away from the cursor every frame and the size runs to its bound.
local function PinTopLeft()
	local left, top = window:GetLeft(), window:GetTop()
	if not left or not top then
		return
	end
	window:ClearAllPoints()
	window:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left, top)
end

-- Saved sizes are clamped on the way in: a size persisted by the runaway would otherwise
-- reopen at the bound for good.
local function SavedSize(key, min, max, fallback)
	local profile = Profile()
	local saved = profile and profile[SIZE_KEYS[key]]
	if type(saved) ~= "number" or saved < min then
		return fallback
	end
	return math.min(saved, max)
end

local function ExpandedWidth()
	return SavedSize("width", MinWidth(), ScreenMaxWidth(), WINDOW_WIDTH)
end

local function SavedHeight()
	return SavedSize("height", WINDOW_MIN_HEIGHT, ScreenMaxHeight(), WINDOW_HEIGHT)
end

local function SaveWindowSize()
	local profile = Profile()
	local width, height = window:GetSize()
	if not profile or not width or not height or width <= 0 or height <= 0 then
		return
	end
	profile[SIZE_KEYS.height] = math.floor(height + 0.5)
	if not minimized then
		profile[SIZE_KEYS.width] = math.floor(width + 0.5)
	end
end

-- In EllesmereUI's look the fold and unfold buttons as it draws the world map's: the game's quest
-- tracker collapse and expand arrows, 16 across, 2 left of the button's middle, desaturated, white at
-- 75% and whole under the pointer. Where the client has not got them, the game's own buttons stay.
local FOLD_GLYPH, UNFOLD_GLYPH = "UI-QuestTrackerButton-Secondary-Collapse", "UI-QuestTrackerButton-Secondary-Expand"

-- The world map's fold buttons against its close button, which EllesmereUI leaves where the game puts
-- them: their frame's anchor and size, the buttons' size and the close button's. Nil where the client
-- has no such map.
local function MapFold()
	local border = _G.WorldMapFrame and type(WorldMapFrame.BorderFrame) == "table" and WorldMapFrame.BorderFrame
	local mm = border and border.MaximizeMinimizeFrame
	local close = border and border.CloseButton
	if type(mm) ~= "table" or type(close) ~= "table" or type(mm.GetPoint) ~= "function" then return nil end
	local point, relativeTo, relativePoint, x, y = mm:GetPoint(1)
	if relativeTo ~= close then return nil end
	local button = type(mm.MinimizeButton) == "table" and mm.MinimizeButton or mm
	return { point = point, relativePoint = relativePoint, x = x or 0, y = y or 0,
		width = mm:GetWidth(), height = mm:GetHeight(), buttonWidth = button:GetWidth(), buttonHeight = button:GetHeight(),
		closeWidth = close:GetWidth(), closeHeight = close:GetHeight() }
end

-- The template's red arrow art, emptied and faded as EllesmereUI's close button does both
-- (WSkin.CloseButton): emptying alone left the template's atlas drawn on the Forever client.
local function FadeFold(button)
	for _, setter in ipairs({ "SetNormalTexture", "SetPushedTexture", "SetHighlightTexture", "SetDisabledTexture" }) do
		if button[setter] then button[setter](button, "") end
	end
	for _, getter in ipairs({ "GetNormalTexture", "GetPushedTexture", "GetHighlightTexture", "GetDisabledTexture" }) do
		local texture = button[getter] and button[getter](button)
		if type(texture) == "table" and texture.SetAlpha and not texture.spokenGlyph then texture:SetAlpha(0) end
	end
	for _, region in ipairs({ button:GetRegions() }) do
		if not region.spokenGlyph and region.SetAlpha
			and not (region.GetObjectType and region:GetObjectType() == "FontString") then
			region:SetAlpha(0)
		end
	end
end
local function FlatFold(button)
	if not (HasAtlas(FOLD_GLYPH) and HasAtlas(UNFOLD_GLYPH)) then return end
	FadeFold(button)
	if button.flatGlyph then return end
	-- Faded again whenever it shows: the template's mixin sets its look as the window folds.
	button:HookScript("OnShow", FadeFold)
	local glyph = button:CreateTexture(nil, "OVERLAY")
	glyph.spokenGlyph = true
	glyph:SetSize(16, 16)
	glyph:SetPoint("CENTER", button, "CENTER", -2, 0)
	if glyph.SetDesaturated then glyph:SetDesaturated(true) end
	glyph:SetVertexColor(1, 1, 1, 0.75)
	button.flatGlyph = glyph
	button:HookScript("OnEnter", function() glyph:SetVertexColor(1, 1, 1, 1) end)
	button:HookScript("OnLeave", function() glyph:SetVertexColor(1, 1, 1, 0.75) end)
end
local function FoldGlyph(button, fold)
	local glyph = button.flatGlyph
	if not glyph then return end
	glyph:SetAtlas(fold and FOLD_GLYPH or UNFOLD_GLYPH, false)
end

local function SetCollapseArrow()
	if minimizeFrame then
		minimizeFrame.MaximizeButton:SetShown(minimized)
		minimizeFrame.MinimizeButton:SetShown(not minimized)
		return
	end
	if not minimizeButton then
		return
	end
	if minimized then
		minimizeButton:SetNormalTexture(BIGGER_UP)
		minimizeButton:SetPushedTexture(BIGGER_DOWN)
	else
		minimizeButton:SetNormalTexture(SMALLER_UP)
		minimizeButton:SetPushedTexture(SMALLER_DOWN)
	end
	if minimizeButton.flatGlyph then
		FlatFold(minimizeButton)
		FoldGlyph(minimizeButton, not minimized)
	end
end

-- Folded down to the list: the page goes, and only the height resizes, so folding never reflows
-- the rows.
local function ShowPages()
	for _, tab in pairs(C.tabs) do
		if tab.panel and tab.panel.pageInset then tab.panel.pageInset:SetShown(not minimized) end
	end
end

local function SetMinimized(want)
	if not window or want == minimized then
		return
	end
	minimized = want
	ApplyResizeBounds()
	PinTopLeft()
	window:SetWidth(minimized and CollapsedWidth() or ExpandedWidth())
	ShowPages()
	SetCollapseArrow()
	if not minimized and active and C.tabs[active].panel and C.tabs[active].panel.Refresh then
		C.tabs[active].panel:Refresh()
	end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- The game's portrait frame where the client has it: its border, title bar, portrait and close
-- button. A plain dialog box where it does not.
local function NewWindow(title, icon)
	local ok, frame = pcall(CreateFrame, "Frame", NAME, UIParent, "PortraitFrameTemplate")
	if ok and frame and frame.SetTitle then
		frame:SetTitle(title)
		if frame.SetPortraitToAsset and icon then frame:SetPortraitToAsset(icon) end
		frame.templated = true
		return frame
	end
	frame = CreateFrame("Frame", NAME, UIParent, "BackdropTemplate")
	frame:SetBackdrop({
		bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
		edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
		tile = true, tileSize = 32, edgeSize = 32,
		insets = { left = 11, right = 12, top = 12, bottom = 11 },
	})
	local text = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	text:SetPoint("TOP", frame, "TOP", 0, -14)
	text:SetText(title)
	frame.titleText = text
	local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -10, -8)
	close:SetScript("OnClick", function() frame:Hide() end)
	frame.CloseButton = close
	return frame
end

local function BuildChrome()
	local close = type(window.CloseButton) == "table" and window.CloseButton
	if close then
		local buttonSize = math.max((close:GetWidth() > 0 and close:GetWidth() or 32) - 2, 24)
		close:SetSize(buttonSize, buttonSize)
		close:ClearAllPoints()
		if window.templated then
			close:SetPoint("TOPRIGHT", window, "TOPRIGHT", -6, -1)
		else
			close:SetPoint("TOPRIGHT", window, "TOPRIGHT", -10, -8)
		end

		local ok, mm = pcall(CreateFrame, "Frame", nil, window, "MaximizeMinimizeButtonFrameTemplate")
		if ok and mm and mm.MaximizeButton and mm.MinimizeButton then
			minimizeFrame = mm
			-- The same size as Close and on its top edge: the frame's own size and the buttons' anchors
			-- are the template's, which left the arrow larger than Close and above the title bar.
			mm:ClearAllPoints()
			mm:SetPoint("TOPRIGHT", close, "TOPLEFT", 0, 0)
			mm:SetFrameLevel(close:GetFrameLevel())
			for _, arrow in ipairs({ mm.MinimizeButton, mm.MaximizeButton }) do
				arrow:SetSize(buttonSize, buttonSize)
				arrow:ClearAllPoints()
				arrow:SetPoint("CENTER", mm, "CENTER", 0, 0)
			end
			mm.MinimizeButton:SetScript("OnClick", function() SetMinimized(true) end)
			mm.MaximizeButton:SetScript("OnClick", function() SetMinimized(false) end)
		else
			minimizeButton = CreateFrame("Button", nil, window)
			minimizeButton:SetSize(buttonSize, buttonSize)
			minimizeButton:SetPoint("RIGHT", close, "LEFT", 0, 0)
			minimizeButton:SetFrameLevel(close:GetFrameLevel())
			minimizeButton:SetHighlightTexture(PANEL_HI)
			minimizeButton:SetScript("OnClick", function() SetMinimized(not minimized) end)
		end
		SetCollapseArrow()
	end

	resizer = CreateFrame("Button", nil, window)
	resizer:SetPoint("BOTTOMRIGHT", -2, 2)
	resizer:SetSize(GRABBER_SIZE, GRABBER_SIZE)
	resizer:SetNormalTexture(GRABBER_UP)
	resizer:SetPushedTexture(GRABBER_DOWN)
	resizer:SetHighlightTexture(GRABBER_HIGHLIGHT)
	resizer:SetFrameLevel(window:GetFrameLevel() + 5)
	resizer:SetScript("OnEnter", function() SetCursor([[Interface\Cursor\UI-Cursor-SizeRight]]) end)
	resizer:SetScript("OnLeave", function() SetCursor(nil) end)
	resizer:SetScript("OnMouseDown", function(_, button)
		if button ~= "LeftButton" then
			return
		end
		local highlight = resizer:GetHighlightTexture()
		if highlight then highlight:Hide() end
		PinTopLeft()
		window:StartSizing("BOTTOMRIGHT")
	end)
	resizer:SetScript("OnMouseUp", function()
		local highlight = resizer:GetHighlightTexture()
		if highlight then highlight:Show() end
		window:StopMovingOrSizing()
		SaveWindowSize()
		SetCursor(nil)
	end)
end

-- How much further down the chosen tab reaches than the others in EllesmereUI's look, and how far up
-- into the window its cover over the window's bottom edge reaches.
local TAB_DROP, TAB_COVER = 3, 1

-- The chosen tab's fill: black, which reads as one piece with the window's dark foot. A plate of the
-- shell's own backdrop was cover-fit to the tab's shape, which showed the texture's lighter middle band.
local function FootColour()
	return 0, 0, 0
end

-- The template's own label hidden for good in EllesmereUI's look, its text kept so the template still
-- sizes the tab: its font objects (normal, under the pointer, disabled) see-through, and the label
-- itself, whichever the template keeps (tab.Text or the button's), faded. Under the pointer the
-- template's highlight font brought it back in gold over Spoken's.
local mutedFont
local function MuteLabel(tab)
	if not mutedFont and CreateFont and GameFontNormalSmall then
		mutedFont = CreateFont("SpokenTabMutedFont")
		local file, size = GameFontNormalSmall:GetFont()
		if file then mutedFont:SetFont(file, size or 10, "") end
		mutedFont:SetTextColor(0, 0, 0, 0)
		mutedFont:SetShadowColor(0, 0, 0, 0)
	end
	if mutedFont then
		for _, setter in ipairs({ "SetNormalFontObject", "SetHighlightFontObject", "SetDisabledFontObject" }) do
			if tab[setter] then tab[setter](tab, mutedFont) end
		end
	end
	for _, text in pairs({ tab.Text or false, tab.GetFontString and tab:GetFontString() or false }) do
		if type(text) == "table" and text.SetAlpha and text ~= (tab.flat and tab.flat.label) then text:SetAlpha(0) end
	end
end

-- A tab as a box in EllesmereUI's look, its own art hidden whichever pieces the template shows.
local function FlatTab(tab)
	if tab.flat then return end
	for _, region in ipairs({ tab:GetRegions() }) do
		if region.SetAlpha and not (region.GetObjectType and region:GetObjectType() == "FontString") then
			region:SetAlpha(0)
		end
	end
	local highlight = tab.GetHighlightTexture and tab:GetHighlightTexture()
	if type(highlight) == "table" and highlight.SetAlpha then highlight:SetAlpha(0) end
	local edge = SpokenEnv.Ellesmere.EDGE
	local flat = { backing = tab:CreateTexture(nil, "BACKGROUND", nil, -8), edges = {} }
	-- The chosen tab's fill, the window's foot colour, opaque as the window is, and its cover over the
	-- window's bottom edge along the tab, which EllesmereUI draws as one piece and cannot be split.
	-- On a sibling over the window's edge and under the tab, since a child would draw over its text.
	local plate = CreateFrame("Frame", nil, window)
	plate:Hide()
	local r, g, b = FootColour()
	plate.fill = plate:CreateTexture(nil, "BACKGROUND")
	plate.fill:SetColorTexture(r, g, b, 1)
	plate.fill:SetAllPoints(plate)
	plate.cover = plate:CreateTexture(nil, "BACKGROUND")
	plate.cover:SetColorTexture(r, g, b, 1)
	flat.plate = plate
	flat.backing:SetColorTexture(flatTabs[1] or 0.08, flatTabs[2] or 0.08, flatTabs[3] or 0.08, 1)
	for _, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
		local line = tab:CreateTexture(nil, "BORDER")
		line:SetColorTexture(edge[1], edge[2], edge[3], edge[4])
		flat.edges[side] = line
	end
	-- Its own label, as EllesmereUI's tabs have, the template's hidden: under the pointer the template
	-- swaps its label's font object, which brought the game's gold back.
	local text = tab.Text or (tab.GetFontString and tab:GetFontString())
	local label = tab:CreateFontString(nil, "OVERLAY")
	local face = SpokenEnv.Ellesmere:Font()
	local _, size = (type(text) == "table" and text.GetFont) and text:GetFont()
	local file = face or (GameFontNormalSmall and GameFontNormalSmall:GetFont())
	if file then label:SetFont(file, size or 10, "") end
	flat.label = label
	tab.flat = flat
	MuteLabel(tab)
	tab:HookScript("OnEnter", function()
		MuteLabel(tab)
		if not tab.selected then label:SetTextColor(0.85, 0.85, 0.85) end
	end)
	tab:HookScript("OnLeave", function()
		MuteLabel(tab)
		if not tab.selected then label:SetTextColor(0.6, 0.6, 0.6) end
	end)
end

-- The chosen tab's text white and its box joined to the window, reaching a little lower than the
-- others; the others' text dimmer and their box shut along the top.
local function PaintFlatTab(tab, selected)
	local flat = tab.flat
	local backing, edges = flat.backing, flat.edges
	backing:ClearAllPoints()
	backing:SetPoint("TOPLEFT", tab, "TOPLEFT", 0, 0)
	backing:SetPoint("BOTTOMRIGHT", tab, "BOTTOMRIGHT", 0, selected and -TAB_DROP or 0)
	local pixel = SpokenLayout.Pixels(tab, 1, 1)
	for side, line in pairs(edges) do
		line:ClearAllPoints()
		if side == "TOP" or side == "BOTTOM" then
			line:SetHeight(pixel)
			line:SetPoint(side .. "LEFT", backing, side .. "LEFT", 0, 0)
			line:SetPoint(side .. "RIGHT", backing, side .. "RIGHT", 0, 0)
		else
			line:SetWidth(pixel)
			line:SetPoint("TOP" .. side, backing, "TOP" .. side, 0, 0)
			line:SetPoint("BOTTOM" .. side, backing, "BOTTOM" .. side, 0, 0)
		end
	end
	edges.TOP:SetShown(not selected)
	backing:SetAlpha(selected and 0 or 1)
	local plate = flat.plate
	plate:ClearAllPoints()
	plate:SetPoint("TOPLEFT", backing, "TOPLEFT", 0, 0)
	plate:SetPoint("BOTTOMRIGHT", backing, "BOTTOMRIGHT", 0, 0)
	-- Inside the side edges, so they run on up into the window's.
	plate.cover:ClearAllPoints()
	plate.cover:SetPoint("BOTTOMLEFT", plate, "TOPLEFT", 1, 0)
	plate.cover:SetPoint("BOTTOMRIGHT", plate, "TOPRIGHT", -1, 0)
	-- One screen pixel, the line EllesmereUI draws: no taller, or its top showed in the window.
	plate.cover:SetHeight(SpokenLayout.Pixels(plate, TAB_COVER, 1))
	-- Over the window's border, so nothing parts the chosen tab from it; the tab's text and edges
	-- over the plate.
	plate:SetFrameLevel(window:GetFrameLevel() + 7)
	-- None for a hidden tab: the window with one part on has no tabs, and its one tab is chosen.
	plate:SetShown(selected and tab:IsShown())
	tab:SetFrameLevel(window:GetFrameLevel() + (selected and 8 or 1))
	-- After the template's select or deselect, which sets its fonts again.
	MuteLabel(tab)
	local label = flat.label
	label:SetText(tab:GetText() or "")
	if selected then label:SetTextColor(1, 1, 1) else label:SetTextColor(0.6, 0.6, 0.6) end
	-- In the middle of its box, which the template sets lower on the chosen tab.
	label:ClearAllPoints()
	label:SetPoint("CENTER", backing, "CENTER", 0, 0)
end

-- The tabs along the window's foot, as the character sheet has them; none with only one.
local function NewTab(index, label)
	local tab
	for _, template in ipairs({ "PanelTabButtonTemplate", "CharacterFrameTabButtonTemplate" }) do
		local ok, button = pcall(CreateFrame, "Button", NAME .. "Tab" .. index, window, template)
		if ok and button then
			tab = button
			tab.template = template
			break
		end
	end
	if not tab then
		tab = CreateFrame("Button", NAME .. "Tab" .. index, window, "UIPanelButtonTemplate")
		tab:SetSize(110, 22)
	end
	tab:SetID(index)
	tab:SetText(label)
	if PanelTemplates_TabResize then pcall(PanelTemplates_TabResize, tab, 0) end
	if flatTabs then FlatTab(tab) end
	return tab
end

-- Whether a tab's part is on: a tab that does not say always is.
local function Enabled(tab)
	return not tab.enabled or (tab.enabled() and true or false)
end

-- Only the tabs whose part is on: a part switched off in Spoken's settings takes its tab away.
local function LayOutTabs()
	local list = {}
	for _, def in ipairs(Ordered()) do
		if Enabled(def) then table.insert(list, def) end
	end
	tabButtons = tabButtons or {}
	for i, def in ipairs(list) do
		local button = tabButtons[i] or NewTab(i, def.label)
		tabButtons[i] = button
		button:SetText(def.label)
		button.key = def.key
		button:ClearAllPoints()
		if i == 1 then
			button:SetPoint("TOPLEFT", window, "BOTTOMLEFT", 12, flatTabs and 0 or 2)
		else
			-- The character sheet's tabs overlap, each tucked under the one before; boxes do not.
			local gap = flatTabs and 2 or button.template == "CharacterFrameTabButtonTemplate" and -15 or 3
			button:SetPoint("LEFT", tabButtons[i - 1], "RIGHT", gap, 0)
		end
		button:SetScript("OnClick", function(self)
			Sound("igCharacterInfoTab")
			picked = true
			C:Select(self.key)
		end)
		button:SetShown(#list > 1)
	end
	-- A spare tab names no part, so no part's choice paints it chosen.
	for i = #list + 1, #tabButtons do
		tabButtons[i]:Hide()
		tabButtons[i].key = nil
	end
end

local function PaintTabs()
	if not tabButtons then return end
	for _, button in ipairs(tabButtons) do
		local selected = button.key == active
		if PanelTemplates_SelectTab and PanelTemplates_DeselectTab then
			if selected then pcall(PanelTemplates_SelectTab, button) else pcall(PanelTemplates_DeselectTab, button) end
		elseif button.LockHighlight then
			if selected then button:LockHighlight() else button:UnlockHighlight() end
		end
		button.selected = selected
		if button.flat then PaintFlatTab(button, selected) end
	end
end

C.Ellesmere(function(skin)
	flatTabs = { skin.GetPanelColor() }
	if not tabButtons then return end
	for _, button in ipairs(tabButtons) do FlatTab(button) end
	LayOutTabs()
	PaintTabs()
end)

local function BuildWindow()
	local L = SpokenEnv and SpokenEnv.L
	window = NewWindow(L and L.OPT_COMPENDIUM_TITLE or "", ICON)
	window:SetSize(ExpandedWidth(), SavedHeight())
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:SetToplevel(true)
	window:EnableMouse(true)
	window:SetMovable(true)
	window:SetResizable(true)
	window:SetClampedToScreen(true)
	window:RegisterForDrag("LeftButton")
	window:SetScript("OnDragStart", window.StartMoving)
	window:SetScript("OnDragStop", window.StopMovingOrSizing)
	window:SetScript("OnShow", function()
		-- The screen may have changed size since the bounds were last set.
		ApplyResizeBounds()
		local tab = active and C.tabs[active]
		if tab and tab.onShow then tab.onShow(tab.panel) end
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_SPELLBOOK_OPEN then PlaySound(SOUNDKIT.IG_SPELLBOOK_OPEN) end
	end)
	window:SetScript("OnHide", function()
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_SPELLBOOK_CLOSE then PlaySound(SOUNDKIT.IG_SPELLBOOK_CLOSE) end
	end)
	window:Hide()
	BuildChrome()
	local built = window
	C.Ellesmere(function(skin)
		skin.Shell(built)
		if type(built.CloseButton) == "table" then skin.CloseButton(built.CloseButton) end
		C.EllesmereTitle(skin, built)
		-- EllesmereUI's windows have no portrait: the tome goes, with its ring.
		for _, part in ipairs({ built.PortraitContainer, built.portrait, built.PortraitButton }) do
			if type(part) == "table" and part.SetAlpha then part:SetAlpha(0) end
		end
		-- Fold and unfold as the world map's beside its close button: the same sizes and place. The map
		-- may not be built yet, so the fit is tried again each time the window opens until it lands.
		local close = type(built.CloseButton) == "table" and built.CloseButton
		local folds = minimizeFrame and { { minimizeFrame.MinimizeButton, true }, { minimizeFrame.MaximizeButton, false } }
			or minimizeButton and { { minimizeButton, not minimized } } or {}
		local dressed = #folds > 0
		for _, fold in ipairs(folds) do
			FlatFold(fold[1])
			FoldGlyph(fold[1], fold[2])
			dressed = dressed and fold[1].flatGlyph ~= nil
		end
		local holder = minimizeFrame or minimizeButton
		local function FitFolds()
			local map = MapFold()
			if not (map and close and holder) then return false end
			close:SetSize(map.closeWidth, map.closeHeight)
			-- Buttons the client's arrows did not dress keep the game's size and place.
			if not dressed then return true end
			for _, fold in ipairs(folds) do fold[1]:SetSize(map.buttonWidth, map.buttonHeight) end
			holder:ClearAllPoints()
			holder:SetPoint(map.point, close, map.relativePoint, map.x, map.y)
			if minimizeFrame then minimizeFrame:SetSize(map.width, map.height) end
			return true
		end
		if not FitFolds() then
			built:HookScript("OnShow", function(self)
				if not self.spokenFoldsFitted then self.spokenFoldsFitted = FitFolds() end
			end)
		end
	end)
	if UISpecialFrames then table.insert(UISpecialFrames, NAME) end -- close on Escape
	C.window = window
end

-- A tab's panel, built the first time it is asked for: the tab lays itself out in it.
local function Panel(key)
	local tab = C.tabs[key]
	if not tab then return nil end
	if not tab.panel then
		local panel = CreateFrame("Frame", nil, window)
		panel:SetAllPoints(window)
		panel:Hide()
		tab.panel, panel.tab = panel, tab
		tab.build(panel)
		if panel.pageInset then panel.pageInset:SetShown(not minimized) end
	end
	return tab.panel
end

--------------------------------------------------------------------------------
-- Public
--------------------------------------------------------------------------------

--- A tab, registered by the part that fills it. The window is built when first opened.
function C:Register(key, def)
	C.tabs[key] = def
	if window then
		LayOutTabs()
		PaintTabs()
	end
end

--- The tab a part registered, and its panel once built.
function C:Tab(key)
	return C.tabs[key]
end

function C:Window()
	if not window then BuildWindow() end
	return window
end

--- Show `key`'s tab in the window, building either the first time.
function C:Select(key)
	if not C.tabs[key] or not Enabled(C.tabs[key]) then return end
	self:Window()
	LayOutTabs()
	local previous = active
	active = key
	for k, tab in pairs(C.tabs) do
		if tab.panel then tab.panel:SetShown(k == key) end
	end
	local panel = Panel(key)
	panel:Show()
	PaintTabs()
	if previous ~= key and window:IsShown() and C.tabs[key].onShow then C.tabs[key].onShow(panel) end
	if panel.Refresh then panel:Refresh() end
	return panel
end

--- Open the window on `key`'s tab.
function C:Open(key)
	local panel = self:Select(key)
	if panel and not window:IsShown() then window:Show() end
	return panel
end

--- Whether the window is open, on `key`'s tab when one is given.
function C:IsOpen(key)
	return window ~= nil and window:IsShown() and (key == nil or active == key)
end

function C:Hide()
	if window then window:Hide() end
end

--- Unfold the window to its page: asked for an entry, a window closed folded would reopen as the
--- bare list.
function C:Expand()
	SetMinimized(false)
end

function C:Active()
	return active
end

--- Lay the tabs out again when a part is switched on or off, and close the window if the tab it
--- shows is one switched off: left open, it would go on listing a part turned off. What is playing
--- goes on, as it does whenever the window closes.
function C:Relayout()
	if not window then return end
	LayOutTabs()
	PaintTabs()
	if active and C.tabs[active] and not Enabled(C.tabs[active]) then window:Hide() end
end

--- Whether there is anything to open: a tab whose part is on.
function C:Available()
	for _, tab in ipairs(Ordered()) do
		if Enabled(tab) then return true end
	end
	return false
end

--- Open the window, or close it when it is open: on the first tab by order whose part is on
--- (Quests), or once the player has chosen a tab this session, on the tab last looked at; through
--- the tab's own open() where it has one (the places' lands on where the player stands). Spoken's
--- minimap menu and settings page open it this way.
function C:Toggle()
	if window and window:IsShown() then
		window:Hide()
		return
	end
	local ordered = Ordered()
	local tab = picked and active and C.tabs[active]
	if not (tab and Enabled(tab)) then
		tab = nil
		for _, each in ipairs(ordered) do
			if Enabled(each) then
				tab = each
				break
			end
		end
	end
	if not tab then return end
	if tab.open then tab.open() else C:Open(tab.key) end
end

--------------------------------------------------------------------------------
-- The list
--------------------------------------------------------------------------------

local PLUS = [[Interface\Buttons\UI-PlusButton-Up]]
local MINUS = [[Interface\Buttons\UI-MinusButton-Up]]
local PLUS_OFF = [[Interface\Buttons\UI-PlusButton-Disabled]]
local READY = [[Interface\RaidFrame\ReadyCheck-Ready]]
local ACTIVE = [[Interface\GossipFrame\ActiveQuestIcon]]
local UNKNOWN_ICON = [[Interface\Icons\INV_Misc_QuestionMark]]
local CHECK = "questlog-icon-checkmark-yellow"
-- One size for every tick in the column down the list's right, on every line.
local TICK_WIDTH, TICK_HEIGHT = 15, 13

-- The campaign header's bar, in its atlas's own pixels: its crest sits half outside the bar at
-- the left end and looked cut off, so the left end is the right one turned round.
local BAR_HORDE, BAR_ALLIANCE = "Objective-Header-CampaignHorde", "Objective-Header-CampaignAlliance"
local BAR_TOP, BAR_BOTTOM = 3, 40
local BAR_MIDDLE, BAR_END = 64, 250

local ROW_END = 12            -- from a row's right side to its numbers
local SHARE_INK = { 0.80, 0.76, 0.70 }
local BANNER_INK = { 0.85, 0.81, 0.73 }
local LOCKED_INK = { 0.50, 0.48, 0.45 }

-- `size` in whole screen pixels as `frame` is drawn (Layout.Pixels): lines and icons stay crisp.
local function Pixels(frame, size, least)
	return SpokenLayout and SpokenLayout.Pixels and SpokenLayout.Pixels(frame, size, least) or size
end

-- A piece of the faint gold line down an open group's contents: solid, or where the line ends,
-- fading out to its foot.
local RAIL_INK = { 0.84, 0.71, 0.31, 0.2 }
-- Both ends set every time, solid or not: a row drawn again keeps its texture, and a fade left on
-- it from when it ended the line showed through once more rows came under it.
local function PaintRail(texture, ends)
	local r, g, b, a = RAIL_INK[1], RAIL_INK[2], RAIL_INK[3], RAIL_INK[4]
	local foot = ends and 0 or a
	texture.fades = ends and true or false
	texture:SetColorTexture(1, 1, 1, 1)
	if CreateColor and texture.SetGradient and pcall(texture.SetGradient, texture, "VERTICAL",
		CreateColor(r, g, b, foot), CreateColor(r, g, b, a)) then
		return
	end
	if texture.SetGradientAlpha then
		texture:SetGradientAlpha("VERTICAL", r, g, b, foot, r, g, b, a)
		return
	end
	texture:SetColorTexture(r, g, b, (foot + a) / 2)
end

local function Tint(fontString, colour)
	fontString:SetTextColor(colour[1], colour[2], colour[3])
end

local NAME_INK = { 1, 0.82, 0 }
local MISSING_INK = { 0.84, 0.71, 0.31 }
-- The chosen row's edge.
local EDGE_INK = { 1, 0.82, 0, 0.9 }
-- In EllesmereUI's look: names white and the line down an open group white, as its windows draw
-- them, the chosen row's edge in its accent, banners as flat boxes (DrawBanner) and the rows in its
-- font.
local flatBanners, listFont
C.Ellesmere(function(skin)
	NAME_INK, MISSING_INK, RAIL_INK = { 1, 1, 1 }, { 0.62, 0.62, 0.62 }, { 1, 1, 1, 0.15 }
	local r, g, b = skin.GetAccentColor()
	EDGE_INK = { r, g, b, 0.9 }
	flatBanners, listFont = true, skin.Font
end)

-- A group's name: gold, duller for what has nothing found yet, grey where it is locked.
local function NameInk(label, item)
	if item.locked then
		Tint(label, LOCKED_INK)
	elseif item.none or item.missing then
		Tint(label, MISSING_INK)
	else
		Tint(label, NAME_INK)
	end
end

local function Share(item)
	local total = item.total or 0
	return total > 0 and math.max(0, math.min(1, (item.count or 0) / total)) or 0
end

-- A tick: the game's yellow check, else its ready check.
local function Ticked(texture)
	if Atlas(texture, CHECK) then
		texture:SetSize(TICK_WIDTH, TICK_HEIGHT)
	else
		texture:SetTexture(READY)
		texture:SetSize(14, 14)
	end
end

-- A count as the game writes numbers in the player's language: 1,054 rather than 1054.
local function Number(n)
	n = math.floor((n or 0) + 0.5)
	if BreakUpLargeNumbers then return BreakUpLargeNumbers(n) end
	return string.format("%d", n)
end

-- A line's numbers: what is found out of all and the share, 5/27 and 18%, or only what
-- is found out of all once ticked; the quest mark first with how many are under way.
local function Numbers(item, total, ratio, ticked)
	if total <= 0 then return "" end
	local numbers = Number(item.count) .. "/" .. Number(total)
	if not ticked then
		numbers = numbers .. string.format(" \226\128\162 %d%%", math.floor(100 * ratio + 1e-6))
	end
	local going = item.goingCount or 0
	if going > 0 then numbers = "|T" .. ACTIVE .. ":12:12:0:0|t" .. Number(going) .. "   " .. numbers end
	return numbers
end

local function ShowAll(parts, shown)
	for _, part in ipairs(parts) do part:SetShown(shown and true or false) end
end

-- A row's light. A banner brightens; a plain row, or a banner drawn without the game's art, takes
-- a gold wash, stronger when chosen with a gold edge.
local function Light(row)
	local style = row.row and row.row.style
	local over, chosen = row.over and true or false, row.selected and true or false
	local flat = style ~= "banner" or not row.bannerArt
	-- EllesmereUI's flat light and accent edge, not the professions list's streak.
	if flatBanners and not row.flatLight then
		row.flatLight = true
		row.wash:SetColorTexture(1, 1, 1, 0.08)
		row.edge:SetColorTexture(EDGE_INK[1], EDGE_INK[2], EDGE_INK[3], EDGE_INK[4])
	end
	row.wash:SetShown(flat and (over or chosen))
	row.wash:SetAlpha(chosen and 1 or 0.55)
	row.edge:SetShown(flat and chosen)
	if row.glow then
		ShowAll(row.glow, style == "banner" and row.bannerArt and (over or chosen))
		for _, part in ipairs(row.glow) do part:SetAlpha(chosen and 0.25 or 0.15) end
	end
end


local List = {}
List.__index = List

--- The list down a tab's left: a search box, the filter menu beside it, and an inset of rows under
--- them running to the window's foot. opts = { search = text, none = text, only = text, onlyGet(),
--- onlySet(on), checks = { { label, get(), set(on) }... }, arrange = { values, describe(value), get(),
--- set(value) }, build() -> items,
--- isSelected(item), onClick(item), onSearch(), onHidden(), addScrollBar(scroll, child, inset),
--- hint(item) -> a line of help under an open row's name in its tooltip, or nil }.
--- While the tab's Unlock switch (its `unlock.get`) is on, nothing is greyed for having none found,
--- as every row is open to read.
--- onHidden is called when a switch in the filter menu leaves the chosen row out of the list, after
--- the list is drawn again; the tab chooses what to show in its place. Without it the page keeps
--- what it showed. The search does not call it: what it hides comes back when it is cleared. The filter
--- menu is the spellbook's, the arrow beside its search box: the tab's only switch (Started Only,
--- Discovered Only, Found Only) and any other checks as checkboxes, and where the tab can arrange its tree more than
--- one way, those ways under a divider. An item is { label, count, total, open, locked, missing }
--- and one of:
--- - style = "banner": across the list, for a continent, a section or a type: its plus or minus,
---   the name, count/total.
--- - style = "group": one line holding more lines (a place, a chain, a kind of quest or of
---   writing): its plus or minus, the name, beside it `count`/`total` and the share or a tick with
---   `tick` (and `goingCount` by the quest mark); no plus or minus with nothing to count.
--- - leaf = true: one line for a single thing: the name, and at the line's end a tick with `done`,
---   the quest mark with `going`, or the padlock with `locked`.
--- Groups and leaves give `nest`, how many open groups hold them.
function C.NewList(panel, opts)
	local list = setmetatable({ panel = panel, opts = opts, rows = {}, filter = "" }, List)
	local left, _, top = C.Margins()
	local filtered = opts.only ~= nil or opts.checks ~= nil or opts.arrange ~= nil

	local searchBox = CreateFrame("EditBox", nil, panel, "SearchBoxTemplate")
	searchBox:SetSize(LIST_WIDTH - 66 - (filtered and FILTER_ROOM or 0), 20)
	-- Halfway down the strip of the window between its title bar and the list.
	searchBox:SetPoint("TOPLEFT", panel, "TOPLEFT", left + 66, top - 11.5)
	if type(searchBox.Instructions) == "table" then searchBox.Instructions:SetText(opts.search or "") end
	-- Drawn again for a new search or filter: on the chosen row where it is still listed, else at
	-- the top. A search's results start at the top.
	local function Rescroll()
		if list.filter ~= "" or not (list.items and list:ScrollToSelection(list.items)) then
			list.scroll:SetVerticalScroll(0)
		end
	end
	searchBox:HookScript("OnTextChanged", function(self)
		list.filter = string.lower(strtrim(self:GetText() or ""))
		if opts.onSearch then opts.onSearch(list.filter) end
		Rescroll()
	end)
	list.searchBox = searchBox

	local ok, inset = pcall(CreateFrame, "Frame", nil, panel, "InsetFrameTemplate")
	if not ok or not inset then inset = CreateFrame("Frame", nil, panel) end
	-- The game's dark marble under the list, at its own colour.
	if type(inset.Bg) == "table" and inset.Bg.SetTexture then
		inset.Bg:SetTexture([[Interface\FrameGeneral\UI-Background-Marble]], "REPEAT", "REPEAT")
		if inset.Bg.SetHorizTile then inset.Bg:SetHorizTile(true); inset.Bg:SetVertTile(true) end
		if inset.Bg.SetVertexColor then inset.Bg:SetVertexColor(1, 1, 1, 1) end
	end
	inset:SetPoint("TOPLEFT", panel, "TOPLEFT", left, top - 38)
	-- Down to the window's foot, level with the page beside it.
	inset:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", left, (window and window.templated) and 6 or 12)
	inset:SetWidth(LIST_WIDTH)
	list.inset = inset
	C.Ellesmere(function(skin)
		skin.Inset(inset)
		skin.EditBox(searchBox)
		-- With no tome over its corner, across the list to the filter menu's arrow.
		searchBox:ClearAllPoints()
		-- Level with the rows: in by the scroll frame's 4 and the rows' own LIST_LEFT.
		local rows = 4 + LIST_LEFT
		searchBox:SetPoint("TOPLEFT", panel, "TOPLEFT", left + rows, top - 11.5)
		searchBox:SetWidth(LIST_WIDTH - rows - (filtered and 24 or 0))
	end)

	local scroll = CreateFrame("ScrollFrame", nil, inset)
	scroll:SetPoint("TOPLEFT", inset, "TOPLEFT", 4, -4)
	scroll:SetPoint("BOTTOMRIGHT", inset, "BOTTOMRIGHT", -4, 4)
	if scroll.SetClipsChildren then scroll:SetClipsChildren(true) end
	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", function(self, delta)
		local range = math.max(0, (list.child:GetHeight() or 0) - (self:GetHeight() or 0))
		local target = self:GetVerticalScroll() - (delta * SCROLL_STEP)
		self:SetVerticalScroll(math.max(0, math.min(range, target)))
	end)
	list.scroll = scroll

	local child = CreateFrame("Frame", nil, scroll)
	child:SetSize(LIST_WIDTH - 8, 1)
	scroll:SetScrollChild(child)
	list.child = child
	-- The game's minimal scroll bar down the list's right side, as each part draws its pages'.
	if opts.addScrollBar then list.bar = opts.addScrollBar(scroll, child, inset) end

	-- The filter menu.
	local function Listed()
		if not (opts.isSelected and list.items) then return false end
		for _, item in ipairs(list.items) do
			if opts.isSelected(item) then return true end
		end
		return false
	end
	-- A filter that leaves out the chosen row tells the tab, which says what the page shows instead:
	-- left alone, the list went to its top and the page went on showing a row no longer there.
	local function Changed()
		local was = Listed()
		if panel.Refresh then panel:Refresh() end
		if was and not Listed() and opts.onHidden then opts.onHidden() end
		Rescroll()
	end
	local function OnlyOn() return opts.onlyGet ~= nil and opts.onlyGet() and true or false end
	local function SetOnly(on)
		if opts.onlySet then opts.onlySet(on) end
		Changed()
	end
	local function Arrange(value)
		opts.arrange.set(value)
		Changed()
	end
	list.setOnly, list.chooseArrange = SetOnly, Arrange
	-- Every checkbox the menu holds, the only switch first.
	local boxes = {}
	if opts.only then table.insert(boxes, { label = opts.only, get = OnlyOn, set = SetOnly }) end
	for _, check in ipairs(opts.checks or {}) do
		table.insert(boxes, { label = check.label, get = function() return check.get() and true or false end,
			set = function(on) check.set(on); Changed() end })
	end
	if filtered then
		local button
		if MenuUtil then
			local okMenu, made = pcall(CreateFrame, "DropdownButton", nil, panel, "UIPanelArrowDropdownButtonTemplate")
			if okMenu and made and made.SetupMenu then
				button = made
				button:SetupMenu(function(_, root)
					for _, box in ipairs(boxes) do
						root:CreateCheckbox(box.label, box.get, function() box.set(not box.get()) end)
					end
					if opts.arrange then
						if #boxes > 0 then root:CreateDivider() end
						for _, value in ipairs(opts.arrange.values) do
							root:CreateRadio(opts.arrange.describe(value), function() return opts.arrange.get() == value end,
								function() Arrange(value) end, value)
						end
					end
				end)
			end
		end
		if not button and UIDropDownMenu_Initialize and UIDropDownMenu_AddButton and ToggleDropDownMenu then
			-- Where the client has not got the game's menus: the older one, from an arrow of the same
			-- shape. Named: the template's parts are found by their parent's name on the older clients.
			C.filterMenus = (C.filterMenus or 0) + 1
			local menu = CreateFrame("Frame", NAME .. "Filter" .. C.filterMenus, panel, "UIDropDownMenuTemplate")
			UIDropDownMenu_Initialize(menu, function(_, level)
				for _, box in ipairs(boxes) do
					local info = UIDropDownMenu_CreateInfo()
					info.text, info.isNotRadio, info.keepShownOnClick = box.label, true, true
					info.checked = box.get()
					info.func = function() box.set(not box.get()) end
					UIDropDownMenu_AddButton(info, level)
				end
				if opts.arrange then
					if #boxes > 0 and UIDropDownMenu_AddSeparator then UIDropDownMenu_AddSeparator(level) end
					for _, value in ipairs(opts.arrange.values) do
						local info = UIDropDownMenu_CreateInfo()
						info.text = opts.arrange.describe(value)
						info.checked = opts.arrange.get() == value
						info.func = function() Arrange(value) end
						UIDropDownMenu_AddButton(info, level)
					end
				end
			end, "MENU")
			button = CreateFrame("Button", nil, panel)
			button:SetSize(20, 20)
			button:SetNormalTexture([[Interface\ChatFrame\UI-ChatIcon-ScrollDown-Up]])
			button:SetPushedTexture([[Interface\ChatFrame\UI-ChatIcon-ScrollDown-Down]])
			button:SetHighlightTexture([[Interface\Buttons\UI-Common-MouseHilight]], "ADD")
			button:SetScript("OnClick", function(self) ToggleDropDownMenu(1, nil, menu, self, 0, 0) end)
			list.filterMenu = menu
		end
		if button then
			-- As close to the box, and as level with it, as the spellbook's arrow is to its search.
			button:SetPoint("LEFT", searchBox, "RIGHT", 4, -3)
			list.filterButton = button
		end
	end

	list.noMatch = inset:CreateFontString(nil, "ARTWORK", "GameFontDisable")
	list.noMatch:SetPoint("TOP", inset, "TOP", 0, -24)
	list.noMatch:SetText(opts.none or "")
	list.noMatch:Hide()
	return list
end

--- Why a locked row does not open, for a tab's `locked` option: Spoken's own sentence naming the
--- Unlock switch (`label` is its key in Spoken's strings).
function C.LockedReason(label)
	local L = SpokenEnv and SpokenEnv.L
	return L and L.LOCKED_ROW_FMT and L[label] and string.format(L.LOCKED_ROW_FMT, L[label]) or nil
end

local function OnRowClick(self)
	local item = self.row
	if not item or item.locked then
		return
	end
	Sound("U_CHAT_SCROLL_BUTTON")
	local list = self.list
	if list.opts.onClick then list.opts.onClick(item) end
end

-- `reason`, why a row does not open, in the colour the settings give a reason; `hint` in white.
local function ShowTip(owner, text, reason, hint)
	GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
	GameTooltip:SetText(text or "")
	if reason then GameTooltip:AddLine(reason, 1, 0.5, 0.25, true) end
	if hint then GameTooltip:AddLine(hint, 1, 1, 1, true) end
	GameTooltip:Show()
	owner.tipShown = true
end

local function HideTip(owner)
	if not owner.tipShown then return end
	owner.tipShown = nil
	if GameTooltip then GameTooltip:Hide() end
end

function List:AcquireRow(index)
	local row = self.rows[index]
	if row then
		return row
	end
	row = CreateFrame("Button", nil, self.child)
	row.list = self

	-- A row's light: the professions list's own, faint under the pointer and full when chosen, with
	-- a gold edge on the chosen one. A flat wash where the client has not got it.
	row.wash = row:CreateTexture(nil, "BACKGROUND")
	if not Atlas(row.wash, "Professions_Recipe_Hover", false) then
		row.wash:SetColorTexture(1, 1, 1, 0.1)
	end
	row.wash:Hide()
	row.edge = row:CreateTexture(nil, "ARTWORK")
	row.edge:SetWidth(Pixels(row, 2))
	row.edge:SetColorTexture(EDGE_INK[1], EDGE_INK[2], EDGE_INK[3], EDGE_INK[4])
	row.edge:Hide()

	-- A plain row's tick or quest mark, before its name.
	row.status = row:CreateTexture(nil, "ARTWORK")
	row.status:Hide()

	row.toggle = row:CreateTexture(nil, "ARTWORK")
	row.toggle:SetSize(16, 16)

	row.label = row:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	row.label:SetJustifyH("LEFT")
	if row.label.SetWordWrap then row.label:SetWordWrap(false) end

	row.count = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	row.count:SetJustifyH("RIGHT")

	-- A padlock where the count goes, on what is not found yet: the group finder's own. None where
	-- the client has not got it; the grey name still says it.
	row.lock = row:CreateTexture(nil, "ARTWORK")
	row.lock:SetSize(12, 14)
	row.hasLock = Atlas(row.lock, "LFG-lock", false)
	row.lock:SetAlpha(0.7)
	row.lock:Hide()

	row:SetScript("OnClick", OnRowClick)
	row:SetScript("OnEnter", function(self)
		self.over = not (self.row and self.row.locked)
		Light(self)
		-- A name cut short with an ellipsis, whole in the tooltip; a locked row says why it does not
		-- open, in the reason's colour the settings use; an open one gives the tab's hint.
		local opts = self.list.opts
		local reason = self.row and self.row.locked and opts.locked and opts.locked(self.row)
		local hint = self.row and not self.row.locked and opts.hint and opts.hint(self.row)
		if GameTooltip and self.row and (reason or hint or (self.label.IsTruncated and self.label:IsTruncated())) then
			ShowTip(self, self.row.label, reason, hint)
		end
	end)
	row:SetScript("OnLeave", function(self)
		self.over = false
		Light(self)
		HideTip(self)
	end)

	self.rows[index] = row
	return row
end

-- The parts only a banner has, made the first time a row is drawn as one: most rows in a
-- long list are plain ones and never need them.
local function BannerParts(row)
	if row.bannerParts then return end
	row.headLeft = row:CreateTexture(nil, "BACKGROUND")
	row.headMiddle = row:CreateTexture(nil, "BACKGROUND")
	row.headRight = row:CreateTexture(nil, "BACKGROUND")
	row.glow = {}
	for i = 1, 3 do
		local glow = row:CreateTexture(nil, "BORDER")
		if glow.SetBlendMode then glow:SetBlendMode("ADD") end
		glow:Hide()
		row.glow[i] = glow
	end
	-- Where the client has not got the bar: a dark band, a gold line along each edge.
	row.bannerFill = row:CreateTexture(nil, "BACKGROUND", nil, -1)
	row.bannerFill:SetColorTexture(0.17, 0.11, 0.06, 0.95)
	row.bannerFill:SetAllPoints(row)
	row.bannerTop = row:CreateTexture(nil, "BORDER")
	row.bannerTop:SetHeight(Pixels(row, 1))
	row.bannerTop:SetColorTexture(0.79, 0.63, 0.31, 0.8)
	row.bannerTop:SetPoint("TOPLEFT", row, "TOPLEFT", 0, 0)
	row.bannerTop:SetPoint("TOPRIGHT", row, "TOPRIGHT", 0, 0)
	row.bannerBottom = row:CreateTexture(nil, "BORDER")
	row.bannerBottom:SetHeight(Pixels(row, 1))
	row.bannerBottom:SetColorTexture(0.79, 0.63, 0.31, 0.45)
	row.bannerBottom:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", 0, 0)
	row.bannerBottom:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", 0, 0)
	-- And down each end, for a flat box.
	row.bannerLeft = row:CreateTexture(nil, "BORDER")
	row.bannerLeft:SetWidth(Pixels(row, 1))
	row.bannerLeft:SetPoint("TOPLEFT", row, "TOPLEFT", 0, 0)
	row.bannerLeft:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", 0, 0)
	row.bannerRight = row:CreateTexture(nil, "BORDER")
	row.bannerRight:SetWidth(Pixels(row, 1))
	row.bannerRight:SetPoint("TOPRIGHT", row, "TOPRIGHT", 0, 0)
	row.bannerRight:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", 0, 0)
	row.bannerParts = { row.headLeft, row.headMiddle, row.headRight, row.bannerFill, row.bannerTop, row.bannerBottom,
		row.bannerLeft, row.bannerRight,
		row.glow[1], row.glow[2], row.glow[3] }
end

-- Only the parts of the style a row is drawn in: a row drawn as a banner before and reused for a
-- line would otherwise keep the banner's bar.
local function ShowStyle(row, style)
	if row.bannerParts and style ~= "banner" then ShowAll(row.bannerParts, false) end
	if style ~= nil then row.status:Hide() end
	row.bannerArt = style == "banner" and row.bannerArt
end

-- The faint line down the left of each open group's contents, one for every group a row is inside.
-- Each row draws its share of the line, `gap` up to the row above; a group's or banner's first row
-- draws it on up to that group or banner. The row a line ends at fades it out: the first
-- `goesOn` lines go on into the next row, and the banner's with `bannerGoesOn`.
local function Rails(row, count, gap, held, underBanner, afterBanner, foot, goesOn, bannerGoesOn)
	-- In EllesmereUI's look a line starts at the foot of its banner's or group's box, not inside it,
	-- where it crossed the box's edge or ran into the group's plus or minus.
	local flat = flatBanners
	if underBanner and not row.bannerRail then
		row.bannerRail = row:CreateTexture(nil, "BORDER")
		row.bannerRail:SetWidth(Pixels(row, 1))
	end
	if row.bannerRail then
		PaintRail(row.bannerRail, not bannerGoesOn)
		row.bannerRail:ClearAllPoints()
		row.bannerRail:SetPoint("TOPLEFT", row, "TOPLEFT", Pixels(row, BANNER_RAIL_X, 0),
			gap + ((afterBanner and not flat) and BANNER_FOOT or 0))
		row.bannerRail:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", Pixels(row, BANNER_RAIL_X, 0), 0)
		row.bannerRail:SetShown(underBanner and true or false)
	end
	row.rails = row.rails or {}
	for i = 1, math.max(count, #row.rails) do
		local rail = row.rails[i]
		if i <= count then
			if not rail then
				rail = row:CreateTexture(nil, "BORDER")
				rail:SetWidth(Pixels(row, 1))
				row.rails[i] = rail
			end
			PaintRail(rail, i > (goesOn or 0))
			local x = Pixels(row, (underBanner and UNDER_BANNER_IN or 0) + (i - 1) * NEST_STEP + RAIL_X, 0)
			rail:ClearAllPoints()
			rail:SetPoint("TOPLEFT", row, "TOPLEFT", x, (i <= held or flat) and gap or gap + (foot or FOOT))
			rail:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", x, 0)
			rail:Show()
		elseif rail then
			rail:Hide()
		end
	end
end

-- The quest log's own expand and collapse, on a banner or a group. Where nothing inside
-- opens -- locked, empty, or none found with the tab's only switch on -- greyed, as the name
-- beside it is. `found`, where an item counts something narrower than what it holds (the quests
-- completed, not those in progress too).
local function Toggle(row, item, onlyFound)
	local count = item.found or item.count or 0
	-- A card with nothing inside it (a dungeon's, a city with no areas) has nothing to open: no
	-- button, rather than a disabled one that does nothing.
	if (item.total or count) <= 0 then
		row.toggle:Hide()
		return
	end
	local opens = not item.locked and not (onlyFound and count == 0)
	local atlas = opens and item.open and "questlog-icon-shrink" or "questlog-icon-expand"
	if Atlas(row.toggle, atlas) then
		if row.toggle.SetDesaturated then row.toggle:SetDesaturated(not opens) end
		row.toggle:SetAlpha(opens and 0.9 or 0.45)
	else
		if row.toggle.SetDesaturated then row.toggle:SetDesaturated(false) end
		row.toggle:SetAlpha(1)
		row.toggle:SetTexture(opens and (item.open and MINUS or PLUS) or PLUS_OFF)
		row.toggle:SetTexCoord(0, 1, 0, 1)
	end
	row.toggle:Show()
end

-- The room above the row for `items[i]`, and how many open groups hold both it and the row above.
local function GapAbove(items, i)
	local item, before = items[i], items[i - 1]
	if not before then return FIRST_GAP, 0 end
	if item.style == "banner" then return BANNER_GAP, 0 end
	if before.style == "banner" then return LEAF_GAP, 0 end
	local was, now = before.nest or 0, item.nest or 0
	-- Lines one under another, as a list: none between them, a little where a group closes.
	return now < was and (was - now) * NEST_AFTER or 0, math.min(now, was)
end

local function RowHeight(item)
	if item.style == "banner" then return BANNER_ROW end
	if item.style == "group" then return GROUP_ROW end
	return LEAF_ROW
end

local function DrawBanner(row, item, onlyFound)
	BannerParts(row)
	local horde = UnitFactionGroup and UnitFactionGroup("player") == "Horde"
	local spot = (not flatBanners) and AtlasSpot(horde and BAR_HORDE or BAR_ALLIANCE) or nil
	row.bannerArt = spot ~= nil
	if spot then
		local width = spot.width
		local cap = math.floor((width - BAR_END) * BANNER_ROW / (BAR_BOTTOM - BAR_TOP) + 0.5)
		local pieces = { { row.headLeft, BAR_END, width, true }, { row.headMiddle, BAR_MIDDLE, BAR_END },
			{ row.headRight, BAR_END, width } }
		for i, piece in ipairs(pieces) do
			AtlasCut(piece[1], spot, piece[2], piece[3], BAR_TOP, BAR_BOTTOM, piece[4])
			AtlasCut(row.glow[i], spot, piece[2], piece[3], BAR_TOP, BAR_BOTTOM, piece[4])
			piece[1]:ClearAllPoints()
		end
		row.headLeft:SetSize(cap, BANNER_ROW)
		row.headLeft:SetPoint("TOPLEFT", row, "TOPLEFT", 0, 0)
		row.headRight:SetSize(cap, BANNER_ROW)
		row.headRight:SetPoint("TOPRIGHT", row, "TOPRIGHT", 0, 0)
		row.headMiddle:SetPoint("TOPLEFT", row.headLeft, "TOPRIGHT", 0, 0)
		row.headMiddle:SetPoint("BOTTOMRIGHT", row.headRight, "BOTTOMLEFT", 0, 0)
		for i, piece in ipairs(pieces) do row.glow[i]:SetAllPoints(piece[1]) end
	end
	ShowAll({ row.headLeft, row.headMiddle, row.headRight }, spot ~= nil)
	ShowAll({ row.bannerFill, row.bannerTop, row.bannerBottom }, spot == nil)
	ShowAll({ row.bannerLeft, row.bannerRight }, flatBanners)
	if flatBanners then
		-- A faint box with a faint edge all round, as EllesmereUI's flat plates are.
		row.bannerFill:SetColorTexture(1, 1, 1, 0.05)
		for _, line in ipairs({ row.bannerTop, row.bannerBottom, row.bannerLeft, row.bannerRight }) do
			line:SetColorTexture(1, 1, 1, 0.12)
		end
	end

	row.toggle:ClearAllPoints()
	-- The plus or minus as far in from the banner's edge as it is from its top and its foot, all
	-- measured from the banner's gold line, whose middle is 1.5 under the row's.
	-- The campaign bar's gold line sits under the row's middle; a flat box has its middle. The quest
	-- log's minus and plus draw their bar 1.5 above their picture's middle (measured in game: the
	-- minus 1.5 px over the box's middle, the name and the count on it), so the sign alone drops.
	local drop = flatBanners and 0 or BANNER_DROP
	local sign = flatBanners and Pixels(row, BANNER_DROP, 0) or BANNER_DROP
	row.toggle:SetPoint("LEFT", row, "LEFT", BANNER_IN, -sign)
	Toggle(row, item, onlyFound)
	local locked = item.locked and row.hasLock
	-- The numbers and padlock in the column the lines' numbers end in.
	row.lock:SetPoint("RIGHT", row, "RIGHT", -ROW_END, -drop)
	row.count:SetPoint("RIGHT", row, "RIGHT", -ROW_END, flatBanners and 0 or -1)
	row.lock:SetShown(locked and true or false)
	row.count:SetShown(not locked)
	row.count:SetFontObject("GameFontHighlightSmall")
	Tint(row.count, BANNER_INK)
	row.count:SetText(item.total and item.total > 0 and (Number(item.count) .. "/" .. Number(item.total)) or "")
	row.label:SetFontObject("GameFontNormal")
	if listFont then listFont(row.label); listFont(row.count) end
	-- Both on the box's middle line, by their own middle.
	if flatBanners and row.label.SetJustifyV then row.label:SetJustifyV("MIDDLE"); row.count:SetJustifyV("MIDDLE") end
	row.label:SetPoint("LEFT", row, "LEFT", BANNER_TEXT, flatBanners and 0 or -1)
	row.label:SetPoint("RIGHT", locked and row.lock or row.count, "LEFT", -8, 0)
	if item.locked then Tint(row.label, LOCKED_INK) else Tint(row.label, NAME_INK) end
	row.label:SetShadowColor(0, 0, 0, 1)
	row.label:SetShadowOffset(0, -1)
	row.label:SetText(item.label)
end

-- A group: its plus or minus on the line down what it holds, its name in gold over
-- the names of what it holds, and on the right what is found out of all and the share, the quest
-- mark with how many are under way, a tick once all are found, a padlock on what does not open.
local function DrawGroup(row, item, indent, onlyFound)
	Toggle(row, item, onlyFound)
	row.toggle:ClearAllPoints()
	row.toggle:SetPoint("CENTER", row, "LEFT", indent + RAIL_X + TOGGLE_SHIFT, 0)

	local locked = item.locked and row.hasLock
	local total = item.total or 0
	local ratio = Share(item)
	local ticked = not locked and item.tick and true or false
	local edge = -(ROW_END + 6)
	row.lock:SetPoint("CENTER", row, "RIGHT", edge, 0)
	row.lock:SetShown(locked and true or false)
	if ticked then
		Ticked(row.status)
		row.status:ClearAllPoints()
		row.status:SetPoint("CENTER", row, "RIGHT", edge, 0)
	end
	row.status:SetShown(ticked)
	row.count:SetFontObject("GameFontHighlightSmall")
	Tint(row.count, SHARE_INK)
	if ticked then
		row.count:SetPoint("RIGHT", row.status, "LEFT", -4, 0)
	else
		row.count:SetPoint("RIGHT", row, "RIGHT", -ROW_END, 0)
	end
	local numbers = Numbers(item, total, ratio, ticked)
	row.count:SetText(numbers)
	row.count:SetShown(not locked and numbers ~= "")

	row.label:SetFontObject("GameFontNormal")
	if listFont then listFont(row.label); listFont(row.count) end
	row.label:SetPoint("LEFT", row, "LEFT", indent + NEST_STEP + 12, 0)
	row.label:SetPoint("RIGHT", locked and row.lock or (numbers ~= "" and row.count) or row, locked and "LEFT"
		or (numbers ~= "" and "LEFT") or "RIGHT", -8, 0)
	NameInk(row.label, item)
	row.label:SetText(item.label)
end

-- One thing on its own: its tick once completed or the quest mark while under way, its name, and
-- a padlock on what is not found yet.
local function DrawLeaf(row, item, indent)
	row.toggle:Hide()
	local status = item.done and "done" or item.going and "going" or nil
	if status == "done" then
		Ticked(row.status)
	elseif status == "going" then
		-- A file after an atlas keeps the atlas's tex coords.
		row.status:SetTexture(ACTIVE)
		row.status:SetTexCoord(0, 1, 0, 1)
		row.status:SetSize(Pixels(row, 15), Pixels(row, 15))
	end
	-- At the row's end, where a padlock goes: one place for what a row's state is.
	row.status:ClearAllPoints()
	row.status:SetPoint("CENTER", row, "RIGHT", -(ROW_END + 6), 0)
	row.status:SetShown(status ~= nil)

	local locked = item.locked and row.hasLock
	row.lock:SetPoint("CENTER", row, "RIGHT", -(ROW_END + 6), 0)
	row.lock:SetShown(locked and true or false)
	row.count:SetText("")
	row.count:Hide()
	row.label:SetFontObject("GameFontHighlight")
	if listFont then listFont(row.label) end
	row.label:SetPoint("LEFT", row, "LEFT", indent + 12, 0)
	-- Clear of the tick, quest mark or padlock at the row's end, which reach 25.5 in.
	row.label:SetPoint("RIGHT", row, "RIGHT", -28, 0)
	-- Something with nothing to read yet, greyed a little: still there to choose. One not yet
	-- found, greyer: listed, but it does not open.
	if item.locked then
		Tint(row.label, LOCKED_INK)
	elseif item.missing then
		row.label:SetTextColor(0.66, 0.64, 0.60)
	else
		row.label:SetTextColor(0.94, 0.93, 0.89)
	end
	row.label:SetText(item.label)
end

--- Build the items again and draw them. Returns the items.
function List:Render()
	local items = self.opts.build()
	local onlyFound = self.opts.onlyGet and self.opts.onlyGet()
	local unlock = self.panel.tab and self.panel.tab.unlock
	local unlocked = unlock and unlock.get and unlock.get()
	local y = LIST_TOP
	local underBanner = false
	for i, item in ipairs(items) do
		if unlocked then item.none = false end
		if item.style == "banner" then underBanner = true end
		local row = self:AcquireRow(i)
		row.row = item
		local gap, held = GapAbove(items, i)
		local height = RowHeight(item)
		y = y + gap
		row:SetHeight(height)
		row:ClearAllPoints()
		row:SetPoint("TOPLEFT", self.child, "TOPLEFT", LIST_LEFT, -y)
		row:SetPoint("TOPRIGHT", self.child, "TOPRIGHT", -LIST_RIGHT, -y)
		y = y + height

		ShowStyle(row, item.style)
		local nest = item.style ~= "banner" and item.nest or 0
		local before, after = items[i - 1], items[i + 1]
		local _, goesOn = 0, 0
		if after and after.style ~= "banner" then _, goesOn = GapAbove(items, i + 1) end
		Rails(row, nest, gap, held, item.style ~= "banner" and underBanner,
			before and before.style == "banner", before and before.style == "group" and GROUP_FOOT or FOOT,
			goesOn, after ~= nil and after.style ~= "banner")
		local indent = (underBanner and UNDER_BANNER_IN or 0) + nest * NEST_STEP
		row.indent = indent
		row.label:ClearAllPoints()
		row.lock:ClearAllPoints()
		row.count:ClearAllPoints()
		if item.style == "banner" then
			indent = 0
			DrawBanner(row, item, onlyFound)
		elseif item.style == "group" then
			DrawGroup(row, item, indent, onlyFound)
		else
			DrawLeaf(row, item, indent)
		end
		-- A single row's light starts on the line down its left, its gold edge over that line.
		local lit = indent
		if item.style ~= "banner" and (nest > 0 or underBanner) then lit = indent - (NEST_STEP - RAIL_X) - 0.5 end
		row.wash:ClearAllPoints()
		row.wash:SetPoint("TOPLEFT", row, "TOPLEFT", lit, 0)
		row.wash:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", 0, 0)
		row.edge:ClearAllPoints()
		row.edge:SetPoint("TOPLEFT", row, "TOPLEFT", lit, 0)
		row.edge:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", lit, 0)
		-- Clicks on the row, not on the room beside its line.
		if row.SetHitRectInsets then row:SetHitRectInsets(indent, 0, 0, 0) end

		row.selected = self.opts.isSelected and self.opts.isSelected(item) or false
		Light(row)
		row:Show()
	end

	for i = #items + 1, #self.rows do
		self.rows[i]:Hide()
		self.rows[i].row = nil
	end

	self.child:SetHeight(math.max(y + LIST_FOOT, 1))
	self.noMatch:SetShown(#items == 0)
	self.items = items
	return items
end

--- Bring the chosen row into view, and say whether it is listed. Only when a tab opens on
--- something or the list is filtered again: doing it on every refresh would yank the list out
--- from under a click.
function List:ScrollToSelection(items)
	local y = LIST_TOP
	for i, item in ipairs(items) do
		y = y + GapAbove(items, i)
		local height = RowHeight(item)
		if self.opts.isSelected and self.opts.isSelected(item) then
			local viewHeight = self.scroll:GetHeight() or 0
			-- GetVerticalScrollRange is stale until the next layout pass, right after
			-- child:SetHeight, so derive the range instead.
			local range = math.max(0, (self.child:GetHeight() or 0) - viewHeight)
			local target = y - (viewHeight / 2) + (height / 2)
			self.scroll:SetVerticalScroll(math.max(0, math.min(range, target)))
			return true
		end
		y = y + height
	end
	return false
end

--- Whether the list as last drawn holds a row `test(item)` says yes to.
function List:ListsAny(test)
	for _, item in ipairs(self.items or {}) do
		if test(item) then return true end
	end
	return false
end

function List:ClearSearch()
	if self.searchBox:GetText() ~= "" then self.searchBox:SetText("") end
	self.filter = ""
end

--- The chosen row brought into view. The client's scroll frame takes an offset only within the
--- range it last measured, which a list just drawn longer has not measured yet; nor has the frame
--- a height until the window is first laid out. Either left the list at its top, the chosen row
--- off screen: the range is measured now, and the row brought into view again a frame later.
function List:ScrollToChosen(items)
	if self.scroll.UpdateScrollChildRect then self.scroll:UpdateScrollChildRect() end
	self:ScrollToSelection(items)
	C_Timer.After(0, function()
		if self.filter == "" and self.items then self:ScrollToSelection(self.items) end
	end)
end

--------------------------------------------------------------------------------
-- The zones, as every tab lays them out
--------------------------------------------------------------------------------

C.WORLD = 947
C.CONTINENTS = { 1414, 1415 } -- Kalimdor, the Eastern Kingdoms
-- Where the client cannot say (C_Map's parents), Classic's own map ids: Kalimdor's zones and
-- cities, then the Eastern Kingdoms'.
local KNOWN_CONTINENT = {}
for _, id in ipairs({ 1411, 1412, 1413, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447,
	1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457 }) do KNOWN_CONTINENT[id] = 1414 end
for _, id in ipairs({ 1416, 1417, 1418, 1419, 1420, 1421, 1422, 1423, 1424, 1425, 1426, 1427, 1428,
	1429, 1430, 1431, 1432, 1433, 1434, 1435, 1436, 1437, 1453, 1455, 1458 }) do KNOWN_CONTINENT[id] = 1415 end
-- The cities, each inside the zone around it, as the places list them.
C.CITY_IN = { [1453] = 1429, [1454] = 1411, [1455] = 1426, [1456] = 1412, [1457] = 1438, [1458] = 1420 }
-- The battlegrounds, under a banner of their own after the continents, whatever map the client
-- hangs them under: Forever's newer client puts Alterac Valley in Hillsbrad Foothills, its older
-- one under Azeroth, where no continent's list reached them.
C.BATTLEGROUNDS = { 1459, 1460, 1461, 2524 } -- Alterac Valley, Warsong Gulch, Arathi Basin, Darkspear Islands
C.IS_BATTLEGROUND = {}
for _, mapID in ipairs(C.BATTLEGROUNDS) do C.IS_BATTLEGROUND[mapID] = true end

function C.IsContinent(mapID)
	return mapID == 1414 or mapID == 1415
end

function C.MapName(mapID)
	local info = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID)
	return info and info.name or tostring(mapID)
end

--- A dungeon or raid by its instance map (Data/Dungeons.lua): { zone = its entrance's, story =
--- { mapID, key } of the Places area telling it or nil, its name by locale }; nil for any other map.
function C.Dungeon(map)
	return _G.SpokenDungeons and SpokenDungeons.dungeons and SpokenDungeons.dungeons[map] or nil
end

--- A dungeon's name in the client's language, as its Map table has it.
function C.DungeonName(map)
	local dungeon = C.Dungeon(map)
	if not dungeon then return tostring(map) end
	return dungeon[GetLocale and GetLocale() or "enUS"] or dungeon[1]
end

local continentCache = {}
--- The continent a zone is on: up the game's map tree until one is reached, else Classic's ids.
function C.ContinentOf(mapID)
	if continentCache[mapID] ~= nil then return continentCache[mapID] or nil end
	local found
	local current, steps = mapID, 0
	while current and steps < 8 and C_Map and C_Map.GetMapInfo do
		local info = C_Map.GetMapInfo(current)
		local parent = info and info.parentMapID
		if not parent or parent == 0 then break end
		if parent == 1414 or parent == 1415 then found = parent break end
		current, steps = parent, steps + 1
	end
	found = found or KNOWN_CONTINENT[mapID]
	continentCache[mapID] = found or false
	return found
end

--- Open what holds a zone's row, as every tab nests them: the battlegrounds' banner, its
--- continent's, or the banner of the zones on none. `continentOpen` and `bannerOpen` are the tab's
--- own, by continent and by "battlegrounds" and "lands".
function C.OpenAround(zone, continentOpen, bannerOpen)
	if C.IS_BATTLEGROUND[zone] then
		bannerOpen.battlegrounds = true
		return
	end
	local continent = C.ContinentOf(C.CITY_IN[zone] or zone)
	if continent then
		continentOpen[continent] = true
	else
		bannerOpen.lands = true
	end
end

--- Open a zone's row in `openZones` and, for a city, the zone's around it, leaving the others as
--- they are.
function C.OpenZone(zone, openZones)
	openZones[zone] = true
	if C.CITY_IN[zone] then openZones[C.CITY_IN[zone]] = true end
end

--- The map the player stands in, or nil where there is none or the game hides it (instances).
local function PlayerMap()
	return _G.Spoken.NotSecret(C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player"))
end

--- The map the player stands in that `has(map)` says a tab lists, walking up from an inn's or a
--- cave's map, or nil.
function C.PlayerZone(has)
	local map = PlayerMap()
	local steps = 0
	while map and steps < 8 do
		if has(map) then return map end
		local info = C_Map.GetMapInfo and C_Map.GetMapInfo(map)
		map, steps = info and info.parentMapID, steps + 1
	end
end

--- Of `listed`, the continents a tab's list shows, the one the player is on, else the first.
function C.PlayerContinent(listed)
	local map = PlayerMap()
	for _, continent in ipairs(listed) do
		if map == continent or (map and C.ContinentOf(map) == continent) then return continent end
	end
	return listed[1]
end

--- The picture of a place's story (Spoken Places'), for Page:Show's `picture` on another tab's page of
--- the place: { file, mask }, or nil where Places is not there, has none or has pictures off.
--- `place` is { mapID = a zone, a city or a continent } or { mapID = the zone of a dungeon's entrance,
--- dungeon = its instance map }.
function C.PlacePicture(place)
	local spoken = _G.Spoken
	if not (spoken and spoken.PlacePicture) then return nil end
	local mapID, key = place.mapID, nil
	if place.dungeon then
		local dungeon = C.Dungeon(place.dungeon)
		if not (dungeon and dungeon.story) then return nil end
		mapID, key = dungeon.story[1], dungeon.story[2]
	end
	local file, mask = spoken:PlacePicture(mapID, key)
	return file and { file = file, mask = mask } or nil
end

--- The page's side of a tab: an inset beside `list` down the rest of `panel`, as the game's split
--- windows frame each pane (the professions window), so list and page are parted by their borders.
--- Returns the frame the page fills; `panel.pageInset` is folded away with the window.
function C.PageHolder(panel, list)
	local _, right = C.Margins()
	local ok, inset = pcall(CreateFrame, "Frame", nil, panel, "InsetFrameTemplate")
	if not ok or not inset then inset = CreateFrame("Frame", nil, panel) end
	inset:SetPoint("TOPLEFT", list.inset, "TOPRIGHT", 6, 38)
	inset:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -right, (window and window.templated) and 6 or 12)
	panel.pageInset = inset
	C.Ellesmere(function(skin) skin.Inset(inset) end)
	local holder = CreateFrame("Frame", nil, inset)
	holder:SetPoint("TOPLEFT", inset, "TOPLEFT", 3, -3)
	holder:SetPoint("BOTTOMRIGHT", inset, "BOTTOMRIGHT", -3, 3)
	-- The inset's border over the parchment's edge, not under it.
	if type(inset.NineSlice) == "table" and inset.NineSlice.SetFrameLevel then
		inset.NineSlice:SetFrameLevel(holder:GetFrameLevel() + 5)
	end
	return holder
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

-- The parchment: Spoken Places' copies of the spellbook's page and divider where it is installed,
-- so every tab is on the same paper as the places; the game's own atlas where the client has it;
-- a plain colour where neither.
local ZONES_ART = "Interface\\AddOns\\Spoken_Places\\Textures\\Art\\"
-- What a page with nothing to read shows in its middle: the client's wax seal of the player's
-- faction at MARK_ALPHA and its own size (larger, it blurs), else the lattice in the ink at LATTICE_ALPHA.
local LATTICE = "Interface\\AddOns\\Spoken\\Textures\\Lattice"
local LATTICE_SIZE, LATTICE_ALPHA, MARK_ALPHA, MARK_MOST = 240, 0.18, 0.35, 380
local FACE_GAP, FACE_SIZE = 10, 50
-- For a page the tab gives no picture: with one on every page, the title never moves.
local TOME = { objectOrItem = true, icon = ICON }

-- The wax seal of the player's faction, else the other's; nil where the client has neither.
local function MarkAtlas()
	local horde = UnitFactionGroup and UnitFactionGroup("player") == "Horde"
	for _, faction in ipairs(horde and { "Horde", "Alliance" } or { "Alliance", "Horde" }) do
		local name = "Quest-" .. faction .. "-WaxSeal"
		if HasAtlas(name) then return name end
	end
end
-- One ink for every word on the page: a lighter one for the line under the title and for a page
-- with nothing chosen read as greyed out, and was hard to make out on the parchment.
-- The spellbook's own, as the places' page has it: the game's colour is darker than the brown
-- this falls back to.
local INK = { 0.25, 0.16, 0.08 }
if _G.SPELLBOOK_FONT_COLOR and SPELLBOOK_FONT_COLOR.GetRGB then INK = { SPELLBOOK_FONT_COLOR:GetRGB() } end
-- The line under the title under the pointer, where a click on it goes up a level: the places'
-- page's link colour.
local LINK = { 0.5, 0.12, 0.04 }
-- On EllesmereUI's dark shell in place of the parchment (Page:Darken): light words, the title and
-- the parts' headings white, as its windows write them, and links in its accent colour.
local LIGHT_INK, LIGHT_TITLE = { 0.9, 0.9, 0.9 }, { 1, 1, 1 }
local PAD, TOP, RIGHT = 24, 36, 36
-- The spellbook header's backplate behind the title, as the places' page lays it: laid out as if it
-- started this far left of the page, and cut there.
local BACKPLATE_CUT, BACKPLATE_FULL = 40, 460

local function PlacesLoaded()
	if C_AddOns and C_AddOns.IsAddOnLoaded then return C_AddOns.IsAddOnLoaded("Spoken_Places") end
	return IsAddOnLoaded and IsAddOnLoaded("Spoken_Places") or false
end

local function Ink(fontString, color)
	fontString:SetTextColor(color[1], color[2], color[3])
	fontString:SetShadowColor(0, 0, 0, 0)
end

--- A Play button's state for `clip`, the line it plays as the queue holds it (nil when not queued),
--- as the quest log's Play and the subtitle have it: "stop" while it is the head and speaking,
--- "replay" while it is the head and the queue is stopped, "play" otherwise (not queued, waiting,
--- or held by a gate).
function C.PlayState(clip)
	local spoken = _G.Spoken
	if not (clip and spoken and spoken.GetCurrent) or spoken:GetCurrent() ~= clip then return "play" end
	if spoken:IsPaused() then return "replay" end
	if spoken:GetNowPlaying() == clip then return "stop" end
	return "play"
end

--- A click on a Play button whose line is `clip` (nil when not queued): Stop and Replay stop the
--- queue and play the line again; a line waiting behind a stopped one plays now; one not queued is
--- started with `start()`; one waiting behind a line speaking is left where it is.
function C.PlayClick(clip, start)
	local spoken = _G.Spoken
	if not spoken then return end
	local state = C.PlayState(clip)
	if state == "stop" or state == "replay" then
		Sound("U_CHAT_SCROLL_BUTTON")
		spoken:TogglePause()
	elseif clip and spoken:IsPaused() then
		Sound("U_CHAT_SCROLL_BUTTON")
		if clip.source and clip.source.PlayNow then clip.source:PlayNow(clip) end
	elseif not clip then
		start()
	end
end

--- A Play button's tooltip for `state`, as every Play of the Compendium's has it: the state's name
--- in Spoken's words, and under it what a click does, `tip` for Play.
function C.PlayTooltip(button, state, tip)
	local words = _G.SpokenEnv and _G.SpokenEnv.L
	if not (words and GameTooltip) then return end
	GameTooltip:SetOwner(button, "ANCHOR_LEFT")
	local line
	if button.IsEnabled and not button:IsEnabled() then
		GameTooltip:SetText(words.PLAY)
		line = words.PLAY_NO_VOICE
	elseif state == "stop" then
		GameTooltip:SetText(words.STOP)
		line = words.STOP_READING_TIP
	elseif state == "replay" then
		GameTooltip:SetText(words.REPLAY)
		line = words.REPLAY_READING_TIP
	else
		GameTooltip:SetText(words.PLAY)
		line = tip
	end
	if line then GameTooltip:AddLine(line, 1, 0.8, 0.2, true) end
	GameTooltip:Show()
end

--- A Report button's tooltip: `title`, `tip` under it, and the line about its right-click where
--- the debug log's menu is installed.
function C.ReportTooltip(button, title, tip)
	if not GameTooltip then return end
	GameTooltip:SetOwner(button, "ANCHOR_LEFT")
	GameTooltip:SetText(title or "")
	if tip then GameTooltip:AddLine(tip, 1, 0.8, 0.2, true) end
	local hint = _G.Spoken and Spoken.LogMenuHint and Spoken:LogMenuHint()
	if hint then GameTooltip:AddLine(hint, 0.6, 0.6, 0.6, true) end
	GameTooltip:Show()
end

local Page = {}
Page.__index = Page

-- The spellbook's page, its top band cut off: a band made to sit under the spellbook's own top bar.
local SPELLBOOK_PAGE = { file = ZONES_ART .. "spellbook-Page-Right-C60", coords = { 0, 0.791016, 0.666016 * 0.07, 0.666016 } }

--- A page of parchment filling `parent`: a title, the line under it, the divider, the words in a
--- scrolling view (UI/TextView.lua, in `addon`'s font for its language), and Report and Play on the
--- title's right, as the places' page has them. `play` = { has(target), find(target) -> the line in
--- the queue or nil, start(target), tip }, what Play does for whatever Show was given (C.PlayState,
--- C.PlayClick); `report` = { has(target), open(target), title, tip }, what Report does, hidden where
--- it has nothing to report or the player hides Report buttons.
---
--- `look`, where given, changes the page's art from the spellbook's for the Compendium:
--- { art = { file, coords } the parchment; top, right, the heading's room from the page's top and
--- its right edge; titleSize; oneLine, a title cut short at one line rather than two; backplate = { full,
--- height } }. Spoken Places' page beside the map is the quest log's details page this way.
function C.NewPage(parent, addon, play, report, look)
	look = look or {}
	local top, right = look.top or TOP, look.right or RIGHT
	local titleSize = look.titleSize or 26
	local self = setmetatable({ playing = play, reporting = report, top = top, right = right,
		titleSize = titleSize, extra = {}, shift = 0, ink = INK, link = LINK, addon = addon }, Page)
	local frame = CreateFrame("Frame", nil, parent)
	frame:SetAllPoints()
	self.frame = frame

	local bg = frame:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	-- Spoken Places' copy of the spellbook's page where it is installed, so every tab is on the same
	-- paper as the places; the game's own atlas where the client has it; a plain colour where
	-- neither. Drawn from a file wherever it can be, so the text's fade is cut from the same picture.
	local art = look.art or (PlacesLoaded() and SPELLBOOK_PAGE) or nil
	local file, coords
	if art then
		file, coords = art.file, art.coords
		bg:SetTexture(file)
		bg:SetTexCoord(coords[1], coords[2], coords[3], coords[4])
	elseif not Atlas(bg, "spellbook-Page-Right-C60") then
		bg:SetColorTexture(0.86, 0.76, 0.56, 1)
	end
	self.bg, self.bgFile, self.bgCoords = bg, file, coords
	-- Off the pixel grid, as the text's fade cut from the same picture is: snapped apart, the two
	-- part by a pixel along the fade's edge.
	SpokenTextView.Unsnap(bg)

	-- The spellbook header's backplate behind the title, faint, as the spellbook lays one behind
	-- each heading. Laid out as if it started BACKPLATE_CUT left of the page, and cut there and at
	-- the page's right edge rather than drawn past them: past the left it showed over the window's
	-- list and over the map's border beside the panel.
	if PlacesLoaded() then
		local plate = look.backplate or { full = BACKPLATE_FULL, height = 110 }
		local backplate = frame:CreateTexture(nil, "BORDER")
		backplate:SetTexture(ZONES_ART .. "spellbook-list-backplate")
		backplate:SetHeight(plate.height)
		backplate:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 28 - top)
		backplate:SetAlpha(0.55)
		local plateRight, plateBottom = 0.617188, 0.828125
		local function Fit()
			local shown = plate.full - BACKPLATE_CUT
			local room = frame:GetWidth() or 0
			if room > 0 then shown = math.min(shown, room) end
			backplate:SetWidth(shown)
			backplate:SetTexCoord(plateRight * BACKPLATE_CUT / plate.full,
				plateRight * (BACKPLATE_CUT + shown) / plate.full, 0, plateBottom)
		end
		frame:HookScript("OnSizeChanged", Fit)
		Fit()
		self.backplate = backplate
	end

	-- The quest log's title face, as a quest's name is written on its page, in the font `addon`
	-- writes its language in (Spoken Places' stories in another language than the client's).
	local title = frame:CreateFontString(nil, "ARTWORK", _G.QuestTitleFont and "QuestTitleFont" or "GameFontNormalLarge")
	local face = addon and addon.FontFor and addon:FontFor(_G.QuestTitleFont)
		or (_G.QuestTitleFont and _G.QuestTitleFont.GetFont and _G.QuestTitleFont:GetFont())
	if face then title:SetFont(face, titleSize, "") end
	title:SetPoint("TOPLEFT", frame, "TOPLEFT", PAD, -top)
	title:SetPoint("RIGHT", frame, "RIGHT", -right - 34, 0)
	title:SetJustifyH("LEFT")
	-- Two lines at most, one where the page is narrow, cut short with an ellipsis after: the line
	-- under it and the divider move down with it.
	if look.oneLine and title.SetWordWrap then title:SetWordWrap(false) end
	if title.SetMaxLines then title:SetMaxLines(look.oneLine and 1 or 2) end
	-- Its shadow is the quest log's: the font's own, which Ink would take away.
	title:SetTextColor(INK[1], INK[2], INK[3])
	self.title = title
	-- A title cut short, whole in the tooltip.
	local titleHit = CreateFrame("Frame", nil, frame)
	titleHit:SetAllPoints(title)
	titleHit:EnableMouse(true)
	titleHit:SetScript("OnEnter", function(hit)
		if GameTooltip and title.IsTruncated and title:IsTruncated() then ShowTip(hit, title:GetText()) end
	end)
	titleHit:SetScript("OnLeave", HideTip)
	self.titleHit = titleHit

	-- The line under the title as the places' page sets it: a line 16 high, its words in the middle,
	-- 2 under the title; none at all where there is nothing to say. Where the tab gives it somewhere
	-- to go (Page:Show's onSubtitle), a click goes there and the pointer paints it as a link.
	local sub = CreateFrame("Button", nil, frame)
	sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)
	sub:SetPoint("RIGHT", frame, "RIGHT", -right, 0)
	sub:SetHeight(16)
	local words = sub:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	words:SetAllPoints()
	words:SetJustifyH("LEFT")
	if words.SetJustifyV then words:SetJustifyV("MIDDLE") end
	-- One line, cut short with an ellipsis: a book found in several places names them all.
	if words.SetWordWrap then words:SetWordWrap(false) end
	if words.SetMaxLines then words:SetMaxLines(1) end
	Ink(words, INK)
	sub.text = words
	sub:SetScript("OnClick", function(b) if b.onClick then b.onClick() end end)
	sub:SetScript("OnEnter", function(b) if b.onClick then Ink(b.text, self.link) end end)
	sub:SetScript("OnLeave", function(b) Ink(b.text, self.ink) end)
	sub:Disable()
	self.sub = sub

	-- The spellbook's divider, as the places' page draws it: at its own size, cut short where the
	-- page is narrower, never stretched (stretched, its flourish widens).
	local divider = frame:CreateTexture(nil, "ARTWORK")
	divider:SetHeight(11)
	divider:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", -6, -10)
	local rule
	if PlacesLoaded() then
		rule = { file = ZONES_ART .. "spellbook-divider", width = 657, left = 0, right = 0.641602, top = 0, bottom = 0.6875 }
	else
		local spot = AtlasSpot("spellbook-divider")
		if spot then
			rule = { file = spot.file or spot.filename, width = spot.width, left = spot.leftTexCoord, right = spot.rightTexCoord,
				top = spot.topTexCoord, bottom = spot.bottomTexCoord }
		end
	end
	if rule then
		divider:SetTexture(rule.file)
		local function Fit()
			local room = (frame:GetWidth() or 0) - (PAD - 6) - right
			if room <= 0 then return end
			local width = math.min(room, rule.width)
			divider:SetWidth(width)
			divider:SetTexCoord(rule.left, rule.left + (rule.right - rule.left) * width / rule.width, rule.top, rule.bottom)
		end
		frame:HookScript("OnSizeChanged", Fit)
		Fit()
	else
		divider:SetPoint("RIGHT", frame, "RIGHT", -right, 0)
		divider:SetColorTexture(INK[1], INK[2], INK[3], 0.35)
		divider:SetHeight(Pixels(frame, 1))
	end
	self.divider = divider
	-- A narrower page can wrap the title onto its second line.
	frame:HookScript("OnSizeChanged", function() self:PlaceDivider() end)

	local body = SpokenTextView.Create(frame, addon)
	body.frame:SetPoint("TOPLEFT", divider, "BOTTOMLEFT", 6, -2)
	body.frame:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -right, PAD - 6)
	body:SetInk(INK[1], INK[2], INK[3])
	body:SetThumbColor(INK[1], INK[2], INK[3])
	-- Text cut off at an edge fades into the parchment under it.
	if file then body:SetFadeSource(frame, file, coords) end
	self.body = body
	local mark = frame:CreateTexture(nil, "BORDER")
	mark:SetPoint("CENTER", body.frame, "CENTER")
	mark:Hide()
	self.mark = mark
	-- The header's buttons stand over the words' right edge, which moves as the bar comes and goes.
	body.onRoom = function() self:RefreshPlay() end

	-- Contribute, under the words that say nothing is written yet: on a page that says so only, and
	-- where the player has not hidden the Contribute buttons.
	local words = SpokenEnv and SpokenEnv.L or {}
	local contribute = CreateFrame("Button", nil, body.child, "UIPanelButtonTemplate")
	contribute:SetSize(100, 22)
	contribute:SetText(words.COMPENDIUM_CONTRIBUTE or "Contribute")
	contribute:Hide()
	-- Under the last part, where the words of a part are the page's.
	body.onPartsEnd = function(y)
		contribute:ClearAllPoints()
		contribute:SetPoint("TOPLEFT", body.child, "TOPLEFT", 0, -(y + 12))
	end
	contribute:SetScript("OnClick", function() if self.unwritten then self.unwritten() end end)
	contribute:SetScript("OnEnter", function(b)
		GameTooltip:SetOwner(b, "ANCHOR_RIGHT")
		GameTooltip:SetText(words.COMPENDIUM_CONTRIBUTE or "Contribute")
		GameTooltip:AddLine(words.COMPENDIUM_CONTRIBUTE_TIP or "", 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)
	contribute:SetScript("OnLeave", function() GameTooltip:Hide() end)
	self.contribute = contribute
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function() self:RefreshContribute() end)
	end

	-- Report in the heading's corner, the game's bug in the player's round button, as the places'
	-- page has it.
	if report and _G.Spoken and Spoken.CreateRoundButton then
		local button = Spoken:CreateRoundButton(frame, "report")
		button:SetScript("OnClick", function()
			if self.target ~= nil then report.open(self.target) end
		end)
		button:HookScript("OnEnter", function(b) C.ReportTooltip(b, report.title, report.tip) end)
		button:HookScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
		button:Hide()
		self.report = button
		if Spoken.RegisterCallback then
			Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function() self:RefreshPlay() end)
		end
	end

	-- Play, the player's round button, beside Report as the places' page has it.
	if play and _G.Spoken and Spoken.CreateRoundButton then
		local button = Spoken:CreateRoundButton(frame, "play")
		button:SetScript("OnClick", function()
			local target = self.target
			if target == nil then return end
			-- Looked up each click: a line that has since finished is no longer in the queue.
			C.PlayClick(play.find(target), function() play.start(target) end)
			self:RefreshPlay()
			if GameTooltip and GameTooltip:GetOwner() == button then C.PlayTooltip(button, button.pageState, play.tip) end
		end)
		button:HookScript("OnEnter", function(b) C.PlayTooltip(b, b.pageState, play.tip) end)
		button:HookScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
		button:Hide()
		self.play = button
		if Spoken.RegisterCallback then
			Spoken:RegisterCallback("AUDIO_CHANGED", function() self:RefreshPlay() end)
		end
	end
	C.Ellesmere(function(skin) self:Darken(skin) end)
	return self
end

-- EllesmereUI's window backdrop where a page's text is cut, for its fade to blend into: in its own
-- style its texture under its 62% black wash, measured at the words' top and foot in the Compendium
-- (920 by 600) and the Place Story panel (360 by 600), which come within 0.005 of each other; in its
-- Modern style its flat default, #111111.
local BACKDROP = { TOP = { 0.094, 0.082, 0.069 }, BOTTOM = { 0.071, 0.063, 0.054 } }
local function BackdropAt(skin, edge)
	if skin.GetStyle and skin.GetStyle() == "modern" then return { 0.067, 0.067, 0.067 } end
	return BACKDROP[edge]
end

--- The page on EllesmereUI's dark shell: no parchment or backplate, and light words with no fade
--- cut from the parchment. Its pictures and faces stay as they are.
function Page:Darken(skin)
	local accent = { skin.GetAccentColor() }
	self.ink, self.link = LIGHT_INK, accent[1] and accent or LIGHT_TITLE
	-- No page of its own: the window's backdrop, the list's, shows through.
	self.bg:SetAlpha(0)
	if self.backplate then self.backplate:SetAlpha(0) end
	-- EllesmereUI's font, where it writes the page's language: Spoken Places' FontFor falls back
	-- to the client's font for another script.
	-- Nil on a client whose script it does not write: the client's fonts stay.
	local path = SpokenEnv and SpokenEnv.Ellesmere and SpokenEnv.Ellesmere:Font()
	local face = path and { GetFont = function() return path, 12, "" end } or nil
	local addon = self.addon
	local file = path
	if face and addon and addon.FontFor then file = addon:FontFor(face) end
	if file then self.title:SetFont(file, self.titleSize, "") end
	self.title:SetTextColor(LIGHT_TITLE[1], LIGHT_TITLE[2], LIGHT_TITLE[3])
	if file then
		local _, size = self.sub.text:GetFont()
		self.sub.text:SetFont(file, size or 12, "")
	end
	Ink(self.sub.text, self.ink)
	-- EllesmereUI's plain line in place of the spellbook's divider, where the divider stood.
	self.divider:SetAlpha(0)
	local line = self.frame:CreateTexture(nil, "ARTWORK")
	line:SetColorTexture(1, 1, 1, 0.25)
	line:SetHeight(Pixels(self.frame, 1))
	line:SetPoint("LEFT", self.divider, "LEFT", 6, 0)
	line:SetPoint("RIGHT", self.frame, "RIGHT", -self.right, 0)
	self.line = line
	local body = self.body
	if file then body:SetFace(face) end
	body:SetInk(self.ink[1], self.ink[2], self.ink[3])
	body:SetColor(self.ink[1], self.ink[2], self.ink[3])
	body:SetThumbColor(self.ink[1], self.ink[2], self.ink[3])
	body:SetHeadInk(LIGHT_TITLE[1], LIGHT_TITLE[2], LIGHT_TITLE[3])
	body:SetFadeColors(BackdropAt(skin, "TOP"), BackdropAt(skin, "BOTTOM"))
	body:SetCleanPictures(true, SpokenEnv and SpokenEnv.Ellesmere and SpokenEnv.Ellesmere.EDGE)
	skin.Button(self.contribute)
	-- White, as EllesmereUI writes the rest of the page.
	skin.WhiteButtonLabel(self.contribute)
end

--- The portrait of a place's page (`icon` of Page:Show): a dungeon's or a zone's picture, with the
--- world for a badge; the question mark where there is no picture yet. Made once for each place.
local placeIcons = {}
function C.PlaceIcon(mapID, dungeon)
	local at = tostring(mapID) .. ":" .. tostring(dungeon)
	if placeIcons[at] then return placeIcons[at] end
	local icon, crop
	if dungeon and Spoken and Spoken.DungeonIcon then
		icon, crop = Spoken:DungeonIcon(dungeon)
	elseif mapID and Spoken and Spoken.ZoneIcon then
		icon, crop = Spoken:ZoneIcon(mapID)
	end
	placeIcons[at] = { objectOrItem = true, icon = icon or UNKNOWN_ICON, iconCrop = icon and crop or nil, bullet = "zone" }
	return placeIcons[at]
end

--- The portrait of a page or a line whose picture does not exist yet: the question mark, with `bullet`'s badge.
function C.UnknownIcon(bullet)
	return { objectOrItem = true, icon = UNKNOWN_ICON, bullet = bullet }
end

function Page:PaintMark(shown)
	local mark = self.mark
	mark:SetShown(shown and true or false)
	if not shown then return end
	local atlas = MarkAtlas()
	if atlas then
		mark:SetAtlas(atlas, true)
		local width, height = mark:GetSize()
		local shrink = math.max(width, height) / MARK_MOST
		if shrink > 1 then mark:SetSize(width / shrink, height / shrink) end
		mark:SetVertexColor(1, 1, 1)
		mark:SetAlpha(MARK_ALPHA)
	else
		mark:SetTexture(LATTICE)
		mark:SetTexCoord(0, 1, 0, 1)
		mark:SetSize(LATTICE_SIZE, LATTICE_SIZE)
		mark:SetVertexColor(self.ink[1], self.ink[2], self.ink[3])
		mark:SetAlpha(LATTICE_ALPHA)
	end
end

--- A round button of the caller's on the heading's line, left of Report and Play, shown or hidden
--- by the caller: Open in Azeroth's Compendium on Spoken Places' page beside the map.
function Page:AddButton(button)
	table.insert(self.extra, button)
	button:HookScript("OnShow", function() self:RefreshPlay() end)
	button:HookScript("OnHide", function() self:RefreshPlay() end)
end

--- What a page nobody has written yet says.
function C.NotWritten()
	local words = SpokenEnv and SpokenEnv.L
	return words and words.COMPENDIUM_NOT_WRITTEN or "Nothing has been written for this yet."
end

--- Where Contribute goes for a page with nothing written and no way of its own: Spoken's
--- contribution page.
function C.ContributeGeneral()
	if _G.Spoken and Spoken.ShowContribution then
		Spoken:ShowContribution(Spoken.SITE_URL .. "/contribute", nil, true)
	end
end

function Page:RefreshContribute()
	local hidden = _G.Spoken and Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden()
	local can = _G.Spoken and Spoken.ShowContribution ~= nil
	self.contribute:SetShown(self.unwritten ~= nil and can and not hidden and true or false)
end

--- Report in the heading's corner where it has something to report, Play beside it on every page
--- that can have words (grey where there is no recording; none on an empty page), and the caller's
--- buttons after them; the title stops 10 short of the last shown.
function Page:RefreshPlay()
	local target = self.target
	local report, button = self.report, self.play
	if report then
		local hidden = _G.Spoken and Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden()
		report:SetShown(target ~= nil and not hidden and self.reporting.has(target) and true or false)
	end
	if button then
		local has = target ~= nil and self.playing.has(target) and true or false
		button:SetShown(not self.empty)
		if has then button:Enable() else button:Disable() end
		button.pageState = has and C.PlayState(self.playing.find(target)) or "play"
		if button.SetState then button:SetState(button.pageState) end
	end
	-- Level with the title's first line, from the scroll bar's right edge leftward, 4 apart. The bar
	-- stands at the view's right edge whether or not it shows, so the buttons stay put.
	local edge = self.right
	local previous
	-- Built without holes: a table with a nil first would stop ipairs before the others.
	local buttons = {}
	if report then buttons[#buttons + 1] = report end
	if button then buttons[#buttons + 1] = button end
	for _, extra in ipairs(self.extra) do buttons[#buttons + 1] = extra end
	for _, shown in ipairs(buttons) do
		if shown:IsShown() then
			shown:ClearAllPoints()
			if previous then
				shown:SetPoint("RIGHT", previous, "LEFT", -4, 0)
			else
				shown:SetPoint("TOPRIGHT", self.frame, "TOPRIGHT", -edge, -self.top - self.titleSize / 2 + 12)
			end
			previous = shown
		end
	end
	self.title:ClearAllPoints()
	self.title:SetPoint("TOPLEFT", self.frame, "TOPLEFT", PAD + self.shift, -self.top)
	self.title:SetPoint("RIGHT", previous or self.frame, previous and "LEFT" or "RIGHT", previous and -10 or -self.right, 0)
	self:PlaceDivider()
end

-- The divider at the page's edge, 10 under the line under the title or under the face, whichever
-- reaches lower: with no line under the title, or a title of one line, the face reaches past it.
function Page:PlaceDivider()
	local title = self.title.GetStringHeight and self.title:GetStringHeight()
	if not title or title <= 0 then title = self.titleSize end
	local under = self.top + title + 2 + (self.sub:GetHeight() or 0)
	local face = self.face and (self.top - 4 + FACE_SIZE) or 0
	self.divider:SetPoint("TOPLEFT", self.sub, "BOTTOMLEFT", -6 - self.shift, -(10 + math.max(0, face - under)))
end

--- entry = { title, subtitle, onSubtitle, text, target = what Play and Report act on, or nil for
--- none, icon = the round portrait left of the title (a Spoken:CreateSpeakerFace speaker table), the
--- Compendium's tome without it, picture = { file, mask } above the words, parts = { { heading, text, buttons } } in place
--- of `text`: words in parts, each under its heading with its own buttons (TextView:SetParts) }. With no text, parts, target or unwritten the page is a group's or a place's: no
--- Play, and its mark in the middle where it has no picture.
--- onSubtitle(), where given, is what a click on the line under the title does (the map panel's
--- area story returns to its zone's with it); without it the line is plain words.
function Page:Show(entry)
	if self.headFace == nil then
		local ok, made = false, nil
		if _G.Spoken and Spoken.CreateSpeakerFace then ok, made = pcall(Spoken.CreateSpeakerFace, Spoken, self.frame, FACE_SIZE) end
		self.headFace = ok and made or false
		if made and ok then made:SetPoint("TOPLEFT", self.frame, "TOPLEFT", PAD, -(self.top - 4)) end
	end
	local face = self.headFace or nil
	local icon = entry.icon or TOME
	-- Drawn again only for another picture: a page is shown again on every refresh.
	if face and icon ~= self.faceIcon then
		face:SetSpeaker(icon)
		self.faceIcon = icon
	end
	self.face = face
	self.shift = face and ((face:GetWidth() or 0) + FACE_GAP) or 0
	self.title:SetText(entry.title or "")
	self.sub.text:SetText(entry.subtitle or "")
	-- No line under the title takes no room: the divider closes up under it.
	self.sub:SetHeight((entry.subtitle and entry.subtitle ~= "") and 16 or 1)
	self.sub.onClick = entry.onSubtitle
	if entry.onSubtitle then self.sub:Enable() else self.sub:Disable() end
	Ink(self.sub.text, self.ink)
	-- Told to the view rather than painted on its text, which a re-wrap would repaint.
	self.body:SetColor(self.ink[1], self.ink[2], self.ink[3])
	local unwritten = entry.unwritten
	self.unwritten = (type(unwritten) == "function" and unwritten) or (unwritten and C.ContributeGeneral) or nil
	local contribute = self.contribute
	-- A page with nothing to read or play (no words, parts, target or Contribute) is a group's or a
	-- place's: its mark.
	local empty = entry.text == nil and entry.parts == nil and entry.target == nil and not entry.unwritten
	self.body.extraBelow = self.unwritten and 34 or 0
	if entry.parts and self.body.SetParts then
		self.body:SetParts(entry.parts)
	else
		contribute:ClearAllPoints()
		contribute:SetPoint("TOPLEFT", self.body.text, "BOTTOMLEFT", 0, -12)
		local picture = entry.picture
		self.body:SetPicture(picture and picture.file, picture and picture.mask)
		-- A page with nothing written says so in one voice on every tab, with Contribute under it.
		local words = entry.unwritten and C.NotWritten()
		self.body:SetText(words or entry.text or "")
	end
	self:PaintMark(empty and not entry.picture)
	self.empty = empty
	self.target = entry.target
	self:RefreshContribute()
	self:RefreshPlay()
end

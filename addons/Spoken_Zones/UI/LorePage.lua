-- SpokenZones -- the page a story is written on, shared by the lore window and the map panel.
--
-- Drawn with the game's own art: the spellbook's parchment and the quest log's details page, the
-- spellbook's divider and backplate, the quest log's frame. Copies of them ship in Textures/Art,
-- cut from the Forever client's files, so the page looks the same on every client: Era and
-- Anniversary have not got the spellbook's art, and a client that has it draws it its own way.
-- Other art is looked up first (C_Texture.GetAtlasInfo), and a client without it gets a plainer
-- piece in its place -- a missing atlas draws nothing at all, which is worse than plain.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local Art = {}
SpokenZones.Art = Art

--------------------------------------------------------------------------------
-- Art with a way out
--------------------------------------------------------------------------------

-- The copies: each in the corner of a power-of-two canvas, as old clients want, its coordinates
-- saying how much of it is the art. The spellbook's page is at its size on screen, half the
-- resolution of the client's, which is larger than an old client loads.
local ART = "Interface\\AddOns\\" .. ADDON_NAME .. "\\Textures\\Art\\"
-- `slice`, for a frame the game draws nine-sliced: how much of each side is corner, as a share of
-- the art (Art.NineSlice).
local function Copy(file, width, height, right, bottom, slice)
	return { file = ART .. file, width = width, height = height, slice = slice,
		leftTexCoord = 0, rightTexCoord = right, topTexCoord = 0, bottomTexCoord = bottom }
end
local COPIES = {
	["spellbook-Page-Right-C60"] = Copy("spellbook-Page-Right-C60", 810, 682, 0.791016, 0.666016),
	["QuestDetailsBackgrounds"] = Copy("QuestDetailsBackgrounds", 287, 464, 0.560547, 0.90625),
	["spellbook-list-backplate"] = Copy("spellbook-list-backplate", 316, 106, 0.617188, 0.828125),
	["spellbook-divider"] = Copy("spellbook-divider", 657, 11, 0.641602, 0.6875),
	["questlog-frame"] = Copy("questlog-frame", 107, 107, 0.835938, 0.835938, 56 / 214),
	["questlog-frame-filigree"] = Copy("questlog-frame-filigree", 48, 19, 0.75, 0.59375),
}
Art.COPIES = COPIES

--- What C_Texture.GetAtlasInfo says of `name`, or of the copy where there is one.
function Art.Info(name)
	if COPIES[name] then return COPIES[name] end
	return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) or nil
end

function Art.HasAtlas(name)
	return Art.Info(name) ~= nil
end

--- Paint `texture` with `atlas` and say so, or leave it alone and say not.
function Art.Atlas(texture, atlas, useAtlasSize)
	local copy = COPIES[atlas]
	if copy then
		texture:SetTexture(copy.file)
		texture:SetTexCoord(0, copy.rightTexCoord, 0, copy.bottomTexCoord)
		if useAtlasSize then
			texture:SetWidth(copy.width)
			texture:SetHeight(copy.height)
		end
		return true
	end
	if texture.SetAtlas and Art.HasAtlas(atlas) then
		texture:SetAtlas(atlas, useAtlasSize)
		return true
	end
	return false
end

--- A frame round `frame`, drawn as the game draws a nine-sliced atlas: the corners at their own
--- size, the edges stretched between them and the middle across the rest. Stretched whole, the
--- corners grew with the frame. Returns the nine pieces, corners first.
function Art.NineSlice(frame, atlas, layer, sublevel)
	local copy = COPIES[atlas]
	local m = copy.slice
	local u = { 0, copy.rightTexCoord * m, copy.rightTexCoord * (1 - m), copy.rightTexCoord }
	local v = { 0, copy.bottomTexCoord * m, copy.bottomTexCoord * (1 - m), copy.bottomTexCoord }
	local w, h = math.floor(copy.width * m + 0.5), math.floor(copy.height * m + 0.5)
	local grid = {}
	for row = 1, 3 do
		grid[row] = {}
		for col = 1, 3 do
			local piece = frame:CreateTexture(nil, layer, nil, sublevel)
			piece:SetTexture(copy.file)
			piece:SetTexCoord(u[col], u[col + 1], v[row], v[row + 1])
			grid[row][col] = piece
		end
	end
	local tl, tr, bl, br = grid[1][1], grid[1][3], grid[3][1], grid[3][3]
	for _, corner in ipairs({ tl, tr, bl, br }) do
		corner:SetWidth(w)
		corner:SetHeight(h)
	end
	tl:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 0)
	tr:SetPoint("TOPRIGHT", frame, "TOPRIGHT", 0, 0)
	bl:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 0, 0)
	br:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", 0, 0)
	local function Between(piece, topLeft, topLeftPoint, bottomRight, bottomRightPoint)
		piece:SetPoint("TOPLEFT", topLeft, topLeftPoint, 0, 0)
		piece:SetPoint("BOTTOMRIGHT", bottomRight, bottomRightPoint, 0, 0)
	end
	Between(grid[1][2], tl, "TOPRIGHT", tr, "BOTTOMLEFT")
	Between(grid[3][2], bl, "TOPRIGHT", br, "BOTTOMLEFT")
	Between(grid[2][1], tl, "BOTTOMLEFT", bl, "TOPRIGHT")
	Between(grid[2][3], tr, "BOTTOMLEFT", br, "TOPRIGHT")
	Between(grid[2][2], tl, "BOTTOMRIGHT", br, "TOPLEFT")
	return { tl, tr, bl, br, grid[1][2], grid[3][2], grid[2][1], grid[2][3], grid[2][2] }
end

function Art.Font(name, fallback)
	return _G[name] and name or fallback
end

local function RGB(color, r, g, b)
	if color and color.GetRGB then return color:GetRGB() end
	return r, g, b
end

-- The spellbook's ink: its headings and its words, dark brown on the parchment.
Art.INK = { RGB(_G.SPELLBOOK_FONT_COLOR, 0.25, 0.16, 0.08) }
-- A link a little redder. Every word is in the ink: a lighter one for captions and for a place
-- with no story read as greyed out, and was hard to make out on the parchment.
Art.LINK = { 0.5, 0.12, 0.04 }

local function Ink(fontString, color, alpha)
	color = color or Art.INK
	fontString:SetTextColor(color[1], color[2], color[3], alpha or 1)
	-- Ink has no shadow: a black one smudges it on parchment.
	fontString:SetShadowColor(0, 0, 0, 0)
end
Art.Ink = Ink

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

local PAD = 24
-- The page's parchment: the spellbook's in the lore window, the quest log's beside the map.
local BOOK_PAGE = "spellbook-Page-Right-C60"
local LOG_PAGE = "QuestDetailsBackgrounds"
-- How far the heading sits from the page's top and its right edge, per art. The spellbook's
-- parchment has a torn edge on its right and top that eats into the page, so its content sits
-- further in there, to look as far from those edges as the title does from the left.
local INSET = { book = { top = 36, right = 36 }, log = { top = 28, right = 28 } }
-- The spellbook's page art leaves a band along its top, made to sit under the spellbook's own
-- top bar: this much of its height, cut off so the parchment starts at the page's top.
local BOOK_TOP_BAND = 0.07
-- How much of the header's backplate lies left of the page, cut off.
local BACKPLATE_CUT = 40

local Page = {}
Page.__index = Page

--- A page of parchment filling `parent`, with a heading -- Play and Report on its right, as
--- the quest log has its buttons -- the line under it that says where the place is (or leads
--- back to its zone), the divider, and the story in ink. `style` picks the art: "book" for the lore window (the spellbook's page), "log"
--- for the panel beside the map (the quest log's details page, as the quest beside it has).
function SpokenZones:CreateLorePage(parent, style)
	local page = setmetatable({ style = style }, Page)
	local inset = INSET[style] or INSET.log
	local frame = CreateFrame("Frame", nil, parent)
	frame:SetAllPoints()
	page.frame = frame

	-- Drawn from the copy's file and coordinates, so the text's fade can be cut from the same
	-- picture (TextView:SetFadeSource). The book's top band is cut off, inside the page, rather than
	-- drawn above it: the band is not empty, and above the page it showed over the window's title bar.
	local bg = frame:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	local parchment = style == "book" and BOOK_PAGE or LOG_PAGE
	local info = COPIES[parchment]
	local top = info.topTexCoord
	if parchment == BOOK_PAGE then top = top + (info.bottomTexCoord - top) * BOOK_TOP_BAND end
	page.parchment, page.bg = parchment, bg
	page.bgFile = info.file
	page.bgCoords = { info.leftTexCoord, info.rightTexCoord, top, info.bottomTexCoord }
	bg:SetTexture(info.file)
	bg:SetTexCoord(info.leftTexCoord, info.rightTexCoord, top, info.bottomTexCoord)
	SpokenZones:Unsnap(bg)

	-- A spellbook header's backplate behind the title, faint, as the spellbook lays one behind
	-- each of its headings. Laid out as if it started BACKPLATE_CUT left of the page, and cut there
	-- and at the page's right edge rather than drawn past them: past the left it showed over the
	-- window's list and over the map's border beside the panel.
	do
		local plate = COPIES["spellbook-list-backplate"]
		local full = style == "book" and 460 or 300
		local backplate = frame:CreateTexture(nil, "BORDER")
		backplate:SetTexture(plate.file)
		backplate:SetHeight(style == "book" and 110 or 80)
		backplate:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 28 - inset.top)
		backplate:SetAlpha(0.55)
		local function Fit()
			local room = frame:GetWidth() or 0
			local shown = full - BACKPLATE_CUT
			if room > 0 then shown = math.min(shown, room) end
			backplate:SetWidth(shown)
			local u = plate.rightTexCoord - plate.leftTexCoord
			backplate:SetTexCoord(plate.leftTexCoord + u * BACKPLATE_CUT / full,
				plate.leftTexCoord + u * (BACKPLATE_CUT + shown) / full, plate.topTexCoord, plate.bottomTexCoord)
		end
		frame:HookScript("OnSizeChanged", Fit)
		Fit()
		page.backplate = backplate
	end

	-- Play and Report on the header's right, level with the title, as the quest log has them: two
	-- of the subtitle's round buttons, Report the game's bug in the corner, Play beside it.
	-- Centred on the title's first line.
	local titleSize = style == "book" and 26 or 20
	local report = SpokenZones:CreateReportIcon(frame)
	report:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -inset.right, -inset.top - titleSize / 2 + 12)
	-- Where the first shown button goes (Page:PlaceButtons).
	report.layoutX, report.layoutY = -inset.right, -inset.top - titleSize / 2 + 12
	page.inset = inset
	page.report = report
	local play = SpokenZones:CreateAudioButton(frame)
	page.play = play

	-- Beside the map, a third: this place in Azeroth's Compendium, with the window's own tome in the
	-- same ring. The window has it open already, so not there.
	if style ~= "book" then
		local icon = SpokenCompendium and SpokenCompendium.ICON or [[Interface\Icons\INV_Misc_Book_11]]
		local open = SpokenZones:CreateRoundButton(frame, "icon", icon)
		-- The tome is a dark picture already: the ring's vignette at full strength left it black.
		if type(open.vignette) == "table" and open.vignette.SetAlpha then open.vignette:SetAlpha(0.35) end
		open:SetScript("OnClick", function(self)
			if self.mapID then SpokenZones:ShowLoreFor(self.mapID, self.areaKey) end
		end)
		open:HookScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_LEFT")
			GameTooltip:SetText(L.OPEN_IN_COMPENDIUM)
			GameTooltip:AddLine(L.OPEN_IN_LORE_TIP, 1, 0.8, 0.2, true)
			GameTooltip:Show()
		end)
		open:HookScript("OnLeave", function() GameTooltip:Hide() end)
		open:Hide()
		page.open = open
	end

	for _, button in ipairs({ report, play, page.open }) do
		button:HookScript("OnShow", function() page:PlaceButtons() end)
		button:HookScript("OnHide", function() page:PlaceButtons() end)
	end

	-- The quest log's title face, as a quest's name is written on its page: larger on the book's.
	local title = frame:CreateFontString(nil, "ARTWORK", Art.Font("QuestTitleFont", "GameFontNormalLarge"))
	local face = _G.QuestTitleFont and _G.QuestTitleFont.GetFont and _G.QuestTitleFont:GetFont()
	if face then title:SetFont(face, titleSize, "") end
	title:SetPoint("TOPLEFT", frame, "TOPLEFT", PAD, -inset.top)
	title:SetJustifyH("LEFT")
	-- One line on the map's narrow panel, cut short with an ellipsis where the name is longer;
	-- the window has room to wrap.
	title:SetWordWrap(style == "book")
	if style ~= "book" and title.SetMaxLines then title:SetMaxLines(1) end
	Ink(title)
	page.title = title

	-- Where the place is, or a way back to its zone: one line, always there, so nothing below it
	-- moves as it changes.
	local sub = CreateFrame("Button", nil, frame)
	sub:SetHeight(16)
	sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)
	sub:SetPoint("RIGHT", frame, "RIGHT", -inset.right, 0)
	sub.text = sub:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	sub.text:SetAllPoints()
	sub.text:SetJustifyH("LEFT")
	sub:SetScript("OnClick", function(self) if self.onClick then self.onClick() end end)
	sub:SetScript("OnEnter", function(self) if self.onClick then Ink(self.text, Art.LINK) end end)
	sub:SetScript("OnLeave", function(self) page:PaintSubtitle() end)
	page.sub = sub

	-- The spellbook's divider under the heading: a flourish on its left and a rule running right.
	-- Where the page is narrower than the art, the rule is cut short rather than the whole of it
	-- squeezed, which flattened the flourish on the map's panel; where it is wider, the rule stops
	-- at the art's own end rather than being stretched to the page's.
	local divider = frame:CreateTexture(nil, "ARTWORK")
	divider:SetHeight(11)
	divider:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", -6, -10)
	do
		local rule = COPIES["spellbook-divider"]
		divider:SetTexture(rule.file)
		divider:SetHeight(rule.height)
		-- From the divider's left (the title's, less 6) to the page's right inset.
		local left = PAD - 6
		local function Fit()
			local room = (frame:GetWidth() or 0) - left - inset.right
			if room <= 0 then return end
			local width = math.min(room, rule.width)
			divider:SetWidth(width)
			local shown = width / rule.width
			divider:SetTexCoord(rule.leftTexCoord, rule.leftTexCoord + (rule.rightTexCoord - rule.leftTexCoord) * shown,
				rule.topTexCoord, rule.bottomTexCoord)
		end
		page.FitDivider = Fit
		frame:HookScript("OnSizeChanged", Fit)
		Fit()
	end
	page.divider = divider

	local body = SpokenZones:CreateTextView(frame)
	body.frame:SetPoint("TOPLEFT", divider, "BOTTOMLEFT", 6, -2)
	body.frame:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -inset.right, PAD - 6)
	body:SetInk(Art.INK[1], Art.INK[2], Art.INK[3])
	body:SetThumbColor(Art.INK[1], Art.INK[2], Art.INK[3])
	-- Text cut off at an edge fades into the parchment under it.
	body:SetFadeSource(frame, page.bgFile, page.bgCoords)
	page.body = body

	-- Under the sentence that says a place has no story yet, so it reads as the answer to it.
	local contribute = SpokenZones:CreateContributeButton(body.child)
	contribute:SetPoint("TOPLEFT", body.text, "BOTTOMLEFT", 0, -12)
	page.contribute = contribute

	-- With nothing chosen: the place's map, faint, behind a line saying what to do.
	if style == "book" then
		local mark = frame:CreateTexture(nil, "BORDER")
		mark:SetSize(96, 96)
		mark:SetPoint("CENTER", frame, "CENTER", 0, 40)
		mark:SetTexture([[Interface\Icons\INV_Misc_Map02]])
		mark:SetTexCoord(0.08, 0.92, 0.08, 0.92)
		if mark.SetDesaturated then mark:SetDesaturated(true) end
		mark:SetAlpha(0.18)
		mark:Hide()
		page.mark = mark
	end
	return page
end

--- The header's round buttons in a row from the right, 4 apart, only those shown: a hidden one
--- leaves no gap. The title stops 10 short of the last of them.
function Page:PlaceButtons()
	local corner = self.report
	local x, y = corner.layoutX, corner.layoutY
	local previous
	for _, button in ipairs({ self.report, self.play, self.open }) do
		if button and button:IsShown() then
			button:ClearAllPoints()
			if previous then
				button:SetPoint("RIGHT", previous, "LEFT", -4, 0)
			else
				button:SetPoint("TOPRIGHT", self.frame, "TOPRIGHT", x, y)
			end
			previous = button
		end
	end
	self.title:ClearAllPoints()
	self.title:SetPoint("TOPLEFT", self.frame, "TOPLEFT", PAD, -self.inset.top)
	if previous then
		self.title:SetPoint("RIGHT", previous, "LEFT", -10, 0)
	else
		self.title:SetPoint("RIGHT", self.frame, "RIGHT", -self.inset.right, 0)
	end
end

function Page:PaintSubtitle()
	Ink(self.sub.text, Art.INK)
end

--- What the page shows: entry = { title, subtitle, onSubtitle = fn?, text, missing = bool,
--- audio = { mapID, key }?, report = { mapID, key }?, contribute = { mapID, subzone }?,
--- empty = bool }. A missing story is said with Contribute under it.
function Page:Show(entry)
	self.title:SetText(entry.title or "")
	self.sub.text:SetText(entry.subtitle or "")
	-- No line under the title takes no room: the divider closes up under it.
	self.sub:SetHeight((entry.subtitle and entry.subtitle ~= "") and 16 or 1)
	self.sub.onClick = entry.onSubtitle
	if entry.onSubtitle then self.sub:Enable() else self.sub:Disable() end
	self:PaintSubtitle()

	-- Told to the view rather than painted on its text, which a re-wrap would repaint.
	self.body:SetColor(Art.INK[1], Art.INK[2], Art.INK[3])
	local picture, mask
	if entry.audio then picture, mask = SpokenZones:Picture(entry.audio[1], entry.audio[2]) end
	self.body:SetPicture(picture, mask)
	self.body:SetText(entry.text or "")

	local audio, report, contribute = entry.audio, entry.report, entry.contribute
	self.play:SetTarget(audio and audio[1], audio and audio[2])
	self.report:SetTarget(report and report[1], report and report[2])
	self.contribute:SetTarget(contribute and contribute[1], contribute and contribute[2])
	if self.open then
		local lore = entry.lore
		self.open.mapID, self.open.areaKey = lore and lore[1], lore and lore[2]
		if lore and lore[1] then self.open:Show() else self.open:Hide() end
	end
	self:PlaceButtons()
	if self.mark then self.mark:SetShown(entry.empty and true or false) end
	self.divider:SetShown(not entry.empty)
	if self.backplate then self.backplate:SetShown(not entry.empty) end
end

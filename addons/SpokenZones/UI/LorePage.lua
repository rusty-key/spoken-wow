-- SpokenZones -- the page a story is written on, shared by the lore window and the map panel.
--
-- Drawn with the game's own art where the client has it: the spellbook's parchment and the
-- quest log's details page, the spellbook's divider and heading colour, and the game's buttons.
-- Every atlas is looked up first (C_Texture.GetAtlasInfo), and a client without one gets the
-- plain look this replaced -- a missing atlas draws nothing at all, which is worse than plain.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local Art = {}
SpokenZones.Art = Art

--------------------------------------------------------------------------------
-- Art with a way out
--------------------------------------------------------------------------------

function Art.HasAtlas(name)
	return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) ~= nil or false
end

--- Paint `texture` with `atlas` and say so, or leave it alone and say not.
function Art.Atlas(texture, atlas, useAtlasSize)
	if texture.SetAtlas and Art.HasAtlas(atlas) then
		texture:SetAtlas(atlas, useAtlasSize)
		return true
	end
	return false
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
-- A caption a little lighter than the ink, and a link a little redder.
Art.FADED = { Art.INK[1] + 0.18, Art.INK[2] + 0.14, Art.INK[3] + 0.1 }
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

	local bg = frame:CreateTexture(nil, "BACKGROUND")
	local parchment = style == "book" and "spellbook-Page-Right-C60" or "QuestDetailsBackgrounds"
	page.onParchment = Art.Atlas(bg, parchment, false)
	bg:SetAllPoints()
	if page.onParchment then
		-- Drawn from the atlas's file and coordinates, so the text's fade can be cut from the same
		-- picture (TextView:SetFadeSource). The book's top band is cut off, inside the page, rather
		-- than drawn above it: the band is not empty, and above the page it showed over the
		-- window's title bar.
		local info = C_Texture.GetAtlasInfo(parchment)
		if info and info.file and info.topTexCoord then
			local top = info.topTexCoord
			if style == "book" then top = top + (info.bottomTexCoord - top) * BOOK_TOP_BAND end
			page.bgFile = info.file
			page.bgCoords = { info.leftTexCoord, info.rightTexCoord, top, info.bottomTexCoord }
			bg:SetTexture(info.file)
			bg:SetTexCoord(info.leftTexCoord, info.rightTexCoord, top, info.bottomTexCoord)
			SpokenZones:Unsnap(bg)
		end
	end
	if not page.onParchment then
		bg:SetColorTexture(0, 0, 0, 0)
	end

	-- Ink on the parchment; light text where the client has not got it, the page then being
	-- see-through over the frame's own dark background.
	local function Words(fontString, color, alpha)
		if page.onParchment then
			Ink(fontString, color, alpha)
		else
			fontString:SetTextColor(1, 1, 1, alpha or 1)
		end
	end
	page.Words = Words

	-- A spellbook header's backplate behind the title, faint, as the spellbook lays one behind
	-- each of its headings. Laid out as if it started BACKPLATE_CUT left of the page, and cut there
	-- and at the page's right edge rather than drawn past them: past the left it showed over the
	-- window's list and over the map's border beside the panel.
	local plate = page.onParchment and Art.HasAtlas("spellbook-list-backplate")
		and C_Texture.GetAtlasInfo("spellbook-list-backplate")
	if plate and plate.file and plate.leftTexCoord then
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

	-- Beside the map, a third: this place in Lore of Azeroth, with the window's own map icon in
	-- the same ring. The window has it open already, so not there.
	if style ~= "book" then
		local open = SpokenZones:CreateRoundButton(frame, "icon", [[Interface\Icons\INV_Misc_Map_01]])
		open:SetScript("OnClick", function(self)
			if self.mapID then SpokenZones:ShowLoreFor(self.mapID, self.areaKey) end
		end)
		open:HookScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_LEFT")
			GameTooltip:SetText(L.MENU_LORE_WINDOW)
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
	if page.onParchment then Ink(title) else title:SetTextColor(1, 0.82, 0) end
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
	sub:SetScript("OnEnter", function(self) if self.onClick then Words(self.text, Art.INK) end end)
	sub:SetScript("OnLeave", function(self) page:PaintSubtitle() end)
	page.sub = sub

	-- The spellbook's divider under the heading: a flourish on its left and a rule running right.
	-- Where the page is narrower than the art, the rule is cut short rather than the whole of it
	-- squeezed, which flattened the flourish on the map's panel; where it is wider, the rule stops
	-- at the art's own end rather than being stretched to the page's.
	local divider = frame:CreateTexture(nil, "ARTWORK")
	divider:SetHeight(11)
	divider:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", -6, -10)
	local rule = Art.HasAtlas("spellbook-divider") and C_Texture.GetAtlasInfo("spellbook-divider")
	if rule and rule.file and rule.width and rule.width > 0 then
		divider:SetTexture(rule.file)
		divider:SetHeight(rule.height or 11)
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
	else
		divider:SetPoint("RIGHT", frame, "RIGHT", -inset.right, 0)
		if not Art.Atlas(divider, "spellbook-divider", false) then
			divider:SetColorTexture(1, 0.82, 0, 0.25)
			divider:SetHeight(1)
		end
	end
	page.divider = divider

	local body = SpokenZones:CreateTextView(frame)
	body.frame:SetPoint("TOPLEFT", divider, "BOTTOMLEFT", 6, -2)
	body.frame:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -inset.right, PAD - 6)
	if page.onParchment then
		body:SetInk(Art.INK[1], Art.INK[2], Art.INK[3])
		body:SetThumbColor(Art.INK[1], Art.INK[2], Art.INK[3])
	end
	-- Text cut off at an edge fades into the parchment under it. Without the parchment's file the
	-- page is see-through, and there is nothing to fade into: the text is cut on a clean line.
	if page.bgFile then
		body:SetFadeSource(frame, page.bgFile, page.bgCoords)
	end
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
		mark:SetTexture([[Interface\Icons\INV_Misc_Map_01]])
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
	self.Words(self.sub.text, Art.FADED)
end

--- What the page shows: entry = { title, subtitle, onSubtitle = fn?, text, missing = bool,
--- audio = { mapID, key }?, report = { mapID, key }?, contribute = { mapID, subzone }?,
--- empty = bool }. A missing story is said in the faded ink, with Contribute under it.
function Page:Show(entry)
	self.title:SetText(entry.title or "")
	self.sub.text:SetText(entry.subtitle or "")
	-- No line under the title takes no room: the divider closes up under it.
	self.sub:SetHeight((entry.subtitle and entry.subtitle ~= "") and 16 or 1)
	self.sub.onClick = entry.onSubtitle
	if entry.onSubtitle then self.sub:Enable() else self.sub:Disable() end
	self:PaintSubtitle()

	-- Told to the view rather than painted on its text, which a re-wrap would repaint in full ink.
	local color
	if entry.missing or entry.empty then
		color = self.onParchment and Art.FADED or { 0.55, 0.55, 0.55 }
	else
		color = self.onParchment and Art.INK or { 1, 1, 1 }
	end
	self.body:SetColor(color[1], color[2], color[3])
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

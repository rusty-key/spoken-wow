-- SpokenZones -- the page a story is written on, shared by the lore window and the map panel:
-- Azeroth's Compendium's page (SpokenCompendium.NewPage), with its Play, Report and layout, on the
-- spellbook's parchment in the window and the quest log's beside the map.
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

-- The page's parchment: the spellbook's in the lore window, the quest log's beside the map.
local BOOK_PAGE = "spellbook-Page-Right-C60"
local LOG_PAGE = "QuestDetailsBackgrounds"
-- The spellbook's page art leaves a band along its top, made to sit under the spellbook's own
-- top bar: this much of its height, cut off so the parchment starts at the page's top.
local BOOK_TOP_BAND = 0.07
-- Beside the map: the quest log's page, its heading nearer the narrower page's top and right edge,
-- smaller and on one line, under a shorter backplate.
local LOG_LOOK = { top = 28, right = 28, titleSize = 20, oneLine = true, backplate = { full = 300, height = 80 } }

-- What Play does on a story's page: the story `target` ({ mapID, key }) where a pack reads it, Stop
-- while it is read and Replay once stopped, as every Play of the Compendium's (SpokenCompendium.PlayState).
local PLAY = {
	has = function(target) return SpokenZones:IsVoiceEnabled() and SpokenZones:HasAudio(target[1], target[2]) end,
	find = function(target) return SpokenZones:LoreClip(target[1], target[2]) end,
	start = function(target) SpokenZones:PlayLore(target[1], target[2]) end,
	tip = L.AUDIO_READ_TIP,
}

-- What Report does: every story, voiced or not. Lore text can be wrong whether or not anyone has
-- read it aloud, and a report on a line with no voiceover is one of the more useful kinds.
local REPORT = {
	has = function() return true end,
	open = function(target)
		SpokenZones:ShowReport(target[1], target[2])
	end,
	title = L.OPT_REPORT_PROBLEM,
	tip = L.OPT_REPORT_LINE_TIP,
}

-- The Compendium's page inside, its parts (title, sub, body, play, report, frame) read through.
local Page = {}
Page.__index = function(page, key) return Page[key] or page.page[key] end

function Page:RefreshPlay()
	self.page:RefreshPlay()
end

--- A story's page filling `parent`: Azeroth's Compendium's page (SpokenCompendium.NewPage), in the
--- lore's font, with Play and Report on its heading's right, the line under the title that says
--- where the place is (or leads back to its zone), the divider, the place's picture and its story.
--- `style` picks the art: "book" for the lore window (the spellbook's page), "log" for the panel
--- beside the map (the quest log's details page, as the quest beside it has), which also has Open in
--- Azeroth's Compendium. A missing story is said with Contribute under it.
function SpokenZones:CreateLorePage(parent, style)
	local parchment = style == "book" and BOOK_PAGE or LOG_PAGE
	local info = COPIES[parchment]
	local top = info.topTexCoord
	if parchment == BOOK_PAGE then top = top + (info.bottomTexCoord - top) * BOOK_TOP_BAND end
	local look = {}
	if style ~= "book" then
		for key, value in pairs(LOG_LOOK) do look[key] = value end
	end
	look.art = { file = info.file, coords = { info.leftTexCoord, info.rightTexCoord, top, info.bottomTexCoord } }
	local inner = SpokenCompendium.NewPage(parent, SpokenZones, PLAY, REPORT, look)
	local page = setmetatable({ page = inner, style = style, parchment = parchment }, Page)
	SpokenZones:OnAudioChanged(function() inner:RefreshPlay() end)

	-- Beside the map, a third: this place in Azeroth's Compendium, with the window's own tome in the
	-- same ring. The window has it open already, so not there.
	if style ~= "book" and _G.Spoken and Spoken.CreateRoundButton then
		local open = Spoken:CreateRoundButton(inner.frame, "icon", nil, SpokenCompendium.ICON)
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
		inner:AddButton(open)
		page.open = open
	end

	return page
end

--- What the page shows: entry = { title, subtitle, onSubtitle = fn?, text,
--- audio = { mapID, key }?, report = { mapID, key }?, contribute = { mapID, subzone }?,
--- lore = { mapID, key }? }: Play for `audio`, Report for `report`, its picture above the words, a
--- missing story's Contribute, and beside the map Open for `lore`.
function Page:Show(entry)
	local story = entry.audio or entry.report
	local picture, mask
	if story then picture, mask = SpokenZones:Picture(story[1], story[2]) end
	local contribute = entry.contribute
	self.page:Show({ title = entry.title, subtitle = entry.subtitle, onSubtitle = entry.onSubtitle, text = entry.text,
		target = story, picture = picture and { file = picture, mask = mask } or nil, icon = entry.icon,
		unwritten = contribute and function()
			if SpokenZones:CanContribute() then SpokenZones:ShowContribution(contribute[1], contribute[2]) end
		end or nil })
	if self.open then
		local lore = entry.lore
		self.open.mapID, self.open.areaKey = lore and lore[1], lore and lore[2]
		self.open:SetShown(lore ~= nil and lore[1] ~= nil)
	end
end

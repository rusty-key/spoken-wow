-- SpokenPlaces -- the story docked to the side of the world map, drawn as the quest log is.
--
-- Shows lore for the zone the map is displaying, or for a subzone the player
-- clicked (see UI/SubzoneClick.lua), with a link back to the zone.
--
-- Also the home for the contribute button (UI/ContributeButton.lua's CreateContributeButton), in the
-- body under the sentence that says a place has no lore yet, pointed at the place this panel is
-- showing -- not where the player stands, since every place is known and what is missing is a
-- description someone can write from anywhere.

local _, SpokenPlaces = ...
local L = SpokenPlaces.L

local Art = SpokenPlaces.Art

local panel, page, toggle

-- What the map's alpha is at when the player stands still. The fader's last step may stop a hair
-- short of 1.
local CLEAR = 0.99

-- The gamepad UI, Forever's InputDeviceInterfaceStyle 1.
local function IsGamepadUI()
	return GetCVar("InputDeviceInterfaceStyle") == "1"
end

-- Inside the map, unless the gamepad UI is on (NewPanel).
local function Host()
	if IsGamepadUI() then return UIParent end
	return WorldMapFrame
end

-- Leatrix Maps' simple map frame draws its own title bar and gold border round the map and the quest
-- log, and hides the game's: the game's border frame then lies beyond what is drawn. The title bar
-- is 22 high and its black frame lies 1 outside the map; the gold border reaches 5 past that.
local LEATRIX_TITLE, LEATRIX_FRAME, LEATRIX_BORDER = 22, 1, 5

local VERSION = SpokenEnv.Version

local function IsEra()
	return VERSION.Variant == "era" or VERSION.Variant == "sod"
end

local function LeatrixFrame()
	local db = _G.LeaMapsDB
	-- Spoken's environment has IsAddOnLoaded on every client; the game's own global is gone.
	return type(db) == "table" and db.SimpleMapFrame ~= "Off"
		and SpokenEnv.IsAddOnLoaded("Leatrix_Maps")
end

local edge
-- Lay the edge frame over what Leatrix draws, as it lays it out: the map, and the quest log's width
-- while that is shown.
local function FitLeatrixEdge()
	if not edge then return end
	local questWidth = 0
	if QuestMapFrame and QuestMapFrame:IsShown() then questWidth = WorldMapFrame.questLogWidth or 0 end
	local map = WorldMapFrame.ScrollContainer
	edge:ClearAllPoints()
	local out = LEATRIX_FRAME + LEATRIX_BORDER
	edge:SetPoint("TOPLEFT", map, "TOPLEFT", -out, LEATRIX_TITLE + LEATRIX_FRAME)
	edge:SetPoint("BOTTOMRIGHT", map, "BOTTOMRIGHT", questWidth + out, -out)
end

local function IsShown(frame)
	return type(frame) == "table" and frame.IsShown and frame:IsShown()
end

-- The frame the player sees as the map: the game's border frame, or where Leatrix Maps' simple frame
-- is on, the frame it draws. The panel and its button hang off it, so they stay against the visible
-- edge.
local function MapEdge()
	if LeatrixFrame() then
		if not edge then
			edge = CreateFrame("Frame", nil, WorldMapFrame)
			if QuestMapFrame then
				QuestMapFrame:HookScript("OnShow", FitLeatrixEdge)
				QuestMapFrame:HookScript("OnHide", FitLeatrixEdge)
			end
		end
		FitLeatrixEdge()
		return edge
	end
	-- Era's windowed map uses MiniBorderFrame; BorderFrame belongs to the other map size and may be
	-- hidden.
	local mini, border = WorldMapFrame.MiniBorderFrame, WorldMapFrame.BorderFrame
	if IsShown(border) and not IsShown(mini) then return border end
	if type(mini) == "table" and mini.SetPoint then return mini end
	if type(border) == "table" and border.SetPoint then return border end
	return WorldMapFrame
end

-- Space between the map's frame and the panel's: a small gap, so the two read as neighbours
-- rather than one frame.
local GAP = 2
-- Era's default border has 12 of clear space on its right: step back over it, so the visible gap is
-- GAP.
local ERA_BORDER_CLEAR = 12

-- The action slot border's opening is 36/66 of its image, so the icon fills it at about
-- BORDER_SIZE * 36 / 66; larger, the border overlaps the icon's edge, smaller leaves a gap.
local ICON_SIZE = 40
local BORDER_SIZE = 74
-- How far the button's left edge tucks under the map's frame, so it reads as attached to it.
local TOGGLE_TUCK = 2
-- Zone Lore's map, so the button reads as the way back to it.
local TOGGLE_ICON = [[Interface\Icons\INV_Misc_Map02]]
-- Where the side tab sits down the map's right edge, as the character frame's first one does.
local SIDE_TAB_TOP = 30
-- Space between side tabs stacked down an edge, as the game and Adventure Guide Forever leave.
local TAB_GAP = 3
-- Where the button sits against the map's edge when no other side tab is there, and its tuck under
-- one when there is (BuildToggle).
local toggleX, toggleY

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- A panel of its own beside the map, as the game draws one: the border, title bar and close
-- button of DefaultPanelFlatTemplate, the family the Map & Quest Log frame belongs to. Inside it
-- the quest log's frame and the filigree on its top edge, round the quest details' parchment
-- (UI/LorePage.lua). The old dark dialog box where the client has not got the template.
--
-- The panel and its button are the map's children, so they fade, scale and hide with it -- except
-- under the gamepad UI (Host). There the Forever client takes every button inside the open map
-- into the map's own navigation, and an addon's buttons there taint it: closing the map with the
-- gamepad is then blocked, and the "blocked from an action" dialog that raises hangs the client.
-- Under it they are UIParent's, anchored to the map and shown, hidden, layered, scaled and faded
-- with it here. Once the client stops tainting a map with an addon's buttons in it (check on a
-- newer build), Host can always answer the map.
local function NewPanel()
	local ok, frame = pcall(CreateFrame, "Frame", "SpokenPlacesPanel", UIParent, "DefaultPanelFlatTemplate")
	if ok and frame and frame.SetTitle then
		frame:SetTitle(L.LORE_PANEL_TITLE)
		frame.templated = true
		return frame
	end
	frame = CreateFrame("Frame", "SpokenPlacesPanel", UIParent, "BackdropTemplate")
	if frame.SetBackdrop then
		frame:SetBackdrop({
			bgFile = [[Interface\DialogFrame\UI-DialogBox-Background-Dark]],
			edgeFile = [[Interface\DialogFrame\UI-DialogBox-Border]],
			tile = true, tileSize = 32, edgeSize = 32,
			insets = { left = 11, right = 12, top = 12, bottom = 11 },
		})
	end
	return frame
end

local function BuildPanel()
	local width = SpokenPlaces:Get("panelWidth")

	panel = NewPanel()
	panel:SetWidth(width)
	panel:EnableMouse(true)

	-- Closed, it stays closed until the button on the map's edge reopens it; the setting turns it
	-- off for good.
	local close = CreateFrame("Button", nil, panel, panel.templated and "UIPanelCloseButtonDefaultAnchors"
		or "UIPanelCloseButton")
	if not panel.templated then close:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -8, -8) end
	close:SetScript("OnClick", function()
		SpokenPlaces:SetMapPanelCollapsed(true)
	end)
	panel.close = close

	-- The page inside the panel's border, under its title bar.
	local holder = CreateFrame("Frame", nil, panel)
	if panel.templated then
		holder:SetPoint("TOPLEFT", panel, "TOPLEFT", 7, -25)
		holder:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -5, 6)
	else
		holder:SetPoint("TOPLEFT", panel, "TOPLEFT", 12, -32)
		holder:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -12, 12)
	end
	page = SpokenPlaces:CreateLorePage(holder, "log")
	panel.page = page

	-- The rim on a frame of its own above the page: drawn on the panel itself it would sit under
	-- the page, which, being a child, is drawn over everything its parent draws.
	-- Out past the page by as much as the frame's art is clear at its edge -- 2 at the sides, 3 at
	-- the top and bottom -- so its solid edge lies on the parchment's, and none shows past it.
	local rim = CreateFrame("Frame", nil, holder)
	rim:SetPoint("TOPLEFT", holder, "TOPLEFT", -2, 3)
	rim:SetPoint("BOTTOMRIGHT", holder, "BOTTOMRIGHT", 2, -3)
	rim:SetFrameLevel(holder:GetFrameLevel() + 12)
	rim.border = Art.NineSlice(rim, "questlog-frame", "OVERLAY")
	local filigree = rim:CreateTexture(nil, "OVERLAY", nil, 1)
	Art.Atlas(filigree, "questlog-frame-filigree", true)
	filigree:SetPoint("TOP", rim, "TOP", 0, 1)
	rim.filigree = filigree
	panel.rim = rim
	-- In EllesmereUI's look, as it draws the map beside it: its shell, and no quest log frame round
	-- the page.
	if SpokenCompendium and SpokenCompendium.Ellesmere then
		SpokenCompendium.Ellesmere(function(skin)
			skin.Shell(panel)
			skin.CloseButton(close)
			SpokenCompendium.EllesmereTitle(skin, panel)
			rim:SetAlpha(0)
		end)
	end

	SpokenPlaces.panel = panel
end

-- The way back to a folded panel has to live on the map, not on the panel it reopens. Folding it
-- needs nothing more than the panel's own close button.
local function BuildToggle()
	-- A side tab down the map's right edge, as the game's new panels have them (the character
	-- frame's, LargeSideTabButtonTemplate): its own tooltip, press and sound. The action slot's ring
	-- where the client has not got it. Placed with the panel (Place): in the map, or beside it under
	-- the gamepad UI.
	local ok, tab = pcall(CreateFrame, "Frame", "SpokenPlacesPanelToggle", UIParent, "LargeSideTabButtonTemplate")
	if ok and tab and type(tab.Icon) == "table" and tab.Icon.SetTexture and tab.SetCustomOnMouseUpHandler then
		toggle = tab
		toggle.fillToInterior = true
		toggle.tooltipText = L.MAP_PANEL_EXPAND
		toggle.Icon:SetTexture(TOGGLE_ICON)
		-- Never shown chosen: it only ever opens. SetChecked also fits the icon to the tab's inside.
		if toggle.SetChecked then toggle:SetChecked(false) end
		toggle:SetCustomOnMouseUpHandler(function() SpokenPlaces:SetMapPanelCollapsed(false) end)
		toggle:EnableMouse(true)
		toggleX, toggleY = 0, -SIDE_TAB_TOP
		toggle:SetScript("OnHide", function(self)
			if GameTooltip:IsOwned(self) then GameTooltip:Hide() end
		end)
		toggle:Hide()
		return
	end
	toggle = CreateFrame("Button", "SpokenPlacesPanelToggle", UIParent)
	toggle:SetSize(ICON_SIZE, ICON_SIZE)
	local icon = toggle:CreateTexture(nil, "ARTWORK")
	icon:SetAllPoints()
	icon:SetTexture(TOGGLE_ICON)
	icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
	local border = toggle:CreateTexture(nil, "OVERLAY")
	border:SetTexture([[Interface\Buttons\UI-Quickslot2]])
	border:SetSize(BORDER_SIZE, BORDER_SIZE)
	border:SetPoint("CENTER")
	toggle:SetPushedTexture([[Interface\Buttons\UI-Quickslot-Depress]])
	toggle:SetHighlightTexture([[Interface\Buttons\ButtonHilight-Square]], "ADD")
	toggleX, toggleY = -TOGGLE_TUCK, -ICON_SIZE
	toggle:SetScript("OnClick", function()
		SpokenPlaces:SetMapPanelCollapsed(false)
	end)
	toggle:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(L.MAP_PANEL_EXPAND)
		GameTooltip:Show()
	end)
	toggle:SetScript("OnLeave", GameTooltip_Hide)
	-- However the button goes -- clicked, the map maximised or closed -- its tooltip goes with it.
	toggle:SetScript("OnHide", function(self)
		if GameTooltip:IsOwned(self) then GameTooltip:Hide() end
	end)
	toggle:Hide()
end

--------------------------------------------------------------------------------
-- Layout
--------------------------------------------------------------------------------

local function InMap()
	return panel:GetParent() == WorldMapFrame
end

-- The panel and its button fade with the map as the player walks: the game's movement fader sets
-- the map's alpha every frame. Inside the map that reaches them as its children, and they fade
-- whole, soft edges and all. Beside it they take the alpha each time, and each layer fades on its
-- own: the strips softening the text's cut edges showed through the parchment under them in
-- darker bands, so there they are off until the panel is clear again. The one way to fade a frame
-- as a whole (SetIsFrameBuffer) crashes the Forever client.
local followed
local function FollowAlpha()
	local alpha = WorldMapFrame:GetAlpha() or 1
	local inMap = InMap()
	local own = inMap and 1 or alpha
	followed = alpha
	toggle:SetAlpha(own)
	panel:SetAlpha(own)
	page.body:SetFadeShown(inMap or alpha >= CLEAR)
end

-- Beside the map, read from the panel's and the button's own OnUpdate: one of them is shown
-- whenever the map is. Not a hook on the map's SetAlpha, which the fader calls every frame: on the
-- Forever client that hooked call raised "attempt to call a nil value" each time.
local function FollowAlphaEachFrame()
	if WorldMapFrame:GetAlpha() == followed then return end
	FollowAlpha()
end

-- Into the map, or out of it under the gamepad UI. Asked on every refresh, as the player can
-- switch the gamepad UI on and off without a reload. Only beside the map do they read its alpha
-- each frame.
local function Place()
	local host = Host()
	if panel:GetParent() ~= host then
		panel:SetParent(host)
		toggle:SetParent(host)
	end
	local follow = host ~= WorldMapFrame and FollowAlphaEachFrame or nil
	panel:SetScript("OnUpdate", follow)
	toggle:SetScript("OnUpdate", follow)
end

-- In front of the map and, beside it, as large as a child of it would be. Copied on every show,
-- since the map's level and scale are its own to change.
local function FollowMap()
	local strata, level = WorldMapFrame:GetFrameStrata(), WorldMapFrame:GetFrameLevel()
	local mapScale, uiScale = WorldMapFrame:GetEffectiveScale(), UIParent:GetEffectiveScale()
	for _, frame in ipairs({ panel, toggle }) do
		if strata then frame:SetFrameStrata(strata) end
		if level then frame:SetFrameLevel(level + 10) end
		if InMap() then
			frame:SetScale(1)
		elseif mapScale and uiScale and uiScale > 0 then
			frame:SetScale(mapScale / uiScale)
		end
	end
	FollowAlpha()
end

-- In units of `scale`, so frames of different scales compare.
local function Rect(frame, scale)
	local left, right, top, bottom = frame:GetLeft(), frame:GetRight(), frame:GetTop(), frame:GetBottom()
	if not (left and right and top and bottom) then return end
	local k = frame:GetEffectiveScale() / scale
	return left * k, right * k, top * k, bottom * k
end

local ApplyAnchors

-- Several shows and hides in one frame, and other addons' hooks on the quest log that run after
-- Spoken's, all settle before one layout on the next frame. With both hidden, as when the map
-- closes, the next Refresh lays them out.
local pending
local function ApplyPending()
	pending = false
	if panel:IsShown() or toggle:IsShown() then ApplyAnchors() end
end
local function ApplyAnchorsSoon()
	if pending then return end
	pending = true
	C_Timer.After(0, ApplyPending)
end

-- A tab shows and hides without its parent doing either, as the game's own do, and a frame not laid
-- out yet cannot be told from a tab until it is. So every child is hooked once, as it is first seen.
local watched = setmetatable({}, { __mode = "k" })
local function Watch(child)
	if watched[child] or not child.HookScript then return end
	watched[child] = true
	child:HookScript("OnShow", ApplyAnchorsSoon)
	child:HookScript("OnHide", ApplyAnchorsSoon)
end

-- How near the map's edge a side tab's left edge may sit.
local COLUMN_SLACK = 12

-- Side tabs belong to no list another addon can join, so the column down the map's right edge is
-- read off the screen, whoever made what hangs there. Shorter than half the map, which keeps out a
-- panel standing beside it. The lowest tab, and how far the widest reaches past the map's edge.
local function SideTabs(mapEdge)
	local scale = mapEdge:GetEffectiveScale()
	local _, edgeRight, edgeTop, edgeBottom = Rect(mapEdge, scale)
	if not edgeRight then return nil, 0 end
	local function InColumn(left, right, top, bottom)
		return left >= edgeRight - COLUMN_SLACK and (left + right) / 2 > edgeRight
			and top <= edgeTop + COLUMN_SLACK and bottom >= edgeBottom - COLUMN_SLACK
			and top - bottom < (edgeTop - edgeBottom) / 2
	end
	local lowest, lowestBottom, reach = nil, nil, 0
	for _, parent in ipairs({ QuestMapFrame or false, WorldMapFrame, WorldMapFrame.BorderFrame or false }) do
		for _, child in ipairs(type(parent) == "table" and { parent:GetChildren() } or {}) do
			if child ~= panel and child ~= toggle then
				Watch(child)
				local left, right, top, bottom
				if child:IsVisible() then left, right, top, bottom = Rect(child, scale) end
				if left and InColumn(left, right, top, bottom) then
					reach = math.max(reach, right - edgeRight)
					if not lowestBottom or bottom < lowestBottom then lowest, lowestBottom = child, bottom end
				end
			end
		end
	end
	return lowest, reach
end

-- Always on the map's right, beside the quest log as the game lays its own panels out, past any
-- side tabs there. The button that reopens it goes under those tabs.
function ApplyAnchors()
	local mapEdge = MapEdge()
	local tab, reach = SideTabs(mapEdge)
	local gap = GAP + reach - ((mapEdge ~= edge and IsEra()) and ERA_BORDER_CLEAR or 0)
	panel:ClearAllPoints()
	panel:SetPoint("TOPLEFT", mapEdge, "TOPRIGHT", gap, 0)
	panel:SetPoint("BOTTOMLEFT", mapEdge, "BOTTOMRIGHT", gap, 0)
	toggle:ClearAllPoints()
	if tab then
		toggle:SetPoint("TOPLEFT", tab, "BOTTOMLEFT", toggleX, -TAB_GAP)
	else
		toggle:SetPoint("TOPLEFT", mapEdge, "TOPRIGHT", toggleX, toggleY)
	end
end

-- Now as well as next frame, so the button never shows a frame in its old place.
local function Relayout()
	ApplyAnchors()
	ApplyAnchorsSoon()
end

-- Maximised, the map fills the screen and a side panel would sit off-screen, so
-- the panel only shows in windowed mode. Whether it is folded away is a separate question.
local function Available()
	-- Beside the map, nothing hides it with the map but this.
	if not WorldMapFrame:IsShown() then
		return false
	end
	-- Switched off in Spoken's settings, the part puts nothing on the map.
	if not SpokenPlaces:IsPartOn() then
		return false
	end
	if not SpokenPlaces:Get("showMapPanel") then
		return false
	end
	if WorldMapFrame.IsMaximized and WorldMapFrame:IsMaximized() then
		return false
	end
	return true
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

local function Refresh(mapID)
	if not panel then
		return
	end

	Place()
	mapID = mapID or SpokenPlaces:GetDisplayedMapID()
	if not Available() or not mapID then
		panel:Hide()
		toggle:Hide()
		return
	end

	FollowMap()
	-- Another addon's side tabs may have been made since the last time.
	Relayout()
	local collapsed = SpokenPlaces:Get("mapPanelCollapsed")
	toggle:SetShown(collapsed)
	panel:SetShown(not collapsed)
	if collapsed then
		return
	end

	local zoneName = SpokenPlaces:GetMapName(mapID) or ("uiMapID " .. tostring(mapID))

	-- A selection only applies to the map it was made on; navigating elsewhere drops it. Checking
	-- here rather than on the map-changed callback keeps this independent of the order modules
	-- register their callbacks.
	local selected = SpokenPlaces.selected
	if selected and selected.mapID ~= mapID then
		SpokenPlaces.selected = nil
		selected = nil
	end

	if selected then
		-- Prefer the name the client reported, which is what the player sees on the map ("The
		-- Bulwark"), over the wiki page title ("Bulwark").
		local name = selected.areaName or selected.entry.name or ""
		-- Audio, the report link and Azeroth's Compendium are keyed by the canonical form, not the name
		-- the client reported. Resolve, not Normalise: on a localized client the reported name
		-- reaches the corpus key only through the alias table, and normalising a non-Latin name
		-- yields nil -- which would silently retarget the buttons at the zone's lore.
		local key = SpokenPlaces:ResolveAreaKey(selected.areaName, mapID)
		-- An area is told where its story is kept: Razorfen Downs, clicked on The Barrens' map,
		-- under Thousand Needles, and Strahnbrad, clicked on Alterac Mountains', under Hillsbrad.
		local story = SpokenPlaces:StoryPlace(mapID, key)
		local line = SpokenPlaces:PlaceLine(story, key or name)
		-- The line under an area's name returns to its zone's story: nothing else on the panel does.
		local back = function() SpokenPlaces:ClearSubzone() end
		-- Not found yet: named, and no more, as Azeroth's Compendium has it.
		if SpokenPlaces.IsLocked and SpokenPlaces:IsLocked(story, key) then
			page:Show({ title = name, subtitle = line, onSubtitle = back, text = L.NOT_DISCOVERED })
			return
		end
		if SpokenPlaces:IsPending(selected.entry) then
			-- Named, listed, and honest about the rest: nothing to play and nothing written to
			-- report on. Azeroth's Compendium lists it all the same, so Open goes to its row there.
			page:Show({ title = name, subtitle = line, onSubtitle = back,
				contribute = { story, name }, lore = { story, key } })
			return
		end
		page:Show({ title = name, subtitle = line, onSubtitle = back, text = selected.entry.full or selected.entry.short or "",
			audio = { story, key }, report = { story, key }, lore = { story, key } })
		return
	end

	local entry, foundOn = SpokenPlaces:GetLoreWithFallback(mapID)
	-- No Open here: a map with no entry at all, not even a pending one, has no row in Lore of
	-- Azeroth to open on.
	if not entry then
		page:Show({ title = zoneName,
			contribute = { mapID, nil } })
		return
	end

	-- Fallback hit an ancestor (a dungeon or micro-map inheriting its zone's lore); say so rather
	-- than silently mislabelling the text.
	local caption = ""
	if foundOn ~= mapID then
		caption = string.format(L.MAP_LORE_FOR_FMT, SpokenPlaces:GetMapName(foundOn) or "parent zone")
	else
		caption = SpokenPlaces:PlaceLine(mapID)
	end
	if SpokenPlaces.IsLocked and SpokenPlaces:IsLocked(foundOn) then
		page:Show({ title = zoneName, subtitle = caption, text = L.NOT_DISCOVERED })
		return
	end
	if SpokenPlaces:IsPending(entry) then
		page:Show({ title = zoneName, subtitle = caption,
			contribute = { foundOn, nil }, lore = { foundOn, nil } })
		return
	end
	-- foundOn, not mapID: a dungeon showing its parent zone's text should read that same parent
	-- zone's narration, and a report on it belongs to the line the text actually came from.
	page:Show({ title = zoneName, subtitle = caption, text = entry.full or entry.short or "",
		audio = { foundOn, nil }, report = { foundOn, nil }, lore = { foundOn, nil } })
end

function SpokenPlaces:RefreshPanel()
	Refresh(SpokenPlaces:GetDisplayedMapID())
end

function SpokenPlaces:SetMapPanelCollapsed(collapsed)
	SpokenPlaces:Set("mapPanelCollapsed", collapsed)
	Refresh()
end

-- Re-apply width and font after an options change. TextView re-wraps itself
-- when the width actually changes, via its OnSizeChanged.
function SpokenPlaces:ApplyPanelOptions()
	if not panel then
		return
	end
	panel:SetWidth(SpokenPlaces:Get("panelWidth"))
	Refresh(SpokenPlaces:GetDisplayedMapID())
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function SpokenPlaces:SetupMapPanel()
	if panel then
		return
	end

	BuildPanel()
	BuildToggle()
	ApplyAnchors()

	-- Re-evaluate visibility whenever the map changes shape: maximising and minimising both
	-- resize it. Its script, not its Maximize and Minimize: hooked, those raise an error inside
	-- the Forever client's own Minimize as the map opens under the gamepad UI.
	WorldMapFrame:HookScript("OnSizeChanged", function()
		Refresh(SpokenPlaces:GetDisplayedMapID())
	end)
	WorldMapFrame:HookScript("OnHide", function()
		panel:Hide()
		toggle:Hide()
	end)
	-- The side tabs on the quest log's edge go with it.
	if QuestMapFrame and QuestMapFrame.HookScript then
		QuestMapFrame:HookScript("OnShow", Relayout)
		QuestMapFrame:HookScript("OnHide", Relayout)
	end

	SpokenPlaces:OnMapChanged(function(mapID)
		Refresh(mapID)
	end)

	-- Toggling "Hide the Contribute buttons" in the Spoken settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			Refresh(SpokenPlaces:GetDisplayedMapID())
		end)
		-- Nor does Hide Report Buttons.
		Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function()
			Refresh(SpokenPlaces:GetDisplayedMapID())
		end)
	end

	Refresh(SpokenPlaces:GetDisplayedMapID())
end

-- SpokenZones -- the story docked to the side of the world map, drawn as the quest log is.
--
-- Shows lore for the zone the map is displaying, or for a subzone the player
-- clicked (see UI/SubzoneClick.lua), with a link back to the zone.
--
-- Also the home for the contribute button (UI/ReportButton.lua's CreateContributeButton), in the
-- body under the sentence that says a place has no lore yet, pointed at the place this panel is
-- showing -- not where the player stands, since every place is known and what is missing is a
-- description someone can write from anywhere.

local ADDON_NAME, SpokenZones = ...
local L = SpokenZones.L

local Art = SpokenZones.Art

local panel, page, toggle

-- Space between the map's frame and the panel's: a small gap, so the two read as neighbours
-- rather than one frame.
local GAP = 2
-- The action slot border's opening is 36/66 of its image, so the icon fills it at about
-- BORDER_SIZE * 36 / 66; larger, the border overlaps the icon's edge, smaller leaves a gap.
local ICON_SIZE = 40
local BORDER_SIZE = 74
-- How far the button's left edge tucks under the map's frame, so it reads as attached to it.
local TOGGLE_TUCK = 2
-- Place Lore's map, so the button reads as the way back to it.
local TOGGLE_ICON = [[Interface\Icons\INV_Misc_Map02]]

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- A panel of its own beside the map, as the game draws one: the border, title bar and close
-- button of DefaultPanelFlatTemplate, the family the Map & Quest Log frame belongs to. Inside it
-- the quest log's frame and the filigree on its top edge, round the quest details' parchment
-- (UI/LorePage.lua). The old dark dialog box where the client has not got the template.
--
-- Beside the map, not in it: the panel and its button are UIParent's, anchored to the map and
-- shown, hidden, layered and scaled with it here. The Forever client's gamepad UI takes every
-- button inside the open map into the map's own navigation, and an addon's buttons there taint
-- it: closing the map with the gamepad is then blocked, and the "blocked from an action" dialog
-- that raises hangs the client.
--
-- A workaround for the gamepad UI alone, paid for by every player: the panel no longer fades with
-- the map as the player moves, and follows a scale or level the map takes while open only at its
-- next refresh. Once the client stops tainting a map with an addon's buttons in it (check on a
-- newer build), the panel belongs back in WorldMapFrame, and FollowMap and the map's OnHide hook
-- go with it.
local function NewPanel()
	local ok, frame = pcall(CreateFrame, "Frame", "SpokenZonesPanel", UIParent, "DefaultPanelFlatTemplate")
	if ok and frame and frame.SetTitle then
		frame:SetTitle(L.LORE_PANEL_TITLE)
		frame.templated = true
		return frame
	end
	frame = CreateFrame("Frame", "SpokenZonesPanel", UIParent, "BackdropTemplate")
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
	local width = SpokenZones:Get("panelWidth")

	panel = NewPanel()
	panel:SetWidth(width)
	panel:EnableMouse(true)

	-- Closed, it stays closed until the button on the map's edge reopens it; the setting turns it
	-- off for good.
	local close = CreateFrame("Button", nil, panel, panel.templated and "UIPanelCloseButtonDefaultAnchors"
		or "UIPanelCloseButton")
	if not panel.templated then close:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -8, -8) end
	close:SetScript("OnClick", function()
		SpokenZones:SetMapPanelCollapsed(true)
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
	page = SpokenZones:CreateLorePage(holder, "log")
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

	SpokenZones.panel = panel
end

-- The way back to a folded panel has to live on the map, not on the panel it reopens. Folding it
-- needs nothing more than the panel's own close button.
local function BuildToggle()
	toggle = CreateFrame("Button", "SpokenZonesPanelToggle", UIParent)
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
	toggle:SetPoint("TOPLEFT", WorldMapFrame, "TOPRIGHT", -TOGGLE_TUCK, -ICON_SIZE)
	toggle:SetScript("OnClick", function()
		SpokenZones:SetMapPanelCollapsed(false)
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

-- In front of the map and as large, as a child of it would be. Copied on every show, since the
-- map's level and scale are its own to change.
local function FollowMap()
	local strata, level = WorldMapFrame:GetFrameStrata(), WorldMapFrame:GetFrameLevel()
	local mapScale, uiScale = WorldMapFrame:GetEffectiveScale(), UIParent:GetEffectiveScale()
	for _, frame in ipairs({ panel, toggle }) do
		if strata then frame:SetFrameStrata(strata) end
		if level then frame:SetFrameLevel(level + 10) end
		if mapScale and uiScale and uiScale > 0 then frame:SetScale(mapScale / uiScale) end
	end
end

-- Always on the map's right, beside the quest log as the game lays its own panels out.
local function ApplyAnchors()
	local gap = GAP
	panel:ClearAllPoints()
	panel:SetPoint("TOPLEFT", WorldMapFrame, "TOPRIGHT", gap, 0)
	panel:SetPoint("BOTTOMLEFT", WorldMapFrame, "BOTTOMRIGHT", gap, 0)
end

-- Maximised, the map fills the screen and a side panel would sit off-screen, so
-- the panel only shows in windowed mode. Whether it is folded away is a separate question.
local function Available()
	-- Not the map's child, so nothing hides it with the map but this.
	if not WorldMapFrame:IsShown() then
		return false
	end
	-- Switched off in Spoken's settings, the part puts nothing on the map.
	if not SpokenZones:IsPartOn() then
		return false
	end
	if not SpokenZones:Get("showMapPanel") then
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

	mapID = mapID or SpokenZones:GetDisplayedMapID()
	if not Available() or not mapID then
		panel:Hide()
		toggle:Hide()
		return
	end

	FollowMap()
	local collapsed = SpokenZones:Get("mapPanelCollapsed")
	toggle:SetShown(collapsed)
	panel:SetShown(not collapsed)
	if collapsed then
		return
	end

	local zoneName = SpokenZones:GetMapName(mapID) or ("uiMapID " .. tostring(mapID))

	-- A selection only applies to the map it was made on; navigating elsewhere drops it. Checking
	-- here rather than on the map-changed callback keeps this independent of the order modules
	-- register their callbacks.
	local selected = SpokenZones.selected
	if selected and selected.mapID ~= mapID then
		SpokenZones.selected = nil
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
		local key = SpokenZones:ResolveAreaKey(selected.areaName)
		local line = SpokenZones:PlaceLine(mapID, key or name)
		local back = function() SpokenZones:ClearSubzone() end
		-- Not found yet: named, and no more, as Azeroth's Compendium has it.
		if SpokenZones.IsLocked and SpokenZones:IsLocked(mapID, key) then
			page:Show({ title = name, subtitle = line, onSubtitle = back, text = L.NOT_DISCOVERED, missing = true })
			return
		end
		if SpokenZones:IsPending(selected.entry) then
			-- Named, listed, and honest about the rest: nothing to play and nothing written to
			-- report on. Azeroth's Compendium lists it all the same, so Open goes to its row there.
			page:Show({ title = name, subtitle = line, onSubtitle = back, text = L.LORE_NOT_WRITTEN:format(name),
				missing = true, contribute = { mapID, name }, lore = { mapID, key } })
			return
		end
		page:Show({ title = name, subtitle = line, onSubtitle = back, text = selected.entry.full or selected.entry.short or "",
			audio = { mapID, key }, report = { mapID, key }, lore = { mapID, key } })
		return
	end

	local entry, foundOn = SpokenZones:GetLoreWithFallback(mapID)
	-- No Open here: a map with no entry at all, not even a pending one, has no row in Lore of
	-- Azeroth to open on.
	if not entry then
		page:Show({ title = zoneName, text = L.NO_LORE_FOR:format(zoneName), missing = true,
			contribute = { mapID, nil } })
		return
	end

	-- Fallback hit an ancestor (a dungeon or micro-map inheriting its zone's lore); say so rather
	-- than silently mislabelling the text.
	local caption, onCaption = "", nil
	if foundOn ~= mapID then
		caption = string.format(L.MAP_LORE_FOR_FMT, SpokenZones:GetMapName(foundOn) or "parent zone")
	else
		local up
		caption, up = SpokenZones:PlaceLine(mapID)
		if up and WorldMapFrame.SetMapID then onCaption = function() WorldMapFrame:SetMapID(up) end end
	end
	if SpokenZones.IsLocked and SpokenZones:IsLocked(foundOn) then
		page:Show({ title = zoneName, subtitle = caption, onSubtitle = onCaption, text = L.NOT_DISCOVERED, missing = true })
		return
	end
	if SpokenZones:IsPending(entry) then
		page:Show({ title = zoneName, subtitle = caption, onSubtitle = onCaption,
			text = L.LORE_NOT_WRITTEN:format(SpokenZones:GetMapName(foundOn) or zoneName), missing = true,
			contribute = { foundOn, nil }, lore = { foundOn, nil } })
		return
	end
	-- foundOn, not mapID: a dungeon showing its parent zone's text should read that same parent
	-- zone's narration, and a report on it belongs to the line the text actually came from.
	page:Show({ title = zoneName, subtitle = caption, onSubtitle = onCaption, text = entry.full or entry.short or "",
		audio = { foundOn, nil }, report = { foundOn, nil }, lore = { foundOn, nil } })
end

function SpokenZones:RefreshPanel()
	Refresh(SpokenZones:GetDisplayedMapID())
end

function SpokenZones:SetMapPanelCollapsed(collapsed)
	SpokenZones:Set("mapPanelCollapsed", collapsed)
	Refresh()
end

-- Re-apply width and font after an options change. TextView re-wraps itself
-- when the width actually changes, via its OnSizeChanged.
function SpokenZones:ApplyPanelOptions()
	if not panel then
		return
	end
	panel:SetWidth(SpokenZones:Get("panelWidth"))
	ApplyAnchors()
	Refresh(SpokenZones:GetDisplayedMapID())
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function SpokenZones:SetupMapPanel()
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
		ApplyAnchors()
		Refresh(SpokenZones:GetDisplayedMapID())
	end)
	WorldMapFrame:HookScript("OnHide", function()
		panel:Hide()
		toggle:Hide()
	end)

	SpokenZones:OnMapChanged(function(mapID)
		Refresh(mapID)
	end)

	-- Toggling "Hide the Contribute buttons" in the Spoken settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			Refresh(SpokenZones:GetDisplayedMapID())
		end)
	end

	Refresh(SpokenZones:GetDisplayedMapID())
end

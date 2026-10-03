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

local panel, page

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- A panel of its own beside the map, as the game draws one: the border, title bar and close
-- button of DefaultPanelFlatTemplate, the family the Map & Quest Log frame belongs to. Inside it
-- the quest log's frame and the filigree on its top edge, round the quest details' parchment
-- (UI/LorePage.lua). The old dark dialog box where the client has not got the template.
local function NewPanel()
	local ok, frame = pcall(CreateFrame, "Frame", "SpokenZonesPanel", WorldMapFrame, "DefaultPanelFlatTemplate")
	if ok and frame and frame.SetTitle then
		frame:SetTitle(L.LORE_PANEL_TITLE)
		frame.templated = true
		return frame
	end
	frame = CreateFrame("Frame", "SpokenZonesPanel", WorldMapFrame, "BackdropTemplate")
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
	panel:SetFrameStrata(WorldMapFrame:GetFrameStrata())
	panel:SetFrameLevel(WorldMapFrame:GetFrameLevel() + 10)
	panel:EnableMouse(true)

	-- Closed, it stays closed until the map is next opened; the setting turns it off for good.
	local close = CreateFrame("Button", nil, panel, panel.templated and "UIPanelCloseButtonDefaultAnchors"
		or "UIPanelCloseButton")
	if not panel.templated then close:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -8, -8) end
	close:SetScript("OnClick", function()
		panel.dismissed = true
		panel:Hide()
	end)
	panel.close = close
	WorldMapFrame:HookScript("OnHide", function() panel.dismissed = nil end)

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
	local rim = CreateFrame("Frame", nil, holder)
	rim:SetAllPoints()
	rim:SetFrameLevel(holder:GetFrameLevel() + 12)
	local border = rim:CreateTexture(nil, "OVERLAY")
	border:SetAllPoints()
	if Art.Atlas(border, "questlog-frame", false) then
		local filigree = rim:CreateTexture(nil, "OVERLAY", nil, 1)
		if Art.Atlas(filigree, "questlog-frame-filigree", true) then
			filigree:SetPoint("TOP", rim, "TOP", 0, 1)
		end
	else
		border:Hide()
	end

	SpokenZones.panel = panel
end

--------------------------------------------------------------------------------
-- Layout
--------------------------------------------------------------------------------

-- Space between the map's frame and the panel's: a small gap, so the two read as neighbours
-- rather than one frame.
local GAP = 2

-- Always on the map's right, beside the quest log as the game lays its own panels out.
local function ApplyAnchors()
	local gap = GAP
	panel:ClearAllPoints()
	panel:SetPoint("TOPLEFT", WorldMapFrame, "TOPRIGHT", gap, 0)
	panel:SetPoint("BOTTOMLEFT", WorldMapFrame, "BOTTOMRIGHT", gap, 0)
end

-- Maximised, the map fills the screen and a side panel would sit off-screen, so
-- the panel only shows in windowed mode.
local function ShouldShow()
	-- Switched off in Spoken's settings, the part puts nothing on the map.
	if Spoken and Spoken.IsPartOn and not Spoken:IsPartOn("zones") then
		return false
	end
	if not SpokenZones:Get("showMapPanel") then
		return false
	end
	if WorldMapFrame.IsMaximized and WorldMapFrame:IsMaximized() then
		return false
	end
	if panel and panel.dismissed then
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

	if not ShouldShow() then
		panel:Hide()
		return
	end

	mapID = mapID or SpokenZones:GetDisplayedMapID()
	if not mapID then
		panel:Hide()
		return
	end

	panel:Show()

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
		local back = function() SpokenZones:ClearSubzone() end
		-- Audio, the report link and Lore of Azeroth are keyed by the canonical form, not the name
		-- the client reported. Resolve, not Normalise: on a localized client the reported name
		-- reaches the corpus key only through the alias table, and normalising a non-Latin name
		-- yields nil -- which would silently retarget the buttons at the zone's lore.
		local key = SpokenZones:ResolveAreaKey(selected.areaName)
		if SpokenZones:IsPending(selected.entry) then
			-- Named, listed, and honest about the rest: nothing to play and nothing written to
			-- report on. Lore of Azeroth lists it all the same, so Open goes to its row there.
			page:Show({ title = name, subtitle = L.BACK_TO_ZONE:format(zoneName), onSubtitle = back,
				text = L.LORE_NOT_WRITTEN:format(name), missing = true, contribute = { mapID, name },
				lore = { mapID, key } })
			return
		end
		page:Show({ title = name, subtitle = L.BACK_TO_ZONE:format(zoneName), onSubtitle = back,
			text = selected.entry.full or selected.entry.short or "", audio = { mapID, key }, report = { mapID, key },
			lore = { mapID, key } })
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
	local caption = ""
	if foundOn ~= mapID then
		caption = string.format(L.MAP_LORE_FOR_FMT, SpokenZones:GetMapName(foundOn) or "parent zone")
	end
	if SpokenZones:IsPending(entry) then
		page:Show({ title = zoneName, subtitle = caption,
			text = L.LORE_NOT_WRITTEN:format(SpokenZones:GetMapName(foundOn) or zoneName), missing = true,
			contribute = { foundOn, nil }, lore = { foundOn, nil } })
		return
	end
	-- foundOn, not mapID: a dungeon showing its parent zone's text should read that same parent
	-- zone's narration, and a report on it belongs to the line the text actually came from.
	page:Show({ title = zoneName, subtitle = caption, text = entry.full or entry.short or "",
		audio = { foundOn, nil }, report = { foundOn, nil }, lore = { foundOn, nil } })
end

function SpokenZones:RefreshPanel()
	Refresh(SpokenZones:GetDisplayedMapID())
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
	ApplyAnchors()

	-- Re-evaluate visibility whenever the map changes shape. Leatrix_Maps hooks
	-- this same set; these are the paths that resize or re-dock the map frame.
	local function Relayout()
		if not panel then
			return
		end
		ApplyAnchors()
		Refresh(SpokenZones:GetDisplayedMapID())
	end

	hooksecurefunc(WorldMapFrame, "Maximize", Relayout)
	hooksecurefunc(WorldMapFrame, "Minimize", Relayout)
	hooksecurefunc(WorldMapFrame, "SynchronizeDisplayState", Relayout)
	if WorldMapFrame.OnFrameSizeChanged then
		hooksecurefunc(WorldMapFrame, "OnFrameSizeChanged", Relayout)
	end

	SpokenZones:OnMapChanged(function(mapID)
		Refresh(mapID)
	end)

	-- Toggling "Hide the Contribute buttons" in the Spoken Player settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			Refresh(SpokenZones:GetDisplayedMapID())
		end)
	end

	Refresh(SpokenZones:GetDisplayedMapID())
end

-- SpokenZones -- lore preview tooltip while hovering the world map.
--
-- Hovering a zone on a continent map, or a subzone on a zone map, shows that
-- place's short lore at the cursor.
--
-- The plan for this feature was to replace the area-label data provider's
-- OnUpdate and pass lore as the label's `description`, which is how Leatrix_Maps
-- shows zone levels and fishing skill. That was abandoned deliberately: only one
-- addon can own that script, SpokenZones loads after Leatrix_Maps, and winning the
-- race would silently disable a feature of an addon the user already runs. A
-- dedicated tooltip shares nothing, cannot conflict, and has far more room for
-- prose than the label's single small description line.

local ADDON_NAME, SpokenZones = ...

local THROTTLE = 0.1

local driver, tooltip
local shownKey

--------------------------------------------------------------------------------
-- Tooltip
--------------------------------------------------------------------------------

local function BuildTooltip()
	-- Our own tooltip rather than GameTooltip: map pins own GameTooltip while
	-- hovered, and fighting them over it causes flicker.
	tooltip = CreateFrame("GameTooltip", "SpokenZonesHoverTooltip", UIParent, "GameTooltipTemplate")
	tooltip:SetFrameStrata("TOOLTIP")
end

local function HideTooltip()
	shownKey = nil
	if tooltip then
		tooltip:Hide()
	end
end

local function ShowTooltip(name, entry)
	-- Rebuilding every tick would reset the fade and flicker, so only redraw when
	-- the hovered place actually changes.
	local key = name .. "\0" .. tostring(entry and entry.source or "")
	if key == shownKey and tooltip:IsShown() then
		return
	end
	shownKey = key

	-- ANCHOR_CURSOR rather than ANCHOR_CURSOR_RIGHT: the latter is not confirmed
	-- present on 11509. Width is left to the tooltip -- SetWidth on a GameTooltip
	-- does not reflow its FontStrings, so the wrap flag on AddLine is what
	-- actually controls line length.
	tooltip:SetOwner(UIParent, "ANCHOR_CURSOR")
	tooltip:ClearLines()
	tooltip:AddLine(name, 1, 0.82, 0)

	if entry and entry.short and entry.short ~= "" then
		tooltip:AddLine(entry.short, 1, 1, 1, true)
	end

	tooltip:Show()
end

--------------------------------------------------------------------------------
-- Driver
--------------------------------------------------------------------------------

local elapsedSince = 0

local function OnUpdate(self, elapsed)
	elapsedSince = elapsedSince + elapsed
	if elapsedSince < THROTTLE then
		return
	end
	elapsedSince = 0

	if not SpokenZones:Get("showHoverPreview") or (Spoken and Spoken.IsPartOn and not Spoken:IsPartOn("zones")) then
		return HideTooltip()
	end

	local container = WorldMapFrame.ScrollContainer
	if not container then
		return HideTooltip()
	end

	-- IsCanvasMouseFocus is false while the cursor is over a pin, which is
	-- exactly when Blizzard's own tooltip should be the only one showing.
	local overCanvas
	if WorldMapFrame.IsCanvasMouseFocus then
		overCanvas = WorldMapFrame:IsCanvasMouseFocus()
	else
		overCanvas = container:IsMouseOver()
	end
	if not overCanvas then
		return HideTooltip()
	end

	local mapID = WorldMapFrame.mapID
	if not mapID then
		return HideTooltip()
	end

	local x, y = container:GetNormalizedCursorPosition()
	if not x or not y then
		return HideTooltip()
	end

	local kind, name, entry = SpokenZones:ResolveAt(mapID, x, y)

	-- Nothing there, or an area we have no lore for: show nothing rather than an
	-- empty tooltip. The panel already names the zone.
	if not kind or not entry then
		return HideTooltip()
	end

	-- On a zone map the panel is already showing this zone's lore, so previewing
	-- the zone itself would be redundant; only subzones are worth a tooltip.
	if kind == "zone" and SpokenZones:IsZoneMap(mapID) then
		return HideTooltip()
	end

	ShowTooltip(name, entry)
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function SpokenZones:SetupHoverPreview()
	if driver then
		return
	end

	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		SpokenZones:Print("|cffffcc00MapUtil.FindBestAreaNameAtMouse missing; hover preview disabled|r")
		return
	end

	BuildTooltip()

	-- Parented to WorldMapFrame so OnUpdate only runs while the map is open.
	driver = CreateFrame("Frame", nil, WorldMapFrame)
	driver:SetScript("OnUpdate", OnUpdate)

	WorldMapFrame:HookScript("OnHide", HideTooltip)

	SpokenZones.HideHoverPreview = HideTooltip
end

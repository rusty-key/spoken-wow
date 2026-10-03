-- SpokenZones -- minimap button, via LibDataBroker + LibDBIcon.
--
-- LibDBIcon owns two keys inside SpokenZonesDB: `hide` and `minimapPos`. They are
-- deliberately not in Core.lua's defaults table, because the library writes them
-- itself and a default would fight it -- except for seeding minimapPos once, so
-- the button starts somewhere sensible instead of at angle 0.

local ADDON_NAME, SpokenZones = ...

local ICON = "Interface\\ICONS\\INV_Misc_Book_09"

local dataObject, icon

local function OnClick(_, button)
	if button == "RightButton" then
		SpokenZones:OpenOptions()
	else
		SpokenZones:ToggleLoreWindow()
	end
end

local function OnTooltipShow(tooltip)
	if not tooltip or not tooltip.AddLine then
		return
	end
	tooltip:AddLine("Spoken Zones")

	-- Show lore for where the player is standing, which is the whole point of a
	-- minimap entry point.
	local mapID = SpokenZones:GetPlayerMapID()
	local zoneName = SpokenZones:GetMapName(mapID)
	if zoneName then
		tooltip:AddLine(zoneName, 1, 0.82, 0)
	end

	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" and subZone ~= zoneName then
		local entry = SpokenZones:GetSubzoneLore(mapID, subZone)
		tooltip:AddLine(subZone .. (entry and "" or " |cff777777(no lore)|r"), 0.8, 0.8, 0.8)
		if entry and entry.short then
			tooltip:AddLine(entry.short, 1, 1, 1, true)
		end
	else
		local entry = SpokenZones:GetLore(mapID)
		if entry and entry.short then
			tooltip:AddLine(entry.short, 1, 1, 1, true)
		end
	end

	tooltip:AddLine(" ")
	tooltip:AddLine(SpokenZones.L.MINIMAP_LEFT_CLICK:format(SpokenZones.L.MENU_LORE_WINDOW), 0.7, 0.7, 0.7)
	tooltip:AddLine("|cff66bbffRight-click|r open settings", 0.7, 0.7, 0.7)
end

function SpokenZones:SetupMinimapButton()
	-- With the Spoken player installed there is one button for every Spoken addon,
	-- and this addon's entries on it are added in Audio.lua. A button of our own
	-- would be the second icon the shared player exists to prevent.
	if _G.Spoken then
		return
	end

	local ldb = LibStub and LibStub:GetLibrary("LibDataBroker-1.1", true)
	local dbicon = LibStub and LibStub:GetLibrary("LibDBIcon-1.0", true)
	if not ldb or not dbicon then
		SpokenZones:Print("|cffffcc00LibDataBroker/LibDBIcon missing; minimap button disabled|r")
		return
	end

	-- Seed the position once so the button does not default to angle 0, where it
	-- can sit under other addons' buttons.
	if SpokenZonesDB.minimapPos == nil then
		SpokenZonesDB.minimapPos = 204
	end
	-- Mirror our own option onto the key LibDBIcon reads.
	SpokenZonesDB.hide = not SpokenZones:Get("showMinimapButton")

	dataObject = ldb:NewDataObject("SpokenZones", {
		type = "data source",
		text = "Spoken Zones",
		icon = ICON,
		OnClick = OnClick,
		OnTooltipShow = OnTooltipShow,
	})

	icon = dbicon
	icon:Register("SpokenZones", dataObject, SpokenZonesDB)

	SpokenZones:ApplyMinimapButton()
end

-- Bring the button in line with the showMinimapButton option. Idempotent, so
-- callers that have already written the option (the options panel) use this
-- rather than the toggle.
function SpokenZones:ApplyMinimapButton()
	local enabled = SpokenZones:Get("showMinimapButton") and true or false
	SpokenZonesDB.hide = not enabled
	if icon then
		if enabled then
			icon:Show("SpokenZones")
		else
			icon:Hide("SpokenZones")
		end
	end
	return enabled
end

function SpokenZones:ToggleMinimapButton()
	SpokenZones:Set("showMinimapButton", not SpokenZones:Get("showMinimapButton"))
	return SpokenZones:ApplyMinimapButton()
end

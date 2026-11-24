setfenv(1, SpokenEnv)

local function AddDeveloper(tooltip, guid)
    if tooltip ~= GameTooltip or (tooltip.IsForbidden and tooltip:IsForbidden()) or tooltip.spokenDeveloperTag then return end
    if guid == nil then
        local _, unit = tooltip:GetUnit()
        unit = NotSecret(unit)
        if type(unit) ~= "string" then return end
        guid = NotSecret(UnitGUID(unit))
    end
    if not DeveloperCharacters[guid] then return end
    tooltip:AddLine([[|TInterface\AddOns\Spoken\icon.tga:0|t ]] .. L.DEVELOPER_TOOLTIP, 0, 229 / 255, 1)
    tooltip.spokenDeveloperTag = true
end

local function HookTooltip()
    GameTooltip:HookScript("OnTooltipCleared", function(tooltip) tooltip.spokenDeveloperTag = nil end)

    -- Classic can expose the processor while still building unit tooltips through this script.
    if GameTooltip:HasScript("OnTooltipSetUnit") then
        GameTooltip:HookScript("OnTooltipSetUnit", function(tooltip) AddDeveloper(tooltip) end)
    elseif TooltipDataProcessor and type(TooltipDataProcessor.AddTooltipPostCall) == "function"
        and Enum and Enum.TooltipDataType then
        TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, function(tooltip, data)
            data = NotSecret(data)
            if type(data) ~= "table" or (issecrettable and issecrettable(data)) then return end
            AddDeveloper(tooltip, NotSecret(data.guid))
        end)
    end
end

-- Hooked after PLAYER_LOGIN, where other addons add their Target rows, so the badge lands below them.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_ENTERING_WORLD")
loader:SetScript("OnEvent", function(self)
    self:UnregisterEvent("PLAYER_ENTERING_WORLD")
    HookTooltip()
end)

setfenv(1, SpokenEnv)

local function IsDeveloper(guid)
    guid = NotSecret(guid)
    if type(guid) ~= "string" then return false end
    local realm, character = guid:match("^Player%-(%d+)%-(%x+)$")
    for _, id in ipairs(realm and DeveloperCharacters[realm] or {}) do
        if id == character then return true end
    end
    return false
end

local function AddDeveloper(tooltip, guid)
    if tooltip ~= GameTooltip or (tooltip.IsForbidden and tooltip:IsForbidden()) or tooltip.spokenDeveloperTag then return end
    if guid == nil then
        local _, unit = tooltip:GetUnit()
        unit = NotSecret(unit)
        if type(unit) ~= "string" then return end
        guid = UnitGUID(unit)
    end
    if not IsDeveloper(guid) then return end
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
            if issecretvalue and issecretvalue(data.guid) then return end
            AddDeveloper(tooltip, data.guid)
        end)
    end
end

-- Unit-tooltip modifiers add their target rows during PLAYER_LOGIN.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_ENTERING_WORLD")
loader:SetScript("OnEvent", function(self)
    self:UnregisterEvent("PLAYER_ENTERING_WORLD")
    HookTooltip()
end)

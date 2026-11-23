setfenv(1, SpokenEnv)

local function AddDeveloper(tooltip)
    if tooltip ~= GameTooltip or (tooltip.IsForbidden and tooltip:IsForbidden()) or tooltip.spokenDeveloperTag then return end
    local name, unit = tooltip:GetUnit()
    if issecretvalue and issecretvalue(name) then return end
    unit = NotSecret(unit)
    if type(unit) ~= "string" then return end
    local guid = UnitGUID(unit)
    if issecretvalue and issecretvalue(guid) then return end
    if not guid then guid = UnitGUID("mouseover") end
    guid = NotSecret(guid)
    if type(guid) ~= "string" then return end
    local realm, character = guid:match("^Player%-(%d+)%-(%x+)$")
    local characters = realm and DeveloperCharacters[realm]
    for _, id in ipairs(characters or {}) do
        if id == character then
            tooltip:AddLine([[|TInterface\AddOns\Spoken\icon.tga:0|t ]] .. L.DEVELOPER_TOOLTIP, 192 / 255, 132 / 255, 252 / 255)
            tooltip.spokenDeveloperTag = true
            return
        end
    end
end

local function HookTooltip()
    GameTooltip:HookScript("OnTooltipCleared", function(tooltip) tooltip.spokenDeveloperTag = nil end)

    -- Classic can expose the processor without using it for native unit tooltips.
    if type(GameTooltip.GetPrimaryTooltipData) == "function" and TooltipDataProcessor
        and type(TooltipDataProcessor.AddTooltipPostCall) == "function" and Enum and Enum.TooltipDataType then
        TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, function(tooltip, data)
            data = NotSecret(data)
            if type(data) ~= "table" or (issecrettable and issecrettable(data)) then return end
            if issecretvalue and issecretvalue(data.guid) then return end
            AddDeveloper(tooltip)
        end)
    elseif GameTooltip:HasScript("OnTooltipSetUnit") then
        GameTooltip:HookScript("OnTooltipSetUnit", AddDeveloper)
    end
end

-- Unit-tooltip modifiers add their target rows during PLAYER_LOGIN.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_ENTERING_WORLD")
loader:SetScript("OnEvent", function(self)
    self:UnregisterEvent("PLAYER_ENTERING_WORLD")
    HookTooltip()
end)

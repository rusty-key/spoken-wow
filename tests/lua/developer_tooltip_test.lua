local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local ICON = [[|TInterface\AddOns\Spoken\icon.tga:0|t ]]

local function Boot(mode, locale, withTarget)
    stub.SetClient(mode == "modern" and "16001" or "11509")
    stub.ResetFrames(); stub.ResetTimers(); stub.ResetSound(); stub.Secrets()
    stub.SetLocale(locale or "enUS")
    _G.SpokenSettings = nil
    local tooltip = stub.Widget("GameTooltip")
    _G.GameTooltip = tooltip
    if mode == "modern" then
        local hasScript = tooltip.HasScript
        tooltip.HasScript = function(self, script)
            return script ~= "OnTooltipSetUnit" and hasScript(self, script)
        end
    end
    tooltip.IsForbidden = function(self) return self.forbidden end
    local unit, guid
    local callbacks = {}
    tooltip.GetUnit = function() return "Developer", unit end
    tooltip.SetNoUnit = function() unit = nil end
    _G.UnitGUID = function() return guid end
    _G.Enum = _G.Enum or {}
    _G.Enum.TooltipDataType = { Unit = 2 }
    _G.TooltipDataProcessor = { AddTooltipPostCall = function(kind, fn)
        Expect("only unit tooltips are registered", kind, Enum.TooltipDataType.Unit)
        callbacks[#callbacks + 1] = fn
    end }
    stub.LoadSpoken(SPOKEN)
    if withTarget then
        local function AddTarget(frame) frame:AddLine("Target: You") end
        if mode == "modern" then
            TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, AddTarget)
        else
            tooltip:HookScript("OnTooltipSetUnit", AddTarget)
        end
    end
    stub.FireEvent("PLAYER_ENTERING_WORLD")
    local callback = callbacks[#callbacks]
    local function Fire(script)
        for _, fn in ipairs(tooltip.hooks[script] or {}) do fn(tooltip) end
    end
    local function Clear()
        tooltip.lines = {}
        Fire("OnTooltipCleared")
    end
    local function Show(value, token)
        guid, unit = value, token or "mouseover"
        if callback then
            for _, fn in ipairs(callbacks) do fn(tooltip, { guid = guid }) end
        else
            Fire("OnTooltipSetUnit")
        end
        return table.concat(tooltip.lines or {}, "|")
    end
    return tooltip, Clear, Show, callback
end

for _, mode in ipairs({ "modern", "legacy" }) do
    local tooltip, Clear, Show, callback = Boot(mode)
    Expect(mode .. ": the native tooltip pipeline is used, even where Classic exposes the processor",
        callback ~= nil, mode == "modern")
    Clear()
    Expect(mode .. ": first developer character is tagged", Show("Player-6921-001E5110"), ICON .. "Spoken Developer")
    Expect(mode .. ": repeated updates do not duplicate the label", Show("Player-6921-001E5110"), ICON .. "Spoken Developer")
    Clear()
    Expect(mode .. ": the second character is tagged after clearing", Show("Player-6921-02CAC851"), ICON .. "Spoken Developer")
    for _, character in ipairs({ "04564413", "04987F43" }) do
        Clear()
        Expect(mode .. ": realm 5149 developer is tagged: " .. character,
            Show("Player-5149-" .. character), ICON .. "Spoken Developer")
    end
    if callback then
        Clear()
        callback(tooltip, {})
        Expect("the tooltip's unit identifies a developer without data.guid", table.concat(tooltip.lines, "|"), ICON .. "Spoken Developer")
        Clear()
        tooltip.SetNoUnit()
        callback(tooltip, { guid = "Player-6921-001E5110" })
        Expect("data.guid identifies a developer without a unit token", table.concat(tooltip.lines, "|"), ICON .. "Spoken Developer")
    end
    local readGUID = UnitGUID
    _G.UnitGUID = function(unit) if unit == "mouseover" then return "Player-6921-001E5110" end end
    Clear()
    Expect(mode .. ": a unit without a GUID is not tagged from the mouseover", Show(nil, "target"), "")
    _G.UnitGUID = readGUID
    for _, guid in ipairs({ "Player-6921-00000000", "Player-1234-001E5110", "Creature-0-0-0-0-6921-001E5110", "invalid" }) do
        Clear()
        Expect(mode .. ": other GUIDs have no label: " .. guid, Show(guid), "")
    end
    Clear()
    Expect(mode .. ": a missing GUID has no label", Show(nil), "")
    tooltip.forbidden = true
    Expect(mode .. ": forbidden tooltips are left alone", Show("Player-6921-001E5110"), "")
    tooltip.forbidden = false
    stub.Secrets("Player-6921-001E5110")
    Expect(mode .. ": secret GUIDs are left alone", Show("Player-6921-001E5110"), "")
    stub.Secrets()
    stub.Secrets("Developer")
    Expect(mode .. ": a secret name still shows the label", Show("Player-6921-001E5110"), ICON .. "Spoken Developer")
    stub.Secrets()
    if not callback then
        Clear()
        stub.Secrets("mouseover")
        Expect(mode .. ": secret unit tokens are left alone", Show("Player-6921-001E5110", "mouseover"), "")
        stub.Secrets()
    end
    if callback then
        local other = stub.Widget("GameTooltip")
        callback(other, { guid = "Player-6921-001E5110" })
        Expect("other tooltip frames are left alone", other.lines, nil)
        local restricted = setmetatable({}, { __index = function() error("restricted tooltip data") end })
        _G.issecrettable = function(data) return data == restricted end
        Expect("restricted tooltip data is never indexed", pcall(callback, tooltip, restricted), true)
        _G.issecrettable = nil
    end
end

for _, mode in ipairs({ "modern", "legacy" }) do
    local _, Clear, Show = Boot(mode, "enUS", true)
    Clear()
    Expect(mode .. ": Spoken appears below the target row", Show("Player-6921-001E5110"),
        "Target: You|" .. ICON .. "Spoken Developer")
end

local translations = {
    enUS = "Spoken Developer", deDE = "Spoken-Entwickler",
    esES = "Desarrollador de Spoken", esMX = "Desarrollador de Spoken",
    frFR = "Développeur de Spoken", koKR = "Spoken 개발자",
    ptBR = "Desenvolvedor do Spoken", ruRU = "Разработчик Spoken",
    zhCN = "Spoken 开发者", zhTW = "Spoken 開發者",
}
for locale, label in pairs(translations) do
    local _, Clear, Show = Boot("modern", locale)
    Clear()
    Expect(locale .. ": the tooltip uses Questie's translated wording with Spoken", Show("Player-6921-001E5110"), ICON .. label)
end

if Failures() > 0 then os.exit(1) end
stub.print("All developer tooltip tests passed")

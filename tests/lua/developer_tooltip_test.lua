local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

local function Boot(mode, locale)
    stub.SetClient(mode == "modern" and "16001" or "11509")
    stub.ResetFrames(); stub.ResetTimers(); stub.ResetSound(); stub.Secrets()
    stub.SetLocale(locale or "enUS")
    _G.SpokenSettings = nil
    local tooltip = stub.Widget("GameTooltip")
    _G.GameTooltip = tooltip
    tooltip.GetPrimaryTooltipData = mode == "modern" and function() end or false
    tooltip.IsForbidden = function(self) return self.forbidden end
    local unit, guid, callback
    tooltip.GetUnit = function() return "Developer", unit end
    _G.UnitGUID = function() return guid end
    _G.Enum = _G.Enum or {}
    _G.Enum.TooltipDataType = { Unit = 2 }
    _G.TooltipDataProcessor = { AddTooltipPostCall = function(kind, fn)
        Expect("only unit tooltips are registered", kind, Enum.TooltipDataType.Unit)
        callback = fn
    end }
    stub.LoadSpoken(SPOKEN)
    local function Fire(script)
        for _, fn in ipairs(tooltip.hooks[script] or {}) do fn(tooltip) end
    end
    local function Clear()
        tooltip.lines = {}
        Fire("OnTooltipCleared")
    end
    local function Show(value, token)
        guid, unit = value, token or "mouseover"
        if callback then callback(tooltip, { guid = guid }) else Fire("OnTooltipSetUnit") end
        return table.concat(tooltip.lines or {}, "|")
    end
    return tooltip, Clear, Show, callback
end

for _, mode in ipairs({ "modern", "legacy" }) do
    local tooltip, Clear, Show, callback = Boot(mode)
    Expect(mode .. ": the native tooltip pipeline is used", callback ~= nil, mode == "modern")
    Clear()
    Expect(mode .. ": first developer character is tagged", Show("Player-6921-001E5110"), "Spoken Developer")
    Expect(mode .. ": repeated updates do not duplicate the label", Show("Player-6921-001E5110"), "Spoken Developer")
    Clear()
    Expect(mode .. ": the second character is tagged after clearing", Show("Player-6921-02CAC851"), "Spoken Developer")
    if callback then
        Clear()
        callback(tooltip, {})
        Expect("the tooltip's unit identifies a developer without data.guid", table.concat(tooltip.lines, "|"), "Spoken Developer")
    end
    local readGUID = UnitGUID
    _G.UnitGUID = function(unit) if unit == "mouseover" then return "Player-6921-001E5110" end end
    Clear()
    Expect(mode .. ": a missing unit GUID falls back to mouseover like Questie", Show(nil, "target"), "Spoken Developer")
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
    stub.Secrets("mouseover")
    Expect(mode .. ": secret unit tokens are left alone", Show("Player-6921-001E5110", "mouseover"), "")
    stub.Secrets()
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
    Expect(locale .. ": the tooltip uses Questie's translated wording with Spoken", Show("Player-6921-001E5110"), label)
end

if Failures() > 0 then os.exit(1) end
stub.print("All developer tooltip tests passed")

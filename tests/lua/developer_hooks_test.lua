-- What Spoken offers the Spoken_Developer module (Developer.lua): without the module nothing
-- happens and nothing breaks; with one registered, the log, the diagnostics, the Developer page's
-- sections and the Report buttons' right-click reach it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests = H.Fresh(stub, SPOKEN)
env.Addon:Enable()
local Spoken = _G.Spoken

local function Fire(button, script, ...)
    for _, fn in ipairs(button.hooks and button.hooks[script] or {}) do fn(button, ...) end
end

---------------------------------------------------------------- without the module
Expect("without the module there is no log", Spoken:HasLog(), false)
Spoken:Log("test", "nobody hears %s", "this")
Expect("...writing to it does nothing", #Spoken:LogLines(), 0)
Expect("...and it is never on", Spoken:IsLogOn(), false)
Expect("...nor shown", Spoken:ShowLog(), nil)
Expect("...nor is there a menu hint", Spoken:LogMenuHint(), nil)
local said = {}
local realPrint = _G.print
_G.print = function(text) table.insert(said, tostring(text)) end
SlashCmdList.SPOKEN("log")
_G.print = realPrint
Expect("/spoken log says the module is missing", said[1] and said[1]:find("Spoken Developer module", 1, true) ~= nil, true)

local report = Spoken:CreateRoundButton(UIParent, "report")
Expect("a Report button can still be right-clicked", pcall(Fire, report, "OnMouseUp", "RightButton"), true)

---------------------------------------------------------------- diagnostics, as lines
local lines = Spoken:Diagnostics()
Expect("the diagnostics start with what /spoken diagnostics says",
    lines[1] and lines[1]:find("Spoken " .. Spoken.ADDON_VERSION, 1, true) == 1, true)
local function Has(list, text)
    for _, line in ipairs(list) do if line:find(text, 1, true) then return true end end
    return false
end
Expect("...say the module is not there", Has(lines, "no Spoken Developer module"), true)
Expect("...and leave chat alone", #said, 1)
Expect("without detail, no context", Has(lines, "context:"), false)
Spoken:AddDiagnostics("Spoken Quests", function(detailed)
    return { "packs: 1 loaded", detailed and "quest 101 open" or nil }
end)
lines = Spoken:Diagnostics(true)
Expect("with detail, the context", Has(lines, "context:"), true)
Expect("...the queue", Has(lines, "queue empty"), true)
Expect("...the narrator", Has(lines, "narrator style "), true)
Expect("a feature addon's diagnostics follow, named", Has(lines, "Spoken Quests:"), true)
Expect("...indented", Has(lines, "  packs: 1 loaded"), true)
Expect("...with its detail", Has(lines, "  quest 101 open"), true)
Spoken:AddDiagnostics("Broken", function() error("boom") end)
Expect("a broken provider says so instead of stopping the rest",
    Has(Spoken:Diagnostics(), "diagnostics error"), true)

---------------------------------------------------------------- the Developer page's sections
local built = 0
Spoken:AddDeveloperSettings(function() built = built + 1 end)
Expect("a section handed in before the module is kept", #Spoken:GetDeveloperSettings(), 1)
local late
Spoken:RegisterCallback("DEVELOPER_SETTINGS_ADDED", function(build) late = build end)
local second = function() end
Spoken:AddDeveloperSettings(second)
Expect("...and one handed in later is announced", late, second)

---------------------------------------------------------------- with a module
local got = { lines = {}, menus = 0 }
local on = false
Spoken:RegisterDeveloper({
    Log = function(category, text) table.insert(got.lines, category .. " " .. text) end,
    IsLogOn = function() return on end,
    SetLogOn = function(value) on = value end,
    Lines = function() return got.lines end,
    Show = function() return #got.lines end,
    ShowMenu = function(anchor) got.menus = got.menus + 1; got.anchor = anchor end,
    MenuHint = function() return "Right-click: the debug log" end,
    SwitchLabel = function() return "Enable Debug Log Recording" end,
    SwitchTip = function() return "tip" end,
    Command = function(rest) got.command = rest end,
    Describe = function() return "debug log on, 3 lines" end,
})
Expect("with the module, there is a log", Spoken:HasLog(), true)
Spoken:Log("test", "kept while off?")
Expect("...that keeps nothing while off", #got.lines, 0)
Spoken:SetLogOn(true)
Spoken:Log("test", "%s and %d", "words", 42)
Expect("...and formats a line while on", got.lines[1], "test words and 42")
Spoken:Log("test", "100% as written")
Expect("...keeping one with nothing to format as written", got.lines[2], "test 100% as written")
Expect("the diagnostics ask it how it stands", Has(Spoken:Diagnostics(), "debug log on, 3 lines"), true)
SlashCmdList.SPOKEN("log write")
Expect("/spoken log hands the rest of the words on", got.command, "write")

-- The refusals that fire no callback.
local clip = H.Clip()
quests:Enqueue(clip)
quests:Enqueue(clip)
Expect("a duplicate refused is in the log", Has(got.lines, "player queue refused " .. clip.key .. " [quests]: duplicate"), true)

-- The Report buttons' right-click.
Fire(report, "OnMouseUp", "RightButton")
Expect("a round Report button's right-click opens the menu", got.menus, 1)
Expect("...at the button", got.anchor, report)
Fire(report, "OnMouseUp", "LeftButton")
Expect("...its left click does not", got.menus, 1)
local play = Spoken:CreateRoundButton(UIParent, "play")
Fire(play, "OnMouseUp", "RightButton")
Expect("a Play button's right-click opens nothing", got.menus, 1)
Expect("the tooltip line comes from the module", Spoken:LogMenuHint(), "Right-click: the debug log")

-- A window's action buttons: only while the button reports.
local frame = CreateFrame("Frame", nil, UIParent)
local reportAction = { id = "report", icon = [[Interface\HelpFrame\HelpIcon-Bug]], label = "Report",
    tooltip = function(tip) tip:AddLine("Report a Problem") end, onClick = function() end }
local reportClip = H.Clip({ present = { header = "h", label = "l", portrait = { kind = "none" },
    actions = { reportAction } } })
reportClip.source = { key = "quests" }
env.Actions:Build(frame)
env.Actions:Configure(frame, reportClip)
local windowButton = frame.actions.byId["quests:report"]
Expect("a window draws its Report action", windowButton ~= nil, true)
if windowButton then
    Fire(windowButton, "OnMouseUp", "RightButton")
    Expect("...whose right-click opens the menu", got.menus, 2)
    windowButton.action = { id = "skip" }
    Fire(windowButton, "OnMouseUp", "RightButton")
    Expect("...but not once the same button does something else", got.menus, 2)
end

-- The welcome window offers the switch, in the module's words.
local Welcome = env.Welcome
_G.UISpecialFrames = _G.UISpecialFrames or {}
Welcome:Build(); Welcome:Sync()
Expect("the welcome window has the module's switch", Welcome.log ~= nil, true)
Expect("...ticked as the log stands", Welcome.log and Welcome.log:GetChecked() and true or false, true)

Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll developer hook tests passed")

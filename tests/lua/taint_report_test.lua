-- What the player gets when the client blocks one of our addons from a protected action. Run
-- with `make test-player`.
--
-- The client's popup names the addon and nothing else. The report adds the function it
-- refused and which addon last wrote the Blizzard fields and globals ours touch, read
-- through `issecurevariable`, which this stub answers from a table of who wrote what.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local Expect, Failures = H.Expecter(print)

-- Who wrote what: [table][key] for fields, [_G][name] for globals. Absent means secure.
local writers = {}
local function Taint(tbl, key, addon)
    writers[tbl] = writers[tbl] or {}
    writers[tbl][key] = addon
end
function _G.issecurevariable(tbl, key)
    if key == nil then tbl, key = _G, tbl end
    local by = writers[tbl] and writers[tbl][key]
    return by == nil, by
end
function _G.InCombatLockdown() return false end
function _G.IsAddOnLoaded() return true end
_G.date = _G.date or os.date

stub.SetClient("11509")
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local chat = {}
env.print = function(message) table.insert(chat, message) end

local function Has(text, fragment)
    return string.find(text, fragment, 1, true) ~= nil
end

---------------------------------------------------------------- nothing blocked
Expect("with nothing blocked, the report says so",
    Has(env.TaintReport:Build(), "No action has been blocked this session."), true)

---------------------------------------------------------------- one of ours is blocked
local scroll = CreateFrame("ScrollFrame", "QuestScrollFrame")
scroll.Contents = CreateFrame("Frame", nil, scroll)
scroll.Contents.layoutIndex = 3
Taint(scroll.Contents, "layoutIndex", "SpokenQuests")
_G.GetQuestLogTitle = function() end
Taint(_G, "GetQuestLogTitle", "SpokenQuests")
_G.SpokenLeak = true
Taint(_G, "SpokenLeak", "SpokenQuests")

stub.FireEvent("ADDON_ACTION_FORBIDDEN", "SpokenQuests", "SetPassThroughButtons()")
Expect("the player is told once, with the function the client refused", chat[1],
    "Spoken: the game blocked SpokenQuests from calling SetPassThroughButtons(). Type /spoken taint to copy a report for the bug tracker.")
stub.FireEvent("ADDON_ACTION_FORBIDDEN", "SpokenQuests", "SetPassThroughButtons()")
Expect("...and not again for the same block", #chat, 1)

local report = env.TaintReport:Build()
Expect("the report names the event and the function", Has(report, "ADDON_ACTION_FORBIDDEN: SpokenQuests blocked from SetPassThroughButtons()"), true)
Expect("...the Blizzard field an addon wrote, and which addon",
    Has(report, "QuestScrollFrame.Contents.layoutIndex (SpokenQuests)"), true)
Expect("...a replaced Blizzard global", Has(report, "GetQuestLogTitle (SpokenQuests)"), true)
Expect("...and a global one of ours leaked into _G", Has(report, "SpokenLeak (SpokenQuests)"), true)
Expect("...and the client it happened on", Has(report, "Client: "), true)

---------------------------------------------------------------- someone else's block
stub.FireEvent("ADDON_ACTION_BLOCKED", "SomeOtherAddon", "CastSpellByName()")
Expect("another addon's block is not announced as ours", #chat, 1)
Expect("...but is in the report, for the combination", Has(env.TaintReport:Build(), "SomeOtherAddon blocked from CastSpellByName()"), true)

---------------------------------------------------------------- the copy box and the log switch
SlashCmdList.SPOKEN("taint")
Expect("/spoken taint opens the report ready to copy",
    Has(env.Spoken.ContributeBox.editBox:GetText(), "Spoken taint report"), true)
Expect("...under a hint that says where it goes", env.Spoken.ContributeBox.hint:GetText(),
    "Press Ctrl+C, then paste it into the bug report:")

stub.ResetSound()
SlashCmdList.SPOKEN("taint on")
Expect("/spoken taint on turns the client's taint log on", GetCVar("taintLog"), "1")
SlashCmdList.SPOKEN("taint off")
Expect("/spoken taint off turns it off", GetCVar("taintLog"), "0")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll taint report tests passed")

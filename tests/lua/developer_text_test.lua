local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local DEVELOPER = here .. "/../../addons/Spoken_Developer/"

local print = stub.print
local Expect, Failures = H.Expecter(print)
local world = stub.world
stub.SetClient("16001")
local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
Expect("the normal quest addon has no developer copy button", VO.CopyTextButton, nil)
local Dev = stub.LoadDeveloper(DEVELOPER)
assert(Dev.Text, "Spoken Developer has no copy-text tool or Developer-page toggle")
stub.FireEvent("PLAYER_ENTERING_WORLD")

local toggle
for _, section in ipairs(Dev.optionsPanel.layout.items) do
    for _, row in ipairs(section.rows or {}) do
        local control = row.control
        if control and control.layoutLabel and control.layoutLabel.text == Dev.L.OPT_COPY_TEXT then
            assert(not toggle, "Copy Text must have only one Developer-page toggle")
            toggle = control
        end
    end
end
assert(toggle, "Copy Text is missing from Spoken > Developer")
local function Enable(on)
    toggle:SetChecked(on)
    toggle:Click()
end
local function Panel(name, event)
    stub.ShowPanel(name)
    world.panels.QuestFrame = true
    stub.FireEvent(event)
end
local function Payload()
    Dev.Text:Show()
    local box = Dev.Box:Frame()
    return box and box.text or ""
end
local function Has(text, needle)
    return text:find(needle, 1, true) ~= nil
end

world.questID, world.title = 9123, "A Rough Start"
world.questText = "Kill six of them.\n\nThen come back."
world.npcName, world.npcGUID = "Deathguard Linnea", "Creature-0-0-0-0-12345-0"
Panel("QuestFrameDetailPanel", "QUEST_DETAIL")
Expect("installing Developer leaves copying off", Dev.Text:IsOn(), false)
Expect("no copy control is built while off", Dev.Text.button, nil)
Dev.Text:Show()
Expect("copying while off opens no window", Dev.Box:Frame(), nil)

Enable(true)
Expect("the Developer checkbox enables copying", Dev.Text:IsOn(), true)
Expect("an already open quest gains its button immediately", Dev.Text.button:IsShown(), true)
Expect("the button belongs to the quest window", Dev.Text.button:GetParent(), QuestFrame)
local payload = Payload()
Expect("the copy retains every paragraph from the client", Has(payload, world.questText), true)
Expect("the quest id accompanies it", Has(payload, "[quest: 9123]"), true)
Expect("the NPC comes from the contribution capture", Has(payload, "[npc: 12345 Deathguard Linnea]"), true)
Expect("the event is accept", Has(payload, "[event: accept]"), true)
Expect("copying uses the shared selectable box", Dev.Box:Frame().edit:GetText(), payload)

world.progressText = "Have you finished?"
Panel("QuestFrameProgressPanel", "QUEST_PROGRESS")
payload = Payload()
Expect("progress copies its own text", Has(payload, world.progressText), true)
Expect("progress has its own event", Has(payload, "[event: progress]"), true)
world.rewardText = "Well done."
Panel("QuestFrameRewardPanel", "QUEST_COMPLETE")
Expect("completion copies its own text", Has(Payload(), world.rewardText), true)

world.gossipText, world.greetingText = "Old gossip text.", "I have work for you."
Panel("QuestFrameGreetingPanel", "QUEST_GREETING")
payload = Payload()
Expect("greetings copy the greeting API's text", Has(payload, world.greetingText), true)
Expect("old gossip is not copied over the greeting", Has(payload, "Old gossip text."), false)
Expect("a greeting never carries the old gossip's key", Has(payload, "[Spoken key:"), false)

stub.HidePanels()
stub.ShowGossip("We stand ready.", { "Tell me more." })
stub.FireEvent("GOSSIP_SHOW")
payload = Payload()
Expect("gossip copies the live words", Has(payload, "We stand ready."), true)
Expect("gossip includes its actual capture key", Has(payload, "[Spoken key: g:12345:"), true)
Expect("gossip choices carry their IDs", Has(payload, "[OptionID: 1001 Tell me more.]"), true)
Expect("the control moves to the gossip window", Dev.Text.button:GetParent(), GossipFrame)

Enable(false)
Expect("turning off hides the existing control", Dev.Text.button:IsShown(), false)
Expect("turning off closes the text copy", Dev.Box:Frame():IsShown(), false)
Dev.Text:Show()
Expect("a stale click cannot reopen the text copy", Dev.Box:Frame():IsShown(), false)
Dev.Box:Show("a debug log", Dev.L.LOG_BOX_TITLE)
Enable(false)
Expect("turning off copying preserves a debug-log window", Dev.Box:Frame():IsShown(), true)
Dev.Box:Hide()
Enable(true)

_G.DUIQuestFrame = CreateFrame("Frame", "DUIQuestFrame")
DUIQuestFrame:Hide()
stub.FireEvent("ADDON_LOADED", "DialogueUI")
DUIQuestFrame:Show()
Expect("DialogueUI's quest window never gets a second copy button", Dev.Text.button:IsShown(), false)
Dev.Text:Show()
Expect("DialogueUI's existing copy control is left in charge", Dev.Box:Frame():IsShown(), false)
DUIQuestFrame:Hide()
stub.FireEvent("GOSSIP_SHOW")
Expect("the Blizzard copy control returns outside DialogueUI", Dev.Text.button:IsShown(), true)

stub.Secrets("We stand ready.")
local safe = pcall(stub.FireEvent, "GOSSIP_SHOW")
Expect("secret text causes no UI error", safe, true)
Expect("secret text has no copy control", Dev.Text.button:IsShown(), false)
stub.Secrets()
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
Expect("closing an NPC dialog hides the control", Dev.Text.button:IsShown(), false)

local READABLES = here .. "/../../addons/Spoken_Readables/"
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Opener", "Reader", "Audio", "Contribute" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
dofile(READABLES .. "Data/Books.lua")
B.openedBy = { { kind = "item", id = 9550 } }
stub.ShowPage({ title = "A Note", text = "The client's actual page.\n\nA second paragraph.", number = 2 })
stub.FireEvent("ITEM_TEXT_READY")
payload = Payload()
Expect("unknown readables can still be copied", Has(payload, world.itemText), true)
Expect("the source item comes from the existing capture", Has(payload, "[item: 9550]"), true)
local _, itemCount = payload:gsub("%[item: 9550%]", "")
Expect("item diagnostics are not duplicated", itemCount, 1)
Expect("readable metadata names the title and page", Has(payload, "[book: A Note]") and Has(payload, "[number: 2]"), true)
Expect("the button moves to the readable frame", Dev.Text.button:GetParent(), ItemTextFrame)
stub.ShowPage({ title = "A Note", text = "The next page.", number = 3 })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning a page copies the new words", Has(Payload(), "The next page."), true)

stub.ShowPage({ title = "A Letter", text = "Private words.", creator = "Another player" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("player mail has no developer copy button", Dev.Text.button:IsShown(), false)
Dev.Box:Hide()
Dev.Text:Show()
Expect("player mail cannot be copied through a stale click", Dev.Box:Frame():IsShown(), false)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")

SpokenDeveloperDB.copyText = true
Dev:InitDB()
Expect("a saved opt-in survives database initialization", Dev.Text:IsOn(), true)
for _, build in ipairs(Spoken:GetDeveloperSettings()) do
    local group, order = Spoken:GetDeveloperGroup(build)
    if group == "testing" and order == 0 then
        local reset = build({ Checkbox = function() end })
        reset()
    end
end
Expect("Developer Defaults turns copying off", Dev.Text:IsOn(), false)
Expect("callbacks did not fail", #env.Callbacks.errors, 0)
if Failures() > 0 then os.exit(1) end
print("All developer text-copy tests passed")

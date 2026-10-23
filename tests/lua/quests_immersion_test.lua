-- Immersion's talk box turning its parts with Spoken Quests' voice (UI/ImmersionBridge.lua),
-- against a fake ImmersionFrame built from the parts the bridge reaches for. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local QUEST_TEXT = "Greetings, Test. The wolves near the farm grow bolder every night.\n\n"
    .. "Kill eight of them and bring me their pelts."

---------------------------------------------------------------- a fake Immersion
-- Its talk box text splits the page into parts and shows one at a time; its timer ticks while the
-- text is in the timer's list. ForceNext onto the last part ends the list, as Immersion's does.
local fs = {}
function fs:CreateLineData(text)
    local strings = {}
    for line in string.gmatch(text, "[^\n]+") do table.insert(strings, line) end
    return 0, strings, {}
end
function fs:SetText(text)
    local _, strings = self:CreateLineData(text)
    self.storedText, self.strings, self.numTexts, self.ticking = text, strings, #strings, true
end
function fs:ForceNext()
    table.remove(self.strings, 1)
    if not self.strings[2] then self.strings = nil end
end
function fs:PauseTimer() self.ticking, self.pauses = false, (self.pauses or 0) + 1 end
function fs:ResumeTimer()
    self.resumes = (self.resumes or 0) + 1
    if self.strings then self.ticking = true end
end
function fs:GetNumTexts() return self.numTexts or 0 end
function fs:GetNumRemaining() return self.strings and #self.strings or 0 end
-- The part on screen: past the last one, the last stays.
local function Part() return math.min(fs:GetNumTexts(), fs:GetNumTexts() - fs:GetNumRemaining() + 1) end

local Immersion = stub.Widget("Frame")
Immersion.TalkBox = { TextFrame = { Text = fs } }
local function Show(event, text)
    Immersion.playbackEvent = event
    fs:SetText(text)
end

---------------------------------------------------------------- boot
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
dofile(QUESTS .. "UI/ImmersionBridge.lua")
local Bridge = VO.ImmersionBridge
VO.Addon:OnInitialize()
Expect("without Immersion nothing is built", Bridge.driver, nil)
_G.ImmersionFrame = Immersion
fs.ForceNext, fs.Missing = nil, fs.ForceNext
Bridge:Setup()
Expect("...nor with a talk box that lacks a method it needs", Bridge.driver, nil)
fs.ForceNext = fs.Missing
Bridge:Setup()
local driver = Bridge.driver
Expect("with Immersion's talk box the bridge is built", driver ~= nil, true)
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["101-accept"] = 12 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)
world.title = "Wolves"; world.questText = QUEST_TEXT
world.npcName = "Farmer Test"; world.npcGUID = "Creature-0-0-0-0-1234-0"
local Spoken = _G.Spoken
local function Tick(seconds)
    stub.Advance(seconds or 0)
    driver.scripts.OnUpdate(driver, 0.06)
end

---------------------------------------------------------------- following the voice
Show("QUEST_DETAIL", QUEST_TEXT)
world.questID = 101
VO.Addon:QUEST_DETAIL()
Tick(0.1)
Expect("while the page is read Immersion's timer waits", fs.ticking, false)
Expect("...on the first part", Part(), 1)
Tick(9)
Expect("the voice in the second paragraph turns to the second part", Part(), 2)
Expect("...still holding the timer", fs.ticking, false)
fs.resumes = 0
Tick(5)
-- On its last part Immersion's list has ended, so there is nothing left for the timer to run.
Expect("when the line ends Immersion's timer is handed back", fs.resumes, 1)

---------------------------------------------------------------- stopping and replaying
Show("QUEST_DETAIL", QUEST_TEXT)
Spoken:StopAll()
VO.Addon:QUEST_DETAIL()
Tick(0.1)
Spoken:Pause()
Tick(0)
Expect("stopping the voice gives Immersion its timer back", fs.ticking, true)
Spoken:Resume()
Tick(0.1)
Expect("...and replaying holds it again", fs.ticking, false)

---------------------------------------------------------------- the player's own clicks
fs:ForceNext()
Tick(0)
Expect("a part the player turned to ahead of the voice stays", Part(), 2)
-- An item reward resolving makes Immersion set the same text again, from its first part.
Tick(9)
fs:SetText(QUEST_TEXT)
Expect("Immersion setting the page again starts it over", Part() .. " " .. tostring(fs.ticking), "1 true")
Tick(0)
Expect("...and the next frame turns back to the part being read", Part() .. " " .. tostring(fs.ticking), "2 false")

---------------------------------------------------------------- what is left alone
Spoken:StopAll()
Tick(0)
Show("QUEST_DETAIL", "The Barrens are wide and dry.\nWater is scarce.")
VO.Addon:QUEST_DETAIL()
Tick(0.1)
Expect("a page that is not the line being read is left to Immersion", fs.ticking, true)

Spoken:StopAll()
Show("IMMERSION_TOAST", QUEST_TEXT)
VO.Addon:QUEST_DETAIL()
Tick(9)
Expect("a toast replaying the page is left to Immersion", Part() .. " " .. tostring(fs.ticking), "1 true")
Immersion.playbackEvent = "QUEST_DETAIL"

Spoken:StopAll()
Tick(0)
local other = env.Sources:Register("other", { title = "Other", addon = "X", order = 9 })
local present = H.Clip().present
present.transcript = QUEST_TEXT
Show("QUEST_DETAIL", QUEST_TEXT)
other:Enqueue(H.Clip({ length = 12, present = present }))
Tick(9)
Expect("another part's line with the same words is left alone", Part() .. " " .. tostring(fs.ticking), "1 true")

Spoken:StopAll()
Tick(0)
_G.ImmersionSetup = { disableprogression = true }
Show("QUEST_DETAIL", QUEST_TEXT)
fs.pauses, fs.resumes = 0, 0
VO.Addon:QUEST_DETAIL()
Tick(9)
Spoken:StopAll()
Tick(0)
Expect("with Immersion's own progression off its timer is never touched", fs.pauses .. " " .. fs.resumes, "0 0")
_G.ImmersionSetup = nil

Show("QUEST_DETAIL", QUEST_TEXT)
VO.Addon:QUEST_DETAIL()
Tick(0.1)
driver.scripts.OnHide(driver)
Expect("Immersion closing gives its timer back", fs.ticking, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Immersion tests passed")

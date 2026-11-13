-- The game's chat bubble is the narrator for World Chatter: the word being read is lit in the bubble's own
-- text and the text is put back when the line ends. Run with `make test-player`.
--
-- The failure this guards against is the bubble left coloured, or a bubble that is not this line's
-- being rewritten: the game puts the text on screen, and what this file does must never leave it
-- different from what the NPC said.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local SPEAKER = 600
local SPEAKER_GUID = "Creature-0-0-0-0-600-0"
local TEXT = "I sense evil brewing. . . ."
local FOLLOWUP_DIR = [[generated\sounds\followup\]]

local PACK = {
    folder = "TestPack",
    module = {
        FollowupLookup = { [SPEAKER] = { [101] = "chat-101" } },
        SoundLengthLookupByFileName = { ["chat-101"] = 5 },
        GetSoundPath = function(_, fileName) return FOLLOWUP_DIR .. fileName .. ".ogg" end,
    },
}

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
stub.ldbObjects = {}; stub.dbIcons = {}
world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
world.playerName = "Tester"; world.unitSex = 2
world.playerRace = "Dwarf"; world.playerClass = "Paladin"
stub.SetLocale("enUS")
stub.SetAddOns({ { folder = PACK.folder, meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = PACK.folder } } })
_G.SpokenQuestsSettings = nil
local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
VO.FollowupLines = { ["end"] = {}, start = {} }
VO.ChatterLines = { [SPEAKER] = { name = "Madame Test", { id = 101, text = TEXT } } }
dofile(QUESTS .. "Followup.lua")
dofile(QUESTS .. "Chatter.lua")
dofile(QUESTS .. "ChatBubble.lua")
VO.Addon:OnInitialize()
VO.DataModules:Register(PACK.folder, PACK.module)
stub.Advance(2)
local Spoken = _G.Spoken

-- A bubble as the game builds it: an outer frame with one child, which holds the text in `String`.
local bubbles = {}
local function Bubble(text)
    local fs = { text = text }
    function fs:GetText() return self.text end
    function fs:SetText(value) self.text = value end
    function fs:GetTextColor() return 1, 1, 1 end
    local child = { String = fs }
    local outer = { GetChildren = function() return child end }
    table.insert(bubbles, outer)
    return fs
end
_G.C_ChatBubbles = { GetAllChatBubbles = function() return bubbles end }

local function Say()
    stub.FireEvent("CHAT_MSG_MONSTER_SAY", TEXT, "Madame Test", "", "", "", "", 0, 0, "", 0, 1, SPEAKER_GUID)
    env.Transcript:Sync()
end

local function Reset()
    Spoken:StopAll()
    VO.Chatter.heard = {}
    VO.ChatBubble:Restore()
    for i = #bubbles, 1, -1 do bubbles[i] = nil end
    stub.Advance(1)
end

local LIT = "|cffffd100"

---------------------------------------------------------------- the word being read is lit
Reset()
local fs = Bubble(TEXT)
Say()
Expect("the line is playing as NPC chat", Spoken:GetCaption() ~= nil, true)
Expect("the tick keeps going while the line is read", VO.ChatBubble.Tick(), true)
Expect("the word being read is lit in the bubble", fs.text:find(LIT .. "I|r", 1, true) ~= nil, true)
Expect("...with the one beside it", fs.text:find(LIT .. "sense|r", 1, true) ~= nil, true)
Expect("...and the rest as the game wrote it", fs.text:find("brewing. . . .", 1, true) ~= nil, true)
local first = fs.text
stub.Advance(3.2)
VO.ChatBubble.Tick()
Expect("the light moves on with the voice", fs.text ~= first, true)
Expect("...to a later word", fs.text:find(LIT .. "I|r", 1, true) == nil, true)

---------------------------------------------------------------- put back when it ends
stub.Advance(2)
Expect("the tick stops when the line is over", VO.ChatBubble.Tick(), false)
Expect("the bubble shows the NPC's own text again", fs.text, TEXT)

---------------------------------------------------------------- stopped mid-line
Reset()
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
Expect("a line stopped half way has marked the bubble", fs.text ~= TEXT, true)
Spoken:StopAll()
stub.Advance(0.1)
Expect("...and stopping puts the bubble's text back at once", fs.text, TEXT)

-- The Stop button holds the line in the queue instead of removing it, and a stop that keeps the
-- line leaves the captions showing it.
Reset()
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
Spoken:Pause()
Expect("Stop puts the bubble's text back", VO.ChatBubble.Tick(), false)
Expect("...and the bubble shows the NPC's own text", fs.text, TEXT)
stub.Advance(1)
Expect("...and it stays so while the line is held", fs.text, TEXT)
Spoken:Resume()
Expect("a replay marks the bubble again", fs.text ~= TEXT or VO.ChatBubble.Tick(), true)
Reset()
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
local playing = Spoken:GetCurrent()
env.Callbacks:Fire("CLIP_STOPPED", playing, false)
Expect("a stop that keeps the line at the head puts the text back", fs.text, TEXT)
Expect("...and the tick does not mark it again", VO.ChatBubble.Tick(), false)
Expect("...leaving it as the game wrote it", fs.text, TEXT)

---------------------------------------------------------------- the captions are a moment behind
-- A window fading out the line before holds the new one back: the captions still show the old clip
-- when the loop first looks, and the loop must wait for them instead of giving up.
Reset()
fs = Bubble(TEXT)
env.Transcript.holdFor = function() return true end
Say()
env.Transcript.holdFor = nil
local before = Spoken:GetCaption()
Expect("the captions are not on the chat line yet", before == nil or before.clip.event ~= VO.Enums.SoundEvent.NPCChatter, true)
Expect("...and the loop waits for them", VO.ChatBubble.Tick(), true)
Expect("...leaving the bubble alone meanwhile", fs.text, TEXT)
env.Transcript:Release()
Expect("once they are on it the bubble is marked", VO.ChatBubble.Tick() and fs.text ~= TEXT, true)
Reset()
fs = Bubble(TEXT)
env.Transcript.holdFor = function() return true end
Say()
env.Transcript.holdFor = nil
stub.Advance(2.5)
Expect("a line the captions never reach is given up on", VO.ChatBubble.Tick(), false)
env.Transcript:Release()

---------------------------------------------------------------- the narrator's settings are not the bubble's
-- Show Narrator and Highlight Words are for the narrator window, which these lines never use; the
-- player has no way to switch the bubble's light off with them.
for _, setting in ipairs({ "HighlightWord", "Enabled" }) do
    Reset()
    local profile = env.Addon:Profile("Transcript")
    profile[setting] = false
    fs = Bubble(TEXT)
    Say()
    VO.ChatBubble.Tick()
    Expect("with the narrator's " .. setting .. " off the bubble is lit all the same", fs.text ~= TEXT, true)
    profile[setting] = true
end

---------------------------------------------------------------- the loop that drives it
Reset()
fs = Bubble(TEXT)
Say()
local loop = VO.ChatBubble.frame
Expect("a line starting as NPC chat starts the loop", type(loop.scripts.OnUpdate), "function")
stub.Advance(0.1)
loop.scripts.OnUpdate(loop, 0.1)
Expect("...which marks the bubble", fs.text ~= TEXT, true)
Spoken:Pause()
loop.scripts.OnUpdate(loop, 0.1)
Expect("...and ends itself when the line is stopped", loop.scripts.OnUpdate, nil)

---------------------------------------------------------------- another NPC's bubble is left alone
Reset()
local other = Bubble("Somebody else's words.")
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
Expect("a bubble that is not this line's is not touched", other.text, "Somebody else's words.")
Expect("...while the line's own is", fs.text ~= TEXT, true)

---------------------------------------------------------------- no bubble
Reset()
Say()
Expect("with no bubble on screen the tick waits for one", VO.ChatBubble.Tick(), true)
fs = Bubble(TEXT)
VO.ChatBubble.Tick()
Expect("...and marks it once it comes", fs.text ~= TEXT, true)

---------------------------------------------------------------- the game reuses the bubble
Reset()
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
fs.text = "A different line altogether."
stub.Advance(1)
VO.ChatBubble.Tick()
Expect("a bubble the game rewrote under it is left as the game has it", fs.text, "A different line altogether.")

---------------------------------------------------------------- a bubble the client forbids
Reset()
local forbidden = { GetChildren = function() error("forbidden frame") end }
table.insert(bubbles, forbidden)
fs = Bubble(TEXT)
Say()
Expect("a forbidden bubble raises nothing", pcall(VO.ChatBubble.Tick), true)
Expect("...and the next one is still marked", fs.text ~= TEXT, true)

---------------------------------------------------------------- a bubble whose text turns secret
Reset()
fs = Bubble(TEXT)
Say()
VO.ChatBubble.Tick()
local marked = fs.text
stub.Secrets(marked)
stub.Advance(1)
Expect("a bubble whose text turned secret mid-line raises nothing", pcall(VO.ChatBubble.Tick), true)
Expect("...and is left alone", fs.text, marked)
VO.ChatBubble:Restore()
Expect("...even when the line ends", fs.text, marked)
stub.Secrets()

if Failures() > 0 then os.exit(1) end

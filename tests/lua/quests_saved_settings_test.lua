-- What a player of the develop build already has saved: SpokenQuestsSettings with two characters on
-- two profiles. Gossip is a part inside the Quests addon and adds no saved variable, so every one of
-- these values has to come back untouched, and nothing the part adds may be written over them.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local SEEN = "Creature-0-0-0-0-12345-0"
local function Seed()
    _G.SpokenSettings = nil
    _G.SpokenQuestsSettings = {
        profileKeys = { ["Tester - Realm"] = "Default", ["Alt - Realm"] = "Second" },
        profiles = {
            Default = { Audio = { GossipFrequency = 4, GreetingFirst = true, OGThrall = true,
                StopAudioOnDisengage = true, Autoplay = false } },
            Second = { Audio = { GossipFrequency = 1, GreetingFirst = false, OGThrall = false, Autoplay = true } },
        },
        char = {
            ["Tester - Realm"] = { hasSeenGossipForNPC = { [SEEN] = true } },
            ["Alt - Realm"] = { hasSeenGossipForNPC = { ["Creature-0-0-0-0-777-0"] = true } },
        },
    }
end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.ldbObjects = {}; stub.dbIcons = {}
Seed()
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local audio = VO.Addon.db.profile.Audio

Expect("the profile this character is on is kept", VO.Addon.db:GetCurrentProfile(), "Default")
Expect("Read Greetings keeps its value", audio.GossipFrequency, VO.Enums.GossipFrequency.Never)
Expect("NPC Voice Before Reading keeps its value", audio.GreetingFirst, true)
Expect("Original Thrall Speech keeps its value", audio.OGThrall, true)
Expect("Stop When Window Closes keeps its value", audio.StopAudioOnDisengage, true)
Expect("Read Automatically keeps its value", audio.Autoplay, false)
-- The test client's AceDB has no real per-character key, so check that what it hands back is
-- one of the saved records, untouched, and that neither record was dropped.
local ownRecord = false
for _, record in pairs(_G.SpokenQuestsSettings.char) do
    if VO.Addon.db.char.hasSeenGossipForNPC == record.hasSeenGossipForNPC then ownRecord = true end
end
Expect("a character's heard NPCs come back from its own saved record", ownRecord, true)
Expect("...and neither record was dropped", _G.SpokenQuestsSettings.char["Tester - Realm"] ~= nil
    and _G.SpokenQuestsSettings.char["Alt - Realm"] ~= nil, true)

VO.Addon.db:SetProfile("Second")
local second = VO.Addon.db.profile.Audio
Expect("the other profile keeps its own Read Greetings", second.GossipFrequency, VO.Enums.GossipFrequency.Always)
Expect("...and its own NPC Voice Before Reading", second.GreetingFirst, false)
Expect("...and its own Read Automatically", second.Autoplay, true)

-- Switching a part off is the profile's own, saved beside what was there, not instead of it.
_G.Spoken:SetPartOn("gossip", false)
Expect("a part switched off is saved in Spoken's profile", _G.Spoken:IsPartOn("gossip"), false)
Expect("...and leaves the quests settings as they were", second.GossipFrequency, VO.Enums.GossipFrequency.Always)
_G.Spoken:SetPartOn("gossip", true)

_G.SpokenQuestsSettings.global = { Compendium = { FoundOnly = false, UnlockUnfound = true } }
VO.Addon:OnInitialize()
local compendium = VO.Addon.db.global.Compendium
Expect("a Started Only saved off before it was on by default reads as on again", compendium.FoundOnly, nil)
Expect("...leaving Unlock Unstarted Quests as it was", compendium.UnlockUnfound, true)
compendium.FoundOnly = false
VO.Addon:OnInitialize()
Expect("...and turned off again, it stays off", VO.Addon.db.global.Compendium.FoundOnly, false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests saved settings tests passed")

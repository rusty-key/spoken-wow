-- What a player of the develop build already has saved: SpokenQuestsSettings with two characters on
-- two profiles. Gossip is a part inside the Quests addon and adds no saved variable, so every one of
-- these values has to come back untouched, and nothing the part adds may be written over them.
-- Greetings heard are the exception: they move from each spawn's GUID to the NPC's ID, so the
-- character does not hear them again.
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
-- Greetings heard as they were kept before: under each spawn's GUID, two spawns of one NPC. Both
-- characters hold them, since the test client's AceDB may hand back either record.
local function HeardByGUID()
    return {
        [SEEN] = true,
        ["Creature-0-0-0-0-4567-1"] = { ["0000aaaa"] = true },
        ["Creature-0-0-0-0-4567-2"] = { ["0000bbbb"] = true },
        -- An object with the same ID as the NPC above: a different speaker.
        ["GameObject-0-0-0-0-4567-1"] = { ["0000cccc"] = true },
    }
end
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
            ["Tester - Realm"] = { hasSeenGossipForNPC = HeardByGUID() },
            ["Alt - Realm"] = { hasSeenGossipForNPC = HeardByGUID() },
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
-- one of the saved records, not a copy, and that neither record was dropped.
local ownRecord = false
for _, record in pairs(_G.SpokenQuestsSettings.char) do
    if VO.Addon.db.char.hasSeenGossipForNPC == record.hasSeenGossipForNPC then ownRecord = true end
end
Expect("a character's heard NPCs come back from its own saved record", ownRecord, true)
Expect("...and neither record was dropped", _G.SpokenQuestsSettings.char["Tester - Realm"] ~= nil
    and _G.SpokenQuestsSettings.char["Alt - Realm"] ~= nil, true)
local heard = VO.Addon.db.char.hasSeenGossipForNPC
Expect("greetings heard under two spawns' GUIDs are kept under the NPC's ID",
    type(heard[4567]) == "table" and heard[4567]["0000aaaa"] and heard[4567]["0000bbbb"], true)
Expect("...and the GUIDs are gone", heard["Creature-0-0-0-0-4567-1"] == nil
    and heard["Creature-0-0-0-0-4567-2"] == nil, true)
Expect("...as is a GUID marked before texts were told apart", heard[SEEN], nil)
Expect("an object's greetings move to a key of their own", type(heard.o4567) == "table"
    and heard.o4567["0000cccc"], true)
Expect("...and its GUID is gone", heard["GameObject-0-0-0-0-4567-1"], nil)
Expect("...and it shares nothing with the NPC of its ID", heard[4567]["0000cccc"] == nil
    and heard.o4567["0000aaaa"] == nil, true)

VO.Addon:MarkGreetingHeard("GameObject-0-0-0-0-4567-2", "A voiced plaque.")
Expect("an object's greeting stays heard under a new GUID",
    VO.Addon:HasHeardGreeting("GameObject-0-0-0-0-4567-3", "A voiced plaque."), true)
Expect("...and is not heard from the NPC of its ID",
    VO.Addon:HasHeardGreeting("Creature-0-0-0-0-4567-1", "A voiced plaque."), false)

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

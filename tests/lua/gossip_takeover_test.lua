-- The gossip module's first login: the settings it takes over from the quests module, which read
-- gossip before there was a module of its own (Spoken_Gossip/Gossip.lua, TakeOverFromQuests).
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local CHAR = "Tester - Realm"
local NPC = "Creature-0-0-0-0-12345-0"

--- A login with the quests module's saved settings as given. `keep` keeps the gossip module's
--- own from the last login; `questsOff` has quests switched off in Spoken's settings.
local function Login(quests, keep, questsOff)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    if not keep then _G.SpokenGossipSettings = nil end
    -- Spoken's own too: which parts are switched on is its to keep.
    _G.SpokenSettings = nil
    _G.SpokenQuestsSettings = quests
    local G = stub.LoadGossip(GOSSIP, SPOKEN)
    if questsOff then _G.Spoken:SetPartOn("quests", false) end
    G.Addon:OnInitialize()
    stub.FireEvent("PLAYER_LOGIN")
    return G, G.Enums.GossipFrequency
end

local function Quests(audio, extra)
    local saved = {
        profiles = { Default = { Audio = audio }, Shared = { Audio = { GossipFrequency = 0 } } },
        char = { [CHAR] = { hasSeenGossipForNPC = { [NPC] = true } } },
    }
    for key, value in pairs(extra or {}) do saved[key] = value end
    return saved
end

---------------------------------------------------------------- the settings, per profile
local G, F = Login(nil)
local always, never = F.Always, F.Never
G, F = Login(Quests({ GossipFrequency = always, StopAudioOnDisengage = true, OGThrall = true }))
local audio = G.Addon.db.profile.Audio
Expect("NPC Greetings comes over", audio.GossipFrequency, always)
Expect("...Stop When Window Closes", audio.StopAudioOnDisengage, true)
Expect("...and Original Thrall Speech", audio.OGThrall, true)
Expect("...every profile's, not only the one in use", _G.SpokenGossipSettings.profiles.Shared.Audio.GossipFrequency, 0)
Expect("the greetings this character has heard come over", G.Addon.db.char.hasSeenGossipForNPC[NPC], true)

---------------------------------------------------------------- once
_G.SpokenQuestsSettings.profiles.Default.Audio.GossipFrequency = never
G, F = Login(_G.SpokenQuestsSettings, true)
Expect("it is taken over once: the next login keeps what is here", G.Addon.db.profile.Audio.GossipFrequency, always)

---------------------------------------------------------------- autoplay off
-- Autoplay off read no greeting by itself, which is Never here.
G, F = Login(Quests({ Autoplay = false, GossipFrequency = always }))
Expect("autoplay off in quests is NPC Greetings at Never", G.Addon.db.profile.Audio.GossipFrequency, never)

---------------------------------------------------------------- nothing to take over
G, F = Login(nil)
Expect("with no quests settings, the default", G.Addon.db.profile.Audio.GossipFrequency, F.OncePerNPC)
Expect("...and it is not looked for again", G.Addon.db.global.fromQuests, true)

---------------------------------------------------------------- the profile in use
G, F = Login(Quests({ GossipFrequency = always }, { profileKeys = { [CHAR] = "Shared", ["Alt - Realm"] = "Shared" } }))
Expect("each character stays on the profile it was on", G.Addon.db:GetCurrentProfile(), "Shared")
Expect("...the characters not logged in too, alts sharing a profile there sharing it here",
    (_G.SpokenGossipSettings.profileKeys or {})["Alt - Realm"], "Shared")

---------------------------------------------------------------- quests switched off
-- A player who had quests off heard no gossip.
G, F = Login(Quests({ GossipFrequency = always }), false, true)
Expect("with quests switched off, gossip starts off too", _G.Spoken:IsPartOn("gossip"), false)
G, F = Login(Quests({ GossipFrequency = always }))
Expect("...and on where quests was on", _G.Spoken:IsPartOn("gossip"), true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip takeover tests passed")

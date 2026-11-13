-- The easter egg swap: with its option on, a line resolves to a recording shipped inside the
-- player instead of the one the installed pack holds. Run with `make test-player`.
--
-- The swap happens after a pack has already been consulted, so it has to survive both cases -
-- the pack that has the line (the usual one) and the player who installed no pack that does.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local VO = stub.LoadPlayer(here .. "/../../addons/Spoken_Quests/")

local failures = 0

local function Expect(scenario, actual, expected)
    if actual == expected then
        print(string.format("ok   %s\n     %s", scenario, tostring(actual)))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
            tostring(expected), tostring(actual)))
    end
end

VO.Addon:OnInitialize()
stub.Advance(2) -- Wait out the deferred data module load that OnInitialize schedules.

local THRALL = "9fdeb82237b72e8801030487901e690f"
local EGG_PATH = [[Interface\AddOns\Spoken_Quests\Sounds\og-thrall.mp3]]

-- The option ships off, so a fresh install hears whatever the pack holds.
local soundData = { fileName = THRALL, filePath = "pack-path" }
Expect("option off leaves the line alone", VO.EasterEggs:Apply(soundData), false)
Expect("option off keeps the pack's path", soundData.filePath, "pack-path")

VO.Addon.db.profile.Audio.OGThrall = true

soundData = { fileName = THRALL, filePath = "pack-path", length = 1,
    module = { METADATA = { AddonName = "TestPack" } } }
Expect("option on swaps the path", VO.EasterEggs:Apply(soundData) and soundData.filePath, EGG_PATH)
Expect("option on swaps the length", soundData.length, 33.802375)

-- A line nobody wrote an egg for keeps whatever the pack resolved.
soundData = { fileName = "1234-accept", filePath = "pack-path" }
Expect("other lines untouched", VO.EasterEggs:Apply(soundData) or soundData.filePath, "pack-path")

-- No pack holds the line - an Alliance-only install, say. The egg still plays, and names an
-- addon, because SoundQueue logs the module a sound came from.
soundData = { fileName = THRALL }
VO.EasterEggs:Apply(soundData)
Expect("egg without a pack names an addon", soundData.module.METADATA.AddonName, "Spoken_Quests")

-- And the swap is actually wired into the resolve, not just callable on its own. Keyed on a
-- quest file name here only because that is the one PrepareSound can be handed directly.
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["4949-accept"] = 1 },
    GetSoundPath = function(_, fileName) return "quests\\" .. fileName .. ".ogg" end,
})
VO.EasterEggs.alternates["4949-accept"] =
    { path = [[Sounds\og-thrall.mp3]], length = 33.802375, option = "OGThrall" }
soundData = { event = VO.Enums.SoundEvent.QuestAccept, questID = 4949 }
Expect("PrepareSound applies the swap",
    VO.DataModules:PrepareSound(soundData) and soundData.filePath, EGG_PATH)

print(failures == 0 and "\nAll easter egg tests passed" or string.format("\n%d test(s) failed", failures))
os.exit(failures == 0 and 0 or 1)

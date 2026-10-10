-- How the quests addon finds its sound packs. A pack is discovered by a TOC key, never by
-- folder name, which is why the packs kept their names through the rename. The key itself
-- is being renamed, so both generations are read: the inherited X-VoiceOver-DataModule-*,
-- which every shipped pack and every third-party pack built for upstream carries, and
-- X-SpokenQuests-DataModule-*. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local OLD, NEW = "X-VoiceOver-DataModule-", "X-SpokenQuests-DataModule-"

--- Install one pack carrying exactly the given TOC keys, and enumerate.
local function Enumerate(meta)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    meta.Title = meta.Title or "TestPack"
    meta.Version = meta.Version or "1.2.1"
    stub.SetAddOns({ { folder = "TestPack", meta = meta } })
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.DataModules:EnumerateAddons(false)
    return VO, VO.DataModules.presentModules["TestPack"]
end

---------------------------------------------------------------- the inherited key
local VO, found = Enumerate({ [OLD .. "Version"] = "1", [OLD .. "Priority"] = "5", [OLD .. "Maps"] = "1,2" })
Expect("a pack with the inherited key is found", found ~= nil, true)
Expect("...its format version is read", found and found.ModuleVersion, 1)
Expect("...its priority", found and found.ModulePriority, 5)
Expect("...and its maps", found and found.Maps[2], true)

---------------------------------------------------------------- the new key
VO, found = Enumerate({ [NEW .. "Version"] = "1", [NEW .. "Priority"] = "7", [NEW .. "Maps"] = "3" })
Expect("a pack with only the new key is found", found ~= nil, true)
Expect("...its format version is read", found and found.ModuleVersion, 1)
Expect("...its priority", found and found.ModulePriority, 7)
Expect("...and its maps", found and found.Maps[3], true)

---------------------------------------------------------------- both, as a transitional pack ships
-- A pack built during the transition carries both so it also loads under the old addon.
-- The values agree there; when they do not, the new key is the one this addon believes.
VO, found = Enumerate({ [OLD .. "Version"] = "1", [OLD .. "Priority"] = "5",
                        [NEW .. "Version"] = "1", [NEW .. "Priority"] = "7" })
Expect("a pack carrying both is found once", found ~= nil, true)
Expect("...and the new key wins", found and found.ModulePriority, 7)

---------------------------------------------------------------- key by key
-- The keys are read one at a time, so a pack may carry the new version key and nothing else.
VO, found = Enumerate({ [NEW .. "Version"] = "1", [OLD .. "Priority"] = "5" })
Expect("a missing new key falls back on its own", found and found.ModulePriority, 5)

---------------------------------------------------------------- registration
-- Register re-reads the version key to check the data format, and must find it either way.
VO = Enumerate({ [NEW .. "Version"] = "1" })
local ok = pcall(function() VO.DataModules:Register("TestPack", { GetSoundPath = function() end }) end)
Expect("a new-key pack can register its data", ok, true)

---------------------------------------------------------------- switched off in the AddOns list
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.SetAddOns({
    { folder = "OnPack", meta = { [OLD .. "Version"] = "1", Title = "OnPack", Version = "1.2.1" } },
    { folder = "OffPack", loadable = false, reason = "DISABLED",
        meta = { [OLD .. "Version"] = "1", Title = "OffPack", Version = "1.2.1" } },
})
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.DataModules:EnumerateAddons(false)
Expect("a pack switched off in the AddOns list is not found", VO.DataModules.presentModules["OffPack"], nil)
Expect("...while one switched on is", VO.DataModules.presentModules["OnPack"] ~= nil, true)
Expect("...and nothing was switched on to load it", #stub.enabledAddOns, 0)

---------------------------------------------------------------- not a pack at all
VO, found = Enumerate({ Title = "Some other addon" })
Expect("an addon carrying neither key is not a pack", found, nil)

---------------------------------------------------------------- offering updates
-- The versions the addon offers are written into it, so a pack can be newer than the addon
-- knows. Only an older pack is offered an update; a newer one must not be sent back.
local D = VO.DataModules
Expect("an older pack is out of date", D:IsOlderContent("2.0.0", "2.1.0"), true)
Expect("...by any component", D:IsOlderContent("2.1.9", "2.10.0"), true)
Expect("the same version is not", D:IsOlderContent("2.1.0", "2.1.0"), false)
Expect("a newer pack is not", D:IsOlderContent("2.1.0", "2.0.0"), false)
Expect("a missing trailing part counts as zero", D:IsOlderContent("2.1", "2.1.0"), false)
Expect("a version that is not numbers is never out of date", D:IsOlderContent("dev", "2.1.0"), false)
Expect("...nor is a missing one", D:IsOlderContent(nil, "2.1.0"), false)

--- Install one shipping pack at a version, and collect what the options offer for it.
local function Offered(version)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetAddOns({ { folder = "SpokenQuestsAudioShared",
        meta = { Title = "Spoken Quests Audio: Shared Quests", Version = version, [NEW .. "Version"] = "1" } } })
    local vo = stub.LoadQuests(QUESTS, SPOKEN)
    local offered = {}
    vo.Options = setmetatable({
        AddAvailableDataModule = function(_, module, _, update) offered[module.AddonName] = update end,
    }, { __index = function() return function() end end })
    vo.DataModules:EnumerateAddons(false)
    return offered, vo.DataModules
end
local known
for _, module in VO.DataModules:GetAvailableModules() do
    if module.AddonName == "SpokenQuestsAudioShared" then known = module.ContentVersion end
end
local offered = Offered("1.0.0")
Expect("an older installed pack is offered its update", offered.SpokenQuestsAudioShared, true)
offered = Offered(known)
Expect("a current pack is offered nothing", offered.SpokenQuestsAudioShared, nil)
offered = Offered("99.0.0")
Expect("a pack newer than the addon knows is offered nothing", offered.SpokenQuestsAudioShared, nil)
Expect("...and having a pack silences the others", offered.SpokenQuestsAudioHorde, nil)

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll data module tests passed")

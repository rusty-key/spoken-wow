-- A quest given by NPCs of different voices is a file per voice, and each giver is heard in
-- its own. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

--- One pack holding `lines`, and the per-giver files `byNPC` names.
local function Install(lines, byNPC, byObject)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetAddOns({ { folder = "Pack", meta = { ["X-SpokenQuests-DataModule-Version"] = "1",
        Version = "1.0.0", Title = "Pack" } } })
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    VO.DataModules:EnumerateAddons(false)
    VO.DataModules:Register("Pack", {
        SoundLengthLookupByFileName = lines,
        QuestFileLookupByNPCID = byNPC,
        QuestFileLookupByObjectID = byObject,
        GetSoundPath = function(_, fileName) return fileName end,
    })
    return VO
end

local function Resolve(VO, guid, event)
    local soundData = { event = event or VO.Enums.SoundEvent.QuestAccept, questID = 109, unitGUID = guid }
    local found = VO.DataModules:PrepareSound(soundData)
    return found and soundData.fileName or nil
end

local FARMER = "Creature-0-0-0-0-237-0"
local TRAINER = "Creature-0-0-0-0-911-0"
local GRAVE = "GameObject-0-0-0-0-61-0"

local VO = Install(
    { ["109-accept"] = 5.0, ["109-accept-human-male-standard"] = 5.2, ["109-complete"] = 4.0 },
    { ["109-accept"] = { [237] = "109-accept-human-male-standard" } },
    { ["109-accept"] = { [61] = "109-accept-narrator-male" } })

Expect("a giver of another voice is heard in its own file", Resolve(VO, FARMER), "109-accept-human-male-standard")
Expect("a giver of the line's own voice is heard in the line's file", Resolve(VO, TRAINER), "109-accept")
Expect("a moment the giver shares no other voice of is the line's", Resolve(VO, FARMER, VO.Enums.SoundEvent.QuestComplete), "109-complete")
Expect("a giver whose voice no installed pack has yet still hears the line", Resolve(VO, GRAVE), "109-accept")
Expect("a quest with no giver known is the line's", Resolve(VO, nil), "109-accept")

VO = Install({ ["109-accept"] = 5.0 }, nil, nil)
Expect("a pack built before per-voice files resolves as it always has", Resolve(VO, FARMER), "109-accept")

-- Two packs of different languages: the player's own language holds only the line, English
-- holds the giver's voice too. The line in the player's language wins over English.
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.SetLocale("deDE")
stub.SetAddOns({
    { folder = "German", meta = { ["X-SpokenQuests-DataModule-Version"] = "1", Version = "1.0.0",
        Title = "German", ["X-SpokenQuests-Language"] = "deDE" } },
    { folder = "English", meta = { ["X-SpokenQuests-DataModule-Version"] = "1", Version = "1.0.0",
        Title = "English" } },
})
_G.SpokenQuestsSettings = nil
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:EnumerateAddons(false)
local byNPC = { ["109-accept"] = { [237] = "109-accept-human-male-standard" } }
VO.DataModules:Register("German", { SoundLengthLookupByFileName = { ["109-accept"] = 5.0 },
    QuestFileLookupByNPCID = byNPC, GetSoundPath = function(_, fileName) return fileName end })
VO.DataModules:Register("English", { SoundLengthLookupByFileName = { ["109-accept"] = 5.0,
    ["109-accept-human-male-standard"] = 5.2 }, QuestFileLookupByNPCID = byNPC,
    GetSoundPath = function(_, fileName) return fileName end })
local soundData = { event = VO.Enums.SoundEvent.QuestAccept, questID = 109, unitGUID = FARMER }
VO.DataModules:PrepareSound(soundData)
Expect("a giver's voice only another language has yields to the line in the player's", soundData.language, "deDE")
Expect("and the file is the line's", soundData.fileName, "109-accept")

stub.SetLocale("enUS")
stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest voice file tests passed")

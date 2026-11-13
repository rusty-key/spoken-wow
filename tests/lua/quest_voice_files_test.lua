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
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
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
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
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

-- A creature drawn as a man or a woman under one id speaks each line in the voice of the sex on
-- screen, found by the line's own stem.
local GUARD = "Creature-0-0-0-0-68-0"
local CLERK = "Creature-0-0-0-0-1-0"
local LINE = string.rep("a", 32)
stub.SetLocale("enUS")
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
stub.SetAddOns({ { folder = "Pack", meta = { ["X-SpokenQuests-DataModule-Version"] = "1",
    Version = "1.0.0", Title = "Pack" } } })
_G.SpokenQuestsSettings = nil
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:EnumerateAddons(false)
VO.DataModules:Register("Pack", {
    SoundLengthLookupByFileName = { [LINE] = 3.0, [LINE .. "-human-female-official"] = 3.1,
        ["109-accept"] = 5.0, ["109-accept-human-female-official"] = 5.1 },
    GossipLookupByNPCID = { [68] = { ["Well met."] = LINE }, [1] = { ["Well met."] = LINE } },
    GossipFileLookupByNPCSex = { [68] = { [2] = { [LINE] = LINE },
        [3] = { [LINE] = LINE .. "-human-female-official" } } },
    QuestFileLookupByNPCSex = { ["109-accept"] = { [68] = { [3] = "109-accept-human-female-official" } } },
    NPCSexByNPCID = { [1] = 2 },
    GetSoundPath = function(_, fileName) return fileName end,
})
local function Greet(guid, sex)
    local data = { event = VO.Enums.SoundEvent.Gossip, unitGUID = guid, text = "Well met.", npcSex = sex }
    return VO.DataModules:PrepareSound(data) and data.fileName or nil, VO.DataModules:IsOtherBody(data)
end
local function Accept(guid, sex)
    local data = { event = VO.Enums.SoundEvent.QuestAccept, questID = 109, unitGUID = guid, npcSex = sex }
    return VO.DataModules:PrepareSound(data) and data.fileName or nil
end
Expect("a split NPC drawn as a woman hears the woman's file", Greet(GUARD, 3), LINE .. "-human-female-official")
Expect("drawn as a man, the man's", Greet(GUARD, 2), LINE)
Expect("with its sex unknown, the line's own", Greet(GUARD, 1), LINE)
Expect("a split NPC's quest line is the sex's too", Accept(GUARD, 3), "109-accept-human-female-official")
Expect("and the line's own for the sex no file names", Accept(GUARD, 2), "109-accept")
Expect("a split NPC is no other sex's", select(2, Greet(GUARD, 3)), false)
Expect("an NPC voiced as a man and drawn as a woman is the other sex", select(2, Greet(CLERK, 3)), true)
Expect("and still plays the man's line", Greet(CLERK, 3), LINE)
Expect("drawn as the sex it is voiced as, it is not", select(2, Greet(CLERK, 2)), false)

--- One pack holding the greeting for each creature below, with `tables` merged into it.
local function InstallBodies(tables)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetAddOns({ { folder = "Pack", meta = { ["X-SpokenQuests-DataModule-Version"] = "1",
        Version = "1.0.0", Title = "Pack" } } })
    _G.SpokenQuestsSettings = nil
    local loaded = stub.LoadQuests(QUESTS, SPOKEN)
    loaded.Addon:OnInitialize()
    loaded.DataModules:EnumerateAddons(false)
    local module = {
        SoundLengthLookupByFileName = { [LINE] = 3.0, [LINE .. "-gnome-male-standard"] = 3.2,
            [LINE .. "-human-female-official"] = 3.1,
            ["109-accept"] = 5.0, ["109-accept-gnome-male-standard"] = 5.2 },
        GossipLookupByNPCID = { [15906] = { ["Well met."] = LINE }, [68] = { ["Well met."] = LINE },
            [1] = { ["Well met."] = LINE } },
        GetSoundPath = function(_, fileName) return fileName end,
    }
    for key, value in pairs(tables) do module[key] = value end
    loaded.DataModules:Register("Pack", module)
    return loaded
end

-- A creature drawn as a dwarf or a gnome under one id speaks each line in the voice of the body
-- on screen, read from its model; while the model is not loaded, its sex's file plays.
local REVELER = "Creature-0-0-0-0-15906-0"
VO = InstallBodies({
    GossipFileLookupByNPCBody = { [15906] = { ["dwarf-male"] = { [LINE] = LINE },
                                              ["gnome-male"] = { [LINE] = LINE .. "-gnome-male-standard" } } },
    GossipFileLookupByNPCSex = { [15906] = { [2] = { [LINE] = LINE } } },
    QuestFileLookupByNPCBody = { ["109-accept"] = { [15906] = { ["gnome-male"] = "109-accept-gnome-male-standard" } } },
    NPCBodiesByNPCID = { [15906] = { ["dwarf-male"] = true, ["gnome-male"] = true }, [1] = { ["human-male"] = true } },
    NPCSexByNPCID = { [1] = 2 },
    BodyByModelFileID = { [119159] = "gnome-male", [118355] = "dwarf-male", [119940] = "human-male" },
})

local function GreetAs(guid, model, sex)
    stub.world.npcGUID = guid; stub.world.modelFileID = model; stub.world.unitSex = sex or 2
    if model then VO.NPCModel:Prime(guid, "npc"); stub.FinishModelLoad() end
    local data = { event = VO.Enums.SoundEvent.Gossip, unitGUID = guid, text = "Well met." }
    return VO.DataModules:PrepareSound(data) and data.fileName or nil, VO.DataModules:IsOtherBody(data)
end
local function AcceptAs(guid, model)
    stub.world.npcGUID = guid; stub.world.modelFileID = model; stub.world.unitSex = 2
    if model then VO.NPCModel:Prime(guid, "npc"); stub.FinishModelLoad() end
    local data = { event = VO.Enums.SoundEvent.QuestAccept, questID = 109, unitGUID = guid }
    return VO.DataModules:PrepareSound(data) and data.fileName or nil
end

Expect("a gnome Reveler is heard in the gnome's file", GreetAs(REVELER, 119159), LINE .. "-gnome-male-standard")
Expect("a dwarf Reveler in the dwarf's", GreetAs("Creature-0-0-0-0-15906-1", 118355), LINE)
Expect("with its model not loaded, its sex's file", GreetAs("Creature-0-0-0-0-15906-2", nil), LINE)
Expect("a gnome Reveler's quest line is the gnome's", AcceptAs("Creature-0-0-0-0-15906-5", 119159), "109-accept-gnome-male-standard")
Expect("...and the line's own while its model is not in", AcceptAs("Creature-0-0-0-0-15906-6", nil), "109-accept")
Expect("a split NPC drawn as a body it has is no other body's", select(2, GreetAs("Creature-0-0-0-0-15906-3", 119159)), false)
Expect("a split NPC drawn as a body it lacks is another body", select(2, GreetAs("Creature-0-0-0-0-15906-4", 119940)), true)
Expect("an unsplit human drawn as a gnome is another body", select(2, GreetAs("Creature-0-0-0-0-1-1", 119159)), true)
Expect("an unsplit human drawn as a human is not", select(2, GreetAs("Creature-0-0-0-0-1-2", 119940)), false)
Expect("an unknown model falls back to the sex", select(2, GreetAs("Creature-0-0-0-0-1-3", 424242)), false)
Expect("...which still sees the other sex", select(2, GreetAs("Creature-0-0-0-0-1-4", 424242, 3)), true)
Expect("a split creature is split", VO.DataModules:IsSplit(15906), true)
Expect("an unsplit one is not", VO.DataModules:IsSplit(1), false)

-- A pack built before bodies carries only the sex tables: the new addon still hears the sex.
VO = InstallBodies({
    GossipFileLookupByNPCSex = { [68] = { [3] = { [LINE] = LINE .. "-human-female-official" } } },
    NPCSexByNPCID = { [1] = 2 },
})
Expect("an old pack's sex file still plays", GreetAs("Creature-0-0-0-0-68-0", 119563, 3), LINE .. "-human-female-official")
Expect("and an old pack's other sex is still seen", select(2, GreetAs("Creature-0-0-0-0-1-9", 119563, 3)), true)
Expect("an old pack's split creature is split", VO.DataModules:IsSplit(68), true)
stub.world.npcGUID = "Creature-0-0-0-0-1234-0"; stub.world.modelFileID = nil; stub.world.unitSex = 2

stub.SetLocale("enUS")
stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest voice file tests passed")

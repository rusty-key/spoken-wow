-- A quest moment the game shows in more than one wording: the text on screen picks the file,
-- as it picks a gossip line. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local HORDE = "You are the Horde, $c, Modera spoke of. Tell me why I should not have you shattered."
local BACK = "Oh, you are back."
local lines = { ["20-accept"] = 5.0, ["20-accept-w1"] = 2.0, ["21-accept"] = 4.0 }

local function Boot(locale, gossipText)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    world.playerName = "Valaas"; world.playerClass = "Mage"; world.unitSex = 2
    stub.SetAddOns({ { folder = "Pack", meta = { ["X-SpokenQuests-DataModule-Version"] = "1",
        Version = "1.0.0", Title = "Pack" } } })
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    VO.DataModules:EnumerateAddons(false)
    VO.DataModules:Register("Pack", {
        SoundLengthLookupByFileName = lines,
        LookupLocale = "enUS",
        QuestWordingLookup = { ["20-accept"] = { [HORDE] = "20-accept", [BACK] = "20-accept-w1" } },
        GetSoundPath = function(_, fileName) return fileName end,
    })
    VO.GossipText = gossipText
    return VO
end

local function Accept(VO, questID, text)
    local soundData = { event = VO.Enums.SoundEvent.QuestAccept, questID = questID, text = text,
        unitGUID = "Creature-0-0-0-0-2-0" }
    return VO.DataModules:PrepareSound(soundData) and soundData.fileName or nil
end

local VO = Boot()
Expect("the first wording plays its own file",
    Accept(VO, 20, "You are the Horde, Mage, Modera spoke of. Tell me why I should not have you shattered."),
    "20-accept")
Expect("another wording plays its own", Accept(VO, 20, "Oh, you are back."), "20-accept-w1")
Expect("a wording the packs lack plays nothing", Accept(VO, 20, "Greetings, traveller, the road is long."), nil)
Expect("a moment with one wording is named from its id alone", Accept(VO, 21, "Anything at all."), "21-accept")
Expect("with no text on screen, the moment's file", Accept(VO, 20, nil), "20-accept")
Expect("an empty text is no text: the moment's file", Accept(VO, 20, ""), "20-accept")

do
    local soundData = { event = VO.Enums.SoundEvent.QuestAccept, questID = 20, text = "Oh, you are back.",
        unitGUID = "Creature-0-0-0-0-2-0" }
    local known = VO.DataModules:IsTextKnown(soundData)
    VO.DataModules:GetModule("Pack").TextByFileName = { ["20-accept-w1"] = "Other words." }
    Expect("a pack's words do not change which text counts as known", VO.DataModules:IsTextKnown(soundData), known)
    Expect("...and a wording still finds its file by the window's words", Accept(VO, 20, "Oh, you are back."), "20-accept-w1")
    VO.DataModules:GetModule("Pack").TextByFileName = nil
end

-- The window offers Contribute when the wording on screen has no line, though the moment's
-- first wording has audio.
SpokenEnv.Spoken.Gather:SetEnabled(false)
world.questID = 20; world.title = "T"; world.npcName = "Image of Archmage Modera"
world.npcGUID = "Creature-0-0-0-0-2-0"
world.questText = "Greetings, traveller, the road is long."
stub.ShowPanel("QuestFrameDetailPanel")
Expect("a wording no pack has is a gap to contribute", VO.Contribute:HasGap(), true)
world.questText = BACK
Expect("a wording a pack has is none", VO.Contribute:HasGap(), false)

-- The Listen button asks the same: the wording on screen, not the moment's first.
local probe = VO.Addon:GetVisibleLine()
Expect("the line the window offers is the wording on screen", probe and probe.fileName, "20-accept-w1")
world.questText = "Greetings, traveller, the road is long."
Expect("a wording no pack has offers no Listen", VO.Addon:GetVisibleLine(), nil)
stub.HidePanels()

VO = Boot("deDE")
Expect("a client whose language has no wordings plays the moment's file",
    Accept(VO, 20, "Oh, Ihr seid zurück."), "20-accept")

VO = Boot("deDE", { QuestWordingLookup = { ["20-accept"] = {
    ["Ihr seid die Horde, $c."] = "20-accept", ["Oh, Ihr seid zurück."] = "20-accept-w1" } } })
Expect("a client in its own language matches its own text", Accept(VO, 20, "Oh, Ihr seid zurück."), "20-accept-w1")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest wording tests passed")

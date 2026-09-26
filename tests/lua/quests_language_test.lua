-- The language axis: which pack answers a line, and in what language. Run with
-- `make test-player`.
--
-- The rule under test is "the selected language, then the fallback language, then
-- silence" -- never "whatever pack happens to hold the line". The install that exists
-- today (one English pack that declares no language at all) must behave exactly as it
-- did before any of this existed; that is test A and it is the one that matters most.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/SpokenQuests/"
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local Expect, Failures = H.Expecter(print)

local KEY = "X-SpokenQuests-DataModule-Version"
local LANG = "X-SpokenQuests-Language"

--- Install the given packs and load the addon. Each entry is
--- { folder, language (nil = declares none), priority, lines = { [fileName] = length } }.
local function Install(packs, locale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    local addons = {}
    for _, pack in ipairs(packs) do
        local meta = { [KEY] = "1", Version = "1.0.0", Title = pack.folder }
        if pack.language then meta[LANG] = pack.language end
        if pack.priority then meta["X-SpokenQuests-DataModule-Priority"] = tostring(pack.priority) end
        table.insert(addons, { folder = pack.folder, meta = meta })
    end
    stub.SetAddOns(addons)
    -- The saved variables outlive a reload in this harness as they do on a client, so a
    -- scenario that changed a setting would otherwise hand it to the next one.
    _G.SpokenQuestsDB = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    -- The settings this file is about live on Addon.db, which AceDB only builds here.
    VO.Addon:OnInitialize()
    VO.DataModules:EnumerateAddons(false)
    for _, pack in ipairs(packs) do
        VO.DataModules:Register(pack.folder, {
            SoundLengthLookupByFileName = pack.lines,
            GossipLookupByNPCID = pack.gossip,
            LookupLocale = pack.lookupLocale,
            ClientLocaleLookups = pack.clientGossip and { GossipLookupByNPCID = pack.clientGossip },
            GetSoundPath = function(_, fileName) return fileName end,
        })
    end
    return VO
end

--- Resolve one quest-accept line, and say which pack answered it.
local function Resolve(VO, questID, event)
    local soundData = { event = event or VO.Enums.SoundEvent.QuestAccept, questID = questID }
    local found = VO.DataModules:PrepareSound(soundData)
    return found and soundData.module.METADATA.AddonName or nil, soundData
end

--- The gossip form: addressed by the NPC's text rather than a quest ID.
local function ResolveGossip(VO, text)
    local soundData = { event = VO.Enums.SoundEvent.Gossip, text = text,
        name = "Innkeeper", unitGUID = "Creature-0-0-0-0-6929-0" }
    local found = VO.DataModules:PrepareSound(soundData)
    return found and soundData.module.METADATA.AddonName or nil, soundData
end

local EN_LINES = { ["1-accept"] = 5.0, ["2-accept"] = 6.0 }

---------------------------------------------------------------- A. the install that exists today
-- One pack, no language key, English client. This is every player upstream has, and the
-- resolution must be the one they have always had.
local VO = Install({ { folder = "EnglishPack", lines = EN_LINES } })
local pack, sound = Resolve(VO, 1)
Expect("A. a pack declaring no language answers on an English client", pack, "EnglishPack")
Expect("A. ...and the path is unchanged", sound.filePath, [[Interface\AddOns\EnglishPack\1-accept]])
Expect("A. an undeclared pack reads as English", VO.DataModules:GetPresentModule("EnglishPack").Language, "enUS")
Expect("A. a line no pack holds is still silent", Resolve(VO, 99), nil)

---------------------------------------------------------------- B. the declared pack is preferred
-- Both packs hold the line; the player's language decides, not the install order.
local PACKS = {
    { folder = "EnglishPack", lines = EN_LINES },
    { folder = "PortuguesePack", language = "ptBR", lines = { ["1-accept"] = 5.5 } },
}
VO = Install(PACKS, "ptBR")
Expect("B. a Portuguese client hears the Portuguese pack", (Resolve(VO, 1)), "PortuguesePack")
VO = Install(PACKS, "enUS")
Expect("B. an English client hears the English pack", (Resolve(VO, 1)), "EnglishPack")

---------------------------------------------------------------- C. language beats priority
-- A higher-priority pack in the wrong language does not outrank the right language.
VO = Install({
    { folder = "EnglishPack", priority = 100, lines = EN_LINES },
    { folder = "PortuguesePack", language = "ptBR", priority = 0, lines = { ["1-accept"] = 5.5 } },
}, "ptBR")
Expect("C. priority does not override the selected language", (Resolve(VO, 1)), "PortuguesePack")

---------------------------------------------------------------- D. the fallback, and only then
-- Line 2 exists in English only. Portuguese is selected, so line 1 is Portuguese and
-- line 2 falls back -- rather than the whole resolution collapsing to one pack.
VO = Install(PACKS, "ptBR")
Expect("D. a line the selected language holds is not fallen back", (Resolve(VO, 1)), "PortuguesePack")
Expect("D. a line it does not hold falls back per line", (Resolve(VO, 2)), "EnglishPack")
local _, fellBack = Resolve(VO, 2)
Expect("D. ...and the clip records the language it was answered in", fellBack.language, "enUS")

---------------------------------------------------------------- E. fallback off is silence
-- "None" means the line is not spoken in a language nobody asked for.
VO = Install(PACKS, "ptBR")
VO.Addon.db.profile.Audio.FallbackLanguage = "none"
Expect("E. with no fallback, a missing line is silent", Resolve(VO, 2), nil)
Expect("E. ...while the selected language still answers", (Resolve(VO, 1)), "PortuguesePack")

---------------------------------------------------------------- F. an explicit choice outranks the client
-- A player on a Portuguese client who picked English keeps English; Auto does not.
VO = Install(PACKS, "ptBR")
VO.Addon.db.profile.Audio.VoiceLanguage = "enUS"
Expect("F. an explicit selection is honoured over the client locale", (Resolve(VO, 1)), "EnglishPack")
VO.Addon.db.profile.Audio.VoiceLanguage = "auto"
Expect("F. ...and Auto goes back to the client's own", (Resolve(VO, 1)), "PortuguesePack")
VO = Install(PACKS, "enUS")
VO.Addon.db.profile.Audio.VoiceLanguage = "ptBR"
Expect("F. a language may be chosen the client does not run in", (Resolve(VO, 1)), "PortuguesePack")

---------------------------------------------------------------- G. gossip: text by client, clip by voice
-- Which line an NPC is saying is found from its text as the *client* shows it; the clip is
-- then played in the voice language. The file is named for the English text's hash in
-- every language, so every pack names the same line the same way.
local GOSSIP_TEXT = "Welcome to the inn, traveller."
local GOSSIP_TEXT_PT = "Bem-vindo a estalagem, viajante."
local GOSSIP_HASH = "inn-greeting"
-- The NPC ID the GUID below names, as Utils:GetIDFromGUID reads it.
local INNKEEPER = 6929
local EN_GOSSIP = { [INNKEEPER] = { [GOSSIP_TEXT] = GOSSIP_HASH } }
local PT_GOSSIP = { [INNKEEPER] = { [GOSSIP_TEXT_PT] = GOSSIP_HASH } }

VO = Install({ { folder = "EnglishPack", lines = { [GOSSIP_HASH] = 4.0 }, gossip = EN_GOSSIP } }, "enUS")
local gossipPack, gossipSound = ResolveGossip(VO, GOSSIP_TEXT)
Expect("G. gossip plays on the install that exists today", gossipPack, "EnglishPack")
Expect("G. ...resolved through the pack's own hash", gossipSound.fileName, GOSSIP_HASH)

-- A German client with English packs: Auto selects German, no pack holds it, and
-- the English tables are the only ones there are. This is every EU player today; it must
-- keep playing the English clip rather than go quiet.
VO = Install({ { folder = "EnglishPack", lines = { [GOSSIP_HASH] = 4.0 }, gossip = EN_GOSSIP } }, "deDE")
Expect("G. a client in a language no pack declares keeps its English gossip",
    ResolveGossip(VO, "Willkommen im Gasthaus, Reisender."), "EnglishPack")

-- An English client choosing Portuguese: the English table recognises the text, the
-- Portuguese pack speaks it.
local BOTH = {
    { folder = "EnglishPack", lines = { [GOSSIP_HASH] = 4.0 }, gossip = EN_GOSSIP },
    { folder = "PortuguesePack", language = "ptBR", lines = { [GOSSIP_HASH] = 4.5 }, gossip = PT_GOSSIP },
}
VO = Install(BOTH, "enUS")
VO.Addon.db.profile.Audio.VoiceLanguage = "ptBR"
gossipPack, gossipSound = ResolveGossip(VO, GOSSIP_TEXT)
Expect("G. gossip is spoken in the voice language, not the client's", gossipPack, "PortuguesePack")
Expect("G. ...under the same hash", gossipSound.fileName, GOSSIP_HASH)

-- The client's own tables are searched first, and only they, when they know the NPC: a
-- Portuguese client asking with Portuguese text finds it in the Portuguese table even
-- though the English one lists the NPC too and has higher priority.
VO = Install({
    { folder = "EnglishPack", priority = 100, lines = { ["en-only"] = 4.0 },
      gossip = { [INNKEEPER] = { [GOSSIP_TEXT_PT] = "en-only" } } },
    { folder = "PortuguesePack", language = "ptBR", lines = { [GOSSIP_HASH] = 4.5 }, gossip = PT_GOSSIP },
}, "ptBR")
local _, lookedUp = ResolveGossip(VO, GOSSIP_TEXT_PT)
Expect("G. the client locale's table outranks another language's", lookedUp.fileName, GOSSIP_HASH)

-- Gossip falls back per line like any other line...
VO = Install({
    { folder = "EnglishPack", lines = { [GOSSIP_HASH] = 4.0 }, gossip = EN_GOSSIP },
    { folder = "PortuguesePack", language = "ptBR", lines = { ["1-accept"] = 5.5 }, gossip = PT_GOSSIP },
}, "ptBR")
Expect("G. a gossip line the voice language lacks falls back", ResolveGossip(VO, GOSSIP_TEXT_PT), "EnglishPack")
-- ...and like any other line, not when the fallback is off.
VO.Addon.db.profile.Audio.FallbackLanguage = "none"
Expect("G. ...and is silent with no fallback", ResolveGossip(VO, GOSSIP_TEXT_PT), nil)

---------------------------------------------------------------- I. which tables speak the client's language
-- A pack built here writes its plain tables from the English corpus whatever it is recorded
-- in, and says so (LookupLocale); it may also carry the client's own locale's text
-- (ClientLocaleLookups). A pack built from somebody's own client says neither, and its
-- tables are in its language.
local SECOND_TEXT = "The rooms upstairs are clean enough."
local SECOND_HASH = "inn-rooms"
local TWO_LINES = { [INNKEEPER] = { [GOSSIP_TEXT] = GOSSIP_HASH, [SECOND_TEXT] = SECOND_HASH } }

-- An English client with only a German pack of ours, beside somebody's Portuguese pack that
-- outranks it and keys the NPC on words that happen to be the English ones. Only the German
-- pack's tables are English, so only they are asked.
VO = Install({
    { folder = "GermanPack", language = "deDE", lookupLocale = "enUS",
      lines = { [GOSSIP_HASH] = 4.0, [SECOND_HASH] = 4.0 }, gossip = TWO_LINES },
    { folder = "TheirPack", language = "ptBR", priority = 200,
      lines = { ["pt-guess"] = 4.0 }, gossip = { [INNKEEPER] = { [SECOND_TEXT] = "pt-guess" } } },
}, "enUS")
VO.Addon.db.profile.Audio.VoiceLanguage = "deDE"
local _, second = ResolveGossip(VO, SECOND_TEXT)
Expect("I. an English client reads a German pack's English tables", second.fileName, SECOND_HASH)
Expect("I. ...and plays it from the German pack", second.module.METADATA.AddonName, "GermanPack")

-- A German client: the German copy is asked before any English table, even one in a pack
-- that outranks it and would otherwise be the only thing to guess from.
local DE_SECOND = "Die Zimmer oben sind sauber genug."
VO = Install({
    { folder = "EnglishPack", priority = 200, lines = { ["en-guess"] = 4.0 },
      gossip = { [INNKEEPER] = { [GOSSIP_TEXT] = "en-guess" } } },
    { folder = "GermanPack", language = "deDE", lookupLocale = "enUS",
      lines = { [GOSSIP_HASH] = 4.0, [SECOND_HASH] = 4.0 },
      clientGossip = { [INNKEEPER] = { ["Willkommen im Gasthaus, Reisender."] = GOSSIP_HASH,
                                        [DE_SECOND] = SECOND_HASH } } },
}, "deDE")
local _, german = ResolveGossip(VO, DE_SECOND)
Expect("I. a German client matches on the German copy", german.fileName, SECOND_HASH)
Expect("I. ...and hears the German pack", german.module.METADATA.AddonName, "GermanPack")

-- Somebody's pack with no LookupLocale: its tables are in its own language.
VO = Install({
    { folder = "EnglishPack", priority = 200, lines = { ["en-guess"] = 4.0 },
      gossip = { [INNKEEPER] = { [GOSSIP_TEXT_PT] = "en-guess" } } },
    { folder = "TheirPack", language = "ptBR", lines = { [GOSSIP_HASH] = 4.0 }, gossip = PT_GOSSIP },
}, "ptBR")
local _, theirs = ResolveGossip(VO, GOSSIP_TEXT_PT)
Expect("I. a pack that says nothing is keyed in its own language", theirs.fileName, GOSSIP_HASH)

---------------------------------------------------------------- H. the language the packs speak
-- What a report is filed under when there is no clip to ask, and what a contribution says
-- the player was listening to. The packs', not the client's.
VO = Install({ { folder = "EnglishPack", lines = EN_LINES } }, "deDE")
Expect("H. a German client with only English packs hears English", VO.DataModules:GetPackLanguage(), "enUS")
VO = Install({
    { folder = "EnglishPack", lines = EN_LINES },
    { folder = "GermanPack", language = "deDE", lines = { ["1-accept"] = 5.5 } },
}, "deDE")
Expect("H. ...and German once a German pack is installed", VO.DataModules:GetPackLanguage(), "deDE")
VO = Install(PACKS, "enUS")
VO.Addon.db.profile.Audio.VoiceLanguage = "ptBR"
Expect("H. an English client can listen in Portuguese",
    VO.DataModules:GetPackLanguage(), "ptBR")
VO = Install({}, "deDE")
Expect("H. with no pack at all, the chosen language", VO.DataModules:GetPackLanguage(), "deDE")

---------------------------------------------------------------- J. a report is filed in the clip's language
VO = Install({ { folder = "EnglishPack", lines = EN_LINES } })
Expect("J. an English report keeps the address it always had",
    VO.ReportButton:Link("quest/1/accept", "enUS"), "https://voiceover.rusty.one/r/quest/1/accept")
Expect("J. ...and so does one with no language",
    VO.ReportButton:Link("quest/1/accept"), "https://voiceover.rusty.one/r/quest/1/accept")
Expect("J. another language's report goes to that language's page",
    VO.ReportButton:Link("quest/1/accept", "deDE"), "https://spoken.rusty.one/deDE/quests/r/quest/1/accept")

-- The Report action hands over the language the clip was answered in: line 2 is English
-- fallback under a Portuguese selection, and its report is about the English take.
local function ReportFor(VO, questID)
    local _, clip = Resolve(VO, questID)
    VO.Player:Prepare(clip)
    local target, language
    VO.ReportButton.CurrentTarget = function() return "quest/" .. questID .. "/accept" end
    VO.ReportButton.ShowLink = function(_, t, l) target, language = t, l end
    for _, action in ipairs(clip.present.actions) do
        if action.id == "report" then action.onClick(clip) end
    end
    return language
end
VO = Install(PACKS, "ptBR")
Expect("J. reporting a Portuguese clip files it in Portuguese", ReportFor(VO, 1), "ptBR")
Expect("J. reporting a fallback clip files it in English", ReportFor(VO, 2), "enUS")

---------------------------------------------------------------- the metadata itself
VO = Install({ { folder = "Pack", language = "ptBR", lines = EN_LINES } })
Expect("a declared language is read off the TOC", VO.DataModules:GetPresentModule("Pack").Language, "ptBR")
VO = Install({ { folder = "Pack", language = "xxXX", lines = EN_LINES } })
Expect("a language this addon does not know reads as English",
    VO.DataModules:GetPresentModule("Pack").Language, "enUS")

---------------------------------------------------------------- in step with SpokenZones
-- The two addons sit side by side; a language one offers and the other does not is a
-- setting the player makes once and finds half-honoured.
local questsCodes = {}
for _, locale in ipairs(VO.Language.LOCALES) do table.insert(questsCodes, locale.code) end
Expect("the language list matches SpokenZones'", table.concat(questsCodes, " "), H.ZonesLocaleCodes(here))

stub.SetLocale("enUS")
stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll language tests passed")

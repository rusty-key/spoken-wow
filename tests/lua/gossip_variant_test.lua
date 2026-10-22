-- One NPC with several gossip texts: the text on screen picks the line, and a text the packs
-- lack for this NPC plays nothing. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local TRAINER = 257021
local DEFAULT = "I hope that your interruption is for a good cause, I was in the middle of an experiment."
local HERBALIST = "Another Herbalist, hmm. I doubt your skill is as great as my own so perhaps I can " ..
    "train you in a few proper techniques."
local NAMED = "Greetings, $N. Welcome, my $gbrother:sister;.$B$BThe $c trainers are upstairs."

local lines = { default = 3, herbalist = 4, named = 5, ["en-guess"] = 4, ["en-other"] = 4, fr = 3, ["fr-other"] = 3,
    ["zh-a"] = 9, ["zh-b"] = 8, ko = 4, ["ko-other"] = 3 }

-- `textLocale`: the locale the pack's text is written in, English unless given.
local function Boot(locale, gossip, textLocale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    world.playerName = "Valaas"; world.playerClass = "Mage"; world.unitSex = 2
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    VO.Addon.db.char.hasSeenGossipForNPC = {}
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = lines,
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
        LookupLocale = textLocale or "enUS",
        GossipLookupByNPCID = gossip or { [TRAINER] = {
            [DEFAULT] = "default", [HERBALIST] = "herbalist", [NAMED] = "named" } },
    })
    stub.Advance(2)
    world.npcName = "Halassa Brisecho"; world.npcGUID = "Creature-0-0-0-0-" .. TRAINER .. "-0"
    return VO, _G.Spoken
end

local function Lookup(VO, text)
    local soundData = { event = VO.Enums.SoundEvent.Gossip, unitGUID = world.npcGUID,
        name = world.npcName, text = text }
    return VO.DataModules:PrepareSound(soundData) and soundData.fileName or nil
end

---------------------------------------------------------------- each text its own line
local VO, Spoken = Boot()
Expect("a player of no profession hears the trainer's own greeting", Lookup(VO, DEFAULT), "default")
Expect("...a herbalist the herbalist's", Lookup(VO, HERBALIST), "herbalist")

world.gossipText = HERBALIST
VO.Addon:GOSSIP_SHOW()
Expect("the window reads the line on screen", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "herbalist")

---------------------------------------------------------------- a text the NPC has no line for
VO, Spoken = Boot()
local UNKNOWN = "Ah, hello. You look as though you have a question for me."
Expect("a text the packs lack for this NPC finds no line", Lookup(VO, UNKNOWN), nil)
world.gossipText = UNKNOWN
VO.Addon:GOSSIP_SHOW()
Expect("...and nothing is read in its place", Spoken:GetQueueSize(), 0)

-- The Darkmoon Faire's barker names a place by faction. The Horde's line, where only the
-- Alliance's is held, shares most of its words and is still not that line.
local ELWYNN = "When the Darkmoon Faire is open, it will be located in Elwynn Forest.  We'll be pitching our " ..
    "tents just south of Goldshire!"
local MULGORE = "When the Darkmoon Faire opens, it will be located in Mulgore.  We'll be pitching our tents " ..
    "just southwest of Thunder Bluff!"
VO = Boot(nil, { [TRAINER] = { [ELWYNN] = "default" } })
Expect("one faction's line is not read for the other's", Lookup(VO, MULGORE), nil)
Expect("...and its own is", Lookup(VO, ELWYNN), "default")

---------------------------------------------------------------- what the client fills in
VO = Boot()
Expect("the player's name, sex and class are filled into the line",
    Lookup(VO, "Greetings, Valaas. Welcome, my brother.\n\nThe Mage trainers are upstairs."), "named")
Expect("...whatever the spacing and the punctuation",
    Lookup(VO, "Greetings, Valaas!  Welcome, my brother...  The Mage trainers are upstairs"), "named")
Expect("a word reworded since the extract still finds the line",
    Lookup(VO, "I hope that your interruption is for a good cause, I was in the midst of an experiment."), "default")

---------------------------------------------------------------- English text is compared as it always was
-- Lower case and ASCII punctuation as spaces, for every printable ASCII character, a tab and
-- line breaks, on the text on screen and on each key.
local function OldWords(text) return (string.gsub(string.lower(text), "%p", " ")) end
local ascii = { "\t", "\n", "\r" }
for byte = 32, 126 do ascii[#ascii + 1] = string.char(byte) end
local seed, samples, gossip = 7, {}, {}
for i = 1, 300 do
    local chars = {}
    for j = 1, 1 + i % 40 do
        seed = (seed * 1103515245 + 12345) % 2147483648
        chars[j] = ascii[1 + seed % #ascii]
    end
    samples[i] = table.concat(chars)
end
for i, sample in ipairs(samples) do
    gossip[TRAINER + i] = { [sample] = "default", [samples[i % #samples + 1] .. "x"] = "herbalist" }
end
VO = Boot(nil, gossip)
local seen, keysDiffer, screensDiffer, shown = 0, 0, 0, nil
local realSearch = VO.FuzzySearchBestKeys
VO.FuzzySearchBestKeys = function(query, entries, keyText)
    if query ~= OldWords(shown) then screensDiffer = screensDiffer + 1 end
    for key in pairs(entries) do
        seen = seen + 1
        if keyText(key) ~= OldWords(VO.Utils:FillPlayerTokens(key)) then keysDiffer = keysDiffer + 1 end
    end
    return realSearch(query, entries, keyText)
end
for i, sample in ipairs(samples) do
    world.npcGUID = "Creature-0-0-0-0-" .. (TRAINER + i) .. "-0"
    shown = sample .. "?"
    Lookup(VO, shown)
end
VO.FuzzySearchBestKeys = realSearch
Expect("every English key is split into the words it always was", keysDiffer, 0)
Expect("...and so is every English text on screen", screensDiffer, 0)
Expect("...over every sample's keys", seen, 2 * #samples)

---------------------------------------------------------------- typographic punctuation
-- A French client shows a curly apostrophe and a no-break space before "!" where the text
-- the packs were built from has the plain ones.
local FR_KEY = "Je crois que Plugger a trop rempli un de ses barils. On dirait qu'il va sauter !"
local FR_SHOWN = "Je crois que Lanfiche a trop rempli un de ses barils. On dirait qu\226\128\153il va sauter\194\160!"
VO = Boot("frFR", { [TRAINER] = { [FR_KEY] = "fr", ["C'est moi que vous regardez ?"] = "fr-other" } }, "frFR")
Expect("a French line with a curly apostrophe and a no-break space finds its line",
    Lookup(VO, FR_SHOWN), "fr")
Expect("...as does a narrow no-break space", Lookup(VO, (string.gsub(FR_SHOWN, "\194\160", "\226\128\175"))), "fr")

---------------------------------------------------------------- languages written without spaces
-- Nefarian's two lines as a Chinese client shows them: the second reworded by two characters.
local ZH_A = "你是不是想要我在强大的$N所率领的军团之前畏缩？$B$B你对我来说不算什么。什么都不是。" ..
    "如果我想要你的头颅，那它就会被插在长矛上呈送给我。"
local ZH_B = "在你匆忙追寻荣耀的过程中，你有没有想过你的行动对于这场竞赛的节奏有什么影响？" ..
    "我对你来说是个难以理解的存在，这让你头颅里那花生大小的脑子感到十分迷茫。"
local ZH_B_SHOWN = "在你匆忙追寻荣耀的过程中，你有没有想过你的行动对于这场竞赛的节奏有什么影响？" ..
    "我对你来说是个难以理解的存在，这让你那花生大小的脑子感到十分迷茫。"
VO = Boot("zhCN", { [TRAINER] = { [ZH_A] = "zh-a", [ZH_B] = "zh-b" } }, "zhCN")
Expect("a reworded Chinese line finds its line", Lookup(VO, ZH_B_SHOWN), "zh-b")
Expect("...the other line its own", Lookup(VO, VO.Utils:FillPlayerTokens(ZH_A)), "zh-a")
Expect("...and a Chinese line the packs lack finds none", Lookup(VO, "这是真的。请允许我总结一下……"), nil)

-- Korean words carry their particles: a reworded line shares few whole words with its key.
local KO_KEY = "미안하지만 저는 사냥꾼과 그 야수에게만 도움을 줄 수 있습니다."
VO = Boot("koKR", { [TRAINER] = { [KO_KEY] = "ko", ["야수에게 가르칠 기술을 배우러 오셨습니까?"] = "ko-other" } }, "koKR")
Expect("a reworded Korean line finds its line",
    Lookup(VO, "형제여, 미안하지만 나는 사냥꾼과 그 야수에게만 도움을 줄 수가 있습니다."), "ko")

---------------------------------------------------------------- a client in another language
-- No table in the client's language knows the NPC: the English ones are searched. German words
-- never match them, so only an NPC with one line can be told what it says.
VO = Boot("deDE", { [TRAINER] = { [DEFAULT] = "en-guess" } })
Expect("a German client with only English text still hears the NPC's one line",
    Lookup(VO, "Ich hoffe, Ihr stört mich aus gutem Grund."), "en-guess")
VO = Boot("deDE", { [TRAINER] = { [DEFAULT] = "en-guess", [HERBALIST] = "en-other" } })
Expect("...but of an NPC with several lines it hears none, rather than any one of them",
    Lookup(VO, "Ich hoffe, Ihr stört mich aus gutem Grund."), nil)
Expect("...unless the text on screen is one of them", Lookup(VO, HERBALIST), "en-other")
VO.GossipAliases = { ["en-guess"] = { "en-other" }, ["en-other"] = { "en-guess" } }
Expect("...and lines recorded as one moment count as one line",
    Lookup(VO, "Ich hoffe, Ihr stört mich aus gutem Grund.") ~= nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip variant tests passed")

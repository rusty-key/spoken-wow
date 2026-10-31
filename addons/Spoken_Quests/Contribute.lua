setfenv(1, VoiceOver)

-- What this addon sends when it has no line for what is on screen.
--
-- The corpus is built from a 1.12 world database, so three kinds of gap cannot be closed from
-- our end: content that postdates vanilla, locales that database does not carry, and whatever
-- custom content a server has added. In all three the client in front of the player is holding the
-- only copy of the text, and a report that says "nothing played" is worth less than the same
-- report carrying it.
--
-- Read from the client, never from soundData, for the reason ReportButton.lua gives: when the
-- data module failed to load there is no soundData at all, and that is the case most worth
-- sending.


local EVENT_PATHS =
{
    [Enums.SoundEvent.QuestAccept] = "accept",
    [Enums.SoundEvent.QuestProgress] = "progress",
    [Enums.SoundEvent.QuestComplete] = "complete",
}

Contribute = {}

--- Whether the Spoken folder beside this addon has what Detemplate and the gathering call. An
--- older one does not, and a player on it has no contribute button rather than an error.
local function CoreIsCurrent()
    local contribute, gather = _G.Spoken and Spoken.Contribute, _G.Spoken and Spoken.Gather
    return contribute and contribute.NameWords and contribute.ReplaceWord and contribute.Parse
        and (not gather or (gather.Lines and gather.Get and gather.Remove and gather.IsTidied))
        and true or false
end

local function GUIDType()
    local guid = Utils:GetNPCGUID()
    if not guid then
        return nil
    end
    local ok, guidType = pcall(Utils.GetGUIDType, Utils, guid)
    return ok and guidType or nil
end

--- The bag item that offered the quest on screen, as its id and name.
---
--- An item's GUID is a spawn, not an item id, so GetIDFromGUID refuses it and the speaker used
--- to go out as nothing at all. The bags still hold the item while its quest is offered, and
--- know which quest each one starts. A creature or gameobject is never asked about: it names
--- itself, and a quest it offers may also be one a carried item starts.
local function QuestItem()
    local guidType = GUIDType()
    if guidType ~= nil and guidType ~= Enums.GUID.Item then
        return nil
    end
    local questID = GetQuestID and NotSecret(GetQuestID()) or 0
    if not (questID and questID > 0 and Spoken and Spoken.QuestItem) then
        return nil
    end
    return Spoken:QuestItem(questID)
end

local function IDFromGUID(guid)
    if guid and Utils.GetIDFromGUID then
        local ok, read = pcall(Utils.GetIDFromGUID, Utils, guid)
        if ok and read then
            return read
        end
    end
end

local function NPCID()
    return IDFromGUID(Utils:GetNPCGUID()) or (QuestItem())
end

--- The npc field as the site reads it: "<id> <name>", or whichever half is known.
local function NPCLabel(id, name)
    if id and name then
        return format("%d %s", id, name)
    end
    return id and tostring(id) or name
end

--- Whether a GUID is a player's. A quest a party member shares opens the window with them as its
--- "npc", and a player's name never goes with a line.
local function IsPlayerGUID(guid)
    local ok, guidType = pcall(Utils.GetGUIDType, Utils, guid)
    return ok and guidType == Enums.GUID.Player
end

--- Whether the window's "npc" is another player, who shares the quest: nothing about them is a
--- quest giver's to send.
local function SharedByPlayer()
    return Utils:IsNPCPlayer() or IsPlayerGUID(Utils:GetNPCGUID())
end

local function NPCField()
    if SharedByPlayer() then
        return nil
    end
    local name = UnitName and NotSecret(UnitName("npc")) or nil
    if not name then
        name = select(2, QuestItem())
    end
    return NPCLabel(NPCID(), name)
end

--- Which id space the unit's GUID belongs to.
---
--- Creature and gameobject ids overlap -- creature 68 is a Stormwind City Guard, gameobject 68
--- is a Wanted Poster -- so the site cannot key on the number alone. Enums.GUID already knows
--- the difference and ReportButton reads it the same way.
local function NPCKind()
    local guidType = GUIDType()
    if guidType == Enums.GUID.GameObject then
        return "gameobject"
    end
    if guidType and Enums.GUID:IsCreature(guidType) then
        return "creature"
    end
    return QuestItem() and "item" or nil
end

-- Which appearances the NPC on screen can wear. No API names the one a unit is drawn with --
-- GetDisplayInfo on a model built with SetUnit answers 0 -- but SetCreature(npcId) builds the
-- creature from the client's cache and rolls one of its appearances (at most four) by spawn
-- probability, fresh on every call, and GetDisplayInfo answers in the same tick. Five rolls
-- missed one of a Bluffwatcher's four. A missed appearance matters: the site confirms a voice
-- when only one is left, so an appearance with a 10% chance and a voice of its own must turn
-- up -- twelve rolls miss it 28% of the time, thirty-two 3%, and a roll costs next to nothing.
-- The model file id above tells the site which body the player is actually looking at.
--
-- One frame, made once, with no parent and never shown: an unshown model draws nothing, and
-- this client has hung its GPU on model rendering before.
local DISPLAY_ROLLS = 32
-- nil until first asked for; false once this client turned out not to have what it takes,
-- so it is never asked again.
local displayRoller
-- npcId -> the appearance ids as the envelope carries them. Only ever set to a real answer: a
-- creature the client has not cached yet answers 0 to every roll, and the next capture, after
-- the client has asked its server, can still find them.
local displayCache = {}

local function DisplayRoller()
    if displayRoller == nil then
        displayRoller = false
        local ok, frame = false, nil
        if CreateFrame then
            ok, frame = pcall(CreateFrame, "DressUpModel")
        end
        if ok and frame and frame.SetCreature and frame.GetDisplayInfo then
            displayRoller = frame
        end
    end
    return displayRoller or nil
end

local function CachedDisplays()
    local npcID = NPCID()
    if not npcID then
        return nil
    end
    if displayCache[npcID] then
        return displayCache[npcID]
    end
    local roller = DisplayRoller()
    if not roller then
        return nil
    end
    local seen, ids = {}, {}
    for _ = 1, DISPLAY_ROLLS do
        pcall(roller.SetCreature, roller, npcID)
        local ok, id = pcall(roller.GetDisplayInfo, roller)
        if ok and type(id) == "number" and id > 0 and not seen[id] then
            seen[id] = true
            ids[#ids + 1] = id
        end
    end
    if roller.ClearModel then pcall(roller.ClearModel, roller) end
    if #ids == 0 then
        return nil
    end
    table.sort(ids)
    displayCache[npcID] = table.concat(ids, ",")
    return displayCache[npcID]
end

--- What the client can see about who is speaking. The site decides what it means. Nothing where
--- the one on screen is a player: their sex, kind and model are not a quest giver's. No displays
--- for a `reworded` line: the site already knows who speaks it, and rolling them is model work.
local function Observations(fields, reworded)
    if SharedByPlayer() then
        return
    end
    local function add(key, value)
        if value ~= nil and value ~= "" then
            fields[#fields + 1] = { key, value }
        end
    end
    local kind = NPCKind()
    add("kind", kind)
    add("model", NPCModel:Get(Utils:GetNPCGUID()))
    -- Creatures only: a gameobject id is a different id space, and SetCreature would roll the
    -- creature that happens to share its number.
    if kind == "creature" and not reworded then
        add("displays", CachedDisplays())
    end
    add("sex", UnitSex and NotSecret(UnitSex("npc")) or nil)
    add("creature", UnitCreatureType and NotSecret(UnitCreatureType("npc")) or nil)
end

--- Which panel the player is looking at, as the event it would have played.
local function EventOnScreen()
    if QuestFrameRewardPanel and QuestFrameRewardPanel:IsShown() then
        return Enums.SoundEvent.QuestComplete, GetRewardText and NotSecret(GetRewardText())
    elseif QuestFrameProgressPanel and QuestFrameProgressPanel:IsShown() then
        return Enums.SoundEvent.QuestProgress, GetProgressText and NotSecret(GetProgressText())
    elseif QuestFrameDetailPanel and QuestFrameDetailPanel:IsShown() then
        return Enums.SoundEvent.QuestAccept, GetQuestText and NotSecret(GetQuestText())
    end
    -- The quest API answers for the dialog whichever window draws it.
    local page = Utils:DialogueUIPage()
    if page == "QUEST_COMPLETE" then
        return Enums.SoundEvent.QuestComplete, GetRewardText and NotSecret(GetRewardText())
    elseif page == "QUEST_PROGRESS" then
        return Enums.SoundEvent.QuestProgress, GetProgressText and NotSecret(GetProgressText())
    elseif page == "QUEST_DETAIL" then
        return Enums.SoundEvent.QuestAccept, GetQuestText and NotSecret(GetQuestText())
    end
    return nil, nil
end

--- The gossip text on screen, or nil once the gossip window is gone. GetGossipText goes on
--- answering with the last words after the window closes -- walking away closes it with no
--- event this addon hears -- so the frame is what says whether they are still being spoken:
--- the game's own, or DialogueUI's in its place. A client without a GossipFrame to ask is
--- taken at its word.
local function GossipOnScreen()
    if Utils:DialogueUIPage() == "GOSSIP_SHOW" then
        return GetGossipText and NotSecret(GetGossipText())
    end
    local frame = _G.GossipFrame
    if frame and frame.IsVisible and not frame:IsVisible() then
        return nil
    end
    return GetGossipText and NotSecret(GetGossipText())
end

--- The text with this character's name, class and race put back as the game's own tokens.
---
--- The client hands us quest text with $N, $C and $R already expanded to whoever is reading
--- it, and a line voiced from that would greet every other player by this one's name. The
--- extract never has the problem -- it reads the templates -- so the fix is to send what the
--- extract would have seen: the site substitutes a token the same way the extract does, and a
--- gossip line hashes to the same id the world database's copy of it would.
---
--- Only this client knows which words were substituted. Once the text leaves, "Thrall" in a
--- line is as likely an NPC as the player, which is why this is done here and not on arrival.
---
--- Class and race are replaced wherever they occur as words, so a warrior reading "a warrior's
--- discipline" sends "a $c's discipline" -- a known cost, taken over voicing someone's class
--- at every other player. The class is kept as written on a quest that only that class can take
--- (questID), since the word there is the quest's own whichever way Blizzard wrote it. $G cannot
--- be undone at all: the client picked one side of the branch, and the words of the other side
--- are not on screen.
function Contribute:Detemplate(text, questID)
    local swaps = {}
    local function add(word, token)
        if type(word) == "string" and word ~= "" then
            swaps[#swaps + 1] = { word, token }
        end
    end
    local function addCased(word, upper, lower)
        add(word, upper)
        if type(word) == "string" and string.lower(word) ~= word then
            add(string.lower(word), lower)
        end
    end

    -- A character with a surname (the Classic beta gives Skybourne elves one) is named whole by
    -- UnitName -- "Valaas Dawnsight" -- while a line greets them by one part: "Greetings, young
    -- Valaas". Each part is the player too, as written or in capitals. Sorted with the class and
    -- race below, so a part of the name inside a longer class or race ("Hunter" in "Demon
    -- Hunter") does not take it first.
    for _, word in ipairs(Spoken.Contribute:NameWords(UnitName and UnitName("player"))) do
        add(word, "$N")
    end
    local localized, classFile, classID
    if UnitClass then
        localized, classFile, classID = UnitClass("player")
    end
    local quests = _G.SpokenQuestsCompendium and _G.SpokenQuestsCompendium.quests
    local quest = questID and quests and quests[questID]
    if localized and not (quest and classID and quest.classes == 2 ^ (classID - 1)) then
        addCased(localized, "$C", "$c")
        -- The locales that inflect a class by gender (deDE "Kriegerin") render the form for
        -- this character, which is the one UnitClass already answered; both are asked for in
        -- case a line names the other.
        for _, names in ipairs({ _G.LOCALIZED_CLASS_NAMES_MALE or {}, _G.LOCALIZED_CLASS_NAMES_FEMALE or {} }) do
            addCased(classFile and names[classFile], "$C", "$c")
        end
    end
    if UnitRace then
        addCased((UnitRace("player")), "$R", "$r")
    end

    -- Longest first, so "Night Elf" goes as one race before a shorter word inside it can be
    -- taken for something else.
    table.sort(swaps, function(a, b) return string.len(a[1]) > string.len(b[1]) end)
    for _, pair in ipairs(swaps) do
        text = Spoken.Contribute:ReplaceWord(text, pair[1], pair[2])
    end
    return text
end

--- The fields every quests envelope starts with: which addon, which client, which language.
local function BaseFields()
    return
    {
        -- VoiceOver.VERSION does not exist -- nothing in this addon ever assigns it. The
        -- addon's own .toc version, read the way DataModules.lua already reads every sound
        -- pack's (GetAddOnMetadata, compat-shimmed onto C_AddOns.GetAddOnMetadata in
        -- Compatibility.lua for clients that moved it there), is the real mechanism to reuse
        -- rather than inventing a second one; "dev" is what a source checkout with no .toc
        -- metadata at all reads back as.
        { "addon", format("SpokenQuests/%s", (GetAddOnMetadata and GetAddOnMetadata(AddonFolder, "Version")) or "dev") },
        { "build", format("%s/%s", (GetBuildInfo and select(1, GetBuildInfo())) or "?",
                                   (GetBuildInfo and select(2, GetBuildInfo())) or "?") },
        -- The client's, because the text is as the client shows it: a German client sends
        -- German, and it belongs with the German lines whatever the player is listening to.
        { "locale", (GetLocale and GetLocale()) or "enUS" },
        -- The language of the packs the player hears, said outright so triage can see that a
        -- German client listening to English packs is missing the line in both.
        { "pack", DataModules:GetPackLanguage() },
        { "packVersion", DataModules:GetPackVersion(DataModules:GetPackLanguage()) },
    }
end

--- The envelope for what is on screen, or nil when there is nothing to send. `reworded` for a
--- line that plays in other words, which leaves out the displays.
function Contribute:Capture(reworded)
    if not CoreIsCurrent() then
        return nil
    end
    local event, text = EventOnScreen()
    local fields = BaseFields()

    if event and text and text ~= "" then
        local questID = GetQuestID and NotSecret(GetQuestID()) or 0
        if questID and questID > 0 then
            fields[#fields + 1] = { "quest", questID }
        end
        fields[#fields + 1] = { "event", EVENT_PATHS[event] }
        fields[#fields + 1] = { "npc", NPCField() }
        Observations(fields, reworded)
        fields[#fields + 1] = { "title", GetTitleText and NotSecret(GetTitleText()) or "" }
        -- The second value is what Gather keys the line on: the quest, the moment and who said
        -- it. The text is left out on purpose -- the same panel read twice is one line. The
        -- third is the text the envelope carries.
        local said = Contribute:Detemplate(text, questID)
        return Spoken.Contribute:Envelope("quests", fields, said),
            format("q:%s:%s:%s", tostring(questID or 0), EVENT_PATHS[event], tostring(NPCID() or "")), said
    end

    -- Gossip: no quest and no event, but an NPC saying something this corpus has never heard.
    --
    -- The creature id is required rather than merely included. A gossip contribution is keyed on
    -- it and nothing else -- there is no quest id to fall back on -- so an envelope without one
    -- is refused on arrival, and offering a button that leads to a refusal is worse than
    -- offering none. The way to arrive here without an id is the frame closing under us, where
    -- the words are still readable and the unit is already gone.
    local gossip = GossipOnScreen()
    if gossip and gossip ~= "" and NPCID() then
        -- Detemplated before the key is taken too, so the same line gathered on two
        -- characters is one line rather than one per name.
        gossip = Contribute:Detemplate(gossip)
        fields[#fields + 1] = { "npc", NPCField() }
        Observations(fields, reworded)
        -- An NPC can say several different things, so gossip is keyed on the words as well.
        -- Keyed on the sex too, so a man and a woman saying the same words are two lines.
        local sex = UnitSex and NotSecret(UnitSex("npc"))
        return Spoken.Contribute:Envelope("quests", fields, gossip),
            format("g:%d:%d%s", NPCID(), Spoken.Contribute:Checksum(gossip), sex == 3 and ":f" or "")
    end

    return nil
end

--- Whether the window on screen is still showing the line `clip` played.
local function ShowsClip(clip)
    if clip.questID and EVENT_PATHS[clip.event] then
        local event = EventOnScreen()
        return event == clip.event and (GetQuestID and GetQuestID()) == clip.questID
    end
    return clip.unitGUID ~= nil and clip.unitGUID == Utils:GetNPCGUID() and GossipOnScreen() ~= nil
end

--- What a report carries beside its address: this client, and the line as the player met it.
---
--- The window on screen first, since only it can still be asked about the NPC's model and sex.
--- A clip the window no longer shows -- Report is offered after the window closes -- is sent
--- as the clip remembers it, with no observations rather than another NPC's.
---@param clip table|nil  the clip being reported, { fromLog, questID, title } for a quest in
---                        the log, or nil for the window on screen
---@return string|nil envelope
function Contribute:ReportContext(clip)
    if not CoreIsCurrent() then
        return nil
    end
    if clip and clip.fromLog then
        return self:CaptureFromLog(clip.questID, clip.title)
    end
    if not clip or ShowsClip(clip) then
        local envelope = self:Capture()
        if envelope or not clip then
            return envelope
        end
    end

    local fields = BaseFields()
    local path = EVENT_PATHS[clip.event]
    if clip.questID and clip.questID > 0 and path then
        fields[#fields + 1] = { "quest", clip.questID }
        fields[#fields + 1] = { "event", path }
    end
    local npc = NPCLabel(IDFromGUID(clip.unitGUID), not IsPlayerGUID(clip.unitGUID) and clip.name or nil)
    if npc then
        fields[#fields + 1] = { "npc", npc }
    end
    if clip.title and clip.title ~= "" then
        fields[#fields + 1] = { "title", clip.title }
    end
    local text = type(clip.text) == "string" and clip.text ~= "" and self:Detemplate(clip.text) or nil
    return Spoken.Contribute:Envelope("quests", fields, text)
end

--- Whether this client's data module has a line for what is on screen.
---
--- Neither VoiceOver.lua nor Player.lua expose a lookup by that name: what actually decides
--- there is nothing to enqueue is DataModules:PrepareSound, called from Player:Enqueue. Run
--- against a throwaway table rather than a soundData already headed for playback -- PrepareSound
--- mutates whatever it is given (fileName, filePath, length, module), and a table built only to
--- ask the question must not be mistaken afterwards for a clip that plays.
local function HasSoundForCurrent()
    local event, text = EventOnScreen()
    if event and text and text ~= "" then
        -- The text and giver too: a moment in several wordings is found by the words on screen.
        return DataModules:PrepareSound({ event = event, questID = GetQuestID and NotSecret(GetQuestID()) or 0,
            text = text, unitGUID = Utils:GetNPCGUID() })
    end

    local gossip = GossipOnScreen()
    local guid = Utils:GetNPCGUID()
    local name = Utils:GetNPCName()
    -- Both absent is the case Addon:GOSSIP_SHOW guards with the same test and the comment
    -- "the player interacted with an NPC while having main menu or options opened". It also
    -- happens on the way out: CloseGossip fires GOSSIP_CLOSED, which refreshes this button
    -- while GetGossipText still answers. DataModules keys gossip on the name when there is no
    -- GUID, and hands that name to string.gsub, so a nil one is an error thrown at a player
    -- who only walked away from a conversation.
    if gossip and gossip ~= "" and (guid or name) then
        local soundData = {
            event = Enums.SoundEvent.Gossip,
            unitGUID = guid,
            name = name,
            unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
            text = gossip,
        }
        -- Drawn as a body its voice is not, a line plays, and is still a line the site lacks.
        return DataModules:PrepareSound(soundData) and not DataModules:IsOtherBody(soundData)
    end

    return false
end

--- Whether Capture would build an envelope, without paying to build one.
---
--- The same two conditions Capture returns on, repeated rather than reused, because reuse
--- here would mean calling Capture and throwing the envelope away -- and Capture is where
--- Observations runs, which is exactly the model-probe cost HasGap must not pay on every
--- quest and gossip event just to answer a yes/no question.
local function HasSomethingToSend()
    local event, text = EventOnScreen()
    if event and text and text ~= "" then
        return true
    end
    local gossip = GossipOnScreen()
    if gossip and gossip ~= "" and NPCID() then
        return true
    end
    return false
end

--- Off while the player listens in a language no client runs in (Italian). HasSoundForCurrent
--- asks the voice language, so every line its pack has not voiced yet would read as missing
--- text and send English the corpus already has. Its text comes from its translators, not
--- from the client, so there is nothing for a player to send for it.
local function IsMissing()
    if not Language:IsClientLanguage(Language:GetVoiceLanguage()) then
        return false
    end
    return HasSomethingToSend() and not HasSoundForCurrent()
end

--- Whether the line on screen is one the corpus has in other words (DataModules:IsTextKnown):
--- Blizzard changed it, or the corpus copy came from a client that wrote a player's name into
--- it. It may well play, so it offers no button; it is only gathered, for the site to correct.
local function IsChanged()
    local event, text = EventOnScreen()
    if event and text and text ~= "" then
        return DataModules:IsTextKnown({ event = event, questID = GetQuestID and NotSecret(GetQuestID()) or 0,
            text = text }) == false
    end
    local gossip = GossipOnScreen()
    if gossip and gossip ~= "" and NPCID() then
        return DataModules:IsTextKnown({ event = Enums.SoundEvent.Gossip, unitGUID = Utils:GetNPCGUID(),
            name = Utils:GetNPCName(), unitIsObjectOrItem = Utils:IsNPCObjectOrItem(), text = gossip }) == false
    end
    return false
end

-- A quest line is kept as "q:<quest>:<moment>:<speaker>". The speaker is empty when the window
-- closes under a capture (QUEST_FINISHED, the frame's OnHide): its text still reads, and the
-- unit is already gone. That copy is the line just kept with its speaker, less the speaker.
local function QuestMoment(key)
    return string.match(key, "^(q:[^:]*:[^:]*:)(.*)$")
end

local function TextOf(envelope)
    return (select(3, Spoken.Contribute:Parse(envelope)))
end

-- Line endings as Envelope writes them, which is how Parse reads a text back.
local function Unix(text)
    return text and (string.gsub(string.gsub(text, "\r\n", "\n"), "\r", "\n"))
end

-- Quest moment -> the words last kept for it with a speaker this session: the window's closing
-- copy of the same words has no speaker, and is not kept.
local keptWith = {}

--- Keep the line on screen for later. Only reached once a caller has established it is
--- missing or changed (HasGap, which passes `reworded`), or when its model has just arrived
--- (NPCModel.onLoaded) -- so that one re-checks that the line is still one of those.
local function GatherLine(reworded)
    if not (Spoken.Gather and Spoken.Gather:IsEnabled()) then
        return false
    end
    if reworded == nil then
        if IsMissing() then
            reworded = false
        elseif IsChanged() then
            reworded = true
        else
            return false
        end
    end
    local envelope, key, said = Contribute:Capture(reworded)
    if not envelope then
        return false
    end
    said = Unix(said)
    -- A quest no one on screen speaks is still kept, without a speaker, until a copy with one
    -- comes in to take its place.
    local stem, speaker = QuestMoment(key)
    if stem and speaker == "" and keptWith[stem] == said then
        return false
    end
    local stored = Spoken.Gather:Add(key, envelope)
    if stored and stem and speaker ~= "" then
        keptWith[stem] = said
        -- The copy kept before it, without its speaker, saying the same.
        local twin = Spoken.Gather:Get(stem)
        if twin and TextOf(twin) == said then
            Spoken.Gather:Remove(stem)
        end
    end
    return stored
end

--- The fields of a quest line kept before a shared quest stopped sending them: the sharing
--- player's model, sex and creature type as the speaker's. Their name, the npc, is blanked.
local PLAYER_FIELDS = { model = true, displays = true, sex = true, creature = true }

--- Whether a speakerless quest line's fields say a player shared it: an npc of one word, with no
--- id and no kind. An NPC is kept with its id or its kind, so this cannot tell a player from an
--- NPC that has neither and a one-word name; a player whose name has two words is not found.
local function SharedByAPlayer(fields)
    local npc, kind
    for _, field in ipairs(fields) do
        if field[1] == "npc" then npc = field[2] elseif field[1] == "kind" then kind = field[2] end
    end
    return npc ~= nil and npc ~= "" and kind == nil and not string.find(npc, "^%d") and not string.find(npc, "%s")
end

--- Tidy the quest lines kept by earlier versions, once, at login: drop a speakerless line where the
--- same moment is kept with a speaker saying the same words, and take a sharing player's name and
--- look out of the rest. This character's name stays: the file is the account's, and a line
--- another character kept is not this one's to read.
function Contribute:TidyGathered()
    local gather = _G.Spoken and Spoken.Gather
    if not (gather and CoreIsCurrent()) or gather:IsTidied() then
        return
    end
    local lines = gather:Lines()
    local said = {}
    for _, line in ipairs(lines) do
        local stem, speaker = QuestMoment(line.key)
        if stem and speaker ~= "" then
            said[stem] = said[stem] or {}
            local text = TextOf(line.envelope)
            if text then said[stem][text] = true end
        end
    end
    -- Backwards, so a removed line leaves the indices still to come where they were.
    for i = #lines, 1, -1 do
        local line = lines[i]
        local stem, speaker = QuestMoment(line.key)
        if stem and speaker == "" then
            local source, fields, text = Spoken.Contribute:Parse(line.envelope)
            if text and said[stem] and said[stem][text] then
                table.remove(lines, i)
            elseif source == "quests" and SharedByAPlayer(fields) then
                local kept = {}
                for _, field in ipairs(fields) do
                    if field[1] == "npc" then
                        kept[#kept + 1] = { "npc", "" }
                    elseif not PLAYER_FIELDS[field[1]] then
                        kept[#kept + 1] = field
                    end
                end
                line.envelope = Spoken.Contribute:Envelope(source, kept, text)
            end
        end
    end
    gather:SetTidied()
end

if CreateFrame then
    local tidier = CreateFrame("Frame")
    tidier:RegisterEvent("PLAYER_LOGIN")
    tidier:SetScript("OnEvent", function()
        pcall(Contribute.TidyGathered, Contribute)
    end)
end

-- Once a model is in, if the same NPC is still on screen: a line gathered while it was loading
-- was kept without it, so take it again (the same key replaces it); and the model can show the
-- line is a body its voice is not, so the button asks again.
table.insert(NPCModel.onLoaded, function(guid)
    if Utils:GetNPCGUID() ~= guid then
        return
    end
    GatherLine()
    if ContributeButton then
        ContributeButton:Refresh()
    end
end)

--- Whether the contribute button belongs on screen: something to send, and nothing to play.
---
--- Priming the model cache happens here, not in Capture, and only where a model can matter:
--- a gap, a creature whose bodies the packs list while its gap could be shown or gathered, or
--- a split creature, whose model picks the file it plays. Most NPCs are none of those, and no
--- model is ever loaded for them. Once per NPC, not once per event -- a player reads a quest
--- for seconds, which is ample for the load NPCModel:Prime started to finish before a click
--- ever reads it back.
function Contribute:HasGap()
    if not (CoreIsCurrent() and Spoken.ShowContribution) then
        return false
    end
    -- Hidden in the Spoken settings: no gap to show, and so no model to prime for one. The
    -- method is guarded because an older bundled player does not have it.
    local hidden = Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden()
    -- Gathering needs the model primed as much as a click does, and runs with the buttons
    -- hidden as readily as with them shown.
    local gathering = Spoken.Gather and Spoken.Gather:IsEnabled()
    -- A body the voice is not can only be seen in the model, so a creature whose bodies the
    -- packs list has it read whatever the gap, where a gap could be shown or gathered. A split
    -- creature has it read regardless, since the model picks the file it plays. Once per guid,
    -- as for a gap, and at most once per pass, since each Prime of a guid still loading counts
    -- towards giving up on it.
    local guid = Utils:GetNPCGUID()
    local id = guid and Utils:GetCreatureIDFromGUID(guid)
    local readBody = id and DataModules:HasBodies(id)
        and ((not hidden or gathering) or DataModules:IsSplit(id))
    if readBody then
        NPCModel:Prime(guid, "npc")
    end
    local missing = (not hidden or gathering) and IsMissing()
    local gap = not hidden and missing
    if missing then
        if not readBody and not SharedByPlayer() then
            NPCModel:Prime(guid, "npc")
        end
        -- Gathered here, on the one pass that already knows the line is missing, rather than
        -- by a second caller asking PrepareSound all over again. This runs on every quest and
        -- gossip event through ContributeButton's refresh, which is what drives gathering.
        if gathering then
            GatherLine(false)
        end
    elseif gathering and IsChanged() then
        -- A line that plays in other words, kept for the site to correct. No model is loaded
        -- for it: the site already knows who speaks a line it has, and a load is kept for gaps.
        GatherLine(true)
    end
    if not missing and NPCModel:IsLoading() and not readBody then
        -- No gap, but a load is still in flight for whatever NPC started it: the player closed
        -- the dialog, or a pack picked up the line, with no click and no retarget to trigger
        -- NPCModel:Prime's own guid-switch guard. Left alone, this is unbounded exposure --
        -- the PlayerModel keeps driving a 3D draw until the next gap NPC, which this session
        -- may never show, and this client has hung its GPU on model rendering before. Put the
        -- probe away without caching anything: this is not a resolution, just a stop.
        NPCModel:Abandon()
    end
    return gap
end

--- A quest's own text, as its quest log entry shows it: the description, which is what the
--- quest giver reads out on the accept panel. Nil when the log does not have the quest.
---
--- Two quest logs, two ways to ask. The classic one (Era, Anniversary) answers only for the
--- selected entry, so the entry is selected for the read and the player's own selection put
--- back straight after. The modern one (the Forever client) has no selection functions at all
--- and takes the entry's index instead -- asked second, because a classic client that also
--- carries C_QuestLog would ignore the index and answer for whatever is selected.
function Contribute:QuestLogDescription(questID)
    if GetQuestLogSelection and SelectQuestLogEntry and GetNumQuestLogEntries and GetQuestLogTitle then
        for index = 1, (GetNumQuestLogEntries()) do
            local id = select(8, GetQuestLogTitle(index))
            if id == questID then
                local previous = GetQuestLogSelection()
                SelectQuestLogEntry(index)
                local description = GetQuestLogQuestText and NotSecret(GetQuestLogQuestText())
                SelectQuestLogEntry(previous or 0)
                return description
            end
        end
        return nil
    end
    if C_QuestLog and C_QuestLog.GetLogIndexForQuestID and GetQuestLogQuestText then
        local index = C_QuestLog.GetLogIndexForQuestID(questID)
        if index then
            return (GetQuestLogQuestText(index))
        end
    end
    return nil
end

--- The envelope for a quest in the quest log, or nil when its text cannot be read.
---
--- The accept moment, since that is the text the log carries. No NPC: the log does not say who
--- gave the quest, so the site asks a moderator for the speaker, or takes it from a
--- contribution sent from the quest giver's own dialog. `from=log` says which of the two this
--- was.
function Contribute:CaptureFromLog(questID, title)
    local text = CoreIsCurrent() and questID and self:QuestLogDescription(questID)
    if not text or text == "" then
        return nil
    end
    local fields = BaseFields()
    fields[#fields + 1] = { "quest", questID }
    fields[#fields + 1] = { "event", "accept" }
    fields[#fields + 1] = { "title", title or "" }
    fields[#fields + 1] = { "from", "log" }
    return Spoken.Contribute:Envelope("quests", fields, Contribute:Detemplate(text, questID))
end

--- Whether the quest log should offer Contribute in place of a Play it cannot give.
---
--- Only with at least one sound pack registered: without one, every quest in the log lacks
--- sound, and offering to contribute all of them would say the corpus is missing what is in
--- fact simply not installed.
function Contribute:CanOfferFromLog()
    if not (CoreIsCurrent() and Spoken.ShowContribution) then
        return false
    end
    if Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden() then
        return false
    end
    return DataModules:HasRegisteredModules()
end

--- The tooltip every Contribute button in this addon shows. `gossip` for an NPC's line rather
--- than a quest, which the first line then says instead. In `tooltip`, or the game's.
function Contribute:ShowTooltip(owner, gossip, tooltip)
    tooltip = tooltip or GameTooltip
    if not tooltip then
        return
    end
    tooltip:SetOwner(owner, "ANCHOR_RIGHT")
    tooltip:SetText(gossip and L.OPT_CONTRIBUTE_TIP_LINE or L.OPT_CONTRIBUTE_TIP_QUEST)
    tooltip:AddLine(L.OPT_CONTRIBUTE_TIP_SHARE, 1, 0.8, 0.2, true)
    tooltip:Show()
end

--- Right-click opens Spoken's debug log menu, as Report's does, where the Spoken Developer module
--- is installed: a Contribute button is up exactly when a line did not play, which is when the log
--- says why. Hooked on mouse-up rather than set as the click, so the button's own OnClick, set
--- again each time it stands for another quest, keeps the left button.
function Contribute:OfferLogMenu(button)
    if not button or button.offersLogMenu then
        return
    end
    button.offersLogMenu = true
    button:HookScript("OnMouseUp", function(self, mouse)
        if mouse ~= "RightButton" or not (Spoken and Spoken.ShowLogMenu) then
            return
        end
        if GameTooltip and GameTooltip:GetOwner() == self then
            GameTooltip:Hide()
        end
        Spoken:ShowLogMenu(self)
    end)
end

--- Hand the player an envelope: as one link where the bundled player can build one, and as the
--- raw text and the address otherwise.
local function Offer(envelope, key)
    local address = format("%s/contribute", Spoken.SITE_URL)
    -- What the first-click choice gathers if the player takes it. Only for a line with a key:
    -- a quest log entry has no NPC in front of it, so it is sent but never kept.
    local gather = key and { key = key, envelope = envelope } or nil
    -- Encode is absent on an older Spoken; Link
    -- returns nil for that or for an oversized result. Either way, the two-copy fallback still
    -- works, which is the whole point of shipping it alongside the link instead of replacing it.
    local link = Spoken.Contribute.Encode and Spoken.Contribute:Link(address, envelope)
    if link then
        Spoken:ShowContribution(link, address, true, gather)
    else
        Spoken:ShowContribution(envelope, address, nil, gather)
    end
end

--- Contribute a quest from the quest log. Compressed on the click, like Show.
function Contribute:ShowFromLog(questID, title)
    local envelope = self:CaptureFromLog(questID, title)
    if envelope then
        Offer(envelope)
    end
end

-- Compression happens here and nowhere upstream of a click: HasGap/Capture run on every quest
-- and gossip event to decide whether the button belongs on screen at all, and paying deflate's
-- cost on each of those would be work spent on every panel the player merely glances at, for a
-- result almost always thrown away unhandled. Show() runs once, when they have already decided
-- to send it.
function Contribute:Show()
    local envelope, key = self:Capture()
    if envelope then
        Offer(envelope, key)
    end
end

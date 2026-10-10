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

-- The merged domain, not the frozen voiceover.rusty.one that ReportButton.lua points at: the
-- contribute page is new and exists only on the site the three sections share. That file's
-- SITE_URL is a local of its own and deliberately stays where it is -- a report link that moved
-- would be a report link that breaks for everyone still running the shipped addon.
local SITE_URL = "https://spoken.rusty.one"

local EVENT_PATHS =
{
    [Enums.SoundEvent.QuestAccept] = "accept",
    [Enums.SoundEvent.QuestProgress] = "progress",
    [Enums.SoundEvent.QuestComplete] = "complete",
}

Contribute = {}

local function NPCID()
    local guid = Utils:GetNPCGUID()
    if not guid or not Utils.GetIDFromGUID then
        return nil
    end
    local ok, read = pcall(Utils.GetIDFromGUID, Utils, guid)
    return ok and read or nil
end

local function NPCField()
    local id = NPCID()
    local name = UnitName and UnitName("npc") or nil
    if id and name then
        return format("%d %s", id, name)
    end
    return id and tostring(id) or name
end

--- Which id space the unit's GUID belongs to.
---
--- Creature and gameobject ids overlap -- creature 68 is a Stormwind City Guard, gameobject 68
--- is a Wanted Poster -- so the site cannot key on the number alone. Enums.GUID already knows
--- the difference and ReportButton reads it the same way.
local function NPCKind()
    local guid = Utils:GetNPCGUID()
    if not guid or not Utils.GetGUIDType then
        return nil
    end
    local ok, guidType = pcall(Utils.GetGUIDType, Utils, guid)
    if not ok or not guidType then
        return nil
    end
    if guidType == Enums.GUID.GameObject then
        return "gameobject"
    end
    return Enums.GUID:IsCreature(guidType) and "creature" or nil
end

-- PlayerModel loads asynchronously: probed against a live client, SetUnit followed
-- immediately by GetModelFileID answers nothing, and the same read a moment later answers
-- the real file id. So the model is never read on the click -- it is pre-warmed on the
-- refresh path, into this cache, while the player is still reading the panel (seconds, not
-- one frame), and Capture only ever looks the guid up here.
--
-- Keyed by the NPC's guid, since the probe is asked about a different unit every time a
-- different NPC comes on screen, and a load that already finished for one says nothing
-- about another. `false` remembers "asked, and nothing came back" (a gameobject, a client
-- with no GUID, or a load that genuinely resolves to nothing) so a miss is asked for at most
-- once per guid rather than retried on every refresh; a guid missing from this table entirely
-- has simply never been asked about.
local modelCache = {}

-- The one guid currently waiting on a load, and how many refreshes it has waited without
-- resolving. A second refresh for the same guid while it is still loading must not call
-- SetUnit again -- that is the whole point of keying by guid at all -- and a guid that never
-- resolves must eventually be given up on rather than left loading (and the probe shown)
-- forever.
local loadingGUID
local loadingRefreshes

-- How many refreshes a guid may wait, once primed, before PollLoadingGUID gives up on it and
-- caches a miss instead. OnModelLoaded is the fast path -- most of the time this bound is
-- never reached, because the callback (when this client fires it at all) resolves the guid
-- first. This is what makes the client behaving either way converge on the same outcome.
local MAX_LOAD_REFRESHES = 2

-- The frame itself, made once and kept, rather than one per prime: it is only ever handed a
-- different unit. What is NOT kept is it being shown -- a PlayerModel left shown keeps
-- driving a 3D scene draw for as long as the addon runs, and this client has hung its GPU on
-- model rendering before. UI/Portrait.lua's pooled-model Acquire/Release (Compat.lua, for the
-- clients that cannot show an arbitrary creature in a DressUpModel) is this repo's existing
-- answer to the same problem: show it while a load is in flight, then Hide/ClearModel once
-- read, the way Release does.
local modelProbe

local function ModelProbeFrame()
    if not CreateFrame then
        return nil
    end
    if not modelProbe then
        local ok, frame = pcall(CreateFrame, "PlayerModel", nil, UIParent)
        if not ok or not frame then
            return nil
        end
        modelProbe = frame
        if modelProbe.SetSize then modelProbe:SetSize(64, 64) end
        if modelProbe.SetPoint then modelProbe:SetPoint("CENTER") end
        if modelProbe.SetAlpha then modelProbe:SetAlpha(0) end
    end
    return modelProbe
end

--- Read back whatever the probe currently has for `guid`, cache it, and put the probe away.
--- The one place that finalises a load, regardless of what noticed it was time to: the
--- OnModelLoaded callback (the fast path), or PollLoadingGUID reading the probe directly
--- (the fallback that does not depend on that callback ever firing).
-- Defined further down, beside the gap checks it needs; FinishModelLoad calls it once the
-- model it waited for is in.
local GatherLine

local function FinishModelLoad(guid)
    -- First act, not last: ClearModel below can itself fire OnModelLoaded on some clients, and
    -- that callback is this same function closed over this same guid. Clearing the script
    -- before touching the model at all means a re-entrant call has nothing left to run.
    local probe = modelProbe
    if probe and probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", nil)
    end
    -- Not `probe and pcall(...)`: `and` truncates pcall's two return values down to one, so
    -- `id` would be nil even on a successful read. Separate statements keep both.
    local ok, id = false, nil
    if probe then
        ok, id = pcall(probe.GetModelFileID, probe)
    end
    if probe then
        -- pcall'd like every other probe call here: ClearModel is exactly the kind of call
        -- that can itself trigger a client callback, and one client's blowup on it must not
        -- skip the Hide beneath it.
        if probe.ClearModel then pcall(probe.ClearModel, probe) end
        if probe.Hide then probe:Hide() end
    end
    if loadingGUID == guid then
        loadingGUID, loadingRefreshes = nil, nil
    end
    -- Absent rather than zero: the site reads a missing model as "race unknown", and 0 is a
    -- file id that would mean something.
    modelCache[guid] = (ok and type(id) == "number" and id > 0) and id or false
    -- A line gathered while this load was in flight was kept without its model. Take it again
    -- now the model is known, if the same NPC is still on screen: the same key replaces it.
    if GatherLine and Utils:GetNPCGUID() == guid then
        GatherLine()
    end
end

--- Put the probe away without deciding anything about `guid` -- the difference between this
--- and FinishModelLoad is exactly that it never writes modelCache. Used when there is simply
--- nothing left on screen to keep the probe up for: the player closed the dialog, or clicked
--- away, with no retarget to another NPC to trigger the guard PrimeModelCache already has.
--- Left uncached, a guid abandoned this way is primed again (one more SetUnit) the next time
--- it is a gap, rather than permanently remembered as a miss it never actually resolved to --
--- only PollLoadingGUID's MAX_LOAD_REFRESHES bound is allowed to decide that.
local function AbandonModelLoad(guid)
    local probe = modelProbe
    if probe and probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", nil)
    end
    if probe then
        if probe.ClearModel then pcall(probe.ClearModel, probe) end
        if probe.Hide then probe:Hide() end
    end
    if loadingGUID == guid then
        loadingGUID, loadingRefreshes = nil, nil
    end
end

--- A refresh for a guid that is still loading, with no cached answer yet: OnModelLoaded may
--- or may not exist on this client, and may or may not have fired already -- there is no way
--- to tell from here, and no need to. The probe is still shown regardless (nothing but
--- FinishModelLoad ever hides it), so read it directly. Finalise on success, or once this
--- guid has waited long enough that leaving the probe shown any longer is not worth it either.
local function PollLoadingGUID(guid)
    loadingRefreshes = loadingRefreshes + 1
    local probe = modelProbe
    local ok, id = false, nil
    if probe then
        ok, id = pcall(probe.GetModelFileID, probe)
    end
    if (ok and type(id) == "number" and id > 0) or loadingRefreshes >= MAX_LOAD_REFRESHES then
        FinishModelLoad(guid)
    end
end

--- Start a model load for this NPC's guid, if nothing has asked about it yet. Everything
--- this does is one-shot per guid -- HasGap calls it on every quest and gossip event, and a
--- second call for a guid already cached or already loading must be free.
local function PrimeModelCache(guid)
    -- Whatever is on screen now, a load left in flight for a DIFFERENT guid is no longer
    -- relevant to anything -- retargeting between two quest givers faster than a load
    -- resolves is ordinary play, not an edge case. Finalise it (whatever it resolved to, or
    -- nothing) before doing anything else, so the probe is never left associated with an
    -- abandoned target: not while priming the new one, and not indefinitely afterward if the
    -- player then lingers on a guid that happens to already be cached.
    if loadingGUID and loadingGUID ~= guid then
        FinishModelLoad(loadingGUID)
    end

    if not guid or modelCache[guid] ~= nil then
        return
    end
    if loadingGUID == guid then
        PollLoadingGUID(guid)
        return
    end

    local probe = ModelProbeFrame()
    if not probe or not probe.SetUnit or not probe.GetModelFileID then
        modelCache[guid] = false
        return
    end

    loadingGUID = guid
    loadingRefreshes = 0
    if probe.Show then probe:Show() end
    -- Before SetUnit, not after: SetUnit can itself deliver the model synchronously enough on
    -- some clients (or fire OnModelLoaded off the same tick) that a script installed afterward
    -- would miss it, and every refresh in between would then still find a stale closure from
    -- whatever guid this probe last loaded, briefly live for the wrong NPC. A fast path, not a
    -- requirement either way: PollLoadingGUID below reads the probe directly on the next
    -- refresh regardless of whether this ever fires, so correctness here never depends on this
    -- client generation supporting the script at all, only on how many refreshes it costs
    -- before the fallback notices. SetScript on an unrecognised script type is a Lua error on a
    -- real client, which is what the pcall is for.
    if probe.SetScript then
        pcall(probe.SetScript, probe, "OnModelLoaded", function() FinishModelLoad(guid) end)
    end
    pcall(probe.SetUnit, probe, "npc")
end

--- What the model probe has cached for the NPC on screen, reading it directly as a last
--- resort on a miss for the guid that is still loading.
---
--- A gossip interaction fires exactly one refresh (GOSSIP_SHOW) before the player reads and
--- clicks -- there is no second refresh for PollLoadingGUID to ever run on, so the poll bound
--- is never reached by click time, and a cache built only from refreshes would omit the model
--- on almost every gossip contribution. But SetUnit happened when the panel opened, seconds
--- before this click, and live-client evidence says that is enough: read the probe (never
--- SetUnit it again -- that would be asking a second time, which PrimeModelCache already
--- guards against).
---
--- Only a successful read finalises anything here. A click quick enough to beat the load --
--- distinct from a load that has genuinely finished with nothing to show -- must not write
--- `false`: doing so would clear loadingGUID and cache a permanent miss, foreclosing the
--- callback or the next poll from ever resolving this guid for the rest of the session. Only
--- PollLoadingGUID's MAX_LOAD_REFRESHES bound is allowed to give up for real; this is not
--- that, so an empty read here simply leaves the guid exactly as it was and omits the field
--- for this one capture.
local function CachedModelFileID()
    local guid = Utils:GetNPCGUID()
    if not guid then
        return nil
    end
    if modelCache[guid] == nil and loadingGUID == guid then
        local probe = modelProbe
        local ok, id = false, nil
        if probe then
            ok, id = pcall(probe.GetModelFileID, probe)
        end
        if ok and type(id) == "number" and id > 0 then
            FinishModelLoad(guid)
        end
    end
    return modelCache[guid] or nil
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
-- nil until first asked for; false once this client turned out not to have what it takes
-- (the 1.12-3.3.5 clients have no GetDisplayInfo), so it is never asked again.
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

--- What the client can see about who is speaking. The site decides what it means.
local function Observations(fields)
    local function add(key, value)
        if value ~= nil and value ~= "" then
            fields[#fields + 1] = { key, value }
        end
    end
    local kind = NPCKind()
    add("kind", kind)
    add("model", CachedModelFileID())
    -- Creatures only: a gameobject id is a different id space, and SetCreature would roll the
    -- creature that happens to share its number.
    if kind == "creature" then
        add("displays", CachedDisplays())
    end
    add("sex", UnitSex and UnitSex("npc") or nil)
    add("creature", UnitCreatureType and UnitCreatureType("npc") or nil)
end

--- Which panel the player is looking at, as the event it would have played.
local function EventOnScreen()
    if QuestFrameRewardPanel and QuestFrameRewardPanel:IsShown() then
        return Enums.SoundEvent.QuestComplete, GetRewardText and GetRewardText()
    elseif QuestFrameProgressPanel and QuestFrameProgressPanel:IsShown() then
        return Enums.SoundEvent.QuestProgress, GetProgressText and GetProgressText()
    elseif QuestFrameDetailPanel and QuestFrameDetailPanel:IsShown() then
        return Enums.SoundEvent.QuestAccept, GetQuestText and GetQuestText()
    end
    -- The quest API answers for the dialog whichever window draws it.
    local page = Utils:DialogueUIPage()
    if page == "QUEST_COMPLETE" then
        return Enums.SoundEvent.QuestComplete, GetRewardText and GetRewardText()
    elseif page == "QUEST_PROGRESS" then
        return Enums.SoundEvent.QuestProgress, GetProgressText and GetProgressText()
    elseif page == "QUEST_DETAIL" then
        return Enums.SoundEvent.QuestAccept, GetQuestText and GetQuestText()
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
        return GetGossipText and GetGossipText()
    end
    local frame = _G.GossipFrame
    if frame and frame.IsVisible and not frame:IsVisible() then
        return nil
    end
    return GetGossipText and GetGossipText()
end

-- A letter, a digit, or any byte of a multi-byte UTF-8 character. Byte-wise rather than %w,
-- which knows nothing past ASCII: a Cyrillic or accented name is all high bytes, and the word
-- next to it must still count as a word.
local function IsWordByte(b)
    return b ~= nil and (b >= 128 or (b >= 48 and b <= 57) or (b >= 65 and b <= 90) or (b >= 97 and b <= 122))
end

--- Every whole-word occurrence of `word` in `text` replaced by `token`.
---
--- A plain find and a hand-made boundary check rather than a pattern: a name is the player's
--- own input, so it would have to be escaped first, and %f -- the one pattern item that would
--- make the boundary easy -- is not something every client's Lua is safe to lean on. Whole
--- words only, so a player called Mist does not turn "Mistwood" into "$Nwood"; "Mist's" still
--- matches, the apostrophe not being a word byte.
local function ReplaceWord(text, word, token)
    local out, pos = {}, 1
    while true do
        local first, last = string.find(text, word, pos, true)
        if not first then
            break
        end
        if IsWordByte(string.byte(text, first - 1)) or IsWordByte(string.byte(text, last + 1)) then
            out[#out + 1] = string.sub(text, pos, last)
        else
            out[#out + 1] = string.sub(text, pos, first - 1)
            out[#out + 1] = token
        end
        pos = last + 1
    end
    out[#out + 1] = string.sub(text, pos)
    return table.concat(out)
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
--- at every other player. $G cannot be undone at all: the client picked one side of the
--- branch, and the words of the other side are not on screen.
function Contribute:Detemplate(text)
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

    local name = UnitName and UnitName("player")
    add(name, "$N")
    -- A character with a surname (the Classic beta gives Skybourne elves one) is named whole by
    -- UnitName -- "Valaas Dawnsight" -- while a line greets them by one part: "Greetings, young
    -- Valaas". Each part is the player too.
    if type(name) == "string" then
        for part in string.gmatch(name, "%S+") do
            if part ~= name then
                add(part, "$N")
            end
        end
    end
    if UnitClass then
        local localized, classFile = UnitClass("player")
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
        text = ReplaceWord(text, pair[1], pair[2])
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
    }
end

--- The envelope for what is on screen, or nil when there is nothing to send.
function Contribute:Capture()
    local event, text = EventOnScreen()
    local fields = BaseFields()

    if event and text and text ~= "" then
        local questID = GetQuestID and GetQuestID() or 0
        if questID and questID > 0 then
            fields[#fields + 1] = { "quest", questID }
        end
        fields[#fields + 1] = { "event", EVENT_PATHS[event] }
        fields[#fields + 1] = { "npc", NPCField() }
        Observations(fields)
        fields[#fields + 1] = { "title", GetTitleText and GetTitleText() or "" }
        -- The second value is what Gather keys the line on: the quest, the moment and who said
        -- it. The text is left out on purpose -- the same panel read twice is one line.
        return Spoken.Contribute:Envelope("quests", fields, Contribute:Detemplate(text)),
            format("q:%s:%s:%s", tostring(questID or 0), EVENT_PATHS[event], tostring(NPCID() or ""))
    end

    -- Gossip: no quest and no event, but an NPC saying something this corpus has never heard.
    --
    -- The creature id is required rather than merely included. A gossip contribution is keyed on
    -- it and nothing else -- there is no quest id to fall back on -- so an envelope without one
    -- is refused on arrival, and offering a button that leads to a refusal is worse than
    -- offering none. Two ways to arrive here without an id: the frame closing under us, where
    -- the words are still readable and the unit is already gone, and the 1.12 client, which has
    -- no UnitGUID and so can never name the creature.
    local gossip = GossipOnScreen()
    if gossip and gossip ~= "" and NPCID() then
        -- Detemplated before the key is taken too, so the same line gathered on two
        -- characters is one line rather than one per name.
        gossip = Contribute:Detemplate(gossip)
        fields[#fields + 1] = { "npc", NPCField() }
        Observations(fields)
        -- An NPC can say several different things, so gossip is keyed on the words as well.
        return Spoken.Contribute:Envelope("quests", fields, gossip),
            format("g:%d:%d", NPCID(), Spoken.Contribute:Checksum(gossip))
    end

    return nil
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
        return DataModules:PrepareSound({ event = event, questID = GetQuestID and GetQuestID() or 0 })
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
        return DataModules:PrepareSound({
            event = Enums.SoundEvent.Gossip,
            unitGUID = guid,
            name = name,
            unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
            text = gossip,
        })
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

--- Keep the line on screen for later. Only reached once a caller has established it is
--- missing (HasGap), or when its model has just arrived (FinishModelLoad) -- so it re-checks
--- only what the latter cannot know: that the line is still a gap.
function GatherLine()
    if not (Spoken.Gather and Spoken.Gather:IsEnabled()) or not IsMissing() then
        return false
    end
    local envelope, key = Contribute:Capture()
    return envelope and Spoken.Gather:Add(key, envelope) or false
end

--- Whether the contribute button belongs on screen: something to send, and nothing to play.
---
--- Priming the model cache happens here, not in Capture, and only when there is actually a
--- gap: most NPCs already have sound, and there is no reason to ever ask a model to load for
--- one of those. One SetUnit per NPC encountered while a gap is showing, not one per event --
--- a player reads a quest for seconds, which is ample for the load PrimeModelCache started to
--- finish before a click ever reads it back.
function Contribute:HasGap()
    if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
        return false
    end
    -- Hidden in the Spoken settings: no gap to show, and so no model to prime. The
    -- method is guarded because an older bundled player does not have it.
    local hidden = Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden()
    -- Gathering needs the model primed as much as a click does, and runs with the buttons
    -- hidden as readily as with them shown.
    local gathering = Spoken.Gather and Spoken.Gather:IsEnabled()
    local missing = (not hidden or gathering) and IsMissing()
    local gap = not hidden and missing
    if missing then
        PrimeModelCache(Utils:GetNPCGUID())
        -- Gathered here, on the one pass that already knows the line is missing, rather than
        -- by a second caller asking PrepareSound all over again. This runs on every quest and
        -- gossip event through ContributeButton's refresh, which is what drives gathering.
        if gathering then
            GatherLine()
        end
    elseif loadingGUID then
        -- No gap, but a load is still in flight for whatever NPC started it: the player closed
        -- the dialog, or a pack picked up the line, with no click and no retarget to trigger
        -- PrimeModelCache's own guid-switch guard. Left alone, this is unbounded exposure --
        -- the PlayerModel keeps driving a 3D draw until the next gap NPC, which this session
        -- may never show, and this client has hung its GPU on model rendering before. Put the
        -- probe away without caching anything: this is not a resolution, just a stop.
        AbandonModelLoad(loadingGUID)
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
                local description = GetQuestLogQuestText and GetQuestLogQuestText()
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
    local text = questID and self:QuestLogDescription(questID)
    if not text or text == "" then
        return nil
    end
    local fields = BaseFields()
    fields[#fields + 1] = { "quest", questID }
    fields[#fields + 1] = { "event", "accept" }
    fields[#fields + 1] = { "title", title or "" }
    fields[#fields + 1] = { "from", "log" }
    return Spoken.Contribute:Envelope("quests", fields, Contribute:Detemplate(text))
end

--- Whether the quest log should offer Contribute in place of a Play it cannot give.
---
--- Only with at least one sound pack registered: without one, every quest in the log lacks
--- sound, and offering to contribute all of them would say the corpus is missing what is in
--- fact simply not installed.
function Contribute:CanOfferFromLog()
    if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
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
    -- Its right-click opens the debug log's menu, where Spoken Developer is installed. Not on
    -- DialogueUI's window, whose own tooltip this is and whose corner has no such menu.
    local hint = tooltip == GameTooltip and Spoken and Spoken.LogMenuHint and Spoken:LogMenuHint()
    if hint then
        tooltip:AddLine(hint, 0.6, 0.6, 0.6, true)
    end
    tooltip:Show()
end

--- Right-click opens Spoken's debug log menu, as Report's does, where the Spoken Developer module
--- is installed: a Contribute button is up exactly when a line did not play, which is when the log
--- says why. Hooked on mouse-up rather than set as the click, so the button's own OnClick, set
--- again each time it stands for another quest, keeps the left button. No HookScript on 1.12,
--- where the module does not run anyway.
function Contribute:OfferLogMenu(button)
    if not button or button.offersLogMenu or not button.HookScript then
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
    local address = format("%s/contribute", SITE_URL)
    -- What the first-click choice gathers if the player takes it. Only for a line with a key:
    -- a quest log entry has no NPC in front of it, so it is sent but never kept.
    local gather = key and { key = key, envelope = envelope } or nil
    -- Encode is absent on an older Spoken a legacy-client zip can still bundle; Link
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

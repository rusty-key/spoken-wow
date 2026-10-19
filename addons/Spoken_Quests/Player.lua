setfenv(1, VoiceOver)

-- This addon speaking through the Spoken player. The queue, the frame, the minimap
-- button and pause are the player's; this file is the one place that knows both what a
-- quest line is and what the player wants to be handed.
--
-- A prepared SoundData IS the clip: the player reads key, path, length, priority and
-- present from it and ignores the rest, and the dispatcher keeps reading event, questID,
-- name and unitGUID from the same table. One table, two readers, no copying.
-- Two sources, one per part of Spoken's page: quests, and gossip (what NPCs say in their gossip
-- and greeting windows). Spoken switches each on and off and shows each on its own; the queue
-- below them is shared.
Player = { source = nil, gossipSource = nil }

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)
local BOOK = TEXTURES .. "Book"

-- The packs that hold quests alone. Every other pack holds gossip too.
local QUEST_ONLY = {
    SpokenQuestsAudioAlliance = true,
    SpokenQuestsAudioHorde = true,
    SpokenQuestsAudioShared = true,
}

--- Whether a pack holds gossip.
function Player:HoldsGossip(module)
    return not QUEST_ONLY[module.AddonName]
end

local BULLETS = {
    [Enums.SoundEvent.QuestAccept]   = "quest-accept",
    [Enums.SoundEvent.QuestProgress] = "quest-progress",
    [Enums.SoundEvent.QuestComplete] = "quest-complete",
    [Enums.SoundEvent.QuestGreeting] = "gossip",
    [Enums.SoundEvent.Gossip]        = "gossip",
    [Enums.SoundEvent.QuestFollowup] = "quest-complete",
}

--------------------------------------------------------------------------------
-- Reading the queue back
--------------------------------------------------------------------------------

--- Whether a clip is this addon's, quests' or gossip's.
function Player:Owns(clip)
    return clip.source ~= nil and (clip.source == self.source or clip.source == self.gossipSource)
end

--- The source that plays a line: gossip's for what NPCs say, quests' for the rest.
function Player:SourceOf(soundData)
    if self.gossipSource and Enums.SoundEvent:IsGossipEvent(soundData.event) then
        return self.gossipSource
    end
    return self.source
end

--- This addon's clips, in queue order.
function Player:Queued()
    local list = {}
    if not self.source or not Spoken then
        return list
    end
    for _, clip in ipairs(Spoken:GetQueue()) do
        if self:Owns(clip) then
            table.insert(list, clip)
        end
    end
    return list
end

function Player:Contains(soundData)
    for _, clip in ipairs(self:Queued()) do
        if clip == soundData then
            return true
        end
    end
    return false
end

--- The head, if it is one of ours.
function Player:Current()
    local head = Spoken and Spoken:GetCurrent()
    if head and self:Owns(head) then
        return head
    end
    return nil
end

local function GossipClips()
    local list = {}
    for _, clip in ipairs(Player:Queued()) do
        if Enums.SoundEvent:IsGossipEvent(clip.event) then
            table.insert(list, clip)
        end
    end
    return list
end

--------------------------------------------------------------------------------
-- Presentation
--------------------------------------------------------------------------------

-- The creature to draw, or nil for the book. The book for Items, GameObjects, players,
-- a missing GUID, and 2.4.3, which cannot show an arbitrary creature -- what
-- ShouldShowBookFor used to decide inside the frame, decided here instead and handed
-- over as a fallback.
local function CreatureFor(soundData)
    if soundData.unitIsObjectOrItem or Version.IsLegacyBurningCrusade then
        return nil
    end
    local guid = soundData.unitGUID
    if guid and Utils.GetGUIDType and Utils.GetIDFromGUID then
        return Utils:GetCreatureIDFromGUID(guid)
    end
    -- 1.12 has no GUIDs; the pooled model shows the "npc" unit and this is only what
    -- tells one clip's portrait from the next.
    if Version.IsLegacyVanilla then
        return soundData.questID or soundData.name
    end
    return nil
end

-- A line from something faceless shows the item that starts the quest, else a posted notice.
local NOTICE = [[Interface\Icons\INV_Misc_Note_01]]
local ICON_CROP = { 0.08, 0.92, 0.08, 0.92 }
local function Faceless(soundData)
    local icon, crop
    if Spoken and Spoken.QuestItemIcon then icon, crop = Spoken:QuestItemIcon(soundData.questID) end
    return { kind = "texture", texture = icon or NOTICE, texCoord = crop or ICON_CROP }
end

-- The creature's appearance from the data, which the client cannot be trusted for until it has cached it.
local function FaceFor(creature)
    local faces = _G.SpokenQuestFaces
    return faces and creature and faces[creature] or nil
end

local function PortraitFor(soundData)
    if soundData.unitIsObjectOrItem then return Faceless(soundData) end
    return {
        kind = "model",
        creatureID = CreatureFor(soundData),
        displayID = FaceFor(CreatureFor(soundData)),
        animation = 60,
        fallback = { kind = "texture", texture = BOOK },
    }
end

-- The Stop Gossip control, anchored to the header as it always was. The one place the
-- domain-agnostic frame is asked to host something quest-shaped.
local STOP_GOSSIP = {
    id = "stopGossip",
    anchor = "header",
    visible = function() return getn(GossipClips()) > 0 end,
    create = function(parent)
        local button = CreateFrame("Button", nil, parent)
        button:SetSize(32, 32)
        function button:SetGossipCount(gossipCount)
            local texture = gossipCount > 1 and (TEXTURES .. "StopGossipMore") or (TEXTURES .. "StopGossip")
            self:SetShown(gossipCount > 0)
            self:SetHighlightTexture(texture, "ADD")
            self:SetNormalTexture(texture)
            self:SetPushedTexture(texture)
            self.tooltip = gossipCount > 1 and L.OPT_NEXT_GOSSIP or L.OPT_STOP_GOSSIP
            if GameTooltip:GetOwner() == self then
                GameTooltip:SetText(self.tooltip)
                GameTooltip:Show()
            end
        end
        button:SetGossipCount(0)
        button:GetHighlightTexture():SetAlpha(0.5)
        button:GetPushedTexture():SetAlpha(0.5)
        button:HookScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_NONE")
            GameTooltip:SetPoint("LEFT", self, "RIGHT")
            GameTooltip:SetText(self.tooltip)
            GameTooltip:Show()
        end)
        button:HookScript("OnLeave", GameTooltip_Hide)
        button:HookScript("OnClick", function()
            PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
            local head = Player:Current()
            if head and Enums.SoundEvent:IsGossipEvent(head.event) then
                Player:Remove(head)
            else
                for _, clip in ipairs(GossipClips()) do
                    Player:Remove(clip)
                end
            end
        end)
        return button
    end,
    onClipChanged = function(clip, button)
        button:SetGossipCount(getn(GossipClips()))
    end,
}

local REPORT = {
    id = "report",
    -- An icon in the corner rather than a word beside the line: the label never changed,
    -- and the strip it used to sit in pushed the queue up to make room for it. The bug
    -- icon postdates the three legacy clients, where the texture is missing and
    -- the button would be a blank square; `text` is what they draw instead.
    icon = [[Interface\HelpFrame\HelpIcon-Bug]],
    label = L.OPT_REPORT_PROBLEM,
    text = "R",
    anchor = "topright",
    tooltip = function(tooltip)
        tooltip:SetText(L.OPT_REPORT_PROBLEM)
        tooltip:AddLine(L.OPT_REPORT_LINE_TIP, 1, 0.8, 0.2, true)
    end,
    onClick = function(clip)
        -- The line itself first: by the time Report is clicked the quest window may be shut.
        local target = ReportButton:TargetForClip(clip)
        local described = target and clip or nil
        target = target or ReportButton:CurrentTarget()
        if target then
            ReportButton:ShowLink(target, described)
        else
            StaticPopup_Show("VOICEOVER_ERROR", L.OPT_REPORT_NO_LINE)
        end
    end,
}

local ACTIONS = { REPORT, STOP_GOSSIP }

--- Turn a prepared SoundData into a clip, in place.
function Player:Prepare(soundData)
    local event = soundData.event
    local gossip = Enums.SoundEvent:IsGossipEvent(event)
    -- Log replay clips have no dialog snapshot. Resolve only their acceptance text;
    -- the log's description must never stand in for a reward or progress speech.
    if event == Enums.SoundEvent.QuestAccept and (not soundData.text or soundData.text == "")
        and Contribute and Contribute.QuestLogDescription and soundData.questID then
        local ok, text = pcall(Contribute.QuestLogDescription, Contribute, soundData.questID)
        if ok and type(text) == "string" then soundData.text = text end
    end
    soundData.key = soundData.fileName
    soundData.path = soundData.filePath
    soundData.priority = gossip and "low" or "normal"
    -- Cut, so none of the NPC's greeting is heard under the line. With Game Greeting First the NPC
    -- has had its say, so a greeting the wait fell short of fades instead.
    soundData.cutsGameDialogue = not (GreetingFirst and GreetingFirst:IsOn())
    soundData.present = {
        header = soundData.name or "",
        label = soundData.title or (event == Enums.SoundEvent.QuestGreeting and L.OPT_GREETING or (gossip and L.OPT_PACK_GOSSIP or "")),
        bullet = BULLETS[event],
        tint = gossip and { 1, 1, 1 } or nil,
        portrait = PortraitFor(soundData),
        actions = ACTIONS,
    }
    return soundData
end

--------------------------------------------------------------------------------
-- Queueing
--------------------------------------------------------------------------------

-- The windows a dispatched event stands for, as the debug log names them.
local WINDOWS = {
    QUEST_DETAIL = "the NPC's quest window (the offer)",
    QUEST_PROGRESS = "the NPC's quest window (progress)",
    QUEST_COMPLETE = "the NPC's quest window (the reward)",
    QUEST_GREETING = "the NPC's greeting window",
    GOSSIP_SHOW = "the NPC's gossip window",
}

--- Where a line comes from, as the debug log says it: the window an event stands for, and
--- whether it was read automatically or asked for (`source`: the Play button, /spq read, ...).
function Player:Origin(event, source, manual)
    local window = WINDOWS[event] or tostring(event)
    if manual then
        return window .. ", asked for with " .. tostring(source or "a reader")
    end
    return window .. ", read automatically (" .. tostring(source or "event") .. ")"
end

--- What a line says of where it came from, on the `queued` stage: the debug log's reader asks
--- which screen queued what.
local function From(soundData)
    if soundData and soundData.origin then return ", from " .. soundData.origin end
    return ""
end

--- Resolve a line through the packs and hand it to the player. Records the stage the
--- 10 Hz watcher keys on, as the queue used to.
---@param soundData SoundData
---@param asked boolean? the player asked for it, so it is read in a battleground too
---@return boolean queued
function Player:Enqueue(soundData, asked)
    if not soundData.origin then soundData.origin = self.origin end
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    local found, why = DataModules:PrepareSound(soundData)
    if not found then
        Debug:Record("data-lookup-failed", format("No sound entry for event %s, quest ID %s, title %q, language %s: %s",
            Enums.SoundEvent:GetName(soundData.event) or tostring(soundData.event),
            tostring(soundData.questID or "none"), soundData.title or soundData.name or "",
            table.concat(Language:ResolutionOrder(), " then "), tostring(why)))
        if Spoken.EndMuteGameDialogueAhead then
            Spoken:EndMuteGameDialogueAhead()
        end
        return false
    end

    return self:EnqueuePrepared(soundData, asked)
end

--- A line asked for by hand: played at once when idle or stopped, else queued behind the line
--- speaking.
---@param soundData SoundData
---@return boolean queued
function Player:PlayNow(soundData)
    if not soundData.origin then soundData.origin = self.origin end
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end
    local found, why = DataModules:PrepareSound(soundData)
    if not found then
        Debug:Record("data-lookup-failed", format("No sound entry for event %s, quest ID %s: %s",
            Enums.SoundEvent:GetName(soundData.event) or tostring(soundData.event), tostring(soundData.questID or "none"),
            tostring(why)))
        return false
    end
    self:Prepare(soundData)
    local queued = self:SourceOf(soundData):PlayNow(soundData)
    return queued and true or false
end

--- Hand the player a line whose file DataModules has already resolved.
---@param soundData SoundData
---@param asked boolean? as Enqueue's
---@return boolean queued
function Player:EnqueuePrepared(soundData, asked)
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    self:Prepare(soundData)
    if self.playNow then
        return self:PlayPreparedNow(soundData)
    end
    local added, reason = self:SourceOf(soundData):Enqueue(soundData, asked)
    if not added then
        if reason == "duplicate" then
            -- Already in the queue is, for the watcher's purposes, queued.
            Debug:Record("queued", format("Already queued: %s%s", soundData.fileName, From(soundData)))
        elseif reason == "missing" then
            Debug:Record("file-playback-failed", format([[The data entry exists, but PlaySoundFile rejected "%s" from module "%s"]],
                soundData.filePath, soundData.module.METADATA.AddonName))
        elseif reason == "outranked" then
            Debug:Record("queue-outranked", "Gossip yields to the quest line that is queued")
        else
            Debug:Record("sound-disabled", reason or "refused")
        end
        return false
    end

    if Spoken:IsPaused() then
        Debug:Record("queue-paused", "The voiceover is queued, but playback is stopped; run /sp replay")
    end
    return true
end

--- Plays a line asked for by a dialog's Play button at once, ahead of the queue, and skips what
--- was speaking rather than replaying it. Callers set `Player.playNow` around the read.
---@param soundData SoundData
---@return boolean playing
function Player:PlayPreparedNow(soundData)
    local interrupted = Spoken.GetCurrent and Spoken:GetCurrent()
    if interrupted and interrupted.key == soundData.key then
        interrupted = nil
    end
    -- The player's PlayNow queues behind a line already speaking, so that line stops first.
    local stopped = interrupted ~= nil and Spoken.Pause ~= nil and not Spoken:IsPaused() and Spoken:Pause()
    local playing, reason = self:SourceOf(soundData):PlayNow(soundData)
    if not playing then
        Debug:Record("sound-disabled", reason or "refused")
        if stopped and Spoken.Resume then
            Spoken:Resume()
        end
        return false
    end
    if interrupted then
        for _, clip in ipairs(Spoken:GetQueue()) do
            if clip == interrupted then
                Debug:Record("skipped", format("Skipped %s for the line asked for", tostring(interrupted.key)))
                interrupted.source:Remove(interrupted)
                break
            end
        end
    end
    return true
end

--- The queued clip reading the dialog's line, or nil. Matched by file rather than by the
--- SoundData the handler built, so a line started from the quest log counts too.
function Player:QueuedClipFor(line)
    for _, clip in ipairs(self:Queued()) do
        if clip.fileName == line.fileName then
            return clip
        end
    end
end

function Player:Remove(soundData)
    if not self.source then
        return false
    end
    return (soundData.source or self:SourceOf(soundData)):Remove(soundData)
end

--- After a setting changed something the player draws from.
function Player:RefreshConfig()
    if Spoken and Spoken.RefreshPlayer then
        Spoken:RefreshPlayer()
    end
end

--------------------------------------------------------------------------------
-- Registration
--------------------------------------------------------------------------------

function Player:Setup()
    if self.source then
        return true
    end
    if not (Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then
        Debug:Record("player-missing", "The Spoken player addon is not installed; nothing will be read aloud")
        return false
    end

    self.source = Spoken:RegisterSource("quests", {
        title = L.OPT_PAGE_TITLE,
        addon = AddonFolder,
        order = 1,
        -- Upstream's figure: quest durations come from a lookup that has drifted across
        -- transcodes, and the extra gap absorbs one that is slightly short.
        interClipGap = 0.55,
        -- Play-and-stop the file before admitting it, as the queue always did here.
        testBeforeQueue = true,
        -- Its settings follow the profile chosen in Spoken's own settings.
        profiles = function() return Addon.db end,
        -- Printed after Spoken's own by its Show Diagnostics.
        diagnostics = function() Options:PrintDiagnostics() end,
        -- What Spoken's settings show on this part's card: which voice packs are installed.
        packs = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do table.insert(names, module.Title) end
            return names
        end,
    })

    -- What NPCs say in their gossip and greeting windows is a part of its own on Spoken's page:
    -- switched on and off, and shown, apart from the quests.
    self.gossipSource = Spoken:RegisterSource("gossip", {
        title = L.OPT_GOSSIP_PAGE_TITLE,
        addon = AddonFolder,
        order = 2,
        interClipGap = 0.55,
        testBeforeQueue = true,
        profiles = function() return Addon.db end,
        -- The voice packs that hold gossip.
        packs = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do
                if Player:HoldsGossip(module) then table.insert(names, module.Title) end
            end
            return names
        end,
    })

    -- What the watcher reads to know whether an event reached the speaker.
    Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if Player:Owns(clip) then
            Debug:Record("queued", format("Queued %s (%s)%s", clip.title or clip.name or clip.fileName, clip.path,
                From(clip)))
        end
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if not Player:Owns(clip) then
            return
        end
        Debug:Record("playing", format("Playing %s", clip.path or clip.fileName or "voiceover"))
    end)

    -- Switchable from the player's settings, named there by this addon. The zones addon
    -- declares the same id, so one setting covers whichever is speaking.
    if Spoken.RegisterOptionalAction then
        Spoken:RegisterOptionalAction("report", L.OPT_REPORT)
    end

    Spoken:RegisterBullet("quest-accept",   TEXTURES .. "SoundQueueBulletAccept", 14)
    Spoken:RegisterBullet("quest-progress", TEXTURES .. "SoundQueueBulletProgress", 14)
    Spoken:RegisterBullet("quest-complete", TEXTURES .. "SoundQueueBulletComplete", 14)
    Spoken:RegisterBullet("gossip",         TEXTURES .. "SoundQueueBulletGossip", 14)

    -- Switched off or on in Spoken's settings: the buttons on the log and the dialog follow, and
    -- so does the Compendium's Quests tab.
    if Spoken.RegisterCallback then
        Spoken:RegisterCallback("PART_SWITCHED", function(key)
            if key ~= "quests" and key ~= "gossip" then return end
            -- Each only where this client loads it.
            local overlay, dialog, contribute = rawget(VoiceOver, "QuestOverlayUI"),
                rawget(VoiceOver, "DialogPlayButton"), rawget(VoiceOver, "ContributeButton")
            if overlay and key == "quests" then
                if overlay.Update and (QuestLogFrame or QuestScrollFrame) then overlay:Update() end
                if overlay.UpdateDetailsPlayButton then overlay:UpdateDetailsPlayButton() end
            end
            if dialog and dialog.Refresh then dialog:Refresh() end
            if contribute and contribute.Refresh then contribute:Refresh() end
            if SpokenCompendium and SpokenCompendium.Relayout then SpokenCompendium:Relayout() end
        end)
    end

    -- No "read visible quest" entry: it only did anything with a quest window already open,
    -- and an open quest window has its own Play button.
    Spoken.Minimap:AddEntry("quests", { id = "Options", text = L.OPT_MINIMAP_SETTINGS, order = 2,
        onClick = function() Options:OpenSettings() end })
    Spoken.Minimap:AddEntry("gossip", { id = "Options", text = L.OPT_GOSSIP_MINIMAP_SETTINGS, order = 2,
        onClick = function() Options:OpenGossipSettings() end })
    if Spoken.AddSettingsLink then
        Spoken:AddSettingsLink(L.OPT_MINIMAP_SETTINGS, function() Options:OpenSettings() end)
    end
    return true
end

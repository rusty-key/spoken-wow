if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

-- This addon speaking through the Spoken player. The queue, the frame, the minimap
-- button and pause are the player's; this file is the one place that knows both what a
-- quest line is and what the player wants to be handed.
--
-- A prepared SoundData IS the clip: the player reads key, path, length, priority and
-- present from it and ignores the rest, and the dispatcher keeps reading event, questID,
-- name and unitGUID from the same table. One table, two readers, no copying.
Player = { source = nil }

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)
-- The English pack of what NPCs say, which is the gossip module's (Spoken_Gossip).
local GOSSIP_PACK = "SpokenQuestsAudioGossip"

local BULLETS = {
    [Enums.SoundEvent.QuestAccept]   = "quest-accept",
    [Enums.SoundEvent.QuestProgress] = "quest-progress",
    [Enums.SoundEvent.QuestComplete] = "quest-complete",
    [Enums.SoundEvent.QuestFollowup] = "quest-complete",
}

--------------------------------------------------------------------------------
-- Reading the queue back
--------------------------------------------------------------------------------

--- This addon's clips, in queue order.
function Player:Queued()
    local list = {}
    if not self.source or not Spoken then
        return list
    end
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.source == self.source then
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
    if head and head.source == self.source then
        return head
    end
    return nil
end

--------------------------------------------------------------------------------
-- Presentation
--------------------------------------------------------------------------------

-- The speaker's portrait and the Report action are the dialogue core's (Present.lua).

local ACTIONS = { Present.REPORT }

--- Turn a prepared SoundData into a clip, in place.
function Player:Prepare(soundData)
    local event = soundData.event
    -- Log replay clips have no dialog snapshot. Resolve only their acceptance text;
    -- the log's description must never stand in for a reward or progress speech.
    if event == Enums.SoundEvent.QuestAccept and (not soundData.text or soundData.text == "")
        and Contribute and Contribute.QuestLogDescription and soundData.questID then
        local ok, text = pcall(Contribute.QuestLogDescription, Contribute, soundData.questID)
        if ok and type(text) == "string" then soundData.text = text end
    end
    soundData.key = soundData.fileName
    soundData.path = soundData.filePath
    -- Ahead of gossip, which the gossip module queues at "low": a greeting yields to the quest.
    soundData.priority = "normal"
    -- Read while the NPC's window is open: its voice is cut as the line starts, not faded, so
    -- none of its greeting is heard under the line (faded instead under Game Greeting First,
    -- SoundQueue.lua).
    soundData.cutsGameDialogue = true
    soundData.present = {
        header = soundData.name or "",
        label = soundData.title or "",
        bullet = BULLETS[event],
        portrait = Present:Portrait(soundData),
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
---@return boolean queued
function Player:Enqueue(soundData)
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
        return false
    end

    return self:EnqueuePrepared(soundData)
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
    local queued = self.source:PlayNow(soundData)
    return queued and true or false
end

--- Hand the player a line whose file DataModules has already resolved.
---@param soundData SoundData
---@return boolean queued
function Player:EnqueuePrepared(soundData)
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    self:Prepare(soundData)
    if self.playNow then
        return self:PlayPreparedNow(soundData)
    end
    local added, reason = self.source:Enqueue(soundData)
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
        Debug:Record("queue-paused", "The voiceover is queued, but playback is stopped; run /spq play")
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
    local playing, reason = self.source:PlayNow(soundData)
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
                self.source:Remove(interrupted)
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
    return self.source:Remove(soundData)
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
        title = "Spoken Quests",
        addon = AddonFolder,
        order = 1,
        -- Upstream's figure: quest durations come from a lookup that has drifted across
        -- transcodes, and the extra gap absorbs one that is slightly short.
        interClipGap = 0.55,
        -- Play-and-stop the file before admitting it, as the queue always did here.
        testBeforeQueue = true,
        -- Read off an NPC's window: under Game Greeting First its lines wait for the NPC's own
        -- greeting (Spoken's GreetingFirst.lua).
        waitsForGreeting = true,
        -- Its settings follow the profile chosen in Spoken's own settings.
        profiles = function() return Addon.db end,
        -- What Spoken's settings show on this part's card: which voice packs are installed. Not
        -- the Gossip pack, which holds no quest: it is on the gossip module's card.
        packs = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do
                if module.AddonName ~= GOSSIP_PACK then table.insert(names, module.Title) end
            end
            return names
        end,
    })

    -- What the watcher reads to know whether an event reached the speaker.
    Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == Player.source then
            Debug:Record("queued", format("Queued %s (%s)%s", clip.title or clip.name or clip.fileName, clip.path,
                From(clip)))
        end
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.source ~= Player.source then
            return
        end
        Debug:Record("playing", format("Playing %s", clip.path or clip.fileName or "voiceover"))
    end)

    -- The Report action and its dialogs, shared with the gossip module.
    Present:Setup()

    Spoken:RegisterBullet("quest-accept",   TEXTURES .. "SoundQueueBulletAccept", 14)
    Spoken:RegisterBullet("quest-progress", TEXTURES .. "SoundQueueBulletProgress", 14)
    Spoken:RegisterBullet("quest-complete", TEXTURES .. "SoundQueueBulletComplete", 14)

    -- Switched off or on in Spoken's settings: the buttons on the log and the dialog follow.
    if Spoken.RegisterCallback then
        Spoken:RegisterCallback("PART_SWITCHED", function(key)
            if key ~= "quests" then return end
            -- Each only where this client loads it.
            local overlay, dialog, contribute = rawget(VoiceOver, "QuestOverlayUI"),
                rawget(VoiceOver, "DialogPlayButton"), rawget(VoiceOver, "ContributeButton")
            if overlay then
                if overlay.Update and (QuestLogFrame or QuestScrollFrame) then overlay:Update() end
                if overlay.UpdateDetailsPlayButton then overlay:UpdateDetailsPlayButton() end
            end
            if dialog and dialog.Refresh then dialog:Refresh() end
            if contribute and contribute.Refresh then contribute:Refresh() end
        end)
    end

    -- No "read visible quest" entry: it only did anything with a quest window already open,
    -- and an open quest window has its own Play button.
    Spoken.Minimap:AddEntry("quests", { id = "Options", text = L.OPT_MINIMAP_SETTINGS, order = 2,
        onClick = function() Options:OpenSettings() end })
    if Spoken.AddSettingsLink then
        Spoken:AddSettingsLink(L.OPT_MINIMAP_SETTINGS, function() Options:OpenSettings() end)
    end
    return true
end

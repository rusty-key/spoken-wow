if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- This addon speaking through the Spoken player: the one place that knows both what an NPC's
-- line is and what the player wants to be handed. Its lines are the low-priority ones: one
-- queued behind a quest's line yields to it (Spoken's SoundQueue, priority "low").
--
-- A prepared SoundData IS the clip: the player reads key, path, length, priority and present
-- from it and ignores the rest, and the dispatcher keeps reading event, name and unitGUID from
-- the same table. One table, two readers, no copying.
Player = { source = nil }

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)

-- The English packs that hold no gossip: quests only. Every other pack holds some -- the
-- Gossip pack, the complete one, each language's single pack, and upstream's.
local QUEST_ONLY = {
    SpokenQuestsAudioAlliance = true,
    SpokenQuestsAudioHorde = true,
    SpokenQuestsAudioShared = true,
}

--- Whether a pack holds gossip.
function Player:HoldsGossip(module)
    return not QUEST_ONLY[module.AddonName]
end

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

-- The Stop Gossip control, anchored to the header as it always was.
local STOP_GOSSIP = {
    id = "stopGossip",
    anchor = "header",
    visible = function() return getn(Player:Queued()) > 0 end,
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
            if head then
                Player:Remove(head)
            else
                for _, clip in ipairs(Player:Queued()) do
                    Player:Remove(clip)
                end
            end
        end)
        return button
    end,
    onClipChanged = function(clip, button)
        button:SetGossipCount(getn(Player:Queued()))
    end,
}

local ACTIONS = { Present.REPORT, STOP_GOSSIP }

--- Turn a prepared SoundData into a clip, in place.
function Player:Prepare(soundData)
    soundData.key = soundData.fileName
    soundData.path = soundData.filePath
    soundData.priority = "low"
    -- Read while the NPC's window is open: its voice is cut as the line starts, not faded, so
    -- none of its greeting is heard under the line (faded instead under Game Greeting First,
    -- Spoken's SoundQueue.lua).
    soundData.cutsGameDialogue = true
    soundData.present = {
        header = soundData.name or "",
        label = soundData.title or (soundData.event == Enums.SoundEvent.QuestGreeting and L.OPT_GREETING or L.OPT_PACK_GOSSIP),
        bullet = "gossip",
        tint = { 1, 1, 1 },
        portrait = Present:Portrait(soundData),
        actions = ACTIONS,
    }
    return soundData
end

--------------------------------------------------------------------------------
-- Queueing
--------------------------------------------------------------------------------

--- Resolve a line through the packs and hand it to the player.
---@param soundData SoundData
---@return boolean queued
function Player:Enqueue(soundData)
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    if not DataModules:PrepareSound(soundData) then
        Debug:Record("data-lookup-failed", format("No sound entry for event %s, NPC %q, language %s",
            Enums.SoundEvent:GetName(soundData.event) or tostring(soundData.event), soundData.name or "",
            table.concat(Language:ResolutionOrder(), " then ")))
        return false
    end

    return self:EnqueuePrepared(soundData)
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
            Debug:Record("queued", format("Already queued: %s", soundData.fileName))
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
        Debug:Record("queue-paused", "The voiceover is queued, but playback is stopped")
    end
    return true
end

--- Plays a line asked for by a Play button at once, ahead of the queue, and skips what was
--- speaking rather than replaying it, as the quests module's does. Callers set `Player.playNow`
--- around the read (DialogueUI.lua).
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

--- The queued clip reading a window's line, or nil. Matched by file rather than by the
--- SoundData the handler built.
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

    self.source = Spoken:RegisterSource("gossip", {
        title = "Spoken Gossip",
        addon = AddonFolder,
        order = 2,
        -- The quests module's figure, for the packs they share.
        interClipGap = 0.55,
        -- Play-and-stop the file before admitting it, as the quests module does.
        testBeforeQueue = true,
        -- Read off an NPC's window: under Game Greeting First its lines wait for the NPC's own
        -- greeting (Spoken's GreetingFirst.lua).
        waitsForGreeting = true,
        -- Its settings follow the profile chosen in Spoken's own settings.
        profiles = function() return Addon.db end,
        -- What Spoken's settings show on this part's card: the voice packs that hold gossip.
        packs = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do
                if Player:HoldsGossip(module) then table.insert(names, module.Title) end
            end
            return names
        end,
    })

    Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == Player.source then
            Debug:Record("queued", format("Queued %s (%s)", clip.title or clip.name or clip.fileName, clip.path))
        end
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.source == Player.source then
            Debug:Record("playing", format("Playing %s", clip.path or clip.fileName or "voiceover"))
        end
    end)

    -- The Report action and its dialogs, shared with the quests module.
    Present:Setup()
    Spoken:RegisterBullet("gossip", TEXTURES .. "SoundQueueBulletGossip", 14)

    -- Switched off or on in Spoken's settings: the buttons on the windows follow.
    if Spoken.RegisterCallback then
        Spoken:RegisterCallback("PART_SWITCHED", function(key)
            if key ~= "gossip" then return end
            if PlayButton and PlayButton.Refresh then PlayButton:Refresh() end
            local contribute = rawget(Core, "ContributeButton")
            if contribute and contribute.Refresh then contribute:Refresh() end
        end)
    end

    Spoken.Minimap:AddEntry("gossip", { id = "Options", text = L.OPT_MINIMAP_SETTINGS, order = 2,
        onClick = function() Options:OpenSettings() end })
    if Spoken.AddSettingsLink then
        Spoken:AddSettingsLink(L.OPT_MINIMAP_SETTINGS, function() Options:OpenSettings() end)
    end
    return true
end

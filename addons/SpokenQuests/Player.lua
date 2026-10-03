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
local BOOK = TEXTURES .. "Book"

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
            self.tooltip = gossipCount > 1 and "Next Gossip" or "Stop Gossip"
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
    label = "Report a problem",
    text = "R",
    anchor = "topright",
    tooltip = function(tooltip)
        tooltip:SetText("Report a problem")
        tooltip:AddLine("A wrong reading, a mispronounced name -- this gives you a link to say so.",
            1, 0.8, 0.2, true)
    end,
    onClick = function(clip)
        -- The line itself first: by the time Report is clicked the quest window may be shut.
        local target = ReportButton:TargetForClip(clip) or ReportButton:CurrentTarget()
        if target then
            -- The language the clip was spoken in, which PrepareSound recorded: a fallback line
            -- is an English take even under a German selection, and its report is about that.
            ReportButton:ShowLink(target, clip.language)
        else
            StaticPopup_Show("VOICEOVER_ERROR",
                "This client cannot tell which line that was, so there is no address to report.")
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
    soundData.present = {
        header = soundData.name or "",
        label = soundData.title or (event == Enums.SoundEvent.QuestGreeting and L.OPT_GREETING or (gossip and L.OPT_PACK_GOSSIP or "")),
        bullet = BULLETS[event],
        tint = gossip and { 1, 1, 1 } or nil,
        portrait = {
            kind = "model",
            creatureID = CreatureFor(soundData),
            animation = 60,
            fallback = { kind = "texture", texture = BOOK },
        },
        actions = ACTIONS,
    }
    return soundData
end

--------------------------------------------------------------------------------
-- Queueing
--------------------------------------------------------------------------------

--- Resolve a line through the packs and hand it to the player. Records the stage the
--- 10 Hz watcher keys on, as the queue used to.
---@param soundData SoundData
---@return boolean queued
function Player:Enqueue(soundData)
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    if not DataModules:PrepareSound(soundData) then
        Debug:Record("data-lookup-failed", format("No sound entry for event %s, quest ID %s, title %q, language %s",
            Enums.SoundEvent:GetName(soundData.event) or tostring(soundData.event),
            tostring(soundData.questID or "none"), soundData.title or soundData.name or "",
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
    local added, reason = self.source:Enqueue(soundData)
    if not added then
        if reason == "duplicate" then
            -- Already in the queue is, for the watcher's purposes, queued.
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
        Debug:Record("queue-paused", "The voiceover is queued, but playback is paused; run /spq play")
    end
    return true
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
        -- Its settings follow the profile chosen in Spoken's own settings.
        profiles = function() return Addon.db end,
        -- What Spoken's settings show on this part's card: which voice packs are installed.
        packs = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do table.insert(names, module.Title) end
            return names
        end,
        -- The voices come in parts -- Alliance, Horde and the rest, or All of them in one -- so
        -- Spoken shows how many of the parts are here out of how many there are. All counts as
        -- every part.
        packCount = function()
            local total, have, all = 0, 0, false
            for _, module in DataModules:GetAvailableModules() do
                if module.AddonName ~= "SpokenQuestsAudioAll" then total = total + 1 end
            end
            for _, module in DataModules:GetPresentModules() do
                if module.AddonName == "SpokenQuestsAudioAll" then
                    all = true
                else
                    have = have + 1
                end
            end
            if total == 0 then total = math.max(have, 1) end
            if all then have = total end
            return math.min(have, total), total
        end,
        -- ...and which, by name, for the top of this part's page.
        packNames = function()
            local names = {}
            for _, module in DataModules:GetPresentModules() do
                if module.AddonName == "SpokenQuestsAudioAll" then return { DataModules:GetPackLabel(module) } end
                table.insert(names, DataModules:GetPackLabel(module))
            end
            return names
        end,
    })

    -- What the watcher reads to know whether an event reached the speaker.
    Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == Player.source then
            Debug:Record("queued", format("Queued %s (%s)", clip.title or clip.name or clip.fileName, clip.path))
        end
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.source ~= Player.source then
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

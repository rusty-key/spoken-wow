if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

---@class Addon : AceAddon, AceAddon-3.0, AceEvent-3.0, AceTimer-3.0
---@field db VoiceOverConfig|AceDBObject-3.0
local AceAddon = LibStub("AceAddon-3.0")

-- Upstream's players, oldest first: the AceAddon name each registers under, and the folder it
-- installs into. This project's own old folders are found by Spoken (Core.lua, OLD_FOLDERS).
local SUPERSEDED_PLAYERS = {
    { name = "VoiceOver", folder = "AI_VoiceOver" },
    { name = "VoiceOverContinued", folder = "AI_VoiceOver_Continued" },
}

-- The folders of the players that actually registered. Two players handle the same events and
-- queue the same line, so each is stopped here for this session and its folder disabled for
-- the next login further down; loading two also used to cause a duplicate AceAddon error.
--
-- Registering is what makes a folder a duplicate, rather than merely existing: a folder that
-- registered nothing is an old install already switched off.
local supersededFolders = {}
for _, player in ipairs(SUPERSEDED_PLAYERS) do
    local supersededAddon = AceAddon:GetAddon(player.name, true)
    if supersededAddon then
        if supersededAddon.Disable then
            supersededAddon:Disable()
        end
        table.insert(supersededFolders, player.folder)
    end
end
Addon = AceAddon:NewAddon("SpokenQuests", "AceEvent-3.0", "AceTimer-3.0")

Addon.OnAddonLoad = {}
local AUTO_POLL_INTERVAL = 0.1

-- Store original function before EQL3 (Extended Quest Log 3) overrides it and starts prepending quest level
local GetTitleText = GetTitleText

local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

-- The last quest event the client fired, and the only way to tell an offer from a turn-in
-- when Blizzard's quest panels never appear. An addon that replaces the quest frame -
-- DialogueUI calls QuestFrame:UnregisterAllEvents() - leaves every panel hidden while the
-- player is in a dialog, so classifying by panel alone read every interaction as an offer.
-- The client still fires the events themselves; only Blizzard's frame stopped listening.
local lastQuestEvent

-- Defined with the handlers below, and asked by functions above them.
local ResolveQuestID

-- The quest globals as they stood when the client fired a quest event. An addon that
-- accepts or turns in the quest from its own handler - Leatrix Plus, and the auto-turn-in
-- addons beside it - closes the dialog in the same frame the event arrived in, so GetQuestID
-- is back to 0 by the time the 10 Hz watcher first polls and the interaction would never be
-- read at all. The watcher still owns dispatch: it replays this record only once the dialog
-- has closed with nothing dispatched for it.
local questSnapshot

-- Set while a handler is being replayed from a snapshot, so it reads that instead of globals
-- the client has already cleared.
local questSnapshotInUse

-- Each quest event's line: the sound it is keyed by, the data module's name for the
-- interaction, and the global its text is read from.
local QUEST_EVENTS = {
    QUEST_DETAIL = { sound = Enums.SoundEvent.QuestAccept, source = "accept",
        text = function() return GetQuestText and GetQuestText() or "" end },
    QUEST_PROGRESS = { sound = Enums.SoundEvent.QuestProgress, source = "progress",
        text = function() return GetProgressText and GetProgressText() or "" end },
    QUEST_COMPLETE = { sound = Enums.SoundEvent.QuestComplete, source = "complete",
        text = function() return GetRewardText and GetRewardText() or "" end },
}

--- GetQuestID for the dialog `event` names. On a legacy client GetQuestID is
--- Compatibility.lua's substitute, which resolves the quest from the text of the dialog it
--- is told about; telling it here, just before asking, means no event order is relied on.
local function QuestIDFor(event)
    local quest = QUEST_EVENTS[event]
    if quest and Addon.NoteLegacyQuestEvent then
        Addon:NoteLegacyQuestEvent(quest.source, quest.text())
    end
    return GetQuestID and GetQuestID() or 0
end

--- The quest on the open dialog `event` names, falling back on its title, NPC and text where
--- the client has no ID for it. For callers outside the dialog events, which have no snapshot:
--- Followup.lua's accept and turn-in hooks on the legacy clients.
function Addon:DialogQuestID(event)
    local quest = QUEST_EVENTS[event]
    return ResolveQuestID(quest.source, QuestIDFor(event), GetTitleText and GetTitleText() or "",
        Utils:GetNPCName() or "", quest.text(), true) or 0
end

local function CaptureQuestSnapshot(event)
    local quest = QUEST_EVENTS[event]
    if not quest then
        return
    end
    local readText = quest.text
    local questID = QuestIDFor(event)
    local questTitle = GetTitleText and GetTitleText() or ""
    -- Nothing to replay, and nothing to identify a quest by either.
    if (not questID or questID == 0) and questTitle == "" then
        return
    end
    questSnapshot = {
        event = event,
        questID = questID,
        title = questTitle,
        text = readText(),
        guid = Utils:GetNPCGUID(),
        targetName = Utils:GetNPCName(),
        isObjectOrItem = Utils:IsNPCObjectOrItem(),
    }
end

-- Where a quest handler's fields come from: the live globals, or the snapshot being replayed.
local function ReadQuestFields(event)
    local snapshot = questSnapshotInUse
    if snapshot then
        return snapshot.questID, snapshot.title, snapshot.text, snapshot.guid, snapshot.targetName,
            snapshot.isObjectOrItem
    end
    return QuestIDFor(event), GetTitleText(), QUEST_EVENTS[event].text(), Utils:GetNPCGUID(),
        Utils:GetNPCName(), Utils:IsNPCObjectOrItem()
end

local function GetVisibleQuestEvent()
    -- Completion and progress take priority over detail. IsVisible accounts
    -- for hidden parents; IsShown can remain true on an inactive child panel.
    if IsFrameVisible(QuestFrameRewardPanel) then
        return "QUEST_COMPLETE"
    elseif IsFrameVisible(QuestFrameProgressPanel) then
        return "QUEST_PROGRESS"
    elseif IsFrameVisible(QuestFrameDetailPanel) then
        return "QUEST_DETAIL"
    end

    local questID = GetQuestID and GetQuestID()
    if not questID or questID == 0 then
        return
    end

    -- Quest-log detail views do not use the NPC QuestFrame panels, but GetQuestID is
    -- authoritative while they are visible, and they only ever show the offer text.
    if IsFrameVisible(QuestLogDetailFrame) or IsFrameVisible(QuestMapDetailsFrame) then
        return "QUEST_DETAIL"
    end

    -- No panel of either kind: trust the last event instead of assuming an offer. It is
    -- cleared by QUEST_FINISHED, so a quest ID the client keeps reporting after the dialog
    -- closed no longer replays anything.
    return lastQuestEvent
end

--- The dialogue core's, which loads the packs (DataModules:Start).
function Addon:ShowMissingDataModulePopup()
    return DataModules:ShowMissingPopup()
end

--- Every read goes through here, automatic or not. `manual` is a player asking for this
--- line - the Play button, /spq read - rather than the client reporting a dialog, so it reads
--- whatever autoplay says.
function Addon:InvokeQuestHandler(event, source, manual)
    local handler = self[event]
    if not handler then
        Debug:Record("handler-missing", format("No handler exists for %s", tostring(event)))
        return false
    end
    if not manual and not self:IsAutoplayOn() then
        Debug:Record("autoplay-off", format("Not reading %s: autoplay is off", event))
        return false
    end
    -- Read while DialogueUI's window is still appearing, the voice would run ahead of the words
    -- it marks, so autoplay waits for the window.
    local bridge = not manual and rawget(VoiceOver, "DialogueUIBridge")
    if bridge and bridge.Defer and bridge:Defer(event, function()
        self:InvokeQuestHandler(event, source, manual)
    end) then
        Debug:Record("dialogueui-wait", format("Waiting for DialogueUI's window to read %s", event))
        return true
    end

    Debug:Record("quest-dispatch", format("Dispatching %s through %s", event, source or "manual reader"))
    -- Where the lines this queues come from, for the debug log (Player:Enqueue keeps it on each).
    Player.origin = Player:Origin(event, source, manual)
    local succeeded, errorMessage = pcall(handler, self, event, manual)
    Player.origin = nil
    -- The bridge keeps the page blank for this read's line; it shows the page at once if none came.
    if bridge and bridge.Read then
        local stage = Debug.runtime.stage
        bridge:Read(event, succeeded and (stage == "queued" or stage == "queue-paused" or stage == "playing"))
    end
    if not succeeded then
        Debug:Record("handler-error", format("%s failed: %s", event, tostring(errorMessage)))
        local errorHandler = geterrorhandler and geterrorhandler()
        if errorHandler then
            errorHandler(errorMessage)
        end
        return false
    end
    return true
end

--- Whether the player has this part of Spoken switched on (Spoken's settings). Off, none of
--- its buttons show on the game's frames.
function Addon:IsPartOn()
    return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("quests")
end

function Addon:IsAutoplayOn()
    return self.db.profile.Audio.Autoplay ~= false
end

function Addon:SetAutoplay(on)
    self.db.profile.Audio.Autoplay = on and true or false
    -- The Play button stands in for autoplay, so it appears or goes with the setting even
    -- while a dialog is already open.
    if DialogPlayButton and DialogPlayButton.Refresh then
        DialogPlayButton:Refresh()
    end
end

--- The line the open dialog would read, resolved against the packs, or nil when no dialog
--- is open or no pack has its line. Asked without reading anything. The second value is
--- the client event it stands for. A caller that already knows the event passes it: under
--- DialogueUI the event is the only record of which panel is up, and DialogueUI hears it
--- before this addon's recorder does.
---@param event string?
---@return SoundData?, string?
function Addon:GetVisibleLine(event)
    event = event or GetVisibleQuestEvent()
    local quest = event and QUEST_EVENTS[event]
    if not quest then
        return nil
    end
    local questID = ResolveQuestID(quest.source, QuestIDFor(event),
        GetTitleText and GetTitleText() or "", Utils:GetNPCName() or "", quest.text(), true)
    if not questID then
        return nil
    end
    local probe = { event = quest.sound, questID = questID }
    if not DataModules:PrepareSound(probe) then
        return nil
    end
    return probe, event
end

--- Read the dialog on screen because the player asked to.
function Addon:ReadVisibleQuest(source)
    local event = GetVisibleQuestEvent()
    if not event then
        Debug:Record("visible-panel-missing", "GetQuestID returned 0 and no Blizzard quest panel is visible")
        return false
    end
    return self:InvokeQuestHandler(event, source or "visible quest reader", true)
end

---@class VoiceOverConfig
local defaults = {
    profile = {
        -- The frame, the minimap button, the sound channel's legacy music-channel
        -- workaround and the paused flag are the Spoken player's settings now.
        Audio = {
            -- What NPCs say and how often is the gossip module's now; it took this addon's
            -- settings for it over on its first login (Spoken_Gossip's TakeOverFromQuests).
            -- The sound channel and the muting of the client's own NPC dialogue used to
            -- live here. They describe how anything is played rather than what this addon
            -- reads, so they are Spoken's settings now.
            StopAudioOnDisengage = false,
            -- Off, no quest dialog reads itself: nothing plays until
            -- the Play button on the window is pressed (UI/DialogPlayButton.lua) or
            -- /spq read is typed.
            Autoplay = true,
            -- What NPCs say in chat after this player accepts or turns in a quest
            -- (Followup.lua). Autoplay off silences these too: they read themselves.
            FollowupLines = true,
            -- Follow the client, and fall back on English. Every pack that exists today
            -- is English and declares no language, so an English-speaking player with the
            -- packs they already have resolves enUS on the first pass and hears exactly
            -- what they heard before this setting existed.
            VoiceLanguage = "auto",
            FallbackLanguage = "enUS",
        },
        -- These do nothing without the DialogueUI addon.
        DialogueUI = {
            -- Typed out, lit, or both, by Spoken's Type Words Out and Highlight Words.
            Captions = true,
            AutoScroll = true,
            -- Off by default: DialogueUI hides the rest of the interface on purpose, and its marked text
            -- already shows the words.
            ShowPlayer = false,
            -- Shown whether or not DialogueUI's Text To Speech is on.
            PlayButton = true,
        },
        DebugEnabled = false,
    },
    char = {
        RecentQuestTitleToID = Version:IsBelowLegacyVersion(30300) and {},
    }
}

Addon.DialogueUIDefaults = defaults.profile.DialogueUI

local currentQuestSoundData

function Addon:OnInitialize()
    self.db = LibStub("AceDB-3.0"):New("SpokenQuestsSettings", defaults)
    self.db.RegisterCallback(self, "OnProfileChanged", "RefreshConfig")
    self.db.RegisterCallback(self, "OnProfileReset", "RefreshConfig")

    StaticPopupDialogs["VOICEOVER_ERROR"] =
    {
        text = "Spoken Quests|n|n%s",
        button1 = OKAY,
        timeout = 0,
        whileDead = 1,
    }

    Player:Setup()

    -- The Contribute button, on the Blizzard quest/gossip frame rather than the Spoken player
    -- frame -- see the dialogue core's ContributeButton.lua for why the player frame will not do. Its
    -- own event frame (built in Setup, not here) is what keeps it in sync with what's on
    -- screen; no timer. Guarded like ReportButton just above: a failed build here must not
    -- take playback down with it.
    local contributeButtonReady, contributeButtonError = pcall(function()
        if ContributeButton and ContributeButton.Setup then
            ContributeButton:Setup()
        end
    end)
    if not contributeButtonReady then
        Debug:Record("contribute-button-error", tostring(contributeButtonError))
    end

    -- The Play button autoplay's off position leaves the player with. Guarded the same
    -- way, for the same reason.
    local dialogPlayButtonReady, dialogPlayButtonError = pcall(function()
        if DialogPlayButton and DialogPlayButton.Setup then
            DialogPlayButton:Setup()
        end
    end)
    if not dialogPlayButtonReady then
        Debug:Record("dialog-play-button-error", tostring(dialogPlayButtonError))
    end

    -- Guarded: DialogueUI is someone else's addon, and a change there must not take narration
    -- down with it.
    local dialogueUIReady, dialogueUIError = pcall(function()
        if DialogueUIBridge and DialogueUIBridge.Setup then
            DialogueUIBridge:Setup()
        end
    end)
    if not dialogueUIReady then
        Debug:Record("dialogueui-error", tostring(dialogueUIError))
    end

    -- The lines NPCs say after a quest. Guarded the same way: a failed hook here must not
    -- take quest narration down with it.
    local followupReady, followupError = pcall(function()
        if Followup and Followup.Setup then
            Followup:Setup()
        end
    end)
    if not followupReady then
        Debug:Record("followup-error", tostring(followupError))
    end

    -- The packs are the dialogue core's to find and load, whichever module that reads NPCs
    -- starts first (DataModules:Start). Its settings list them once they are found.
    DataModules:Start()
    local optionsSucceeded, optionsError = pcall(Options.Initialize, Options)
    if not optionsSucceeded then
        self.optionsInitializationError = tostring(optionsError)
        Debug:Record("options-ui-failed", self.optionsInitializationError)
    end

    -- Install this before all optional event registration. AceAddon deliberately
    -- safe-calls OnInitialize, so a later registration failure must not take
    -- automatic playback down with it.
    Debug:Record("options-ready", "Options and manual quest reader are registered")
    self.autoQuestState = {
        candidateAge = 0,
        retryDelay = 0,
        lastHandledAt = 0,
    }

    local function ResetCandidate(state)
        state.candidateKey = nil
        state.candidateAge = 0
        state.retryDelay = 0
        state.completedKey = nil
    end

    local function PollAutomaticQuest()
        local state = self.autoQuestState
        if DataModules:IsPending() then
            Debug:Note("watcher", "pending", "quest watcher waits: the voice packs are still loading")
            return
        end
        if not self:IsAutoplayOn() then
            -- Nothing to poll for: InvokeQuestHandler would refuse every read. The snapshot is
            -- dropped too, so turning autoplay back on does not replay a dialog long closed.
            questSnapshot = nil
            ResetCandidate(state)
            -- Said once for each quest opened meanwhile, which is the question a player asks.
            local open = GetQuestID and GetQuestID() or 0
            if open and open ~= 0 then
                Debug:Note("watcher", "off:" .. tostring(open),
                    "quest %s open, not read: Read Automatically is off", tostring(open))
            end
            return
        end
        local questCallSucceeded, questID = pcall(function()
            return GetQuestID and GetQuestID() or 0
        end)
        if not questCallSucceeded then
            error(questID)
        end
        if not questID or questID == 0 then
            -- The dialog is gone. If it closed with nothing dispatched for it, the event
            -- snapshot is the whole record of the interaction, so read that before the
            -- candidate state is cleared.
            local snapshot = questSnapshot
            questSnapshot = nil
            if snapshot and not snapshot.dispatched then
                local key = format("%s:%s:%s", snapshot.event, tostring(snapshot.questID), snapshot.title or "")
                if key ~= state.lastHandledKey or GetTime() - state.lastHandledAt >= 5 then
                    state.lastHandledKey = key
                    state.lastHandledAt = GetTime()
                    Debug:Record("auto-watcher-snapshot", format(
                        "Reading %s quest %s from its event snapshot: the dialog closed before it could stabilize",
                        snapshot.event, tostring(snapshot.questID)))
                    questSnapshotInUse = snapshot
                    self:InvokeQuestHandler(snapshot.event, "closed dialog event snapshot", false)
                    questSnapshotInUse = nil
                end
            end
            ResetCandidate(state)
            return
        end

        local titleSucceeded, questTitle = pcall(function()
            return GetTitleText and GetTitleText() or ""
        end)
        if not titleSucceeded then
            error(questTitle)
        end
        local eventSucceeded, event = pcall(GetVisibleQuestEvent)
        if not eventSucceeded then
            error(event)
        end
        event = event or "QUEST_DETAIL"
        local key = format("%s:%s:%s", event, tostring(questID), questTitle or "")
        if key ~= state.candidateKey then
            state.candidateKey = key
            state.candidateAge = 0
            state.retryDelay = 0
            state.completedKey = nil
            Debug:Record("auto-watcher-stabilizing", format("Waiting for %s quest %s to finish populating", event,
                tostring(questID)))
            return
        end

        -- A synchronous Classic quest event can expose the previous quest's
        -- globals briefly while switching NPCs. Do not replay the most recent
        -- quest key during that transition; /spq read remains an explicit way
        -- to replay it.
        if key == state.lastHandledKey and GetTime() - state.lastHandledAt < 5 then
            state.completedKey = key
            return
        end

        state.candidateAge = state.candidateAge + AUTO_POLL_INTERVAL
        state.retryDelay = math.max(0, state.retryDelay - AUTO_POLL_INTERVAL)
        local expectedSoundEvent = QUEST_EVENTS[event] and QUEST_EVENTS[event].sound
        for _, queuedSound in ipairs(Player:Queued()) do
            if queuedSound.questID == questID and queuedSound.event == expectedSoundEvent then
                state.completedKey = key
                state.lastHandledKey = key
                state.lastHandledAt = GetTime()
                if questSnapshot then
                    questSnapshot.dispatched = true
                end
                return
            end
        end

        if key ~= state.completedKey and state.candidateAge >= 0.4 and state.retryDelay <= 0 then
            state.retryDelay = 0.5
            Debug:Record("auto-watcher-dispatch", format("Automatically reading %s quest %s", event,
                tostring(questID)))
            local visibleEvent = GetVisibleQuestEvent()
            if visibleEvent then
                self:InvokeQuestHandler(visibleEvent, "automatic GetQuestID timer", false)
            else
                Debug:Record("visible-panel-missing", "GetQuestID returned 0 and no Blizzard quest panel is visible")
            end

            local stage = Debug.runtime and Debug.runtime.stage
            if stage == "queued" or stage == "queue-paused" or stage == "playing" or
               stage == "sound-disabled" or stage == "file-playback-failed" or stage == "playback-failed" or
               stage == "data-lookup-failed" then
                state.completedKey = key
                state.lastHandledKey = key
                state.lastHandledAt = GetTime()
                if questSnapshot then
                    questSnapshot.dispatched = true
                end
            end
        end
    end

    -- The watcher cannot work on a legacy client and must not be installed there.
    -- GetQuestID does not exist before 3.3.0, so Compatibility.lua substitutes one that
    -- resolves a quest fuzzily from text captured by the QUEST_DETAIL/PROGRESS/COMPLETE
    -- handlers - which the poll below is trying to decide whether to call. It would poll a
    -- zero forever. Those clients dispatch from the events directly instead; see directEvents.
    if Version.IsAnyLegacy then
        Debug:Record("auto-watcher-skipped", "Legacy client: quest events dispatch directly")
    else
        local tickerInstalled, tickerOrError = pcall(self.ScheduleRepeatingTimer, self, function()
            local succeeded, pollError = pcall(PollAutomaticQuest)
            if not succeeded then
                Debug:Record("auto-watcher-error", tostring(pollError))
            end
        end, AUTO_POLL_INTERVAL)
        if tickerInstalled then
            self.autoQuestTicker = tickerOrError
            Debug:Record("auto-watcher-ready", "AceTimer GetQuestID polling is active")
        else
            Debug:Record("auto-watcher-install-failed", tostring(tickerOrError))
        end
    end

    local slashInstalled, slashError = pcall(function()
        _G.SLASH_SPOKENQUESTSREAD1 = "/spqread"
        _G.SlashCmdList.SPOKENQUESTSREAD = function()
            self:ReadVisibleQuest("/spqread")
        end
    end)
    if not slashInstalled then
        Debug:Record("standalone-slash-failed", tostring(slashError))
    end

    self.eventBridgeErrors = {}
    local aceRegistered, aceError = pcall(self.RegisterEvent, self, "ADDON_LOADED")
    if not aceRegistered then
        table.insert(self.eventBridgeErrors, "AceEvent ADDON_LOADED: " .. tostring(aceError))
    end

    -- Quest detail/progress/completion are intentionally absent here on Blizzard's clients. On
    -- Classic Era those synchronous events can fire before GetQuestID and the text globals
    -- change, replaying the previous quest. The stabilized 10 Hz watcher above is their single
    -- automatic dispatcher.
    --
    -- On a legacy client the race does not exist, the watcher does not run, and these
    -- events are the only route to quest audio - they are also what sets the text
    -- Compatibility.lua's GetQuestID substitute reads, so nothing resolves until one fires.
    -- Greetings and gossip are the gossip module's (Spoken_Gossip), with their own events.
    local directEvents = {
        "QUEST_FINISHED",
    }
    if Version.IsAnyLegacy then
        table.insert(directEvents, "QUEST_DETAIL")
        table.insert(directEvents, "QUEST_PROGRESS")
        table.insert(directEvents, "QUEST_COMPLETE")
    end
    -- Recording a quest event is not the same as dispatching it: on Blizzard's clients an
    -- event can fire before the quest globals change, which is why the watcher owns
    -- dispatch, but the event name itself is trustworthy the moment it arrives.
    -- QUEST_FINISHED is here to clear the record, so that a quest ID the client keeps
    -- reporting after the dialog closed cannot be read as a fresh interaction.
    self.questEventRecorderFrame = CreateFrame("Frame")
    for _, event in ipairs({ "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_FINISHED" }) do
        pcall(self.questEventRecorderFrame.RegisterEvent, self.questEventRecorderFrame, event)
    end
    self.questEventRecorderFrame:SetScript("OnEvent", function(_, event)
        if event == "QUEST_FINISHED" then
            lastQuestEvent = nil
        else
            lastQuestEvent = event
            -- Through pcall because a snapshot is a fallback, and a client that refuses one
            -- of these globals must not stop the event from being recorded.
            pcall(CaptureQuestSnapshot, event)
            pcall(self.MuteGreetingAhead, self, event)
        end
    end)

    local directEventLookup = {}
    local lastDispatch = {}
    local dispatching = {}
    local function DispatchDirectEvent(event, source)
        local now = GetTime()
        if dispatching[event] or lastDispatch[event] and now - lastDispatch[event] < 0.5 then
            return
        end

        dispatching[event] = true
        local succeeded = self:InvokeQuestHandler(event, source, false)
        dispatching[event] = nil
        if not succeeded then
            return
        end

        -- Only suppress the panel/watcher fallback when this route
        -- actually reached the queue or playback stage. An early event
        -- with unpopulated quest globals must be allowed to retry.
        local stage = Debug.runtime and Debug.runtime.stage
        if stage == "queued" or stage == "queue-paused" or stage == "playing" then
            lastDispatch[event] = GetTime()
        else
            lastDispatch[event] = nil
        end
    end
    self.DispatchDirectEvent = function(addon, event, source)
        return DispatchDirectEvent(event, source or "manual dispatch")
    end

    local function SignalDirectEvent(event, source)
        DispatchDirectEvent(event, source)
    end

    self.directEventFrame = CreateFrame("Frame")
    for _, event in ipairs(directEvents) do
        local registered, registerError = pcall(self.directEventFrame.RegisterEvent, self.directEventFrame, event)
        if registered then
            directEventLookup[event] = true
        else
            table.insert(self.eventBridgeErrors, format("Direct %s: %s", event, tostring(registerError)))
        end
    end
    self.directEventFrame:SetScript("OnEvent", function(frame, event)
        SignalDirectEvent(event, "direct frame")
    end)

    -- Hook the exact Blizzard dispatcher that updates the visible quest
    -- panels. This runs after Blizzard has populated GetQuestID/GetTitleText.
    --
    -- Blizzard's own function is what is hooked here, so the frame overrides that normalize
    -- handler arguments on the older clients do not apply: before 3.0.2 it takes no arguments
    -- and reads the global `event` instead.
    if QuestFrame_OnEvent and hooksecurefunc then
        local hooked, hookError = pcall(hooksecurefunc, "QuestFrame_OnEvent", function(frame, event)
                event = event or _G.event
                if directEventLookup[event] then
                    SignalDirectEvent(event, "QuestFrame_OnEvent hook")
                end
            end)
        if not hooked then
            table.insert(self.eventBridgeErrors, "QuestFrame_OnEvent: " .. tostring(hookError))
        end
    end

    if next(self.eventBridgeErrors) then
        Debug:Record("event-bridge-partial", format("Quest watcher is active; %d optional bridge component(s) failed",
            getn(self.eventBridgeErrors)))
    else
        Debug:Record("event-bridge-ready", "Stabilized quest watcher is registered")
    end

    -- The folders of the players that registered this session, stopped at the top of this
    -- file. Disabling one takes effect on the next login only. Nothing is read from their
    -- saved variables: every player starts this release with settings of its own.
    --
    -- Through pcall in case a client refuses DisableAddOn to an addon (Forever accepts it,
    -- checked 2026-10-04): every quest hook below this still has to be installed. The
    -- duplicate is stopped for the session either way.
    local disabled = {}
    for _, folder in ipairs(supersededFolders) do
        pcall(DisableAddOn, folder)
        table.insert(disabled, format('"%s"', folder))
    end

    if next(disabled) and not self.db.profile.SeenDuplicatePlayerDialog then
        StaticPopupDialogs["VOICEOVER_REDUX_DUPLICATE_ADDON"] =
        {
            text = format([[Spoken Quests|n|n%s was also enabled. It has been disabled for the next login, and its event handler was stopped for this session.|n|nKeep your sound pack enabled - "Spoken Quests Audio" or the older "AI_VoiceOverData_Vanilla", either works. You can delete or leave the old player disabled, then /reload.]],
                table.concat(disabled, " and ")),
            button1 = OKAY,
            timeout = 0,
            whileDead = 1,
            OnAccept = function()
                self.db.profile.SeenDuplicatePlayerDialog = true
            end,
        }
        StaticPopup_Show("VOICEOVER_REDUX_DUPLICATE_ADDON")
    end

    local function MakeAbandonQuestHook(field, getFieldData)
        return function()
            local data = getFieldData()
            local soundsToRemove = {}
            for _, soundData in ipairs(Player:Queued()) do
                if Enums.SoundEvent:IsQuestEvent(soundData.event) and soundData[field] == data then
                    table.insert(soundsToRemove, soundData)
                end
            end

            -- From the last, so the speaking line goes after its quest's waiting lines: then it fades
            -- out if nothing at all waits behind it, and is cut when any line waits behind it.
            for i = #soundsToRemove, 1, -1 do
                Player:Remove(soundsToRemove[i])
            end
        end
    end
    if C_QuestLog and C_QuestLog.AbandonQuest then
        hooksecurefunc(C_QuestLog, "AbandonQuest", MakeAbandonQuestHook("questID", function() return C_QuestLog.GetAbandonQuest() end))
    elseif AbandonQuest then
        hooksecurefunc("AbandonQuest", MakeAbandonQuestHook("questName", function() return GetAbandonQuestName() end))
    end

    if QuestLog_Update then
        hooksecurefunc("QuestLog_Update", function()
            QuestOverlayUI:Update()
        end)
    end
end

function Addon:RefreshConfig()
    Player:RefreshConfig()
end

function Addon:ADDON_LOADED(event, addon)
    addon = addon or arg1 -- Thanks, Ace3v...
    local hook = self.OnAddonLoad[addon]
    if hook then
        hook()
    end
end

local function QuestSoundDataAdded(soundData)
    -- Save current quest sound data for dialog/frame sync option
    currentQuestSoundData = soundData
end

function ResolveQuestID(source, questID, questTitle, targetName, questText, quiet)
    if questID and questID ~= 0 then
        return questID
    end

    -- On current Classic clients GetQuestID can briefly return 0 while the
    -- QUEST_DETAIL frame is already populated. Resolve it through the loaded
    -- data module's title/NPC/text index instead of silently abandoning the
    -- event. This also handles ambiguous repeated quest titles.
    local fallbackID = DataModules:GetQuestID(source, questTitle or "", targetName or "", questText or "")
    if fallbackID then
        if quiet then
            return fallbackID
        end
        Debug:Record("quest-id-fallback", format("Resolved %q to quest ID %d", questTitle or "", fallbackID))
        return fallbackID
    end

    if quiet then
        return
    end
    Debug:Record("quest-id-missing", format("The client returned quest ID 0 and the data module could not resolve %q",
        questTitle or ""))
end

function Addon:QUEST_DETAIL()
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_DETAIL")

    Debug:Record("quest-detail", format("QUEST_DETAIL: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("accept", questID, questTitle, targetName, questText)
    if not questID then
        return
    end

    if Addon.db.char.RecentQuestTitleToID and questID ~= 0 then
        Addon.db.char.RecentQuestTitleToID[questTitle] = questID
    end

    local type = guid and Utils:GetGUIDType(guid)
    if type == Enums.GUID.Item then
        -- Allow quests started from items to have VO, book icon will be displayed for them
    elseif not type or not Enums.GUID:CanHaveID(type) then
        -- If the quest is started by something that we cannot extract the ID of (e.g. Player, when sharing a quest) - try to fallback to a questgiver from a module's database
        local id
        type, id = DataModules:GetQuestLogQuestGiverTypeAndID(questID)
        guid = id and Enums.GUID:CanHaveID(type) and Utils:MakeGUID(type, id) or guid
        targetName = id and DataModules:GetObjectName(type, id) or targetName or "Unknown Name"
    end

    -- print("QUEST_DETAIL", questID, questTitle);
    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestAccept,
        questID = questID,
        name = targetName,
        title = questTitle,
        text = questText,
        unitGUID = guid,
        unitIsObjectOrItem = isObjectOrItem,
        addedCallback = QuestSoundDataAdded,
    }
    Player:Enqueue(soundData)
end

function Addon:QUEST_PROGRESS()
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_PROGRESS")

    Debug:Record("quest-progress", format("QUEST_PROGRESS: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("progress", questID, questTitle, targetName, questText)
    if not questID then
        return
    end

    if Addon.db.char.RecentQuestTitleToID then
        Addon.db.char.RecentQuestTitleToID[questTitle] = questID
    end

    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestProgress,
        questID = questID,
        name = targetName,
        title = questTitle,
        text = questText,
        unitGUID = guid,
        unitIsObjectOrItem = isObjectOrItem,
        addedCallback = QuestSoundDataAdded,
    }
    Player:Enqueue(soundData)
end

function Addon:QUEST_COMPLETE()
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_COMPLETE")

    Debug:Record("quest-complete", format("QUEST_COMPLETE: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("complete", questID, questTitle, targetName, questText)
    if not questID then
        return
    end

    if Addon.db.char.RecentQuestTitleToID and questID ~= 0 then
        Addon.db.char.RecentQuestTitleToID[questTitle] = questID
    end

    -- print("QUEST_COMPLETE", questID, questTitle);
    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestComplete,
        questID = questID,
        name = targetName,
        title = questTitle,
        text = questText,
        unitGUID = guid,
        unitIsObjectOrItem = isObjectOrItem,
        addedCallback = QuestSoundDataAdded,
    }
    Player:Enqueue(soundData)
end

--- An NPC's own greeting starts the moment its dialog opens, and the line that replaces it
--- is read off the dialog a moment later, once its globals have held still for 0.4s. The player muting the game's dialogue only once that line started is what cut the
--- greeting off mid-word, so for a dialog that is going to be read the mute is taken here,
--- in the frame the dialog opened, and the greeting is not heard at all. A dialog nothing
--- will be read for keeps its greeting: that is what the lookups below are for.
---@param event string
function Addon:MuteGreetingAhead(event)
    if not Spoken.MuteGameDialogueAhead or not self:IsAutoplayOn() or DataModules:IsPending()
        or not Player.source then
        return
    end
    if not QUEST_EVENTS[event] then
        return
    end
    -- Silenced only where a pack reads the line; any other NPC keeps its greeting. A quest whose
    -- ID is not known yet is muted too: its greeting starts now, and with no line the mute lifts.
    -- Under Game Greeting First nothing is cut (Spoken's GreetingFirst.lua).
    local questID = QuestIDFor(event)
    if not questID or questID == 0 or self:ExpectedLine(event) then
        Spoken:MuteGameDialogueAhead(Player.source)
    end
end

--- The text autoplay will read for the quest window that just opened, or nil. Asked before the
--- line is queued. `textIsCurrent` is the DialogueUI bridge's, and changes nothing for a quest.
---@param event string
---@param textIsCurrent boolean?
---@return string?
function Addon:ExpectedLine(event, textIsCurrent)
    if not self:IsAutoplayOn() or DataModules:IsPending() or not Player.source then
        return nil
    end
    local quest = QUEST_EVENTS[event]
    if not quest then
        return nil
    end
    -- The quest ID can still be the previous quest's this early; the worst that costs is one
    -- greeting muted for nothing, or one cut off as it was before.
    local questID = QuestIDFor(event)
    if not questID or questID == 0 then
        return nil
    end
    if not DataModules:PrepareSound({ event = quest.sound, questID = questID }) then
        return nil
    end
    return quest.text() or ""
end

function Addon:QUEST_FINISHED()
    if Addon.db.profile.Audio.StopAudioOnDisengage and currentQuestSoundData then
        Player:Remove(currentQuestSoundData)
    end
    currentQuestSoundData = nil
end

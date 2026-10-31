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

local AUTO_POLL_INTERVAL = 0.1

-- Store original function before EQL3 (Extended Quest Log 3) overrides it and starts prepending quest level
local GetTitleText = GetTitleText

-- The open quest's title, or "" where there is none or the game hides it from addons (in
-- instances on the Forever client): it keys tables, which take no nil.
local function QuestTitle()
    return GetTitleText and NotSecret(GetTitleText()) or ""
end

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
local ResolveQuestID, NoteGossipPage

-- The quest globals as they stood when the client fired each quest event, oldest first. An
-- addon that accepts or turns in the quest from its own handler - Leatrix Plus, Enhance QoL,
-- RestedXP, Zygor - closes the dialog in the same frame the event arrived in, so GetQuestID
-- is back to 0 by the time the 10 Hz watcher first polls and the interaction would never be
-- read at all. An auto turn-in shows two pages before the watcher can read either, so each
-- page keeps its own record. The watcher still owns dispatch: a page is replayed from here
-- only once the dialog has closed, or the quest was accepted or turned in, with nothing read
-- for it. A page whose event arrived with neither a quest ID nor a title names no quest, and
-- no later event could tie it to one, so it is not recorded.
local questSnapshots = {}

-- Long enough for the server to answer an accept or a turn-in, short enough that a quest
-- accepted later some other way (an escort a party member starts) does not read an old offer.
local SNAPSHOT_LIFETIME = 10

-- Set while a handler is being replayed from a snapshot, so it reads that instead of globals
-- the client has already cleared.
local questSnapshotInUse

-- A quest page is read once whichever route finds it first: the key of the last page handled, and
-- when. A quest the client reports again within this long is the same interaction.
local HANDLED_AGAIN_AFTER = 5

local function HandledRecently(state, key)
    return key == state.lastHandledKey and GetTime() - state.lastHandledAt < HANDLED_AGAIN_AFTER
end

local function MarkHandled(state, key)
    state.lastHandledKey = key
    state.lastHandledAt = GetTime()
end

local function PageKey(event, questID, title)
    return format("%s:%s:%s", event, tostring(questID), title or "")
end

-- Each quest event's line: the sound it is keyed by, the data module's name for the
-- interaction, and the global its text is read from.
local QUEST_EVENTS = {
    QUEST_DETAIL = { sound = Enums.SoundEvent.QuestAccept, source = "accept",
        text = function() return GetQuestText and NotSecret(GetQuestText()) or "" end },
    QUEST_PROGRESS = { sound = Enums.SoundEvent.QuestProgress, source = "progress",
        text = function() return GetProgressText and NotSecret(GetProgressText()) or "" end },
    QUEST_COMPLETE = { sound = Enums.SoundEvent.QuestComplete, source = "complete",
        text = function() return GetRewardText and NotSecret(GetRewardText()) or "" end },
}

--- The quest the open dialog shows, 0 when none.
local function CurrentQuestID()
    return NotSecret(GetQuestID()) or 0
end

local EVENT_OF_SOUND = {}
for event, quest in pairs(QUEST_EVENTS) do
    EVENT_OF_SOUND[quest.sound] = event
end

local function PruneQuestSnapshots()
    local now = GetTime()
    for i = #questSnapshots, 1, -1 do
        if now - questSnapshots[i].at > SNAPSHOT_LIFETIME then
            table.remove(questSnapshots, i)
        end
    end
end

local function CaptureQuestSnapshot(event)
    local quest = QUEST_EVENTS[event]
    if not quest then
        return
    end
    PruneQuestSnapshots()
    local questID = CurrentQuestID()
    local questTitle = QuestTitle()
    -- Nothing to replay, and nothing to identify a quest by either.
    if questID == 0 and questTitle == "" then
        return
    end
    local text, targetName = quest.text(), Utils:GetNPCName()
    -- Resolved now, the way the handler would: QUEST_ACCEPTED and QUEST_TURNED_IN find a page by
    -- its quest ID, and the brief 0 a Classic client reports would match neither.
    if questID == 0 then
        questID = ResolveQuestID(quest.source, questID, questTitle, targetName, text, true) or 0
    end
    local snapshot = {
        event = event,
        at = GetTime(),
        questID = questID,
        title = questTitle,
        text = text,
        guid = Utils:GetNPCGUID(),
        targetName = targetName,
        isObjectOrItem = Utils:IsNPCObjectOrItem(),
    }
    -- The same page shown again replaces its record, and keeps what was done with it, so a page
    -- read in the open window is not read again after it closes.
    for i = #questSnapshots, 1, -1 do
        local old = questSnapshots[i]
        if old.event == event and old.questID == questID and old.title == questTitle then
            snapshot.dispatched = old.dispatched
            table.remove(questSnapshots, i)
        end
    end
    table.insert(questSnapshots, snapshot)
end

--- A page of `event` of quest `questID` was read while its dialog was open: the newest record of
--- that event is that page, whatever the globals held when its event arrived. The earlier pages of
--- `questID` were passed over by the player, as they always were, so they are not replayed after it
--- either. The record's own quest ID is not used for that: it may be the previous quest's, and
--- that quest's pages may still be waiting for their own accept or turn-in.
local function MarkQuestSnapshotRead(event, questID)
    for i = #questSnapshots, 1, -1 do
        if questSnapshots[i].event == event then
            questSnapshots[i].dispatched = true
            for j = 1, i - 1 do
                if questSnapshots[j].questID == questID then
                    questSnapshots[j].dispatched = true
                end
            end
            return
        end
    end
end

--- An offer recorded after a progress or reward page of its quest: it carries the globals of the
--- quest just handed in, not an offer of its own.
local function IsStaleOffer(i)
    local offer = questSnapshots[i]
    if offer.event ~= "QUEST_DETAIL" then
        return false
    end
    for j = 1, i - 1 do
        local earlier = questSnapshots[j]
        if earlier.questID == offer.questID and earlier.event ~= "QUEST_DETAIL" then
            return true
        end
    end
    return false
end

-- Where a quest handler's fields come from: the live globals, or the snapshot being replayed.
local function ReadQuestFields(event)
    local snapshot = questSnapshotInUse
    if snapshot then
        return snapshot.questID, snapshot.title, snapshot.text, snapshot.guid, snapshot.targetName,
            snapshot.isObjectOrItem
    end
    return CurrentQuestID(), QuestTitle(), QUEST_EVENTS[event].text(), Utils:GetNPCGUID(),
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
    elseif IsFrameVisible(QuestFrameGreetingPanel) then
        return "QUEST_GREETING"
    end

    local questID = NotSecret(GetQuestID())
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

-- The Forever client's gamepad UI takes over every popup as it opens, inside the code that
-- opened it. Opened by an addon, that taints the gamepad's bindings: the next close is blocked,
-- and the "blocked from an action" dialog it raises hangs the client (#165). What this addon
-- would pop up unasked goes to chat there instead. A copy of Spoken's own (Core.lua), because
-- the player may be the addon that is missing.
local function IsGamepadUI()
    return GetCVar("InputDeviceInterfaceStyle") == "1"
end

local function Say(text)
    DEFAULT_CHAT_FRAME:AddMessage("|cff66bbffSpoken Quests:|r " .. text)
end

function Addon:ShowMissingDataModulePopup()
    if DataModules:HasRegisteredModules() then
        return
    end

    local loadDetails = {}
    for _, module in DataModules:GetPresentModules() do
        local reason = DataModules:GetModuleLoadError(module.AddonName)
        if reason then
            table.insert(loadDetails, format("%s: %s", module.AddonName, reason))
        end
    end
    local details = next(loadDetails) and ("|n|nDetected but not loaded:|n" .. table.concat(loadDetails, "|n")) or ""
    local text = [[No usable voice packs were loaded.|n|nKeep a voice pack installed beside this addon - "Spoken Audio: Quests", or the older "AI_VoiceOverData_Vanilla". Run "/spq diagnostics" for details.]] .. details
    if IsGamepadUI() then
        Say(text)
        return
    end
    StaticPopupDialogs["VOICEOVER_NO_REGISTERED_DATA_MODULES"] =
    {
        text = "Spoken Quests|n|n" .. text,
        button1 = OKAY,
        timeout = 0,
        whileDead = 1,
    }
    StaticPopup_Show("VOICEOVER_NO_REGISTERED_DATA_MODULES")
end

--- Every read goes through here, automatic or not. `manual` is a player asking for this
--- line - the Play button, /spq read - rather than the client reporting a dialog, so it reads
--- whatever autoplay and the greeting frequency say.
--- `snapshot` is a page replayed from the record of its event: it is read as recorded, and does
--- not wait for DialogueUI's window, which is no longer the page's.
function Addon:InvokeQuestHandler(event, source, manual, snapshot)
    local handler = self[event]
    if not handler then
        Debug:Record("handler-missing", format("No handler exists for %s", tostring(event)))
        return false
    end
    -- Only a read waits on autoplay: a window closing must still stop a line the Play button started.
    if not manual and event ~= "QUEST_FINISHED" and event ~= "GOSSIP_CLOSED" and not self:IsAutoplayOn() then
        Debug:Record("autoplay-off", format("Not reading %s: autoplay is off", event))
        return false
    end
    -- Read while DialogueUI's window is still appearing, the voice would run ahead of the words
    -- it marks, so autoplay waits for the window.
    local bridge = not manual and not snapshot and rawget(VoiceOver, "DialogueUIBridge")
    if bridge and bridge.Defer and bridge:Defer(event, function()
        self:InvokeQuestHandler(event, source, manual)
    end) then
        Debug:Record("dialogueui-wait", format("Waiting for DialogueUI's window to read %s", event))
        return true
    end

    Debug:Record("quest-dispatch", format("Dispatching %s through %s", event, source or "manual reader"))
    -- Where the lines this queues come from, for the debug log (Player:Enqueue keeps it on each).
    Player.origin = Player:Origin(event, source, manual)
    questSnapshotInUse = snapshot
    local succeeded, errorMessage = pcall(handler, self, event, manual)
    questSnapshotInUse = nil
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

--- Whether the player has a part of Spoken switched on (Spoken's settings): "quests", or
--- "gossip" for what NPCs say. Off, none of its buttons show on the game's frames.
function Addon:IsPartOn(part)
    return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn(part or "quests")
end

--- The part a window belongs to, told by the game event that opens it: greeting and gossip
--- windows are Gossip's, every quest window Quests'.
function Addon:PartOfPage(event)
    return (event == "GOSSIP_SHOW" or event == "QUEST_GREETING") and "gossip" or "quests"
end

--- Whether the part the window `event` opens belongs to is switched on.
function Addon:IsPageOn(event)
    return self:IsPartOn(self:PartOfPage(event))
end

function Addon:IsAutoplayOn()
    return self.db.profile.Audio.Autoplay ~= false
end

--- Read Greetings is at Never: no NPC window reads itself, whatever Read Automatically says.
function Addon:IsNever()
    return self.db.profile.Audio.GossipFrequency == Enums.GossipFrequency.Never
end

function Addon:SetAutoplay(on)
    self.db.profile.Audio.Autoplay = on and true or false
    -- The Play button stands in for autoplay, so it appears or goes with the setting even
    -- while a dialog is already open.
    if DialogPlayButton and DialogPlayButton.Refresh then
        DialogPlayButton:Refresh()
    end
end

--- The quest panels and the gossip frame, in the priority GetVisibleQuestEvent gives them.
--- Gossip is last because it is the one a quest dialog replaces.
local function GetVisibleDialogueEvent()
    local event = GetVisibleQuestEvent()
    if not event and IsFrameVisible(GossipFrame) then
        event = "GOSSIP_SHOW"
    end
    return event
end

local SPEECH_EVENTS = {
    QUEST_GREETING = { sound = Enums.SoundEvent.QuestGreeting, text = function() return NotSecret(GetGreetingText()) end },
    GOSSIP_SHOW = { sound = Enums.SoundEvent.Gossip, text = function() return NotSecret(GetGossipText()) end },
}

--- The line the open dialog would read, resolved against the packs, or nil when no dialog
--- is open or no pack has its line. Asked without reading anything. The second value is
--- the client event it stands for. A caller that already knows the event passes it: under
--- DialogueUI the event is the only record of which panel is up, and DialogueUI hears it
--- before this addon's recorder does.
---@param event string?
---@return SoundData?, string?
function Addon:GetVisibleLine(event)
    event = event or GetVisibleDialogueEvent()
    -- A part that is off reads nothing and offers nothing: no Listen button, no DialogueUI Play.
    if event and not self:IsPageOn(event) then
        return nil, event
    end
    local quest = event and QUEST_EVENTS[event]
    local speech = event and SPEECH_EVENTS[event]
    local probe
    if quest then
        local text = quest.text()
        local questID = ResolveQuestID(quest.source, CurrentQuestID(),
            QuestTitle(), Utils:GetNPCName() or "", text, true)
        if not questID then
            return nil
        end
        -- The text and giver too: a moment in several wordings is found by the words on screen.
        probe = { event = quest.sound, questID = questID, text = text, unitGUID = Utils:GetNPCGUID() }
    elseif speech then
        local guid, name = Utils:GetNPCGUID(), Utils:GetNPCName()
        if not guid and not name then
            return nil
        end
        probe = {
            event = speech.sound,
            name = name,
            text = speech.text() or "",
            unitGUID = guid,
            unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
        }
    else
        return nil
    end
    if not DataModules:PrepareSound(probe) then
        return nil
    end
    return probe, event
end

--- Read the dialog on screen because the player asked to.
function Addon:ReadVisibleQuest(source)
    local event = GetVisibleDialogueEvent()
    if not event then
        Debug:Record("visible-panel-missing", "GetQuestID returned 0 and no Blizzard quest or gossip panel is visible")
        return false
    end
    return self:InvokeQuestHandler(event, source or "visible quest reader", true)
end

---@class VoiceOverConfig
local defaults = {
    profile = {
        -- The frame, the minimap button and the paused flag are the Spoken player's settings now.
        Audio = {
            -- A quest giver's greeting is read once; other NPCs greet every time. A profile
            -- that stored a choice of its own keeps it.
            GossipFrequency = Enums.GossipFrequency.OncePerQuestNPC,
            -- The sound channel and the muting of the client's own NPC dialogue used to
            -- live here. They describe how anything is played rather than what this addon
            -- reads, so they are Spoken's settings now.
            StopAudioOnDisengage = false,
            -- On, the NPC's own greeting is heard and what Spoken reads waits for it
            -- (GreetingFirst.lua); off, Silence NPC Voices cuts it where a pack has one.
            GreetingFirst = false,
            -- Off, no quest dialog, greeting or gossip reads itself: nothing plays until
            -- the Play button on the window is pressed (UI/DialogPlayButton.lua) or
            -- /spq read is typed. GossipFrequency then has nothing to decide.
            Autoplay = true,
            OGThrall = false,
            -- On, an automatic read starts when the window closes instead of when it opens.
            ReadAfterClose = false,
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
            -- Shown whether or not DialogueUI's Text To Speech is on.
            PlayButton = true,
        },
        QuestLogPlayButton = true,
        TrackerPlayButton = true,
        DebugEnabled = false,
    },
    char = {
        hasSeenGossipForNPC = {},
    }
}

Addon.DialogueUIDefaults = defaults.profile.DialogueUI

local lastGossipOptions
local selectedGossipOption
-- Set by picking any option, even one whose label could not be found, until the window closes:
-- every page after the greeting was asked for.
local gossipOptionPicked
-- The gossip or greeting event whose window took a mute ahead, until the next window opens, it
-- closes, or a read gives the NPC its voice back; and how often it has been read again for its text.
local greetingMutedFor
local greetingTextTries = 0
local GREETING_TEXT_TRIES, GREETING_TEXT_WAIT = 5, 0.2
-- Moved on whenever a wait ends, so a read again for one window never runs in the next: a quest
-- page replaces the greeting in the same window with no close at all.
local greetingWait = 0

local function EndGreetingTextWait()
    greetingMutedFor = nil
    greetingTextTries = 0
    greetingWait = greetingWait + 1
end

--- A read of a window that took a mute will not speak its greeting: the NPC has its voice back
--- now, not at the mute's deadline.
local function GiveVoiceBack(event)
    if greetingMutedFor == event then
        EndGreetingTextWait()
        if Spoken.EndMuteGameDialogueAhead then
            Spoken:EndMuteGameDialogueAhead()
        end
    end
end
local currentQuestSoundData
local currentGossipSoundData

function Addon:OnInitialize()
    -- A character Spoken put on the profile chosen for new characters starts on it here too, so the
    -- two stay one profile. AceDB uses it only where these settings have not seen the character.
    local profile = Spoken and Spoken.NewCharacterStartProfile and Spoken:NewCharacterStartProfile()
    self.db = LibStub("AceDB-3.0"):New("SpokenQuestsSettings", defaults, profile)
    -- A Started Only saved off before it was on by default would read as the player's choice:
    -- cleared once behind this marker, as unset reads as on. An off set after that is kept.
    local global = self.db.global
    if not global.startedOnlyDefaultOn then
        global.startedOnlyDefaultOn = true
        if global.Compendium then global.Compendium.FoundOnly = nil end
    end
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
    GreetingFirst:Setup()
    -- The copy-link popup behind the Report button. Guarded because a failure to build a
    -- dialog must not stop playback initializing.
    local reportButtonReady, reportButtonError = pcall(ReportButton.Initialize, ReportButton)
    if not reportButtonReady then
        Debug:Record("report-button-error", tostring(reportButtonError))
    end

    -- The Contribute button, on the Blizzard quest/gossip frame rather than the Spoken player
    -- frame -- see UI/ContributeButton.lua's header for why the player frame will not do. Its
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

    -- What NPCs say in the world: a failed hook here must not take quest narration down either.
    local chatterReady, chatterError = pcall(function()
        if Chatter and Chatter.Setup then
            Chatter:Setup()
        end
    end)
    if not chatterReady then
        Debug:Record("chatter-error", tostring(chatterError))
    end

    -- Discover data packs now, but load their multi-megabyte generated Lua
    -- tables after entering the world. Keeping LoadAddOn out of AceAddon's
    -- shared initialization/login stack avoids Hardcore's stricter script
    -- time budget being charged to AceAddon-3.0. One pack per callback: several
    -- in one still run past the client's script-time limit.
    DataModules:EnumerateAddons(false)
    self.dataModulesPending = not DataModules:HasRegisteredModules()
    -- A position rather than "the first pack not registered", so a pack that fails is tried once
    -- and cannot hold back the packs after it.
    local nextPack = 1
    local function LoadDeferredDataModules()
        if not self.dataModulesPending then
            return
        end
        -- result is the pack tried, or the error when the call itself failed.
        local succeeded, result = pcall(DataModules.LoadPresentModuleAt, DataModules, nextPack)
        if succeeded and result then
            nextPack = nextPack + 1
            local reason = DataModules:GetModuleLoadError(result.AddonName)
            if reason then
                Debug:Record("data-load-error", format("%s: %s", result.AddonName, reason))
            end
            -- The next frame's callback starts with a fresh script-time budget.
            C_Timer.After(0, LoadDeferredDataModules)
            return
        end
        self.dataModulesPending = nil
        if not succeeded then
            self.dataModulesDeferredError = tostring(result)
            Debug:Record("data-load-error", self.dataModulesDeferredError)
        elseif DataModules:HasRegisteredModules() then
            Debug:Record("data-ready", "Deferred sound packs finished loading")
        end
        -- The settings pages were built before this, with every pack still to register.
        SpokenEnv.Callbacks:Fire("VOICE_PACKS_LOADED")
        self:ShowMissingDataModulePopup()
    end
    local function ScheduleDeferredDataLoad()
        C_Timer.After(1, LoadDeferredDataModules)
    end
    if self.dataModulesPending then
        if IsLoggedIn and IsLoggedIn() then
            ScheduleDeferredDataLoad()
        else
            self.dataLoaderFrame = CreateFrame("Frame")
            self.dataLoaderFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
            self.dataLoaderFrame:SetScript("OnEvent", function(frame)
                frame:UnregisterEvent("PLAYER_ENTERING_WORLD")
                ScheduleDeferredDataLoad()
            end)
        end
    end
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

    --- Reads the recorded pages nothing has read yet, oldest first. With `questID` (from
    --- QUEST_ACCEPTED or QUEST_TURNED_IN) only that quest's pages of `events`; without it, the
    --- newest unread page of each event whose dialog has closed: of offers opened and closed
    --- unread, the last is the one the player was left with. The others are passed over, and
    --- stay for their own accept or turn-in. An offer recorded after its quest's own pages
    --- carries the globals of the quest just handed in, so it is not read.
    local function ReplaySnapshot(snapshot, source)
        local state = self.autoQuestState
        snapshot.dispatched = true
        local key = PageKey(snapshot.event, snapshot.questID, snapshot.title)
        if HandledRecently(state, key) then
            return
        end
        MarkHandled(state, key)
        Debug:Record("auto-watcher-snapshot", format("Reading %s quest %s from its event snapshot: %s",
            snapshot.event, tostring(snapshot.questID), source))
        self:InvokeQuestHandler(snapshot.event, "event snapshot", false, snapshot)
    end

    -- Index of the newest unread page of each event, refilled on every close-time replay.
    local newest = {}

    local function ReplayQuestSnapshots(source, questID, events)
        PruneQuestSnapshots()
        -- The watcher calls this ten times a second whenever no quest is open.
        if #questSnapshots == 0 then
            return
        end
        if questID then
            for _, snapshot in ipairs(questSnapshots) do
                if not snapshot.dispatched and events[snapshot.event] and snapshot.questID == questID then
                    ReplaySnapshot(snapshot, source)
                end
            end
            return
        end
        wipe(newest)
        for i, snapshot in ipairs(questSnapshots) do
            if not snapshot.dispatched and not snapshot.passed then
                newest[snapshot.event] = i
            end
        end
        for i, snapshot in ipairs(questSnapshots) do
            if not snapshot.dispatched and not snapshot.passed then
                -- Passed over, not spent: its own QUEST_ACCEPTED or QUEST_TURNED_IN still reads it.
                if newest[snapshot.event] ~= i or IsStaleOffer(i) then
                    snapshot.passed = true
                else
                    ReplaySnapshot(snapshot, source)
                end
            end
        end
    end

    local function PollAutomaticQuest()
        local state = self.autoQuestState
        if self.dataModulesPending then
            Debug:Note("watcher", "pending", "quest watcher waits: the voice packs are still loading")
            return
        end
        if not self:IsAutoplayOn() then
            -- Nothing to poll for: InvokeQuestHandler would refuse every read. The snapshots are
            -- dropped too, so turning autoplay back on does not replay a dialog long closed.
            wipe(questSnapshots)
            ResetCandidate(state)
            -- Said once for each quest opened meanwhile, which is the question a player asks.
            local open = CurrentQuestID()
            if open ~= 0 then
                Debug:Note("watcher", "off:" .. tostring(open),
                    "quest %s open, not read: Read Automatically is off", tostring(open))
            end
            return
        end
        local questID = CurrentQuestID()
        if questID == 0 then
            -- The dialog is gone. Pages it closed on with nothing dispatched for them are the
            -- whole record of the interaction, so read them before the candidate state is cleared.
            ReplayQuestSnapshots("the dialog closed before it could stabilize")
            ResetCandidate(state)
            return
        end

        local titleSucceeded, questTitle = pcall(QuestTitle)
        if not titleSucceeded then
            error(questTitle)
        end
        local eventSucceeded, event = pcall(GetVisibleQuestEvent)
        if not eventSucceeded then
            error(event)
        end
        event = event or "QUEST_DETAIL"
        local key = PageKey(event, questID, questTitle)
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
        if HandledRecently(state, key) then
            state.completedKey = key
            return
        end

        state.candidateAge = state.candidateAge + AUTO_POLL_INTERVAL
        state.retryDelay = math.max(0, state.retryDelay - AUTO_POLL_INTERVAL)
        local expectedSoundEvent = QUEST_EVENTS[event] and QUEST_EVENTS[event].sound
        for _, queuedSound in ipairs(Player:Queued()) do
            if queuedSound.questID == questID and queuedSound.event == expectedSoundEvent then
                state.completedKey = key
                MarkHandled(state, key)
                MarkQuestSnapshotRead(event, questID)
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
                MarkHandled(state, key)
                MarkQuestSnapshotRead(visibleEvent, questID)
            end
        end
    end

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

    -- Quest detail/progress/completion are intentionally absent here. On Classic Era those
    -- synchronous events can fire before GetQuestID and the text globals change, replaying the
    -- previous quest. The stabilized 10 Hz watcher above is their single automatic dispatcher.
    local directEvents = {
        "QUEST_GREETING",
        "QUEST_FINISHED",
        "GOSSIP_SHOW",
        "GOSSIP_CLOSED",
    }
    -- Recording a quest event is not the same as dispatching it: an event can fire before the
    -- quest globals change, which is why the watcher owns dispatch, but the event name itself is
    -- trustworthy the moment it arrives.
    -- QUEST_FINISHED is here to clear the record, so that a quest ID the client keeps
    -- reporting after the dialog closed cannot be read as a fresh interaction.
    -- QUEST_ACCEPTED and QUEST_TURNED_IN say the dialog closed on an accepted or handed-in quest,
    -- not a declined one, on a client that keeps reporting the quest ID after the dialog closed.
    -- The pages each of them reads.
    local REPLAYED_ON = {
        QUEST_ACCEPTED = { QUEST_DETAIL = true },
        QUEST_TURNED_IN = { QUEST_PROGRESS = true, QUEST_COMPLETE = true },
    }
    self.questEventRecorderFrame = CreateFrame("Frame")
    for _, event in ipairs({ "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_FINISHED",
        "QUEST_ACCEPTED", "QUEST_TURNED_IN" }) do
        pcall(self.questEventRecorderFrame.RegisterEvent, self.questEventRecorderFrame, event)
    end
    self.questEventRecorderFrame:SetScript("OnEvent", function(_, event, questIDArg, ...)
        if event == "QUEST_FINISHED" then
            lastQuestEvent = nil
        elseif REPLAYED_ON[event] then
            if self.dataModulesPending then
                return
            end
            -- QUEST_TURNED_IN carries the quest ID first and the rewards after it. QUEST_ACCEPTED
            -- carries the quest ID alone, except on Classic clients, where it follows the quest log
            -- index. A secret quest ID there is no ID, and the index is never taken for one.
            if event == "QUEST_ACCEPTED" and select("#", ...) > 0 then
                questIDArg = (...)
            end
            local questID = NotSecret(questIDArg)
            if type(questID) ~= "number" or questID == 0 then
                return
            end
            local succeeded, replayError = pcall(ReplayQuestSnapshots, event, questID, REPLAYED_ON[event])
            if not succeeded then
                Debug:Record("auto-watcher-error", tostring(replayError))
            end
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

        if event == "GOSSIP_SHOW" then
            -- Whether or not autoplay reads this page, the next one's label depends on it.
            NoteGossipPage()
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

    -- Greeting globals can have the same synchronous-event race. Coalesce the
    -- event/frame signals and read them on a later frame after Blizzard has
    -- populated the new NPC and text.
    local deferredSpeechEvents = {
        QUEST_GREETING = true,
        GOSSIP_SHOW = true,
    }
    local deferredEventGeneration = {}
    -- The last read asked for an event wins, and a close of its window cancels it.
    local function DispatchLater(event, source, delay)
        local generation = (deferredEventGeneration[event] or 0) + 1
        deferredEventGeneration[event] = generation
        self:ScheduleTimer(function()
            if deferredEventGeneration[event] == generation then
                DispatchDirectEvent(event, source)
            end
        end, delay)
    end
    local function SignalDirectEvent(event, source)
        if event == "QUEST_FINISHED" then
            deferredEventGeneration.QUEST_GREETING = (deferredEventGeneration.QUEST_GREETING or 0) + 1
        elseif event == "GOSSIP_CLOSED" then
            deferredEventGeneration.GOSSIP_SHOW = (deferredEventGeneration.GOSSIP_SHOW or 0) + 1
        end
        if not deferredSpeechEvents[event] then
            DispatchDirectEvent(event, source)
            return
        end
        DispatchLater(event, source .. " (deferred)", 0.1)
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
        -- Before the deferral: the greeting is already playing.
        if deferredSpeechEvents[event] then
            pcall(self.MuteGreetingAhead, self, event)
        end
        SignalDirectEvent(event, "direct frame")
    end)

    -- Keep UI fallbacks only for NPC greetings. Quest narration is exclusively
    -- handled by the stabilized watcher.
    local panelEvents = {
        { frame = QuestFrameGreetingPanel, event = "QUEST_GREETING" },
        { frame = GossipFrame, event = "GOSSIP_SHOW" },
    }
    for _, binding in ipairs(panelEvents) do
        if binding.frame and binding.frame.HookScript then
            local event = binding.event
            local hooked, hookError = pcall(binding.frame.HookScript, binding.frame, "OnShow", function()
                    SignalDirectEvent(event, "panel OnShow")
                end)
            if not hooked then
                table.insert(self.eventBridgeErrors, format("Panel %s: %s", event, tostring(hookError)))
            end
        end
    end

    -- Hook the exact Blizzard dispatcher that updates the visible quest
    -- panels. This runs after Blizzard has populated GetQuestID/GetTitleText.
    if QuestFrame_OnEvent then
        local hooked, hookError = pcall(hooksecurefunc, "QuestFrame_OnEvent", function(frame, event)
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
            #self.eventBridgeErrors))
    else
        Debug:Record("event-bridge-ready", "Stabilized quest watcher and deferred greeting bridge are registered")
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
            text = format([[Spoken Quests|n|n%s was also enabled. It has been disabled for the next login, and its event handler was stopped for this session.|n|nKeep your sound pack enabled - "Spoken Audio: Quests" or the older "AI_VoiceOverData_Vanilla", either works. You can delete or leave the old player disabled, then /reload.]],
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
            local data = NotSecret(getFieldData())
            if data == nil then
                return
            end
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

    if C_GossipInfo and C_GossipInfo.SelectOption then
        -- The game's window picks by id, DialogueUI by the option's index in the page.
        for name, field in pairs({ SelectOption = "gossipOptionID", SelectOptionByIndex = "orderIndex" }) do
            if C_GossipInfo[name] then
                hooksecurefunc(C_GossipInfo, name, function(pick)
                    gossipOptionPicked = true
                    pick = NotSecret(pick)
                    if lastGossipOptions and pick then
                        for _, info in ipairs(lastGossipOptions) do
                            if NotSecret(info[field]) == pick then
                                selectedGossipOption = NotSecret(info.name)
                                break
                            end
                        end
                        lastGossipOptions = nil
                    end
                end)
            end
        end
    elseif SelectGossipOption then
        hooksecurefunc("SelectGossipOption", function(index)
            gossipOptionPicked = true
            index = NotSecret(index)
            if lastGossipOptions and index then
                selectedGossipOption = NotSecret(lastGossipOptions[1 + (index - 1) * 2])
                lastGossipOptions = nil
            end
        end)
    end
end

function Addon:RefreshConfig()
    Player:RefreshConfig()
    QuestOverlayUI:RefreshQuestLog()
    QuestOverlayUI.UpdateTrackerButtons()
end

local function GossipSoundDataAdded(soundData)
    -- Save current gossip sound data for dialog/frame sync option
    currentGossipSoundData = soundData
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

-- With Read When Window Closes on, an automatic read waits for the window to close
-- (QUEST_FINISHED). The window shows one quest page at a time, so the last one read is the one kept.
local pendingRead

local function QueueRead(soundData, manual)
    -- A read from the snapshot of a window that has already closed has nothing left to wait for.
    if not manual and Addon.db.profile.Audio.ReadAfterClose and not questSnapshotInUse then
        pendingRead = soundData
        -- Held counts as handled for the watcher, or it would read the quest again once the window closes.
        MarkQuestSnapshotRead(EVENT_OF_SOUND[soundData.event], soundData.questID)
        local state = Addon.autoQuestState
        if state then
            state.completedKey = state.candidateKey
            MarkHandled(state, state.candidateKey)
        end
        return
    end
    if questSnapshotInUse then
        -- Its window closed before it started, so no later close is its own.
        soundData.addedCallback = nil
    end
    Player:Enqueue(soundData, manual)
end

function Addon:QUEST_DETAIL(_, manual)
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_DETAIL")

    Debug:Record("quest-detail", format("QUEST_DETAIL: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("accept", questID, questTitle, targetName, questText)
    if not questID then
        return
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
    QueueRead(soundData, manual)
end

function Addon:QUEST_PROGRESS(_, manual)
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_PROGRESS")

    Debug:Record("quest-progress", format("QUEST_PROGRESS: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("progress", questID, questTitle, targetName, questText)
    if not questID then
        return
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
    QueueRead(soundData, manual)
end

function Addon:QUEST_COMPLETE(_, manual)
    local questID, questTitle, questText, guid, targetName, isObjectOrItem = ReadQuestFields("QUEST_COMPLETE")

    Debug:Record("quest-complete", format("QUEST_COMPLETE: raw ID %s, title %q, NPC %q",
        tostring(questID or "nil"), questTitle or "", targetName or ""))
    questID = ResolveQuestID("complete", questID, questTitle, targetName, questText)
    if not questID then
        return
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
    QueueRead(soundData, manual)
end

-- A greeting's text as a short key: the full text of every greeting heard would swell the saved
-- variables. A sum kept below 2^31, so it stays exact in a double.
local function TextKey(text)
    local h = 5381
    for i = 1, string.len(text) do
        h = h * 33 + string.byte(text, i)
        h = h - math.floor(h / 2147483647) * 2147483647
    end
    return format("%08x", h)
end

--- Whether this character has heard this NPC greet them with this text. An NPC that greets
--- with several texts reads each of them once. A GUID that holds anything but a table was
--- marked when only the NPC was remembered, and counts as unheard.
function Addon:HasHeardGreeting(guid, text)
    if not text then
        return false
    end
    local heard = self.db.char.hasSeenGossipForNPC[guid or "unknown"]
    return type(heard) == "table" and heard[TextKey(text)] == true
end

function Addon:MarkGreetingHeard(guid, text)
    local seen = self.db.char.hasSeenGossipForNPC
    local npcKey = guid or "unknown"
    if type(seen[npcKey]) ~= "table" then
        seen[npcKey] = {}
    end
    seen[npcKey][TextKey(text)] = true
end

---@param followsOption boolean? the page was reached by picking one of the NPC's options
function Addon:ShouldPlayGossip(guid, text, manual, followsOption)
    local npcKey = guid or "unknown"

    -- Asked for by name, so having heard it before does not stand in the way.
    if manual then
        return true
    end

    if self:IsNever() then
        Debug:Note("gossip", "never", "greetings not read: NPC Greetings is set to never")
        return
    end
    -- The once-per settings hold back the greeting an NPC opens with, not the pages after it.
    if followsOption then
        return true
    end

    local heard = self:HasHeardGreeting(guid, text)

    -- Asked again for the same NPC while its window stays open; the log says it once.
    if self.db.profile.Audio.GossipFrequency == Enums.GossipFrequency.OncePerQuestNPC then
        local numActiveQuests = GetNumGossipActiveQuests()
        local numAvailableQuests = GetNumGossipAvailableQuests()
        local npcHasQuests = (numActiveQuests > 0 or numAvailableQuests > 0)
        if npcHasQuests and heard then
            Debug:Note("gossip", npcKey .. ":quest-npc", "greeting of %s not read: an NPC with quests, this greeting heard before (NPC Greetings: once for quest givers)", npcKey)
            return
        end
    elseif self.db.profile.Audio.GossipFrequency == Enums.GossipFrequency.OncePerNPC then
        if heard then
            Debug:Note("gossip", npcKey .. ":once", "greeting of %s not read: this greeting heard before (NPC Greetings: once per greeting)", npcKey)
            return
        end
    end

    return true
end

--- An NPC's own greeting starts the moment its dialog opens, and the line that replaces it
--- is read off the dialog a moment later -- 0.1s for gossip, 0.4s of stable globals for a
--- quest. The player muting the game's dialogue only once that line started is what cut the
--- greeting off mid-word, so for a dialog that is going to be read the mute is taken here,
--- in the frame the dialog opened, and the greeting is not heard at all. A dialog nothing
--- will be read for keeps its greeting: that is what the lookups below are for.
---@param event string
function Addon:MuteGreetingAhead(event)
    EndGreetingTextWait()
    if not Spoken.MuteGameDialogueAhead or not self:IsPageOn(event) or not self:IsAutoplayOn() or self.dataModulesPending
        or not Player.source then
        return
    end
    local quest = QUEST_EVENTS[event]
    if not (SPEECH_EVENTS[event] or quest) then
        return
    end
    -- A quest read that waits for the window to close leaves the NPC's greeting alone.
    if quest and self.db.profile.Audio.ReadAfterClose then
        return
    end
    -- Game Greeting First: nothing is cut, and the line waits for the greeting instead.
    if GreetingFirst:IsOn() then
        GreetingFirst:Open()
        return
    end
    -- Silenced only where a pack reads the line; any other NPC keeps its greeting. A quest whose
    -- ID is not known yet is muted too: its greeting starts now, and with no line the mute lifts.
    local questID = quest and CurrentQuestID()
    if (quest and (not questID or questID == 0)) or self:ExpectedLine(event) then
        local muted = Spoken:MuteGameDialogueAhead(self:PartOfPage(event) == "gossip" and Player.gossipSource or Player.source)
        greetingMutedFor = muted and SPEECH_EVENTS[event] and event or nil
    end
end

--- Whether the read of a greeting window found no text yet, with the mute its opening took
--- still held. On a first talk to an NPC the client has not shown before, the window's text can
--- arrive after the event, so the window is read again every GREETING_TEXT_WAIT seconds, up to
--- GREETING_TEXT_TRIES times while the mute holds: the count starts again with the next window,
--- and a close ends it. A read that finds text and no line is a real miss, and gives the NPC its
--- voice back at once.
---@param event string
---@param text string? what the window's text read as
---@param manual boolean?
---@return boolean waiting true when the read is to be tried again, so this one stops
function Addon:WaitsForGreetingText(event, text, manual)
    if manual or greetingMutedFor ~= event or (text and text:find("%S")) then
        return false
    end
    if greetingTextTries >= GREETING_TEXT_TRIES then
        return false
    end
    greetingTextTries = greetingTextTries + 1
    local wait = greetingWait
    self:ScheduleTimer(function()
        -- Past the mute's deadline the NPC's greeting is heard again, and a line read now would
        -- start over it.
        if wait == greetingWait and Spoken:IsMutingGameDialogueAhead() then
            self:DispatchDirectEvent(event, "text not there yet, read again")
        end
    end, GREETING_TEXT_WAIT)
    return true
end

--- The text autoplay will read for the dialog that just opened, or nil. Asked before the line is
--- queued; `textIsCurrent` when the page is drawn, to check its own line, not just the speaker.
---@param event string
---@param textIsCurrent boolean?
---@return string?
function Addon:ExpectedLine(event, textIsCurrent)
    if not self:IsPageOn(event) or not self:IsAutoplayOn() or self.dataModulesPending or not Player.source
        or (Spoken.ReadsHere and not Spoken:ReadsHere()) then
        return nil
    end
    local speech, quest = SPEECH_EVENTS[event], QUEST_EVENTS[event]
    if speech then
        -- The page text is not to be trusted yet (see the deferred read), so this asks only
        -- whether any pack voices this speaker at all.
        local guid = Utils:GetNPCGUID()
        local speaker = { unitGUID = guid, name = Utils:GetNPCName(), unitIsObjectOrItem = Utils:IsNPCObjectOrItem() }
        if not guid and not speaker.name then
            return nil
        end
        local followsOption = event == "GOSSIP_SHOW" and gossipOptionPicked
        -- Whether the greeting was heard goes by its text, so the text on screen is the best
        -- guess there is. A stale one costs only the NPC's own greeting being cut or not.
        if not self:ShouldPlayGossip(guid, speech.text(), false, followsOption)
            or not DataModules:HasGossipFor(speaker) then
            return nil
        end
        if textIsCurrent and not self:GetVisibleLine(event) then
            return nil
        end
        return speech.text() or ""
    elseif quest then
        if self.db.profile.Audio.ReadAfterClose then
            return nil
        end
        -- The quest ID can still be the previous quest's this early; the worst that costs is
        -- one greeting muted for nothing, or one cut off as it was before.
        local questID = CurrentQuestID()
        if not questID or questID == 0 then
            return nil
        end
        local text = quest.text() or ""
        if not DataModules:PrepareSound({ event = quest.sound, questID = questID, text = text }) then
            return nil
        end
        return text
    end
    return nil
end

function Addon:QUEST_GREETING(event, manual)
    local guid = Utils:GetNPCGUID()
    local targetName = Utils:GetNPCName()
    local greetingText = NotSecret(GetGreetingText())

    -- Can happen if the player interacted with an NPC while having main menu or options opened
    if not guid and not targetName then
        return
    end
    if self:WaitsForGreetingText(event, greetingText, manual) then
        return
    end
    if not greetingText then
        GiveVoiceBack(event)
        return
    end

    if not self:ShouldPlayGossip(guid, greetingText, manual) then
        GiveVoiceBack(event)
        return
    end

    -- Play the gossip sound
    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestGreeting,
        name = targetName,
        text = greetingText,
        unitGUID = guid,
        unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
        addedCallback = GossipSoundDataAdded,
        startCallback = function()
            self:MarkGreetingHeard(guid, greetingText)
        end
    }
    Player:Enqueue(soundData, manual)
end

-- The option the player picked to reach the gossip on screen, as its clip's label. Kept past
-- the show that consumed selectedGossipOption, for a Play pressed on that same gossip later.
local shownGossipTitle
-- Which page that was. The direct event and the frame's OnShow can both deliver one page,
-- and the second must not overwrite the label the first took.
local shownGossipKey

--- A fresh gossip page: note which option led here and what the page offers next, whether or
--- not it is read. With autoplay off it is not, and the next page's label would otherwise be
--- looked up in this page's predecessor's options.
function NoteGossipPage()
    local npc = tostring(Utils:GetNPCGUID() or Utils:GetNPCName())
    local pageKey = npc .. ":" .. tostring(NotSecret(GetGossipText()) or "")
    if not selectedGossipOption and pageKey == shownGossipKey then
        return
    end
    -- The text of the page already noted arriving: its label stays, and only what it offers is read again.
    local textArrived = not selectedGossipOption and shownGossipKey == npc .. ":"
    shownGossipKey = pageKey
    if not textArrived then
        shownGossipTitle = selectedGossipOption and format([["%s"]], selectedGossipOption)
    end
    selectedGossipOption = nil
    lastGossipOptions = nil
    if C_GossipInfo and C_GossipInfo.GetOptions then
        lastGossipOptions = C_GossipInfo.GetOptions()
    elseif GetGossipOptions then
        lastGossipOptions = { GetGossipOptions() }
    end
end

function Addon:GOSSIP_SHOW(event, manual)
    local guid = Utils:GetNPCGUID()
    local targetName = Utils:GetNPCName()
    local gossipText = NotSecret(GetGossipText())

    -- Can happen if the player interacted with an NPC while having main menu or options opened
    if not guid and not targetName then
        return
    end
    if self:WaitsForGreetingText(event, gossipText, manual) then
        return
    end
    if not gossipText then
        GiveVoiceBack(event)
        return
    end

    if not self:ShouldPlayGossip(guid, gossipText, manual, gossipOptionPicked) then
        GiveVoiceBack(event)
        return
    end

    -- Play the gossip sound
    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.Gossip,
        name = targetName,
        title = shownGossipTitle,
        text = gossipText,
        unitGUID = guid,
        unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
        addedCallback = GossipSoundDataAdded,
        startCallback = function()
            self:MarkGreetingHeard(guid, gossipText)
        end
    }
    Player:Enqueue(soundData, manual)
end

function Addon:QUEST_FINISHED()
    if Addon.db.profile.Audio.StopAudioOnDisengage then
        if currentQuestSoundData then
            Player:Remove(currentQuestSoundData)
        end
        -- A quest giver's greeting is read in the quest frame, so it ends with the frame.
        if currentGossipSoundData and currentGossipSoundData.event == Enums.SoundEvent.QuestGreeting then
            Player:Remove(currentGossipSoundData)
            currentGossipSoundData = nil
        end
    end
    currentQuestSoundData = nil
    EndGreetingTextWait()
    local pending = pendingRead
    pendingRead = nil
    if pending then
        -- Its window has closed, so it is no window's line: the next close leaves it playing.
        pending.addedCallback = nil
        Player:Enqueue(pending)
    end
end

function Addon:GOSSIP_CLOSED()
    if Addon.db.profile.Audio.StopAudioOnDisengage and currentGossipSoundData then
        Player:Remove(currentGossipSoundData)
    end
    currentGossipSoundData = nil
    EndGreetingTextWait()

    selectedGossipOption = nil
    gossipOptionPicked = nil
    shownGossipTitle = nil
    shownGossipKey = nil
end

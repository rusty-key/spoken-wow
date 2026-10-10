if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- What NPCs say when the player talks to them: the gossip page, and the greeting a quest giver
-- opens with. Read automatically as NPC Greetings decides; at Never only from the window's Listen
-- button (UI/PlayButton.lua).

---@class GossipAddon : AceAddon, AceAddon-3.0, AceEvent-3.0, AceTimer-3.0
Addon = LibStub("AceAddon-3.0"):NewAddon("SpokenGossip", "AceEvent-3.0", "AceTimer-3.0")

-- The windows this addon reads, the sound each is keyed by and where its text is read from.
local SPEECH_EVENTS = {
    QUEST_GREETING = { sound = Enums.SoundEvent.QuestGreeting, panel = "QuestFrameGreetingPanel",
        text = function() return GetGreetingText() end },
    GOSSIP_SHOW = { sound = Enums.SoundEvent.Gossip, panel = "GossipFrame",
        text = function() return GetGossipText() end },
}

local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

---@class GossipConfig
local defaults = {
    profile = {
        Audio = {
            -- Once per NPC rather than once per quest NPC, which upstream defaulted to:
            -- that setting only silences a repeat where the NPC has a quest, so every
            -- innkeeper, vendor and flight master said the same line on every visit --
            -- the greeting a player hears most often is exactly the one it did not
            -- remember. A profile that stored a choice of its own keeps it.
            GossipFrequency = Enums.GossipFrequency.OncePerNPC,
            StopAudioOnDisengage = false,
            OGThrall = false,
        },
    },
    char = {
        hasSeenGossipForNPC = {},
    },
    global = {},
}

local lastGossipOptions
local selectedGossipOption
-- Set by picking any option, even one whose label could not be found, until the window closes:
-- every page after the greeting was asked for.
local gossipOptionPicked
local currentGossipSoundData

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

--- Whether the player has this part of Spoken switched on (Spoken's settings). Off, none of
--- its buttons show on the game's windows.
function Addon:IsPartOn()
    return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("gossip")
end

--- Whether NPC Greetings is at Never: nothing reads itself, and the window offers Listen.
function Addon:IsNever()
    return self.db.profile.Audio.GossipFrequency == Enums.GossipFrequency.Never
end

--- Every NPC greets this character again.
function Addon:ForgetGreetings()
    local char = self.db and self.db.char
    if char then char.hasSeenGossipForNPC = {} end
    print("|cFF00CCFFSpoken Gossip:|r " .. L.OPT_FORGET_GREETINGS_DONE)
end

--- The NPC window on screen that is this addon's, or nil. A quest's own panel is the quests
--- module's, even over a greeting.
local function GetVisibleSpeechEvent()
    if IsFrameVisible(QuestFrameRewardPanel) or IsFrameVisible(QuestFrameProgressPanel)
        or IsFrameVisible(QuestFrameDetailPanel) then
        return nil
    end
    if IsFrameVisible(QuestFrameGreetingPanel) then
        return "QUEST_GREETING"
    elseif IsFrameVisible(GossipFrame) then
        return "GOSSIP_SHOW"
    end
end

--- The line the open window would read, resolved against the packs, or nil when no window is
--- open or no pack has its line. Asked without reading anything. The second value is the
--- client event it stands for. A caller that already knows the event passes it: under
--- DialogueUI the game's windows never show, and the event is all there is to go by.
---@param event string?
---@return SoundData?, string?
function Addon:GetVisibleLine(event)
    event = event or GetVisibleSpeechEvent()
    local speech = event and SPEECH_EVENTS[event]
    if not speech then
        return nil
    end
    local guid, name = Utils:GetNPCGUID(), Utils:GetNPCName()
    if not guid and not name then
        return nil
    end
    local probe = {
        event = speech.sound,
        name = name,
        text = speech.text() or "",
        unitGUID = guid,
        unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
    }
    if not DataModules:PrepareSound(probe) then
        return nil
    end
    return probe, event
end

--- Every read goes through here, automatic or not. `manual` is a player asking for this
--- line -- the Listen button, /spg read -- rather than the client reporting a window, so it
--- reads whatever NPC Greetings says.
function Addon:InvokeHandler(event, source, manual)
    local handler = self[event]
    if not handler then
        Debug:Record("handler-missing", format("No handler exists for %s", tostring(event)))
        return false
    end
    -- Read while DialogueUI's window is still appearing, the voice would run ahead of the words
    -- it marks, so a greeting waits for the window (the quests module's DialogueUIBridge.lua).
    local bridge = not manual and SPEECH_EVENTS[event] and rawget(Core, "DialogueUIBridge")
    if bridge and bridge.Defer and bridge:Defer(event, function()
        self:InvokeHandler(event, source, manual)
    end) then
        Debug:Record("dialogueui-wait", format("Waiting for DialogueUI's window to read %s", event))
        return true
    end
    Debug:Record("gossip-dispatch", format("Dispatching %s through %s", event, source or "manual reader"))
    local succeeded, errorMessage = pcall(handler, self, event, manual)
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

--- Read the window on screen because the player asked to.
function Addon:ReadVisible(source)
    local event = GetVisibleSpeechEvent()
    if not event then
        Debug:Record("visible-panel-missing", "No greeting or gossip window is visible")
        return false
    end
    return self:InvokeHandler(event, source or "visible gossip reader", true)
end

--------------------------------------------------------------------------------
-- Fix a Problem
--------------------------------------------------------------------------------

-- Thrall's "All members of the Horde are equal in my eyes": a line every pack that holds gossip
-- has, by the file name every language's pack gives it (EasterEggs.lua keys on it too).
local TEST_LINE = "9fdeb82237b72e8801030487901e690f"

--- Play the test line through the player, the route every real line takes.
function Addon:RunSelfTest()
    local soundData = { event = Enums.SoundEvent.Gossip, fileName = TEST_LINE, name = "Thrall",
        title = "Spoken Gossip self-test" }
    if not DataModules:ResolveSoundFile(soundData) then
        Debug:Record("self-test-data-failed", "No loaded pack holds the known gossip test line")
        print("|cFFFF4040Spoken Gossip test failed: the known test line was not found in the loaded sound packs.|r")
        return false
    end
    if Player:EnqueuePrepared(soundData) then
        print("|cFF40FF40Spoken Gossip test started.|r You should hear Thrall.")
        return true
    end
    local stage, message = Debug:GetRuntimeStatus()
    print(format("|cFFFF4040Spoken Gossip test failed: %s (%s).|r", message or "refused", stage or "unknown"))
    return false
end

--- What to paste into a bug report: the client, the setting, and the packs that hold gossip.
function Addon:PrintDiagnostics()
    print(format("|cFF00CCFFSpoken Gossip %s|r - client %s, interface %d",
        AddonVersion, Version.Client or "unknown", Version.Interface or 0))
    print(format("Switched %s, NPC greetings: %s, player: %s", self:IsPartOn() and "on" or "off",
        Enums.GossipFrequency:GetName(self.db.profile.Audio.GossipFrequency) or "unknown",
        Spoken and Spoken.ADDON_VERSION or "missing"))
    local found = 0
    for _, module in DataModules:GetPresentModules() do
        if Player:HoldsGossip(module) then
            found = found + 1
            local status = DataModules:GetModule(module.AddonName) and "loaded"
                or (DataModules:GetModuleLoadError(module.AddonName) or "not loaded")
            print(format("Data: %s (%s) - %s", module.AddonName, module.ContentVersion or "unknown version", status))
        end
    end
    if found == 0 then
        print("Data: no sound pack that holds gossip was detected")
    end
    local stage, message = Debug:GetRuntimeStatus()
    print(format("Last runtime stage: %s - %s", stage or "none", message or "no details"))
    for _, warning in ipairs(self.eventBridgeErrors or {}) do
        print("Bridge warning: " .. warning)
    end
end

--------------------------------------------------------------------------------
-- From the quests module
--------------------------------------------------------------------------------

local FROM_QUESTS = { "GossipFrequency", "StopAudioOnDisengage", "OGThrall" }

--- The first time this addon runs, the settings it took over from the quests module, which
--- read gossip before there was a module of its own: each profile's greeting settings, each
--- character's greetings heard, and which profile each character is on. Autoplay off there read
--- no greeting by itself, which is Never here. And a player who had switched quests off heard no
--- gossip, so this starts off too. At login, when the quests module's saved variables have
--- loaded, if it is enabled at all.
function Addon:TakeOverFromQuests()
    local db = self.db
    if db.global.fromQuests then
        return
    end
    db.global.fromQuests = true
    local quests = rawget(_G, "SpokenQuestsSettings")
    if type(quests) ~= "table" then
        return
    end
    local sv = db.sv

    for name, profile in pairs(quests.profiles or {}) do
        local audio = type(profile) == "table" and profile.Audio
        if type(audio) == "table" then
            sv.profiles = sv.profiles or {}
            local target = sv.profiles[name] or {}
            sv.profiles[name] = target
            target.Audio = target.Audio or {}
            -- Over whatever is there: this runs before the player can have set anything here.
            for _, key in ipairs(FROM_QUESTS) do
                if audio[key] ~= nil then
                    target.Audio[key] = audio[key]
                end
            end
            if audio.Autoplay == false then
                target.Audio.GossipFrequency = Enums.GossipFrequency.Never
            end
        end
    end

    for key, char in pairs(quests.char or {}) do
        local heard = type(char) == "table" and char.hasSeenGossipForNPC
        if type(heard) == "table" then
            sv.char = sv.char or {}
            local target = sv.char[key] or {}
            sv.char[key] = target
            target.hasSeenGossipForNPC = target.hasSeenGossipForNPC or {}
            for npc, seen in pairs(heard) do
                target.hasSeenGossipForNPC[npc] = seen
            end
        end
    end

    -- Every character's profile there, where this module has none yet, so alts sharing one there
    -- share it here. The character logging in already has its default, so it is set below.
    if type(quests.profileKeys) == "table" then
        sv.profileKeys = sv.profileKeys or {}
        for key, name in pairs(quests.profileKeys) do
            if sv.profileKeys[key] == nil then
                sv.profileKeys[key] = name
            end
        end
    end
    local charKey = db.keys and db.keys.char
    local profile = quests.profileKeys and charKey and quests.profileKeys[charKey]
    if profile and profile ~= db:GetCurrentProfile() then
        db:SetProfile(profile)
    end

    if Spoken and Spoken.IsPartOn and not Spoken:IsPartOn("quests") and Spoken.SetPartOn then
        Spoken:SetPartOn("gossip", false)
    end
end

--------------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------------

function Addon:OnInitialize()
    self.db = LibStub("AceDB-3.0"):New("SpokenGossipSettings", defaults)
    self.db.RegisterCallback(self, "OnProfileChanged", "RefreshConfig")
    self.db.RegisterCallback(self, "OnProfileReset", "RefreshConfig")

    Player:Setup()

    -- The windows' Contribute button and this addon's Listen button. Guarded: a failed build
    -- here must not take reading down with it.
    local contributeReady, contributeError = pcall(function()
        local contribute = rawget(Core, "ContributeButton")
        if contribute and contribute.Setup then
            contribute:Setup()
        end
    end)
    if not contributeReady then
        Debug:Record("contribute-button-error", tostring(contributeError))
    end
    local playReady, playError = pcall(PlayButton.Setup, PlayButton)
    if not playReady then
        Debug:Record("dialog-play-button-error", tostring(playError))
    end

    -- The packs are the dialogue core's to find and load, whichever module that reads NPCs
    -- starts first.
    DataModules:Start()

    local optionsReady, optionsError = pcall(Options.Initialize, Options)
    if not optionsReady then
        self.optionsInitializationError = tostring(optionsError)
        Debug:Record("options-ui-failed", self.optionsInitializationError)
    end

    local login = CreateFrame("Frame")
    login:RegisterEvent("PLAYER_LOGIN")
    login:SetScript("OnEvent", function()
        login:UnregisterEvent("PLAYER_LOGIN")
        Addon:TakeOverFromQuests()
    end)
    if IsLoggedIn and IsLoggedIn() then
        self:TakeOverFromQuests()
    end

    self:SetupEvents()
end

function Addon:RefreshConfig()
    Player:RefreshConfig()
    if PlayButton and PlayButton.Refresh then PlayButton:Refresh() end
end

--- The client's events for the two windows, and the hooks that stand in where an event comes
--- too early or not at all.
function Addon:SetupEvents()
    self.eventBridgeErrors = {}
    local directEvents = { "QUEST_GREETING", "QUEST_FINISHED", "GOSSIP_SHOW", "GOSSIP_CLOSED" }

    local directEventLookup = {}
    local lastDispatch = {}
    local dispatching = {}
    local function DispatchDirectEvent(event, source)
        local now = GetTime()
        if dispatching[event] or lastDispatch[event] and now - lastDispatch[event] < 0.5 then
            return
        end

        if event == "GOSSIP_SHOW" then
            -- Whether or not this page is read, the next one's label depends on it.
            self:NoteGossipPage()
        end

        dispatching[event] = true
        local succeeded = self:InvokeHandler(event, source, false)
        dispatching[event] = nil
        if not succeeded then
            return
        end

        -- Only suppress the panel fallback when this route actually reached the queue or
        -- playback stage. An early event with unpopulated globals must be allowed to retry.
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

    -- The greeting and gossip globals can lag their event: the client fires it before it has
    -- the new NPC and text. Coalesce the event and frame signals and read them on a later frame.
    local deferredEventGeneration = {}
    local function SignalDirectEvent(event, source)
        if event == "QUEST_FINISHED" then
            deferredEventGeneration.QUEST_GREETING = (deferredEventGeneration.QUEST_GREETING or 0) + 1
        elseif event == "GOSSIP_CLOSED" then
            deferredEventGeneration.GOSSIP_SHOW = (deferredEventGeneration.GOSSIP_SHOW or 0) + 1
        end
        if not SPEECH_EVENTS[event] then
            DispatchDirectEvent(event, source)
            return
        end
        local generation = (deferredEventGeneration[event] or 0) + 1
        deferredEventGeneration[event] = generation
        self:ScheduleTimer(function()
            if deferredEventGeneration[event] == generation then
                DispatchDirectEvent(event, source .. " (deferred)")
            end
        end, 0.1)
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
        if SPEECH_EVENTS[event] then
            pcall(self.MuteGreetingAhead, self, event)
        end
        SignalDirectEvent(event, "direct frame")
    end)

    -- The windows themselves, where a replacement or an old client delivers no event.
    for event, speech in pairs(SPEECH_EVENTS) do
        local frame = _G[speech.panel]
        if frame and frame.HookScript then
            local hooked, hookError = pcall(frame.HookScript, frame, "OnShow", function()
                SignalDirectEvent(event, "panel OnShow")
            end)
            if not hooked then
                table.insert(self.eventBridgeErrors, format("Panel %s: %s", event, tostring(hookError)))
            end
        end
    end

    -- Blizzard's own dispatcher for the quest frame, which runs after it has populated the
    -- greeting. Before 3.0.2 it takes no arguments and reads the global `event` instead.
    if QuestFrame_OnEvent and hooksecurefunc then
        local hooked, hookError = pcall(hooksecurefunc, "QuestFrame_OnEvent", function(frame, event)
            event = event or _G.event
            if event == "QUEST_GREETING" and directEventLookup[event] then
                SignalDirectEvent(event, "QuestFrame_OnEvent hook")
            end
        end)
        if not hooked then
            table.insert(self.eventBridgeErrors, "QuestFrame_OnEvent: " .. tostring(hookError))
        end
    end

    -- Which option the player picked, for the next page's label.
    if C_GossipInfo and C_GossipInfo.SelectOption then
        hooksecurefunc(C_GossipInfo, "SelectOption", function(optionID)
            gossipOptionPicked = true
            if lastGossipOptions then
                for _, info in ipairs(lastGossipOptions) do
                    if info.gossipOptionID == optionID then
                        selectedGossipOption = info.name
                        break
                    end
                end
                lastGossipOptions = nil
            end
        end)
    elseif SelectGossipOption then
        hooksecurefunc("SelectGossipOption", function(index)
            gossipOptionPicked = true
            if lastGossipOptions then
                selectedGossipOption = lastGossipOptions[1 + (index - 1) * 2]
                lastGossipOptions = nil
            end
        end)
    end

    local slashInstalled, slashError = pcall(function()
        _G.SLASH_SPOKENGOSSIPREAD1 = "/spgread"
        _G.SlashCmdList.SPOKENGOSSIPREAD = function()
            self:ReadVisible("/spgread")
        end
    end)
    if not slashInstalled then
        Debug:Record("standalone-slash-failed", tostring(slashError))
    end
end

--------------------------------------------------------------------------------
-- The handlers
--------------------------------------------------------------------------------

---@param followsOption boolean? the page was reached by picking one of the NPC's options
function Addon:ShouldPlayGossip(guid, text, manual, followsOption)
    local npcKey = guid or "unknown"

    -- Asked for by name, so having heard it before does not stand in the way.
    if manual then
        return true, npcKey
    end
    if not self:IsPartOn() then
        return
    end

    if self.db.profile.Audio.GossipFrequency == Enums.GossipFrequency.Never then
        Debug:Note("gossip", "never", "greetings not read: NPC Greetings is set to never")
        return
    end
    -- The once-per settings hold back the greeting an NPC opens with, not the pages after it.
    if followsOption then
        return true, npcKey
    end

    local gossipSeenForNPC = self.db.char.hasSeenGossipForNPC[npcKey]
    local frequency = self.db.profile.Audio.GossipFrequency

    -- Asked again for the same NPC while its window stays open; the log says it once.
    if frequency == Enums.GossipFrequency.OncePerQuestNPC then
        local numActiveQuests = GetNumGossipActiveQuests()
        local numAvailableQuests = GetNumGossipAvailableQuests()
        local npcHasQuests = (numActiveQuests > 0 or numAvailableQuests > 0)
        if npcHasQuests and gossipSeenForNPC then
            Debug:Note("gossip", npcKey .. ":quest-npc", "greeting of %s not read: an NPC with quests, heard before (NPC Greetings: once per quest NPC)", npcKey)
            return
        end
    elseif frequency == Enums.GossipFrequency.OncePerNPC then
        if gossipSeenForNPC then
            Debug:Note("gossip", npcKey .. ":once", "greeting of %s not read: heard before (NPC Greetings: once per NPC)", npcKey)
            return
        end
    end

    return true, npcKey
end

--- An NPC's own greeting starts the moment its window opens, and the line that replaces it
--- is read off the window a moment later (0.1s). The player muting the game's dialogue only
--- once that line started is what cut the greeting off mid-word, so for a window that is going
--- to be read the mute is taken here, in the frame the window opened, and the greeting is not
--- heard at all. A window nothing will be read for keeps its greeting.
---@param event string
function Addon:MuteGreetingAhead(event)
    if DataModules:IsPending() or not Player.source or not Spoken.MuteGameDialogueAhead then
        return
    end
    if not SPEECH_EVENTS[event] then
        return
    end
    -- Silenced only where a pack reads its greeting, so the pack's replaces the game's. Any
    -- other NPC, quest-givers included, keeps its own. The page text is not to be trusted yet
    -- (see the deferred read), so this asks only whether any pack voices this speaker at all.
    local guid = Utils:GetNPCGUID()
    local speaker = { unitGUID = guid, name = Utils:GetNPCName(), unitIsObjectOrItem = Utils:IsNPCObjectOrItem() }
    if not guid and not speaker.name then
        return
    end
    local followsOption = event == "GOSSIP_SHOW" and gossipOptionPicked
    if not self:ShouldPlayGossip(guid, nil, false, followsOption) or not DataModules:HasGossipFor(speaker) then
        return
    end
    Spoken:MuteGameDialogueAhead(Player.source)
end

--- The words a greeting or gossip will be read in for the window that just opened, or nil.
--- Asked before the line is queued (DialogueUI's bridge keeps them blank until it starts);
--- `textIsCurrent` when the page is drawn, to check its own line, not just the speaker.
---@param event string
---@param textIsCurrent boolean?
---@return string?
function Addon:ExpectedLine(event, textIsCurrent)
    local speech = SPEECH_EVENTS[event]
    if not speech or DataModules:IsPending() or not Player.source then
        return nil
    end
    -- The page text is not to be trusted yet (see the deferred read), so this asks only whether
    -- any pack voices this speaker at all.
    local guid = Utils:GetNPCGUID()
    local speaker = { unitGUID = guid, name = Utils:GetNPCName(), unitIsObjectOrItem = Utils:IsNPCObjectOrItem() }
    if not guid and not speaker.name then
        return nil
    end
    local followsOption = event == "GOSSIP_SHOW" and gossipOptionPicked
    if not self:ShouldPlayGossip(guid, nil, false, followsOption) or not DataModules:HasGossipFor(speaker) then
        return nil
    end
    if textIsCurrent and not self:GetVisibleLine(event) then
        return nil
    end
    return speech.text() or ""
end

local function GossipSoundDataAdded(soundData)
    -- The line to stop when the window closes, under Stop When Window Closes.
    currentGossipSoundData = soundData
end

function Addon:QUEST_GREETING(event, manual)
    local guid = Utils:GetNPCGUID()
    local targetName = Utils:GetNPCName()
    local greetingText = GetGreetingText()

    -- Can happen if the player interacted with an NPC while having main menu or options opened
    if not guid and not targetName then
        return
    end

    local play, npcKey = self:ShouldPlayGossip(guid, greetingText, manual)
    if not play then
        return
    end

    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestGreeting,
        name = targetName,
        text = greetingText,
        unitGUID = guid,
        unitIsObjectOrItem = Utils:IsNPCObjectOrItem(),
        addedCallback = GossipSoundDataAdded,
        startCallback = function()
            self.db.char.hasSeenGossipForNPC[npcKey] = true
        end
    }
    Player:Enqueue(soundData)
end

-- The option the player picked to reach the gossip on screen, as its clip's label. Kept past
-- the show that consumed selectedGossipOption, for a Listen pressed on that same gossip later.
local shownGossipTitle
-- Which page that was. The direct event and the frame's OnShow can both deliver one page,
-- and the second must not overwrite the label the first took.
local shownGossipKey

--- A fresh gossip page: note which option led here and what the page offers next, whether or
--- not it is read. At Never it is not, and the next page's label would otherwise be looked up
--- in this page's predecessor's options.
function Addon:NoteGossipPage()
    local pageKey = tostring(Utils:GetNPCGUID() or Utils:GetNPCName()) .. ":" .. tostring(GetGossipText())
    if not selectedGossipOption and pageKey == shownGossipKey then
        return
    end
    shownGossipKey = pageKey
    shownGossipTitle = selectedGossipOption and format([["%s"]], selectedGossipOption)
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
    local gossipText = GetGossipText()

    -- Can happen if the player interacted with an NPC while having main menu or options opened
    if not guid and not targetName then
        return
    end

    local play, npcKey = self:ShouldPlayGossip(guid, gossipText, manual, gossipOptionPicked)
    if not play then
        return
    end

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
            self.db.char.hasSeenGossipForNPC[npcKey] = true
        end
    }
    Player:Enqueue(soundData)
end

-- The quest frame closing, the greeting's window among its panels: under Stop When Window Closes
-- its greeting stops, as the gossip window's line does. A quest's own line is the quests
-- module's to stop.
function Addon:QUEST_FINISHED()
    local current = currentGossipSoundData
    if self.db.profile.Audio.StopAudioOnDisengage and current and current.event == Enums.SoundEvent.QuestGreeting then
        Player:Remove(current)
        currentGossipSoundData = nil
    end
end

function Addon:GOSSIP_CLOSED()
    if self.db.profile.Audio.StopAudioOnDisengage and currentGossipSoundData then
        Player:Remove(currentGossipSoundData)
    end
    currentGossipSoundData = nil

    selectedGossipOption = nil
    gossipOptionPicked = nil
    shownGossipTitle = nil
    shownGossipKey = nil
end

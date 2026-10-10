setfenv(1, VoiceOver)
Debug = {}

Debug.runtime = {
    stage = "addon-loaded",
    message = "Waiting for a quest or gossip event",
}

function Debug:Record(stage, message)
    self.runtime.stage = stage
    self.runtime.message = message
    self.runtime.time = GetTime and GetTime() or 0
    self:Print(message, stage)
end

function Debug:GetRuntimeStatus()
    return self.runtime.stage, self.runtime.message, self.runtime.time
end

function Debug:Print(msg, header)
    if Addon and Addon.db and Addon.db.profile.DebugEnabled then
        if header then
            print(Utils:ColorizeText("Spoken Quests", NORMAL_FONT_COLOR_CODE) ..
                Utils:ColorizeText(" (" .. header .. ")", GRAY_FONT_COLOR_CODE) ..
                " - " .. msg)
        else
            print(Utils:ColorizeText("Spoken Quests", NORMAL_FONT_COLOR_CODE) ..
                " - " .. msg)
        end
    end
end

--------------------------------------------------------------------------------
-- Spoken's debug log (the Spoken_Developer module, where it is installed)
--------------------------------------------------------------------------------
--
-- Every stage recorded above also goes to the log, as `quests <stage>: <message>`: the stages are
-- what /spq diagnostics calls the last runtime stage, and in the log they read as the whole story
-- of a quest window, from the event to the line queued or the reason it was not. Note covers the
-- decisions that record no stage. Nothing happens without the module, or while its log is off.
--
-- Parsed by the 1.12 client too, so Lua 5.0 syntax: no `#`, no `...`, no string methods.

local function Log(message, a, b, c, d)
    if Spoken and Spoken.Log then Spoken:Log("quests", message, a, b, c, d) end
end

-- The stages that name a quest window, the last of which the diagnostics repeat.
local WINDOW_STAGES = { ["quest-detail"] = true, ["quest-progress"] = true, ["quest-complete"] = true }

local recordStage = Debug.Record
function Debug:Record(stage, message)
    recordStage(self, stage, message)
    if WINDOW_STAGES[stage] then
        self.lastWindow = { message = message, time = GetTime and GetTime() or 0 }
    end
    Log("%s: %s", tostring(stage), tostring(message))
end

-- What each topic last said, so a decision asked about ten times a second (the quest watcher, a
-- window polling for its Play button) is written once, and again only when the answer changes.
local lastNoted = {}

--- One line in the log about `topic`, unless the last one about it had the same `key`.
function Debug:Note(topic, key, message, a, b, c)
    if lastNoted[topic] == key then return end
    lastNoted[topic] = key
    Log(message, a, b, c)
end

--------------------------------------------------------------------------------
-- Mock Missing Voice Over (Spoken > Developer)
--------------------------------------------------------------------------------

local function DeveloperSettings()
    local profile = Addon and Addon.db and Addon.db.profile
    if not profile then return nil end
    if type(profile.Developer) ~= "table" then profile.Developer = {} end
    return profile.Developer
end

--- Every quest line answered as one no pack has (DataModules:PrepareSound), to see what a quest
--- without a voice-over looks like on a quest that has one.
function Debug:IsMockingMissingVoice()
    local developer = DeveloperSettings()
    return developer ~= nil and developer.MockMissingVoice == true
end

--- This addon's section of the Developer page. Hands back what puts it back to its defaults.
function Debug:DeveloperRows(layout)
    -- A dialog already open shows the change at once: its buttons ask DataModules again.
    local function Refresh()
        local names = { "ContributeButton", "DialogPlayButton" }
        for _, name in ipairs(names) do
            local button = rawget(VoiceOver, name)
            if button and button.Refresh then button:Refresh() end
        end
    end
    layout:Section(L.OPT_PAGE_TITLE)
    layout:Checkbox(L.OPT_DEV_MOCK_MISSING, L.OPT_DEV_MOCK_MISSING_TIP,
        function() return Debug:IsMockingMissingVoice() end,
        function(value)
            DeveloperSettings().MockMissingVoice = value and true or false
            Log("Mock Missing Voice Over %s", value and "on" or "off")
            Refresh()
        end)
    return function()
        local developer = DeveloperSettings()
        if developer then developer.MockMissingVoice = false end
        Refresh()
    end
end

if Spoken and Spoken.AddDeveloperSettings then
    Spoken:AddDeveloperSettings(function(layout) return Debug:DeveloperRows(layout) end)
end

-- Kept between sessions, so said at each login: with it on, no quest line plays.
local reminder = CreateFrame("Frame")
reminder:RegisterEvent("PLAYER_LOGIN")
reminder:SetScript("OnEvent", function()
    if Debug:IsMockingMissingVoice() then
        print("|cFF00CCFFSpoken Quests:|r " .. L.OPT_DEV_MOCK_ON)
    end
end)

--------------------------------------------------------------------------------
-- Diagnostics, for the log and its copies
--------------------------------------------------------------------------------

-- Colour codes are for chat; the copies are plain text.
local function Plain(text)
    text = string.gsub(tostring(text), "|c%x%x%x%x%x%x%x%x", "")
    text = string.gsub(text, "|r", "")
    return text
end

--- What /spq diagnostics prints, as lines: the command's own function runs with `print` caught,
--- so the two never say different things.
local function DiagnosticsLines(lines)
    local saved = rawget(VoiceOver, "print")
    VoiceOver.print = function(text) table.insert(lines, Plain(text)) end
    local ok, err = pcall(Options.PrintDiagnostics, Options)
    VoiceOver.print = saved
    if not ok then table.insert(lines, "diagnostics error: " .. tostring(err)) end
end

local function Safe(fn)
    local ok, value = pcall(fn)
    if ok then return value end
    return nil
end

--- What an agent needs besides: the settings that decide whether a line plays, the window open
--- and what it would read, how long ago the last stage was.
local function ContextLines(lines)
    local audio = Addon.db and Addon.db.profile.Audio or {}
    table.insert(lines, format("read automatically %s, NPC greetings %s, mock missing voice-over %s",
        Addon:IsAutoplayOn() and "on" or "off",
        tostring(Enums.GossipFrequency:GetName(audio.GossipFrequency)),
        Debug:IsMockingMissingVoice() and "ON" or "off"))
    local questID = Safe(function() return GetQuestID and GetQuestID() end)
    local title = Safe(function() return GetTitleText and GetTitleText() end)
    local npc = Safe(function() return Utils:GetNPCName() end)
    local guid = Safe(function() return Utils:GetNPCGUID() end)
    table.insert(lines, format("now: quest ID %s, title %q, NPC %q, GUID %s", tostring(questID), tostring(title or ""),
        tostring(npc or ""), tostring(guid)))
    local heard = guid and Addon.db and Addon.db.char.hasSeenGossipForNPC
        and Addon.db.char.hasSeenGossipForNPC[guid]
    if guid then
        table.insert(lines, "this NPC's greeting heard before: " .. (heard and "yes" or "no"))
    end
    local found, probe, event = pcall(function() return Addon:GetVisibleLine() end)
    if found and probe then
        table.insert(lines, format("open window %s: would read %s from %s (%s), %s s", tostring(event),
            tostring(probe.fileName), tostring(probe.module and probe.module.METADATA and probe.module.METADATA.AddonName),
            tostring(probe.language), tostring(probe.length)))
    elseif found then
        table.insert(lines, "open window: none with a line a pack has")
    else
        table.insert(lines, "open window: could not tell (" .. tostring(probe) .. ")")
    end
    -- What is on screen, read off the frames: on Forever the game's own answers above can say no
    -- quest is open while its window shows one (after a QUEST_FINISHED that came early).
    local panel = Safe(function()
        local panels = { { QuestFrameRewardPanel, "reward" }, { QuestFrameProgressPanel, "progress" },
            { QuestFrameDetailPanel, "detail" }, { QuestFrameGreetingPanel, "greeting" } }
        for _, entry in ipairs(panels) do
            if entry[1] and entry[1]:IsVisible() then return entry[2] end
        end
        return nil
    end)
    -- The quest title on screen, and which window shows it: the NPC's quest frame and the quest
    -- log's details both draw their quest with the same QuestInfo frames, moved between them.
    local shownTitle = Safe(function()
        return QuestInfoTitleHeader and QuestInfoTitleHeader:IsVisible() and QuestInfoTitleHeader:GetText() or nil
    end)
    local function Under(frame, ancestor)
        while frame and ancestor do
            if frame == ancestor then return true end
            frame = frame.GetParent and frame:GetParent()
        end
        return false
    end
    local titleIn = Safe(function()
        if not shownTitle then return nil end
        if Under(QuestInfoTitleHeader, QuestFrame) then return "frame" end
        return "log"
    end)
    local shownNPC = Safe(function()
        local container = QuestFrame and QuestFrame.TitleContainer
        local text = container and container.TitleText or QuestFrameTitleText or QuestFrameNpcNameText
        return text and text:GetText() or nil
    end)
    -- The quest log: the map's details on the modern clients, QuestLogFrame on the classic ones.
    local logShown = Safe(function()
        local details = QuestMapFrame and QuestMapFrame.DetailsFrame
        if details and details:IsVisible() then return "details" end
        if QuestMapFrame and QuestMapFrame:IsVisible() then return "list" end
        if QuestLogDetailFrame and QuestLogDetailFrame:IsVisible() then return "details" end
        if QuestLogFrame and QuestLogFrame:IsVisible() then return "list" end
        return nil
    end)
    local gossipShown = Safe(function() return GossipFrame and GossipFrame:IsVisible() end)
    local frameText = panel and ("shown, " .. panel .. " panel") or "hidden"
    if titleIn == "frame" then frameText = frameText .. format(", quest %q", shownTitle) end
    if panel and shownNPC then frameText = frameText .. format(", NPC %q", shownNPC) end
    local logText = logShown and ("shown, " .. (logShown == "details" and "a quest's details" or "the list")) or "hidden"
    if titleIn == "log" then logText = logText .. format(", quest %q", shownTitle) end
    table.insert(lines, format("on screen: NPC quest frame %s; quest log %s; gossip frame %s",
        frameText, logText, gossipShown and "shown" or "hidden"))
    if Debug:IsMockingMissingVoice() then
        table.insert(lines, "(Mock Missing Voice Over is on: no line is found for any window)")
    end
    local window = Debug.lastWindow
    if window then
        table.insert(lines, format("last window read, %.1f s ago: %s",
            (GetTime and GetTime() or 0) - window.time, tostring(window.message)))
    else
        table.insert(lines, "last window read: none since login")
    end
    local stage, message, time = Debug:GetRuntimeStatus()
    table.insert(lines, format("last stage %s, %s s ago: %s", tostring(stage),
        time and format("%.1f", (GetTime and GetTime() or 0) - time) or "?", tostring(message)))
end

if Spoken and Spoken.AddDiagnostics then
    Spoken:AddDiagnostics("Spoken Quests", function(detailed)
        local lines = {}
        DiagnosticsLines(lines)
        if detailed then
            local ok, err = pcall(ContextLines, lines)
            if not ok then table.insert(lines, "context error: " .. tostring(err)) end
        end
        return lines
    end)
end

setfenv(1, VoiceOver)

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)

---@class QuestPlayButton : Button
---@field soundData SoundData

QuestOverlayUI = {
    ---@type table<number, QuestPlayButton>
    questPlayButtons = {},
    ---@type table<number, Button>
    questContributeButtons = {},
    ---@type QuestPlayButton[]
    displayedButtons = {},
}

--- The frame a play button is created under, before `UpdatePlayButton` reparents it to the
--- row it marks. Overridden where the quest log is not the named `QuestLogFrame` - the
--- modern map-attached log has no named frame at all.
---@return Frame parent
function QuestOverlayUI:GetPlayButtonParent()
    return QuestLogFrame
end

--- A play button with no quest attached to it yet. The quest log keeps one per quest; the
--- quest details view keeps a single one it rebinds to whichever quest it is showing.
---@return QuestPlayButton playButton
function QuestOverlayUI:MakePlayButton(parent)
    -- Detached, because this runs while the quest log is open (Utils:CreateDetachedFrame).
    local playButton = Utils:CreateDetachedFrame("Button", nil, parent or self:GetPlayButtonParent())
    playButton:SetWidth(20)
    playButton:SetHeight(20)
    playButton:SetHitRectInsets(2, 2, 2, 2)
    playButton:SetNormalTexture((TEXTURES .. "QuestLogPlayButton"))
    playButton:SetDisabledTexture((TEXTURES .. "QuestLogPlayButton"))
    playButton:GetDisabledTexture():SetDesaturated(true)
    playButton:GetDisabledTexture():SetAlpha(0.33)
    playButton:SetHighlightTexture("Interface\\BUTTONS\\UI-Panel-MinimizeButton-Highlight")
    ---@cast playButton QuestPlayButton
    return playButton
end

function QuestOverlayUI:CreatePlayButton(questID)
    self.questPlayButtons[questID] = self:MakePlayButton()
end

--- The Contribute button for a quest the log has no sound for, sitting where its Play would,
--- or nil when this client cannot offer one (buttons hidden, or no sound pack at all -- see Contribute:CanOfferFromLog). The client's own plus icon, the same size as
--- Play: the row has room for an icon and not for a word, and the tooltip says what it does.
---@return Button?
function QuestOverlayUI:ContributeButtonFor(questID, title)
    if not Contribute:CanOfferFromLog() then
        return nil
    end
    local button = self.questContributeButtons[questID]
    if not button then
        button = Utils:CreateDetachedFrame("Button", nil, self:GetPlayButtonParent())
        button:SetWidth(20)
        button:SetHeight(20)
        button:SetHitRectInsets(2, 2, 2, 2)
        button:SetNormalTexture("Interface\\Buttons\\UI-PlusButton-Up")
        button:SetPushedTexture("Interface\\Buttons\\UI-PlusButton-Down")
        button:SetHighlightTexture("Interface\\Buttons\\UI-PlusButton-Hilight")
        button:SetScript("OnEnter", function(self)
            Contribute:ShowTooltip(self)
        end)
        button:SetScript("OnLeave", function()
            if GameTooltip then
                GameTooltip:Hide()
            end
        end)
        Contribute:OfferLogMenu(button)
        self.questContributeButtons[questID] = button
    end
    button:SetScript("OnClick", function()
        Contribute:ShowFromLog(questID, title)
    end)
    return button
end

local prefix

--- Spaces ahead of the title, as wide as Play, so the button sits before the title's first glyph.
local function PadTitle(normalText)
    if not prefix then
        local text = normalText:GetText()
        for i = 1, 20 do
            normalText:SetText(string.rep(" ", i))
            if normalText:GetStringWidth() >= 24 then
                prefix = normalText:GetText()
                break
            end
        end
        prefix = prefix or "  "
        normalText:SetText(text)
    end
    local text = normalText:GetText() or ""
    local padded = prefix .. string.trim(text)
    if padded ~= text then normalText:SetText(padded) end
    return padded
end

--- Pads the row's title again whenever anything rewrites it. Other addons hook QuestLog_Update
--- after Spoken and replace the whole title (Leatrix Plus prefixes the quest level), which
--- would put Play over the title's first glyphs. The left margin is no room for Play: the
--- client shows how many party members share the quest there.
local function KeepTitlePadded(row, i, normalText)
    if row.spokenKeepsPadding then return end
    row.spokenKeepsPadding = true
    hooksecurefunc(row, "SetText", function()
        if not Addon:IsPartOn() then return end
        local questIndex = i + Utils:GetQuestLogScrollOffset()
        local numEntries = GetNumQuestLogEntries()
        if questIndex > numEntries or select(4, GetQuestLogTitle(questIndex)) then return end
        PadTitle(normalText)
    end)
end

function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
    playButton:SetPoint("LEFT", normalText, "LEFT", 4, 0)

    QuestLogDummyText:SetText(PadTitle(normalText))

    questCheck:SetPoint("LEFT", normalText, "LEFT", normalText:GetStringWidth(), 0)
end

--- Play or stop, read off the button's own sound data rather than the quest log's table:
--- the details view has a button that belongs to no quest in particular. A button drawn its
--- own way (the details view's round one) carries its own `setPlayState`.
function QuestOverlayUI:SetPlayButtonState(playButton)
    local isPlaying = playButton.soundData and Player:Contains(playButton.soundData) or false
    if playButton.setPlayState then
        playButton.setPlayState(playButton, isPlaying)
        return
    end
    local texturePath = isPlaying and (TEXTURES .. "QuestLogStopButton") or (TEXTURES .. "QuestLogPlayButton")
    playButton:SetNormalTexture(texturePath)
end

function QuestOverlayUI:UpdatePlayButtonTexture(questID)
    local playButton = self.questPlayButtons[questID]
    if playButton then
        self:SetPlayButtonState(playButton)
    end
end

-- The minimal player draws a quest-log giver's face from its creature id, and a creature the
-- client has not cached reads as nothing until its server answers -- the book, for a round
-- trip, after the click. Asking as the log draws the button starts that round trip while the
-- player is still reading the list. The player owns the model it asks through.
--
-- Quest ids already asked about, or whose giver is not a creature. Left unset only while the
-- data modules have not loaded: there is no giver to ask about yet, and a redraw tries again.
local primed = {}

local function PrimeGiver(questID)
    if primed[questID] or not (Spoken and Spoken.PrimePortrait) then return end
    local type, id = DataModules:GetQuestLogQuestGiverTypeAndID(questID)
    if not type then return end
    primed[questID] = true
    if Enums.GUID:IsCreature(type) then Spoken:PrimePortrait(id) end
end

--- What a play button does when it is clicked, for whichever quest it currently stands for.
--- Shared by the buttons in the quest log, the objective tracker and the one in the quest details
--- view. `origin` names the screen for the debug log.
function QuestOverlayUI:BindPlayButton(playButton, questID, soundTitle, origin)
    PrimeGiver(questID)
    playButton:SetScript("OnClick", function(self)
        if not self.soundData then
            local type, id = DataModules:GetQuestLogQuestGiverTypeAndID(questID)
            self.soundData = {
                event = Enums.SoundEvent.QuestAccept,
                questID = questID,
                name = id and DataModules:GetObjectName(type, id) or "Unknown Name",
                title = soundTitle,
                unitGUID = id and Enums.GUID:CanHaveID(type) and Utils:MakeGUID(type, id) or nil,
                -- A poster or an item has no face to draw: the line shows a notice, as the dialog's does.
                unitIsObjectOrItem = id ~= nil and not Enums.GUID:IsCreature(type),
                -- For the debug log: which screen queued it.
                origin = origin or "the quest log's Play button",
            }
        end

        local soundData = self.soundData
        local isPlaying = Player:Contains(soundData)

        if not isPlaying then
            Player:PlayNow(soundData)
            QuestOverlayUI:SetPlayButtonState(self)

            soundData.stopCallback = function()
                -- Only if the button still stands for this line: it may have been rebound since.
                if self.soundData == soundData then self.soundData = nil end
                QuestOverlayUI:SetPlayButtonState(self)
            end
        else
            Player:Remove(soundData)
        end
    end)
    if playButton.setPlayState then self:AddStopReplay(playButton, questID) end
end

--- This quest's accept line in the queue, whoever queued it: autoplay, a button or the windows.
--- Found again each time, since a rebind or a reopened panel starts afresh.
function QuestOverlayUI:QueuedLine(questID)
    if not questID then return nil end
    for _, clip in ipairs(Player:Queued()) do
        if clip.questID == questID and clip.event == Enums.SoundEvent.QuestAccept then return clip end
    end
end

--- Stop while this quest's line speaks, Replay while it is stopped at the head, Play otherwise.
--- Also the line, where it is queued.
function QuestOverlayUI:StateOf(questID)
    local clip = self:QueuedLine(questID)
    if not clip or Spoken:GetCurrent() ~= clip then return "play", clip end
    if Spoken:IsPaused() then return "replay", clip end
    if Spoken:GetNowPlaying() == clip then return "stop", clip end
    return "play", clip
end

--- A button's `setPlayState`, for one that stops and replays: its glyph is what the queue says its quest is doing.
function QuestOverlayUI.FollowQueue(button) button:SetState((QuestOverlayUI:StateOf(button.questID))) end

-- The tooltip says what a click does now.
local TIPS = { play = { "OPT_PLAY", "OPT_PLAY_TIP" }, stop = { "OPT_STOP", "OPT_STOP_TIP" },
    replay = { "OPT_REPLAY", "OPT_REPLAY_TIP" } }

function QuestOverlayUI:ShowPlayTip(button)
    local tip = TIPS[button.state or "play"]
    GameTooltip:SetOwner(button, "ANCHOR_LEFT")
    GameTooltip:SetText(L[tip[1]])
    GameTooltip:AddLine(L[tip[2]], 1, 0.8, 0.2, true)
    GameTooltip:Show()
end

-- Every button that stops and replays, to follow the queue.
local stoppable = setmetatable({}, { __mode = "k" })
local listening

--- Stopped or replayed from the subtitle or the windows, every such button's glyph follows.
function QuestOverlayUI:RefreshStates()
    for button in pairs(stoppable) do
        if button:IsShown() then self:SetPlayButtonState(button) end
    end
end

--- A button drawn its own way (it carries `setPlayState`) stops and replays as the round buttons do:
--- Stop or Replay this quest's line while it is the head, Play it where it waits behind a stopped
--- one, queue it otherwise. Bound after `BindPlayButton`, which it wraps.
function QuestOverlayUI:AddStopReplay(playButton, questID)
    playButton.questID = questID
    stoppable[playButton] = true
    if not listening and Spoken and Spoken.RegisterCallback then
        listening = true
        Spoken:RegisterCallback("AUDIO_CHANGED", function() QuestOverlayUI:RefreshStates() end)
    end
    local bound = playButton:GetScript("OnClick")
    playButton:SetScript("OnClick", function(button, mouse, down)
        -- Looked up each click, never the copy kept when the button was bound: a line that has since
        -- finished is no longer in the queue, and holding on to it left the button dead.
        local state, clip = QuestOverlayUI:StateOf(button.questID)
        if state == "stop" or state == "replay" then
            SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
            Spoken:TogglePause()
        elseif clip and Spoken:IsPaused() and Player.source then
            -- Waiting behind a stopped line: Play on it plays it, and takes the queue out of its stop.
            SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
            Player.source:PlayNow(clip)
        elseif not clip and bound then
            -- The bound handler queues the line it holds, so it starts from a fresh one.
            button.soundData = nil
            bound(button, mouse, down)
        end
        QuestOverlayUI:SetPlayButtonState(button)
        if GameTooltip:GetOwner() == button then QuestOverlayUI:ShowPlayTip(button) end
    end)
    playButton:SetScript("OnEnter", function(button) QuestOverlayUI:ShowPlayTip(button) end)
    playButton:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

function QuestOverlayUI:UpdatePlayButton(soundTitle, questID, questLogTitleFrame, normalText, questCheck)
    local playButton = self.questPlayButtons[questID]
    playButton:SetParent(questLogTitleFrame:GetParent())
    playButton:SetFrameLevel(questLogTitleFrame:GetFrameLevel() + 2)

    QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
    self:BindPlayButton(playButton, questID, soundTitle)
end

function QuestOverlayUI:Update()
    if not QuestLogFrame:IsShown() then
        return
    end

    local numEntries, numQuests = GetNumQuestLogEntries()

    -- Hide all buttons in displayedButtons
    for _, button in pairs(self.displayedButtons) do
        button:Hide()
    end
    -- Switched off, the part puts nothing on the log.
    if not Addon:IsPartOn() then
        table.wipe(self.displayedButtons)
        return
    end

    if numEntries == 0 then
        return
    end

    -- Clear displayedButtons
    table.wipe(self.displayedButtons)

    -- Traverse through the quests displayed in the UI
    for i = 1, QUESTS_DISPLAYED do
        local questIndex = i + Utils:GetQuestLogScrollOffset();
        if questIndex > numEntries then
            break
        end

        -- Get quest title
        local questLogTitleFrame = Utils:GetQuestLogTitleFrame(i)
        local normalText = Utils:GetQuestLogTitleNormalText(i)
        local questCheck = Utils:GetQuestLogTitleCheck(i)
        KeepTitlePadded(questLogTitleFrame, i, normalText)
        local title, level, suggestedGroup, isHeader, isCollapsed, isComplete, frequency, questID = GetQuestLogTitle(
            questIndex)

        if not isHeader then
            if not self.questPlayButtons[questID] then
                self:CreatePlayButton(questID)
            end

            local playButton = self.questPlayButtons[questID]
            local shown = playButton
            if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                self:UpdatePlayButton(title, questID, questLogTitleFrame, normalText, questCheck)
                playButton:Enable()
            else
                -- No sound: Contribute where Play would be, or Play greyed out where this
                -- client cannot contribute.
                local contribute = self:ContributeButtonFor(questID, title)
                if contribute then
                    playButton:Hide()
                    contribute:SetParent(questLogTitleFrame:GetParent())
                    contribute:SetFrameLevel(questLogTitleFrame:GetFrameLevel() + 2)
                    shown = contribute
                else
                    playButton:Disable()
                end
                self:UpdateQuestTitle(questLogTitleFrame, shown, normalText, questCheck)
            end

            shown:Show()
            if shown == playButton then
                self:UpdatePlayButtonTexture(questID)
            end

            -- Add the button to displayedButtons
            table.insert(self.displayedButtons, shown)
        end
    end
end

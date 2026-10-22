-- Open in Azeroth's Compendium, where a player reads a quest: the quest giver's window, the
-- quest log's details, and DialogueUI's window (UI/DialogueUIBridge.lua puts it in its row). The
-- button Spoken Places' lore page has: the Compendium's tome in the player's round button. Shown
-- only for a quest whose words its page would show: one this character may take, started, or any
-- with Unlock Unstarted Quests on, whatever the list's filters leave out.
--
-- Not under setfenv(1, VoiceOver), for UI/QuestsTab.lua's reason.

local VO = VoiceOver
local QuestsTab = VO.QuestsTab
local L = VO.L

local GAP = 4
-- Where UI/DialogPlayButton.lua and UI/ContributeButton.lua put theirs: under the close button,
-- in the strip below the title bar, with the quest log details' inset from the right.
local STRIP_OFFSET, CORNER_INSET, INSET = 12, 32, 11
-- The round button is 24 tall where those are 20: up by half the difference to share their middle.
local LIFT = 2

--- The button for `parent`, its quest set on `questID`. `tooltip`, where given, returns the
--- tooltip to use: DialogueUI hides the game's with the rest of the interface.
function QuestsTab:NewOpenButton(parent, tooltip)
    if not (_G.Spoken and Spoken.CreateRoundButton) then return nil end
    local icon = _G.SpokenCompendium and SpokenCompendium.ICON or 5341597
    local button = Spoken:CreateRoundButton(parent, "icon", nil, icon)
    button:SetScript("OnClick", function(self)
        if self.questID then
            if self.beforeOpen then self.beforeOpen() end
            QuestsTab:Open(self.questID)
        end
    end)
    button:HookScript("OnEnter", function(self)
        local tip = tooltip and tooltip() or GameTooltip
        tip:SetOwner(self, "ANCHOR_LEFT")
        tip:SetText(L.OPEN_IN_COMPENDIUM)
        tip:AddLine(L.OPEN_QUEST_IN_COMPENDIUM_TIP, 1, 0.8, 0.2, true)
        tip:Show()
        self.tooltip = tip
    end)
    button:HookScript("OnLeave", function(self)
        if self.tooltip then self.tooltip:Hide() end
    end)
    button:Hide()
    return button
end

local function Visible(frame)
    return type(frame) == "table" and frame.IsVisible ~= nil and frame:IsVisible() and true or false
end

--------------------------------------------------------------------------------
-- The quest giver's window
--------------------------------------------------------------------------------

local giver

local function GiverQuestOnScreen()
    return Visible(_G.QuestFrameDetailPanel) or Visible(_G.QuestFrameProgressPanel)
        or Visible(_G.QuestFrameRewardPanel)
end

-- Left of Listen or Contribute where one is shown, else in their corner.
local function PlaceGiver()
    local frame = _G.QuestFrame
    giver:ClearAllPoints()
    for _, owner in ipairs({ VO.DialogPlayButton, VO.ContributeButton }) do
        local beside = type(owner) == "table" and owner.button
        if type(beside) == "table" and beside:IsShown() then
            giver:SetPoint("RIGHT", beside, "LEFT", -GAP, 0)
            return
        end
    end
    local close = type(frame.CloseButton) == "table" and frame.CloseButton or _G.QuestFrameCloseButton
    local frameTop, closeBottom = frame:GetTop(), close and close.GetBottom and close:GetBottom()
    if type(frameTop) == "number" and type(closeBottom) == "number" then
        giver:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -INSET, -(frameTop - closeBottom + STRIP_OFFSET) + LIFT)
    else
        giver:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET + LIFT)
    end
end

function QuestsTab:RefreshGiverButton()
    if not giver then return end
    local id = GiverQuestOnScreen() and GetQuestID and VO.NotSecret(GetQuestID()) or nil
    local shown = self:Has(id)
    giver.questID = shown and id or nil
    if id then PlaceGiver() end
    giver:SetShown(shown)
end

local function SetupGiver()
    local frame = _G.QuestFrame
    if giver or type(frame) ~= "table" then return end
    giver = QuestsTab:NewOpenButton(frame)
    if not giver then return end
    giver:SetFrameLevel(frame:GetFrameLevel() + 10)
    QuestsTab.giverButton = giver
    local function Refresh() QuestsTab:RefreshGiverButton() end
    local watcher = CreateFrame("Frame")
    for _, event in ipairs({ "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_FINISHED" }) do
        pcall(watcher.RegisterEvent, watcher, event)
    end
    watcher:SetScript("OnEvent", function()
        Refresh()
        -- Again a moment later: a Classic quest event can arrive before GetQuestID changes, and
        -- Listen and Contribute settle then too.
        C_Timer.After(0.25, Refresh)
    end)
    frame:HookScript("OnHide", Refresh)
    for _, owner in ipairs({ VO.DialogPlayButton, VO.ContributeButton }) do
        local beside = type(owner) == "table" and owner.button
        if type(beside) == "table" and beside.HookScript then
            beside:HookScript("OnShow", Refresh)
            beside:HookScript("OnHide", Refresh)
        end
    end
end

--------------------------------------------------------------------------------
-- The quest log's details
--------------------------------------------------------------------------------

-- Classic Era's quest log: the selected quest's details on the right, the button in their top
-- right corner.
local logButton

function QuestsTab:RefreshLogButton()
    if not logButton then return end
    local index = GetQuestLogSelection and GetQuestLogSelection()
    local id = Visible(_G.QuestLogDetailScrollFrame) and index and index > 0 and select(8, GetQuestLogTitle(index)) or nil
    local shown = self:Has(id)
    logButton.questID = shown and id or nil
    logButton:SetShown(shown)
end

local function SetupLog()
    local frame, details = _G.QuestLogFrame, _G.QuestLogDetailScrollFrame
    if logButton or type(frame) ~= "table" or type(details) ~= "table" or not GetQuestLogTitle then return end
    logButton = QuestsTab:NewOpenButton(frame)
    if not logButton then return end
    logButton:SetFrameLevel(details:GetFrameLevel() + 5)
    logButton:SetPoint("TOPRIGHT", details, "TOPRIGHT", -2, -2)
    QuestsTab.logButton = logButton
    local function Refresh() QuestsTab:RefreshLogButton() end
    for _, name in ipairs({ "QuestLog_UpdateQuestDetails", "QuestLog_Update" }) do
        if type(_G[name]) == "function" then hooksecurefunc(name, Refresh) end
    end
    frame:HookScript("OnShow", Refresh)
end

-- The map's quest log (Forever): the details view, left of its Play, Report or Contribute.
local mapButton

function QuestsTab:RefreshMapButton()
    if not mapButton then return end
    local details = QuestMapFrame.DetailsFrame
    local id = details.questID or (C_QuestLog and C_QuestLog.GetSelectedQuest and C_QuestLog.GetSelectedQuest())
    local shown = self:Has(id)
    mapButton.questID = shown and id or nil
    mapButton:ClearAllPoints()
    local overlay = VO.QuestOverlayUI
    local header = details.BackFrame or details
    local beside
    for _, key in ipairs({ "detailsPlayButton", "detailsContributeButton", "detailsReportButton" }) do
        local button = type(overlay) == "table" and overlay[key]
        if type(button) == "table" and button:IsShown() then
            beside = button
            break
        end
    end
    if beside then
        mapButton:SetPoint("RIGHT", beside, "LEFT", -GAP, 0)
    else
        local back = type(header.BackButton) == "table" and header.BackButton
        local _, _, _, backInset, backOffset = back and back:GetPoint(1)
        mapButton:SetPoint("RIGHT", header, "RIGHT", -(backInset or INSET), backOffset or 4)
    end
    mapButton:SetShown(shown)
end

local function SetupMap()
    local details = _G.QuestMapFrame and QuestMapFrame.DetailsFrame
    if mapButton or type(details) ~= "table" or not _G.QuestMapFrame_ShowQuestDetails then return end
    local header = details.BackFrame or details
    mapButton = QuestsTab:NewOpenButton(header)
    if not mapButton then return end
    mapButton:SetFrameLevel(header:GetFrameLevel() + 2)
    QuestsTab.mapButton = mapButton
    -- After Compatibility.lua's own hook, which has placed Play and Report by then.
    hooksecurefunc("QuestMapFrame_ShowQuestDetails", function() QuestsTab:RefreshMapButton() end)
end

--- The buttons, once the Compendium's tab is there.
function QuestsTab:SetupOpenButtons()
    if self.openButtonsReady then return end
    self.openButtonsReady = true
    for _, setup in ipairs({ SetupGiver, SetupLog, SetupMap }) do
        local ok, err = pcall(setup)
        if not ok and VO.Debug then VO.Debug:Record("compendium-error", tostring(err)) end
    end
end

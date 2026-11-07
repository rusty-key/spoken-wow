setfenv(1, VoiceOver)

-- The Copy text button on quest and gossip dialogue. DialogueUI has the best version of the
-- window already, so use it when it exposes its clipboard method; the Blizzard-frame button gets
-- the same selectable edit box through a large StaticPopup.

local BUTTON_HEIGHT = 20
local BUTTON_WIDTH = 75
local LABEL_PADDING = 24
local BUTTON_SIZE = 24
local STRIP_OFFSET = 12
local CORNER_INSET = 32
local COPY_ICON = "Interface\\Icons\\INV_Misc_ScrollUnrolled01"
local COPY_DIALOG = "SPOKEN_COPY_TEXT"
local COPY_TEXT = L.OPT_COPY_TEXT
local COPY_TEXT_TIP = L.OPT_COPY_TEXT_TIP

local REFRESH_EVENTS = {
    "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_GREETING",
    "GOSSIP_SHOW", "GOSSIP_CLOSED", "QUEST_FINISHED",
}

CopyTextButton = {}

local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

local function CloseButtonOf(frame, global)
    if frame and type(frame.CloseButton) == "table" then
        return frame.CloseButton
    end
    return _G[global]
end

local function QuestPanelOnScreen()
    if IsFrameVisible(QuestFrameRewardPanel) then
        return QuestFrameRewardPanel
    elseif IsFrameVisible(QuestFrameProgressPanel) then
        return QuestFrameProgressPanel
    elseif IsFrameVisible(QuestFrameDetailPanel) then
        return QuestFrameDetailPanel
    elseif IsFrameVisible(QuestFrameGreetingPanel) then
        return QuestFrameGreetingPanel
    end
end

local function PlayButtonInset()
    local details = _G.QuestMapFrame and QuestMapFrame.DetailsFrame
    local header = details and (details.BackFrame or details)
    local back = header and header.BackButton
    if type(back) == "table" and back.GetPoint then
        local _, _, _, x = back:GetPoint(1)
        if type(x) == "number" and x > 0 then
            return x
        end
    end
    return 11
end

local function CurrentText()
    if not (Contribute and Contribute.CurrentText) then
        return nil
    end
    local ok, text = pcall(Contribute.CurrentText, Contribute)
    return ok and type(text) == "string" and text ~= "" and text or nil
end

local function DialogueFrame()
    local page = Utils:DialogueUIPage()
    local frame = _G.DUIQuestFrame
    if page and frame and IsFrameVisible(frame) then
        return frame
    end
end

local function TooltipFor(frame)
    if ContributeButton and ContributeButton.DialogueUITooltip then
        return ContributeButton:DialogueUITooltip(frame)
    end
    return GameTooltip
end

function CopyTextButton:ShowPopup(text)
    if not (StaticPopup_Show and StaticPopupDialogs) then
        return
    end
    self.text = text
    StaticPopup_Show(COPY_DIALOG)
end

function CopyTextButton:ShowText()
    local frame = DialogueFrame()
    if frame and type(frame.SendContentToClipboard) == "function" then
        local ok = pcall(frame.SendContentToClipboard, frame)
        if ok then
            return
        end
    end
    local text = CurrentText()
    if text then
        self:ShowPopup(text)
    end
end

function CopyTextButton:PositionStandard(frame)
    local button = self.button
    local compendium = QuestsTab and QuestsTab.giverButton
    if frame == _G.QuestFrame and compendium and compendium:IsShown() then
        button:ClearAllPoints()
        button:SetPoint("RIGHT", compendium, "LEFT", -4, 0)
        return
    end
    local close = CloseButtonOf(frame, frame == _G.QuestFrame and "QuestFrameCloseButton" or "GossipFrameCloseButton")
    button:ClearAllPoints()
    local frameTop = frame.GetTop and frame:GetTop()
    local closeBottom = close and close.GetBottom and close:GetBottom()
    if type(frameTop) == "number" and type(closeBottom) == "number" then
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -PlayButtonInset(),
            -(frameTop - closeBottom + STRIP_OFFSET))
    elseif close then
        button:SetPoint("TOPRIGHT", close, "BOTTOMRIGHT", -2, -STRIP_OFFSET)
    else
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET)
    end
end

local function CreateIconButton(parent)
    local button
    if Spoken and Spoken.CreateRoundButton then
        button = Spoken:CreateRoundButton(parent, "icon", nil, COPY_ICON)
    else
        button = CreateFrame("Button", nil, parent)
        button:SetSize(BUTTON_SIZE, BUTTON_SIZE)
        button.texture = button:CreateTexture(nil, "OVERLAY")
        button.texture:SetAllPoints()
        button.texture:SetTexture(COPY_ICON)
    end
    button:SetSize(BUTTON_SIZE, BUTTON_SIZE)
    return button
end

local function CreateTextButton()
    local button = CreateFrame("Button", nil, UIParent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    button:SetText(COPY_TEXT)
    button:SetWidth(math.max(BUTTON_WIDTH, button:GetTextWidth() + LABEL_PADDING))
    return button
end

function CopyTextButton:PositionDialogue(frame)
    local button = self.dialogueButton
    local native = frame.CopyTextButton
    button:ClearAllPoints()
    if native and native.GetPoint then
        -- If DialogueUI created its button but hid it, use the same slot and scale.
        button:SetPoint("CENTER", native, "CENTER", 0, 0)
    else
        -- This is DialogueUI's own default position for its Copy Text button.
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
    end
    button:SetScale(1)
    button:SetSize(BUTTON_SIZE, BUTTON_SIZE)
end

function CopyTextButton:Refresh()
    if not self.button then
        return
    end

    local dialogue = DialogueFrame()
    if dialogue then
        self.button:Hide()
        local native = dialogue.CopyTextButton
        -- Do not draw a second icon when the player has enabled DialogueUI's own one.
        if native and IsFrameVisible(native) then
            self.dialogueButton:Hide()
            return
        end
        self:PositionDialogue(dialogue)
        self.dialogueButton:Show()
        return
    end

    self.dialogueButton:Hide()
    local frame = QuestPanelOnScreen()
    if frame then
        frame = _G.QuestFrame
    elseif IsFrameVisible(_G.GossipFrame) then
        frame = _G.GossipFrame
    end
    if not frame then
        self.button:Hide()
        return
    end

    self:PositionStandard(frame)
    self.button:Show()
end

local function HideTooltip()
    if CopyTextButton.tooltip then
        CopyTextButton.tooltip:Hide()
    elseif GameTooltip then
        GameTooltip:Hide()
    end
end

function CopyTextButton:Setup()
    if self.button or not CreateFrame then
        return self.button
    end

    StaticPopupDialogs[COPY_DIALOG] = {
        text = COPY_TEXT,
        button1 = CLOSE,
        timeout = 0,
        whileDead = 1,
        hideOnEscape = true,
        hasEditBox = true,
        editBoxWidth = 420,
        OnShow = function(dialog)
            dialog = dialog or this
            if not dialog then
                return
            end
            dialog:SetWidth(700)
            dialog:SetHeight(500)
            local editBox = dialog.editBox or _G[dialog:GetName() .. "EditBox"]
            if not editBox then
                return
            end
            editBox:ClearAllPoints()
            editBox:SetPoint("TOPLEFT", dialog, "TOPLEFT", 32, -55)
            editBox:SetPoint("BOTTOMRIGHT", dialog, "BOTTOMRIGHT", -32, 70)
            editBox:SetWidth(636)
            editBox:SetHeight(375)
            if editBox.SetMultiLine then
                editBox:SetMultiLine(true)
            end
            if editBox.SetAutoFocus then
                editBox:SetAutoFocus(false)
            end
            editBox.spokenCopyText = CopyTextButton.text or ""
            editBox:SetText(editBox.spokenCopyText)
            editBox:SetFocus()
            editBox:HighlightText()
            local close = dialog.button1 or dialog.Button1
            if close then
                close:ClearAllPoints()
                close:SetPoint("BOTTOMRIGHT", dialog, "BOTTOMRIGHT", -32, 24)
            end
        end,
        EditBoxOnTextChanged = function(editBox)
            editBox = editBox or this
            if editBox and editBox.spokenCopyText and editBox:GetText() ~= editBox.spokenCopyText then
                editBox:SetText(editBox.spokenCopyText)
                editBox:HighlightText()
            end
        end,
        EditBoxOnEscapePressed = function(editBox)
            editBox = editBox or this
            if editBox and editBox:GetParent() then
                editBox:GetParent():Hide()
            end
        end,
    }

    local button = CreateTextButton()
    if button.SetFrameStrata then
        button:SetFrameStrata("DIALOG")
    end
    button:Hide()
    button:SetScript("OnClick", function()
        CopyTextButton:ShowText()
    end)
    button:SetScript("OnEnter", function(self)
        if GameTooltip then
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(COPY_TEXT_TIP)
            GameTooltip:Show()
        end
    end)
    button:SetScript("OnLeave", HideTooltip)
    self.button = button

    local dialogueParent = _G.DUIQuestFrame or UIParent
    local dialogueButton = CreateIconButton(dialogueParent)
    dialogueButton:SetFrameStrata("FULLSCREEN")
    dialogueButton:SetScript("OnClick", function()
        CopyTextButton:ShowText()
    end)
    dialogueButton:SetScript("OnEnter", function(self)
        local frame = DialogueFrame()
        if not frame then
            return
        end
        local tooltip = TooltipFor(frame)
        if tooltip then
            CopyTextButton.tooltip = tooltip
            tooltip:SetOwner(self, "ANCHOR_RIGHT")
            tooltip:SetText(COPY_TEXT)
            tooltip:Show()
        end
    end)
    dialogueButton:SetScript("OnLeave", HideTooltip)
    dialogueButton:Hide()
    self.dialogueButton = dialogueButton

    local watcher = CreateFrame("Frame")
    for _, event in ipairs(REFRESH_EVENTS) do
        pcall(watcher.RegisterEvent, watcher, event)
    end
    watcher:SetScript("OnEvent", function()
        CopyTextButton:Refresh()
    end)
    self.watcher = watcher

    for _, name in ipairs({ "QuestFrame", "GossipFrame" }) do
        local host = _G[name]
        if type(host) == "table" and host.HookScript then
            host:HookScript("OnHide", function()
                CopyTextButton:Refresh()
            end)
        end
    end

    -- DialogueUI builds and resizes its page after the game event. The child driver runs only
    -- while its window exists and keeps our icon in its header slot as that happens.
    local driver = CreateFrame("Frame", nil, dialogueParent)
    driver:SetScript("OnUpdate", function(_, elapsed)
        self.elapsed = (self.elapsed or 0) + elapsed
        if self.elapsed >= 0.1 then
            self.elapsed = 0
            CopyTextButton:Refresh()
        end
    end)
    self.driver = driver

    self:Refresh()
    return button
end

setfenv(1, VoiceOver)

-- The Copy text button on quest and gossip dialogue. DialogueUI has the best version of the
-- window already, so use it when it exposes its clipboard method; the Blizzard-frame button gets
-- the same selectable edit box through Spoken's Gathered Lines dialog style.

local BUTTON_SIZE = 24
local STRIP_OFFSET = 12
local CORNER_INSET = 32
local COPY_WIDTH, COPY_HEIGHT = 640, 480
local COPY_ICON = "Interface\\Icons\\INV_Misc_ScrollUnrolled01"
local COPY_FRAME = "SpokenCopyTextFrame"
local COPY_TEXT = L.OPT_COPY_TEXT

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
    if not self.popup then
        self.popup = self:BuildPopup()
    end
    self.popup.payload = text
    if Spoken and Spoken.TintDialog then
        Spoken:TintDialog(self.popup.frame)
    end
    self.popup.frame:Show()
    self.popup.editBox:SetText(text)
    self.popup.editBox:SetFocus()
    self.popup.editBox:HighlightText()
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

function CopyTextButton:BuildPopup()
    local frame = CreateFrame("Frame", COPY_FRAME, UIParent, "BackdropTemplate")
    frame:SetSize(COPY_WIDTH, COPY_HEIGHT)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetToplevel(true)
    frame:EnableMouse(true)
    frame:SetMovable(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetClampedToScreen(true)
    if UISpecialFrames then
        table.insert(UISpecialFrames, COPY_FRAME)
    end
    if frame.SetBackdrop then
        frame:SetBackdrop({
            bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
            edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
            tile = true,
            tileSize = 32,
            edgeSize = 32,
            insets = { left = 11, right = 12, top = 12, bottom = 11 },
        })
    end
    if Spoken and Spoken.TintDialog then
        Spoken:TintDialog(frame)
    end

    local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    title:SetPoint("TOP", frame, "TOP", 0, -16)
    title:SetText(COPY_TEXT)

    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
    close:SetScript("OnClick", function() frame:Hide() end)

    local scroll = CreateFrame("ScrollFrame", COPY_FRAME .. "Scroll", frame)
    scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", 20, -44)
    scroll:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -28, 20)

    local editBox = CreateFrame("EditBox", COPY_FRAME .. "Edit", scroll)
    editBox:SetMultiLine(true)
    editBox:SetMaxBytes(0)
    editBox:SetAutoFocus(false)
    editBox:SetFontObject(ChatFontNormal)
    editBox:SetWidth(COPY_WIDTH - 48)
    editBox:SetHeight(COPY_HEIGHT - 64)
    scroll:SetScrollChild(editBox)
    editBox:SetScript("OnTextChanged", function(self)
        if self:GetParent():GetParent().payload and self:GetText() ~= self:GetParent():GetParent().payload then
            self:SetText(self:GetParent():GetParent().payload)
            self:HighlightText()
        end
    end)
    editBox:SetScript("OnEscapePressed", function(self)
        self:GetParent():GetParent():Hide()
    end)

    frame:Hide()
    return { frame = frame, editBox = editBox, title = title }
end

function CopyTextButton:Setup()
    if self.button or not CreateFrame then
        return self.button
    end

    local button = CreateIconButton(UIParent)
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
            GameTooltip:SetText(COPY_TEXT)
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

    if Spoken and Spoken.RegisterCallback then
        for _, event in ipairs({ "FRAME_SETTINGS_CHANGED", "REPORT_SETTINGS_CHANGED" }) do
            Spoken:RegisterCallback(event, function()
                if self.popup and Spoken.TintDialog then
                    Spoken:TintDialog(self.popup.frame)
                end
            end)
        end
    end

    self:Refresh()
    return button
end

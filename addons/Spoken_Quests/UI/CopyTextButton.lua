setfenv(1, VoiceOver)

-- The Copy text button on the game's quest and gossip frames. DialogueUI supplies its own copy
-- control, so this button stays on the Blizzard frames and does not add a duplicate to DialogueUI.

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

local function CurrentText()
    if not (Contribute and Contribute.CurrentText) then
        return nil
    end
    local ok, text = pcall(Contribute.CurrentText, Contribute)
    return ok and type(text) == "string" and text ~= "" and text or nil
end

local function AddDiagnostic(lines, label, value)
    if value ~= nil and value ~= "" then
        lines[#lines + 1] = format("[%s: %s]", label, tostring(value))
    end
end

local function NPCInfo()
    if not Utils then
        return nil, nil
    end
    local name = Utils:GetNPCName()
    local guid = Utils:GetNPCGUID()
    local id
    if guid and Utils.GetIDFromGUID then
        local ok, value = pcall(Utils.GetIDFromGUID, Utils, guid)
        if ok then id = value end
    end
    return id, name
end

local function QuestItemID(source, index)
    if not GetQuestItemInfo then
        return nil
    end
    local name, _, count, _, _, itemID = GetQuestItemInfo(source, index)
    if not itemID and GetQuestItemLink then
        local link = GetQuestItemLink(source, index)
        itemID = link and tonumber(string.match(link, "item:(%d+)"))
    end
    return itemID, name, count
end

local function AddQuestItems(lines, source, count, seen)
    if not (count and count > 0) then
        return
    end
    for index = 1, count do
        local hidden = IsQuestItemHidden and IsQuestItemHidden(index)
        if hidden ~= 1 then
            local itemID, name, quantity = QuestItemID(source, index)
            if itemID and not seen[itemID] then
                seen[itemID] = true
                local suffix = quantity and quantity > 1 and format(" x%d", quantity) or ""
                AddDiagnostic(lines, "ItemID", tostring(itemID) .. (name and " " .. name or "") .. suffix)
            end
        end
    end
end

local function AddGreetingQuests(lines)
    if GetNumAvailableQuests and GetAvailableTitle and GetAvailableQuestInfo then
        for index = 1, (GetNumAvailableQuests() or 0) do
            local title = GetAvailableTitle(index)
            local _, _, _, _, questID = GetAvailableQuestInfo(index)
            if questID and questID ~= 0 then
                AddDiagnostic(lines, "Available Quest", tostring(questID) .. (title and " " .. title or ""))
            end
        end
    end
    if GetNumActiveQuests and GetActiveTitle and GetActiveQuestID then
        for index = 1, (GetNumActiveQuests() or 0) do
            local title = GetActiveTitle(index)
            local questID = GetActiveQuestID(index)
            if questID and questID ~= 0 then
                AddDiagnostic(lines, "Active Quest", tostring(questID) .. (title and " " .. title or ""))
            end
        end
    end
end

local function AddGossipOptions(lines)
    local options
    if C_GossipInfo and C_GossipInfo.GetOptions then
        options = C_GossipInfo.GetOptions()
    end
    if not options then
        return
    end
    for _, option in ipairs(options) do
        local id = NotSecret(option.gossipOptionID)
        local name = NotSecret(option.name)
        if id then
            AddDiagnostic(lines, "OptionID", tostring(id) .. (name and " " .. name or ""))
        end
    end
end

local function GreetingID(npcID, text)
    if not (npcID and Spoken and Spoken.Contribute and Spoken.Contribute.Checksum) then
        return nil
    end
    local sex = UnitSex and NotSecret(UnitSex("npc"))
    local suffix = sex == 3 and ":f" or ""
    return format("g:%d:%d%s", npcID, Spoken.Contribute:Checksum(text), suffix)
end

local function TextWithDiagnostics(text)
    local lines = {}
    local npcID, npcName = NPCInfo()
    if npcID and npcName then
        AddDiagnostic(lines, "NPC", tostring(npcID) .. " " .. npcName)
    elseif npcName then
        AddDiagnostic(lines, "NPC", npcName)
    end

    local page = Utils and Utils:DialogueUIPage()
    local questID = GetQuestID and NotSecret(GetQuestID())
    local title = GetTitleText and NotSecret(GetTitleText())
    local questPanel = QuestPanelOnScreen()
    local event = questPanel == QuestFrameDetailPanel and "accept"
            or questPanel == QuestFrameProgressPanel and "progress"
            or questPanel == QuestFrameRewardPanel and "complete"
            or page == "QUEST_DETAIL" and "accept"
            or page == "QUEST_PROGRESS" and "progress"
            or page == "QUEST_COMPLETE" and "complete"
    if event then
        if questID and questID ~= 0 then
            AddDiagnostic(lines, "Quest", tostring(questID) .. (title and " " .. title or ""))
        elseif title and title ~= "" then
            AddDiagnostic(lines, "Quest", title)
        end
        AddDiagnostic(lines, "Event", event)

        local seen = {}
        if questID and questID ~= 0 and Spoken and Spoken.QuestItem then
            local itemID, itemName = Spoken:QuestItem(questID)
            if itemID then
                seen[itemID] = true
                AddDiagnostic(lines, "ItemID", tostring(itemID) .. (itemName and " " .. itemName or ""))
            end
        end
        if event == "progress" then
            AddQuestItems(lines, "required", GetNumQuestItems and GetNumQuestItems(), seen)
        elseif event == "complete" then
            AddQuestItems(lines, "choice", GetNumQuestChoices and GetNumQuestChoices(), seen)
            AddQuestItems(lines, "reward", GetNumQuestRewards and GetNumQuestRewards(), seen)
        end
    elseif page == "QUEST_GREETING" or IsFrameVisible(QuestFrameGreetingPanel) then
        AddDiagnostic(lines, "Spoken greeting key", GreetingID(npcID, text))
        AddGreetingQuests(lines)
        AddGossipOptions(lines)
    else
        AddGossipOptions(lines)
        AddDiagnostic(lines, "Spoken greeting key", GreetingID(npcID, text))
    end

    if #lines == 0 then
        return text
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = text
    return table.concat(lines, "\n")
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
    local text = CurrentText()
    if text then
        self:ShowPopup(TextWithDiagnostics(text))
    end
end

function CopyTextButton:PositionStandard(frame)
    local button = self.button
    local compendium = QuestsTab and QuestsTab.giverButton
    if frame == _G.QuestFrame and compendium and compendium:IsShown() then
        if QuestsTab.PositionGiver then
            QuestsTab:PositionGiver()
        end
        button:ClearAllPoints()
        button:SetPoint("RIGHT", compendium, "LEFT", -4, 0)
        return
    end
    local close = CloseButtonOf(frame, frame == _G.QuestFrame and "QuestFrameCloseButton" or "GossipFrameCloseButton")
    button:ClearAllPoints()
    if close then
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

function CopyTextButton:Refresh()
    if not self.button then
        return
    end
    if _G.DUIQuestFrame and IsFrameVisible(_G.DUIQuestFrame) then
        self.button:Hide()
        return
    end

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

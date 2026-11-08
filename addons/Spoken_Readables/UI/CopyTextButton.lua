-- Copy the page on a readable object, with the identifiers needed to report it.

local _, SpokenReadables = ...
local L = SpokenReadables.L
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

local BUTTON_SIZE = 24
local COPY_ICON = "Interface\\Icons\\INV_Misc_ScrollUnrolled01"
local COPY_FRAME = "SpokenReadableCopyTextFrame"

local function AddLine(lines, label, value)
    if value ~= nil and value ~= "" then
        lines[#lines + 1] = format("[%s: %s]", label, tostring(value))
    end
end

local function CurrentText(self)
    local text = ItemTextGetText and NotSecret(ItemTextGetText())
    if type(text) == "string" and text ~= "" then
        return text
    end
    local page = self.lastPage
    if page and self.PageTextIn and self.GetClientLanguage then
        return self:PageTextIn(page, self:GetClientLanguage())
    end
end

local function CurrentPage(self)
    if not self.PageOnScreen then
        return self.lastPage
    end
    local ok, page = pcall(self.PageOnScreen, self)
    return ok and page or self.lastPage
end

local function Diagnostics(self, text)
    local lines = {}
    local seen = {}
    local page = CurrentPage(self)
    local book = page and self.PlaceOf and self:PlaceOf(page)
    local entry = book and self.BookById and self:BookById(book)
    local title = ItemTextGetItem and NotSecret(ItemTextGetItem())
    local number = ItemTextGetPage and NotSecret(ItemTextGetPage()) or nil

    AddLine(lines, "Readable ID", page)
    AddLine(lines, "Book ID", book)
    AddLine(lines, "Title", title or (entry and entry.title))
    AddLine(lines, "Page", number or 1)

    local function AddOpener(kind, id)
        local key = kind .. ":" .. tostring(id)
        if id ~= nil and not seen[key] then
            seen[key] = true
            AddLine(lines, kind == "item" and "Item ID" or "Object ID", id)
        end
    end

    for _, opener in ipairs(self.openedBy or {}) do
        AddOpener(opener.kind, opener.id)
    end
    -- If the addon was loaded after the book opened, openedBy is empty. The live unit GUID is
    -- still the same source DialogueUI uses, so use it as a late fallback for the copy box.
    if UnitGUID and self.ItemIDOfGUID then
        AddOpener("item", self:ItemIDOfGUID(UnitGUID("npc")))
    end

    if self.ChecksumOf then
        local checksumText = text
        if self.Detemplate then
            local ok, detemplated = pcall(self.Detemplate, self, text)
            if ok and type(detemplated) == "string" then checksumText = detemplated end
        end
        AddLine(lines, "Text ID", self:ChecksumOf(checksumText))
    end

    lines[#lines + 1] = ""
    lines[#lines + 1] = text
    return table.concat(lines, "\n")
end

function SpokenReadables:ShowCopyText()
    local text = CurrentText(self)
    if not text then
        return
    end
    if not self.copyPopup then
        local frame = CreateFrame("Frame", COPY_FRAME, UIParent, "BackdropTemplate")
        frame:SetSize(640, 480)
        frame:SetPoint("CENTER")
        frame:SetFrameStrata("DIALOG")
        frame:SetToplevel(true)
        frame:EnableMouse(true)
        frame:SetMovable(true)
        frame:RegisterForDrag("LeftButton")
        frame:SetScript("OnDragStart", frame.StartMoving)
        frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
        frame:SetClampedToScreen(true)
        if UISpecialFrames then table.insert(UISpecialFrames, COPY_FRAME) end
        frame:SetBackdrop({
            bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
            edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
            tile = true,
            tileSize = 32,
            edgeSize = 32,
            insets = { left = 11, right = 12, top = 12, bottom = 11 },
        })
        local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
        title:SetPoint("TOP", frame, "TOP", 0, -16)
        title:SetText(L.COPY_TEXT)
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
        editBox:SetWidth(592)
        editBox:SetHeight(416)
        scroll:SetScrollChild(editBox)
        editBox:SetScript("OnTextChanged", function(box)
            local popup = box:GetParent():GetParent()
            if popup.payload and box:GetText() ~= popup.payload then
                box:SetText(popup.payload)
                box:HighlightText()
            end
        end)
        editBox:SetScript("OnEscapePressed", function(box) box:GetParent():GetParent():Hide() end)
        frame:Hide()
        self.copyPopup = { frame = frame, editBox = editBox }
    end

    local payload = Diagnostics(self, text)
    self.copyPopup.payload = payload
    if Spoken and Spoken.TintDialog then Spoken:TintDialog(self.copyPopup.frame) end
    self.copyPopup.frame:Show()
    self.copyPopup.editBox:SetText(payload)
    self.copyPopup.editBox:SetFocus()
    self.copyPopup.editBox:HighlightText()
end

function SpokenReadables:NewCopyButton(parent)
    if not (Spoken and Spoken.CreateRoundButton) then
        return nil
    end
    local button = Spoken:CreateRoundButton(parent, "icon", nil, COPY_ICON)
    button:SetSize(BUTTON_SIZE, BUTTON_SIZE)
    button:SetScript("OnClick", function() SpokenReadables:ShowCopyText() end)
    button:SetScript("OnEnter", function(self)
        local tip = GameTooltip
        if not tip then return end
        tip:SetOwner(self, "ANCHOR_RIGHT")
        tip:SetText(L.COPY_TEXT)
        tip:Show()
        self.tooltip = tip
    end)
    button:SetScript("OnLeave", function(self)
        if self.tooltip then self.tooltip:Hide() end
    end)
    button:Hide()
    return button
end

function SpokenReadables:RefreshCopyButton()
    local button = self.copyButton
    if not button then return end
    local dialogue = _G.DUIBookFrame
    if dialogue and dialogue.IsShown and dialogue:IsShown() then
        button:Hide()
        return
    end
    local shown = not self:IsMail() and CurrentText(self) ~= nil
    button:SetShown(shown)
end

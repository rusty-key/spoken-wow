setfenv(1, SpokenEnv)

-- A frame holding one envelope, ready to copy.
--
-- Not a StaticPopup, which is what every other copy box in this project is (ReportButton.lua
-- here, UI/CopyLink.lua in books and zones): `hasEditBox` gives one line sized for a character
-- name, and an envelope is a few kilobytes over many lines. So this is a frame of its own with
-- a scrolling, multi-line edit box, and it is the only one -- three addons share it, which is
-- also why it lives in the player.
--
-- The text is selected on show. Making the player select it first is the difference between a
-- payload people send and a payload people look at, and a partial selection is the failure the
-- envelope's checksum exists to catch on the far end.

local WIDTH, HEIGHT = 500, 340

-- The choice's two buttons, side by side along the bottom edge.
local CHOICE_WIDTH = 200      -- the least either is, sized to the English labels
local CHOICE_INSET = 30       -- from the frame's side edges
local CHOICE_GAP = 20         -- the least room kept between the two
local LABEL_PADDING = 24      -- room a button's end caps take either side of its label

local box

local function Build()
    -- "BackdropTemplate" is what carries SetBackdrop on the modern clients, where the mixin
    -- moved out of the base frame; it is simply an unknown template name on the legacy ones,
    -- which still answer SetBackdrop themselves. UI/PlayerFrame.lua and the zones lore window
    -- both pass it for the same reason.
    local frame = CreateFrame("Frame", "SpokenContributeBox", UIParent, "BackdropTemplate")
    frame:SetWidth(WIDTH)
    frame:SetHeight(HEIGHT)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetToplevel(true)
    frame:EnableMouse(true)
    frame:SetMovable(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetClampedToScreen(true)
    -- Without this the envelope draws straight onto the world: white text over grass, which is
    -- what the first player to see this frame reported. The same dialog art the zones lore
    -- window uses, so the two read as one addon.
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
    frame:Hide()

    local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    title:SetPoint("TOP", frame, "TOP", 0, -16)
    title:SetText("Spoken")

    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
    close:SetScript("OnClick", function() frame:Hide() end)

    -- Said once, above the box, because the box itself is a wall of key=value lines and a
    -- player who does not know what to do with it will do nothing with it.
    local hint = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    hint:SetPoint("TOPLEFT", frame, "TOPLEFT", 16, -34)
    hint:SetText(L.OPT_COPY_HINT_PASTE)

    local scroll = CreateFrame("ScrollFrame", "SpokenContributeBoxScroll", frame)
    scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", 16, -56)
    scroll:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -32, 56)

    local editBox = CreateFrame("EditBox", "SpokenContributeBoxEdit", scroll)
    editBox:SetMultiLine(true)
    -- The default is 255 bytes, which would truncate every envelope this frame exists for.
    editBox:SetMaxBytes(0)
    editBox:SetWidth(WIDTH - 60)
    editBox:SetAutoFocus(false)
    if editBox.SetFontObject then
        editBox:SetFontObject(ChatFontNormal)
    end
    scroll:SetScrollChild(editBox)

    local address = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    address:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 16, 20)

    -- Read-only in effect rather than in fact: a box that refuses input cannot be selected
    -- with the mouse. Accept the keystroke and undo it, as the report popup does.
    editBox:SetScript("OnTextChanged", function(self)
        self = self or this
        if box and box.payload and self:GetText() ~= box.payload then
            self:SetText(box.payload)
            self:HighlightText()
        end
    end)
    editBox:SetScript("OnEscapePressed", function(self)
        (self or this):GetParent():GetParent():Hide()
    end)

    -- The first-click choice and the gathering instructions: prose in place of the box, since
    -- neither has anything to copy.
    local body = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    body:SetPoint("TOPLEFT", frame, "TOPLEFT", 20, -40)
    body:SetWidth(WIDTH - 40)
    body:SetJustifyH("LEFT")
    body:SetJustifyV("TOP")
    body:Hide()

    local justThis = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    justThis:SetHeight(24)
    justThis:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", CHOICE_INSET, 20)
    justThis:SetText(L.CONTRIBUTE_JUST_THIS)
    justThis:Hide()

    local gather = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
    gather:SetHeight(24)
    gather:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -CHOICE_INSET, 20)
    gather:SetText(L.CONTRIBUTE_GATHER)
    gather:Hide()

    -- One width for both, fitted to the longer label, so the pair stays a matched set in
    -- every language. A translation long enough that the two would meet widens the frame
    -- rather than letting them overlap, and the box and the prose widen with it.
    local choiceWidth = math.max(CHOICE_WIDTH,
        (justThis:GetTextWidth() or 0) + LABEL_PADDING,
        (gather:GetTextWidth() or 0) + LABEL_PADDING)
    justThis:SetWidth(choiceWidth)
    gather:SetWidth(choiceWidth)
    local frameWidth = math.max(WIDTH, 2 * (choiceWidth + CHOICE_INSET) + CHOICE_GAP)
    frame:SetWidth(frameWidth)
    editBox:SetWidth(frameWidth - 60)
    body:SetWidth(frameWidth - 40)

    return { frame = frame, editBox = editBox, address = address, title = title, hint = hint,
        scroll = scroll, body = body, justThis = justThis, gather = gather }
end

-- Which of the box's three faces is up: the payload to copy, or prose with or without the
-- choice under it.
local function Face(prose, choice)
    box.body:SetShown(prose)
    box.hint:SetShown(not prose)
    box.scroll:SetShown(not prose)
    box.address:SetShown(not prose)
    box.justThis:SetShown(choice)
    box.gather:SetShown(choice)
end

-- The folder the saved variables live under, as far as the client can tell. Named rather
-- than left as a placeholder because hunting for the right one of four is where a player
-- gives up; a guess that is wrong on some install is still a better start than none.
local function GameFolder()
    if Version.IsCamelot then
        return "_classic_beta_"
    elseif Version.IsRetailMainline then
        return "_retail_"
    elseif Version.IsRetailVanilla then
        return "_classic_era_ (or _anniversary_)"
    end
    return "<your game folder>"
end

local function EnsureBox()
    box = box or Build()
    Spoken.ContributeBox = box
end

local function ShowPayload(payload, address, isLink)
    EnsureBox()
    Face(false, false)
    -- Shown before the focus is asked for: a hidden edit box ignores SetFocus, so the first
    -- time the box opened, the keyboard stayed with the game and a Cmd+C straight away copied
    -- nothing. Only a box that was already up -- the second contribution, or "Just this one"
    -- -- ever had it.
    box.frame:Show()
    box.payload = payload
    box.editBox:SetText(payload)
    box.editBox:SetFocus()
    box.editBox:HighlightText()
    if isLink then
        -- The link already carries the address in it (https://.../contribute#e1=...), so a
        -- second line repeating just the host would tell the player nothing the payload above
        -- doesn't already say.
        box.hint:SetText(L.OPT_COPY_HINT_LINK)
        box.address:SetText("")
    else
        box.hint:SetText(L.OPT_COPY_HINT_PASTE)
        box.address:SetText(address or "")
    end
end

-- Prose in place of the payload, with or without the first-click choice under it. Nothing to
-- copy, so no payload for OnTextChanged to restore.
local function ShowProse(text, choice)
    EnsureBox()
    Face(true, choice)
    box.payload = nil
    box.body:SetText(text)
    box.frame:Show()
end

--- Any text to copy, under a hint of the caller's own. The taint report uses the box too: it
--- is the one multi-line copy box there is.
function Spoken:ShowCopyText(text, hint)
    ShowPayload(text, "", false)
    box.hint:SetText(hint)
end

--- How to send what was gathered. Also what "How to send them" in the settings and
--- /spoken share open, so the steps are never only in a window the player closed.
function Spoken:ShowGatherInstructions()
    ShowProse(format(L.GATHER_INSTRUCTIONS, Gather:Count(), GameFolder()), false)
end

--- Show something ready to copy: a contribute link, or (isLink falsy) the raw envelope plus
--- the address to paste it into -- the fallback an older bundled player still gets, since a
--- legacy-client zip can carry a SpokenPlayer that predates Encode/Link entirely.
---
--- `gather`, when a feature addon passes it, is the line on screen as Gather keeps it:
--- { key = ..., envelope = ... }. On the first click ever, it turns the box into a choice
--- between sending this one line and gathering in the background. Zones pass none: a place's
--- contribution is the description the player writes on the site, which nothing can gather.
---@return boolean shown  False when there is nothing to show, so a caller can stay quiet.
function Spoken:ShowContribution(payload, address, isLink, gather)
    if type(payload) ~= "string" or payload == "" then
        return false
    end

    if type(gather) == "table" and Gather and not Gather:IsIntroduced() then
        ShowProse(L.CONTRIBUTE_INTRO, true)
        box.justThis:SetScript("OnClick", function()
            Gather:SetIntroduced()
            ShowPayload(payload, address, isLink)
        end)
        box.gather:SetScript("OnClick", function()
            Gather:SetIntroduced()
            Gather:SetEnabled(true)
            Gather:Add(gather.key, gather.envelope)
            Spoken:ShowGatherInstructions()
        end)
        return true
    end

    ShowPayload(payload, address, isLink)
    return true
end

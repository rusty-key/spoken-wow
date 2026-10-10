setfenv(1, VoiceOver)
local L = SpokenEnv.L

-- The Contribute button, on the Blizzard quest frame itself.
--
-- Modeled on SpokenBooks/UI/PlayButton.lua, the closest precedent in this repo for a button
-- the game's own frame has to host because ours cannot. There the reason is that the book
-- addon has no player frame of its own at all; here the reason is narrower but just as final:
-- this button's whole precondition, Contribute:HasGap(), is true exactly when nothing was
-- ever queued (see Contribute.lua's HasSoundForCurrent), so the Spoken player frame -- whose
-- action row is where ReportButton's own button lives, registered by Player.lua -- is hidden
-- the entire time this button needs to be shown (UI/PlayerFrame.lua in the player addon:
-- `if not clip then self:Hide(); return end`). There is no clip to decorate, so there is no
-- player-frame action row to add a second action to. What is left, and what already carries
-- ReportButton's own copy-link popup for exactly this reason, is the game's own frame.
--
-- A TEXT button, not an icon, for PlayButton.lua's reason, unchanged: an icon path cannot be
-- verified without launching the client, and a texture missing on a legacy client
-- draws nothing at all -- an invisible button is a worse failure than a plain one.
--
-- Hidden rather than disabled when there is nothing to send, for PlayButton.lua's reason,
-- unchanged: a greyed-out button on every quest and every NPC this client has no line for is
-- a permanent invitation to wonder what's broken; an absent one says there is nothing to do.
--
-- DialogueUI hides UIParent while its window is open, so that window gets a corner of its own
-- under its Decline button: a faint Report icon, or for a line no pack has, a Contribute link.

local BUTTON_HEIGHT = 20
local BUTTON_WIDTH = 90
local GAP = 2
-- From the close button's bottom edge down into the middle of the strip under the title bar.
local STRIP_OFFSET = 12
local CORNER_INSET = 32
-- Fallback margins under and beside DialogueUI's footer buttons: its bottom (36) and side (26)
-- paddings at its default size (1.1).
local DUI_FOOTER_MARGIN = 40
local DUI_SIDE_MARGIN = 29
local DUI_LINK_HEIGHT = 16
-- The Report icon stays faint until hovered, since a bug is the rare case. Icon and words are
-- smaller than DialogueUI's to fit above the curl of the parchment's foot.
local DUI_ICON = 16
local DUI_TEXT_SCALE = 0.9
local DUI_REPORT_ALPHA = 0.4
-- Hung just under the footer buttons, not centred in the margin: its lower half is the
-- parchment's curled edge.
local DUI_ICON_GAP = 4
-- The red of DialogueUI's Accept button art (Art/Theme_*/OptionBackground-Common.png), lifted
-- on the dark theme, where the art's (135, 27, 26) is too dark to read as small text on black.
local DUI_RED_ON_LIGHT = { 0.467, 0.161, 0.078 }
local DUI_RED_ON_DARK = { 0.85, 0.22, 0.2 }

-- The events that flip a quest or gossip panel on or off, on every client generation this
-- addon targets -- not a timer. VoiceOver.lua's own OnInitialize already pays for
-- registering exactly these seven, unconditionally: QUEST_DETAIL/PROGRESS/COMPLETE/FINISHED
-- on its dedicated recorder frame, and QUEST_GREETING/GOSSIP_SHOW/GOSSIP_CLOSED on its
-- direct-event frame. Listening for the same seven here, on a second frame of our own, costs
-- nothing that isn't already being paid, mirrors how PlayButton.lua refreshes off
-- ITEM_TEXT_READY/ITEM_TEXT_CLOSED rather than a poll, and needs no timer of its own.
local REFRESH_EVENTS = {
    "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_GREETING",
    "GOSSIP_SHOW", "GOSSIP_CLOSED", "QUEST_FINISHED",
}

ContributeButton = {}

-- A copy of VoiceOver.lua's helper of the same name, which is a local there and so not
-- reachable from this file -- the same reason ReportButton.lua and Player.lua each carry
-- their own copy rather than sharing one.
local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

--- Which of the three NPC quest panels is on screen, the same priority Contribute:Capture
--- and ReportButton:CurrentTarget both use.
local function QuestPanelOnScreen()
    if IsFrameVisible(QuestFrameRewardPanel) then
        return QuestFrameRewardPanel
    elseif IsFrameVisible(QuestFrameProgressPanel) then
        return QuestFrameProgressPanel
    elseif IsFrameVisible(QuestFrameDetailPanel) then
        return QuestFrameDetailPanel
    end
end

-- A frame's close button, under whichever of its two names this client uses: a parentKey on
-- the modern frames (ButtonFrameTemplate's CloseButton) and a global on the older ones.
-- `type(...) == "table"` rather than truthiness for the reason the test stub gives: its generic
-- frame answers any unset capitalised field with a callable stand-in rather than nil.
local function CloseButtonOf(frame, global)
    if frame and type(frame.CloseButton) == "table" then
        return frame.CloseButton
    end
    return _G[global]
end

-- How far the quest log's details Play sits from its panel's right edge: it mirrors the Back
-- button's left inset (Compatibility.lua's UpdateDetailsPlayButton), so read it off the same
-- button, and fall back to the number that anchor falls back to.
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

--- Place the button in `frame`'s top right corner, in the empty strip under the title bar: just
--- below the close button, and as far in from the frame's right edge as the quest log's details
--- Play is from its own, so the two read as the same control. On the title bar itself, beside
--- the close button, it ran into the NPC's name. Inset from the corner when the client draws no
--- close button this file can find. False only when there is no frame to place it on.
function ContributeButton:PositionAtCorner(frame, close)
    if not frame then
        return false
    end
    local button = self.button
    button:ClearAllPoints()
    button:SetWidth(BUTTON_WIDTH)
    local frameTop, closeBottom = frame.GetTop and frame:GetTop(), close and close.GetBottom and close:GetBottom()
    if type(frameTop) == "number" and type(closeBottom) == "number" then
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -PlayButtonInset(), -(frameTop - closeBottom + STRIP_OFFSET))
    elseif close then
        -- Not laid out yet, so no edges to measure: under the close button, right-aligned with it.
        button:SetPoint("TOPRIGHT", close, "BOTTOMRIGHT", -GAP, -STRIP_OFFSET)
    else
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET)
    end
    return true
end

local function OnClick()
    Contribute:Show()
end

local function OnEnter(self)
    Contribute:ShowTooltip(self, ContributeButton.gossip)
end

local function OnLeave()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

--- Report what DialogueUI's window shows, in the language its line would be heard in.
function ContributeButton:ReportFromDialogueUI()
    local target = ReportButton:CurrentTarget()
    if not target then
        return
    end
    -- Asked of the module whose page it is, quests or gossip, through the bridge.
    local bridge = rawget(VoiceOver, "DialogueUIBridge")
    local ok, line = pcall(function() return bridge and bridge.LineFor and bridge:LineFor(Utils:DialogueUIPage()) end)
    ReportButton:ShowLink(target, ok and line and line.language or nil)
end

--- The game's tooltip is a child of UIParent, which DialogueUI hides, so its window gets its
--- own, scaled to the size the game's would be.
function ContributeButton:DialogueUITooltip(frame)
    local tooltip = self.tooltip
    if not tooltip then
        tooltip = CreateFrame("GameTooltip", "SpokenQuestsDialogueUITooltip", frame, "GameTooltipTemplate")
        tooltip:SetFrameStrata("TOOLTIP")
        self.tooltip = tooltip
    end
    tooltip:SetScale(UIParent:GetEffectiveScale() / frame:GetEffectiveScale())
    return tooltip
end

--- The icon and words are children of the window, so they show while DialogueUI hides UIParent
--- and close with it. Nil with a player too old to draw the icon.
function ContributeButton:DialogueUICorner(frame)
    local corner = self.corner
    if corner then
        return corner
    end
    if not (_G.Spoken and Spoken.CreateRoundButton) then
        return nil
    end
    local icon = Spoken:CreateRoundButton(frame, "report")
    icon:SetFrameStrata("FULLSCREEN")
    icon:SetSize(DUI_ICON, DUI_ICON)
    local link = CreateFrame("Button", nil, frame)
    link:SetFrameStrata("FULLSCREEN")
    link:SetHeight(DUI_LINK_HEIGHT)
    link:SetPoint("RIGHT", icon, "LEFT", -4, 0)
    local label = link:CreateFontString(nil, "OVERLAY")
    label:SetFontObject(_G.DUIFont_QuestType_Left or GameFontNormalSmall)
    label:SetPoint("RIGHT", link, "RIGHT", 0, 0)
    label:SetText(L.DIALOGUE_CONTRIBUTE_NO_VO)
    if label.SetTextScale then
        label:SetTextScale(DUI_TEXT_SCALE)
    end
    link.label = label
    corner = { icon = icon, link = link }

    local function Click()
        if corner.missing then
            Contribute:Show()
        else
            ContributeButton:ReportFromDialogueUI()
        end
    end
    local function Enter(owner)
        icon:SetAlpha(1)
        local tooltip = ContributeButton:DialogueUITooltip(frame)
        if corner.missing then
            Contribute:ShowTooltip(owner, ContributeButton.gossip, tooltip)
        else
            tooltip:SetOwner(owner, "ANCHOR_RIGHT")
            tooltip:SetText(L.DIALOGUE_REPORT_PROBLEM)
            tooltip:AddLine(L.DIALOGUE_REPORT_LINE_TIP, 1, 0.8, 0.2, true)
            tooltip:Show()
        end
    end
    local function Leave()
        icon:SetAlpha(corner.missing and 1 or DUI_REPORT_ALPHA)
        if ContributeButton.tooltip then
            ContributeButton.tooltip:Hide()
        end
    end
    -- Hooked on the icon to keep its own hover glow; the words have none to keep.
    icon:SetScript("OnClick", Click)
    icon:HookScript("OnEnter", Enter)
    icon:HookScript("OnLeave", Leave)
    link:SetScript("OnClick", Click)
    link:SetScript("OnEnter", Enter)
    link:SetScript("OnLeave", Leave)
    icon:Hide()
    link:Hide()
    self.corner = corner
    return corner
end

--- Show the corner under DialogueUI's Decline (or Goodbye) button, right-aligned with it: the
--- faint Report icon, or with `missing`, the icon in full and the words to contribute.
function ContributeButton:ShowOnDialogueUI(frame, missing)
    local corner = self:DialogueUICorner(frame)
    if not corner then
        return
    end
    local icon, link = corner.icon, corner.link
    corner.missing = missing and true or false
    local red = Utils:DialogueUIThemeID() == 2 and DUI_RED_ON_DARK or DUI_RED_ON_LIGHT
    link.label:SetTextColor(red[1], red[2], red[3])
    -- Sized to the words, since DialogueUI's font size setting changes them.
    link:SetWidth((link.label:GetStringWidth() or 0) + 2)
    -- Measured from the footer button, since DialogueUI's window size setting changes the margins.
    local below, beside = DUI_FOOTER_MARGIN, DUI_SIDE_MARGIN
    local footer = frame.ExitButton
    if type(footer) == "table" and footer.GetBottom and frame.GetBottom then
        local bottom, frameBottom = footer:GetBottom(), frame:GetBottom()
        if type(bottom) == "number" and type(frameBottom) == "number" and bottom > frameBottom then
            below = bottom - frameBottom
        end
        local right, frameRight = footer:GetRight(), frame:GetRight()
        if type(right) == "number" and type(frameRight) == "number" and frameRight > right then
            beside = frameRight - right
        end
    end
    icon:ClearAllPoints()
    icon:SetPoint("RIGHT", frame, "BOTTOMRIGHT", -beside, below - DUI_ICON_GAP - DUI_ICON / 2)
    icon:SetAlpha(corner.missing and 1 or DUI_REPORT_ALPHA)
    icon:Show()
    if corner.missing then
        link:Show()
    else
        link:Hide()
    end
end

function ContributeButton:HideOnDialogueUI()
    if self.tooltip then
        self.tooltip:Hide()
    end
    if self.corner then
        self.corner.icon:Hide()
        self.corner.link:Hide()
    end
end

--- Show, hide and place the button for whatever is on screen now. Parented to UIParent, not
--- to QuestFrame or GossipFrame: whichever of those two is relevant is the one hidden while
--- the other is up, and a child cannot be visible while its ancestor is not. Positioning
--- still tracks the right one, through SetPoint's relativeTo, which does not require a shared
--- parent.
function ContributeButton:Refresh()
    local button = self.button
    if not button then
        return
    end
    -- The module the window belongs to must be switched on: Quests for a quest, Gossip for what
    -- an NPC says (gossip and quest-giver greetings). DialogueUI hides Blizzard's panels, so on
    -- its window the page it shows says which.
    local page = Utils:DialogueUIPage()
    local questWindow = QuestPanelOnScreen()
    local gossipPage
    if page then
        gossipPage = page == "GOSSIP_SHOW" or page == "QUEST_GREETING"
    else
        gossipPage = not questWindow
    end
    if Spoken and Spoken.IsPartOn and not Spoken:IsPartOn(gossipPage and "gossip" or "quests") then
        button:Hide()
        self:HideOnDialogueUI()
        return
    end

    -- DialogueUI's window: the corner is there on every page, Report or Contribute, Report
    -- unless Hide Report Buttons is on.
    if page then
        button:Hide()
        self.gossip = gossipPage
        local missing = Contribute:HasGap()
        local reportHidden = _G.Spoken and Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden()
        if missing or not reportHidden then
            self:ShowOnDialogueUI(_G.DUIQuestFrame, missing)
        else
            self:HideOnDialogueUI()
        end
        return
    end
    self:HideOnDialogueUI()

    if not Contribute:HasGap() then
        button:Hide()
        return
    end

    local placed
    if questWindow then
        self.gossip = false
        placed = self:PositionAtCorner(_G.QuestFrame, CloseButtonOf(_G.QuestFrame, "QuestFrameCloseButton"))
    else
        self.gossip = true
        placed = self:PositionAtCorner(_G.GossipFrame, CloseButtonOf(_G.GossipFrame, "GossipFrameCloseButton"))
    end
    if placed then
        button:Show()
    else
        button:Hide()
    end
end

--- Build the button and its event frame, once, parented to UIParent so its own visibility
--- never depends on QuestFrame's or GossipFrame's.
function ContributeButton:Setup()
    if self.button then
        return self.button
    end
    if not CreateFrame then
        return nil
    end

    local button = CreateFrame("Button", nil, UIParent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    -- "Contribute", not "No voice -- contribute": the long form was the first thing a player
    -- said was wrong about this button, and it has to share a row with Blizzard's own controls.
    -- The books addon's button already says exactly this word, so the two now match.
    button:SetText(L.DIALOGUE_CONTRIBUTE)
    if button.SetFrameStrata then
        -- DIALOG rather than a verified match for QuestFrame's or GossipFrame's own strata --
        -- this file did not check what either actually is (neither Vanilla/QuestFrame.xml,
        -- TBC/QuestFrame.xml nor the two GossipFrame.xml files declare frameStrata inline, so
        -- it comes from a template or from Lua this change did not chase down). DIALOG is
        -- above every ordinary game panel, which is what "reads as part of whichever frame is
        -- open" actually needs.
        button:SetFrameStrata("DIALOG")
    end
    button:Hide()

    button:SetScript("OnClick", OnClick)
    button:SetScript("OnEnter", OnEnter)
    button:SetScript("OnLeave", OnLeave)
    Contribute:OfferLogMenu(button)

    self.button = button

    -- The refresh frame. Ignores its own event argument entirely -- every one of
    -- REFRESH_EVENTS means only "something may have changed," so there is nothing to read out
    -- of it, which sidesteps 1.12's OnEvent calling convention (no arguments; the event name
    -- arrives in the global `event` instead) rather than having to account for it.
    local watcher = CreateFrame("Frame")
    for _, event in ipairs(REFRESH_EVENTS) do
        pcall(watcher.RegisterEvent, watcher, event)
    end
    watcher:SetScript("OnEvent", function()
        -- Also what drives gathering: HasGap, which Refresh asks, keeps the line when the
        -- player opted in, so these seven events are the only ones gathering needs.
        ContributeButton:Refresh()
    end)
    self.watcher = watcher

    -- Walking away, or another window taking the screen, closes these frames without any of
    -- the events above, so hear about it from the frames themselves.
    for _, name in ipairs({ "QuestFrame", "GossipFrame" }) do
        local host = _G[name]
        if type(host) == "table" and host.HookScript then
            host:HookScript("OnHide", function()
                ContributeButton:Refresh()
            end)
        end
    end

    -- The hide setting lives in the Spoken settings, and toggling it fires no game
    -- event, so the button hears about it from the player instead.
    if _G.Spoken and Spoken.RegisterCallback then
        Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
            ContributeButton:Refresh()
        end)
        Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function()
            ContributeButton:Refresh()
        end)
    end

    return button
end

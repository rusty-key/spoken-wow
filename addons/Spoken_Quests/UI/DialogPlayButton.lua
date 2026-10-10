setfenv(1, VoiceOver)

-- The Listen/Stop button on the Blizzard quest and gossip frames, for a player who turned
-- autoplay off. "Do not start by yourself" must not mean "give me no way to start it", and /spq read is
-- not a way most players will find -- the reason SpokenBooks/UI/PlayButton.lua exists too.
--
-- Shown only while autoplay is off. With it on the line is already playing by the time the
-- dialog has settled, and the Spoken player frame is where it is stopped.
--
-- A TEXT button, not an icon, for PlayButton.lua's reason: an icon path cannot be verified
-- without launching the client, and a texture missing on a legacy client draws
-- nothing at all.
--
-- IN THE CORNER UI/ContributeButton.lua uses, under the close button, on whichever of the two
-- frames is up. The two buttons never want it at once: Contribute is shown only for a line the
-- packs do not have, and this only for one they do. Contribute.xml is not loaded on the legacy clients, so the placement is
-- copied here rather than borrowed from it.
--
-- Not drawn under a replacement dialog addon: DialogueUI hides QuestFrame and GossipFrame, and
-- a button parented to UIParent would float over nothing. /spq read still works there.

local BUTTON_HEIGHT = 20
local BUTTON_WIDTH = 60
-- Room the button's end caps take either side of its label.
local LABEL_PADDING = 24
local GAP = 2
local STRIP_OFFSET = 12
local CORNER_INSET = 32

-- The events that change which panel is up, ContributeButton.lua's seven. Ignored as
-- arguments, for its reason: 1.12 hands OnEvent none.
local REFRESH_EVENTS = {
    "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_GREETING",
    "GOSSIP_SHOW", "GOSSIP_CLOSED", "QUEST_FINISHED",
}

-- What changes whether the dialog's line is playing, which no game event reports. They fire
-- for every Spoken addon's clips, so they only relabel the line already found.
local CLIP_EVENTS = { "CLIP_QUEUED", "CLIP_STARTED", "CLIP_STOPPED", "CLIP_DROPPED" }

DialogPlayButton = {}

-- The Blizzard panel each event is drawn on. VoiceOver.lua's GetVisibleQuestEvent also answers
-- from the quest log or the last event when no panel is up, and there is no window to put a
-- button on then.
local PANELS = {
    QUEST_DETAIL = "QuestFrameDetailPanel",
    QUEST_PROGRESS = "QuestFrameProgressPanel",
    QUEST_COMPLETE = "QuestFrameRewardPanel",
    QUEST_GREETING = "QuestFrameGreetingPanel",
    GOSSIP_SHOW = "GossipFrame",
}

--- Widen the button to fit the widest label it will ever show, never below BUTTON_WIDTH.
--- Measured once over both labels rather than on each SetText, so flipping between Play
--- and Stop keeps one width. BUTTON_WIDTH was sized to the English labels; a translated one
--- can be twice as long. Anchored TOPRIGHT, so it grows into the frame, not off it.
local function FitToLabels(button, labels)
    local widest = 0
    for _, label in ipairs(labels) do
        button:SetText(label)
        widest = math.max(widest, button:GetTextWidth())
    end
    button:SetWidth(math.max(BUTTON_WIDTH, widest + LABEL_PADDING))
end

local function Refresh() DialogPlayButton:Refresh() end
local function Relabel() DialogPlayButton:Relabel() end

-- A copy of VoiceOver.lua's helper of the same name, which is a local there.
local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end


-- ContributeButton.lua's CloseButtonOf and PlayButtonInset, for the reason in the header.
local function CloseButtonOf(frame, global)
    if frame and type(frame.CloseButton) == "table" then
        return frame.CloseButton
    end
    return _G[global]
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

function DialogPlayButton:Position(frameName)
    local frame = _G[frameName]
    local close = CloseButtonOf(frame, frameName .. "CloseButton")
    local button = self.button
    button:ClearAllPoints()
    local frameTop, closeBottom = frame.GetTop and frame:GetTop(), close and close.GetBottom and close:GetBottom()
    if type(frameTop) == "number" and type(closeBottom) == "number" then
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -PlayButtonInset(), -(frameTop - closeBottom + STRIP_OFFSET))
    elseif close then
        button:SetPoint("TOPRIGHT", close, "BOTTOMRIGHT", -GAP, -STRIP_OFFSET)
    else
        button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -CORNER_INSET, -CORNER_INSET)
    end
end

--- Show, hide and label the button for whatever is on screen now. Hidden rather than
--- disabled for a quest with no line, for ContributeButton.lua's reason: a greyed-out button
--- invites the player to wonder what is broken.
function DialogPlayButton:Refresh()
    local button = self.button
    if not button then
        return
    end
    self.line = nil

    if Addon:IsAutoplayOn() or not Addon:IsPartOn() then
        button:Hide()
        return
    end
    local line, event = Addon:GetVisibleLine()
    -- The panel itself, not merely the event: under DialogueUI the event arrives and the
    -- panel never shows.
    if not line or not IsFrameVisible(_G[PANELS[event]]) then
        button:Hide()
        return
    end

    self:Position(event == "GOSSIP_SHOW" and "GossipFrame" or "QuestFrame")
    self.line = line
    self:Relabel()
    button:Show()
end

--- Listen or Stop, for the line already found. All a clip starting or stopping can change.
function DialogPlayButton:Relabel()
    if self.line then
        self.button:SetText(Player:QueuedClipFor(self.line) and L.OPT_STOP or L.OPT_LISTEN)
    end
end

function DialogPlayButton:OnClick()
    self:Refresh()
    if not self.line then
        return
    end
    local clip = Player:QueuedClipFor(self.line)
    -- The label follows from the CLIP_ callbacks either of these fires.
    if clip then
        Player:Remove(clip)
    else
        Addon:ReadVisibleQuest("dialog Play button")
    end
end

--- Build the button and what keeps it current, once. Parented to UIParent for
--- ContributeButton.lua's reason, so its strata is its own.
function DialogPlayButton:Setup()
    if self.button or not CreateFrame then
        return
    end

    local button = CreateFrame("Button", nil, UIParent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    FitToLabels(button, { L.OPT_LISTEN, L.OPT_STOP })
    button:SetText(L.OPT_LISTEN)
    if button.SetFrameStrata then
        button:SetFrameStrata("DIALOG")
    end
    button:Hide()

    button:SetScript("OnClick", function()
        DialogPlayButton:OnClick()
    end)
    button:SetScript("OnEnter", function(self)
        if not GameTooltip then
            return
        end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        if self:GetText() == L.OPT_STOP then
            GameTooltip:SetText(L.OPT_DIALOG_STOP_TIP)
        else
            GameTooltip:SetText(L.OPT_READ_TIP)
            GameTooltip:AddLine(L.OPT_AUTOPLAY_OFF_TIP, 1, 0.8, 0.2, true)
        end
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function()
        if GameTooltip then
            GameTooltip:Hide()
        end
    end)
    self.button = button

    local watcher = CreateFrame("Frame")
    for _, event in ipairs(REFRESH_EVENTS) do
        pcall(watcher.RegisterEvent, watcher, event)
    end
    watcher:SetScript("OnEvent", function()
        DialogPlayButton:Refresh()
        -- Again a moment later: a Classic quest event can arrive before GetQuestID and the
        -- text globals change (VoiceOver.lua's directEvents comment), and the first look
        -- would label the previous quest. Not with autoplay on, when there is no button.
        if Addon.ScheduleTimer and not Addon:IsAutoplayOn() then
            Addon:ScheduleTimer(Refresh, 0.2)
        end
    end)

    -- Walking away closes the frame without any of the events above, as ContributeButton.lua
    -- found for its own button.
    for _, name in ipairs({ "QuestFrame", "GossipFrame" }) do
        local host = _G[name]
        if type(host) == "table" and host.HookScript then
            host:HookScript("OnHide", Refresh)
        end
    end

    if _G.Spoken and Spoken.RegisterCallback then
        for _, event in ipairs(CLIP_EVENTS) do
            Spoken:RegisterCallback(event, Relabel)
        end
    end
end

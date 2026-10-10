setfenv(1, VoiceOver)

-- The Listen/Stop button on the Blizzard NPC windows, for a player whose module does not read
-- them by itself: quests with autoplay off, gossip at Never. "Do not start by yourself" must not
-- mean "give me no way to start it", and a slash command is not a way most players will find --
-- the reason SpokenBooks/UI/PlayButton.lua exists too.
--
-- One per module, each for its own windows (DialoguePlayButton:New). Shown only while its module
-- would not read the window itself: otherwise the line is already playing by the time the window
-- has settled, and the Spoken player frame is where it is stopped.
--
-- A TEXT button, not an icon, for PlayButton.lua's reason: an icon path cannot be verified
-- without launching the client, and a texture missing on a legacy client draws nothing at all.
--
-- IN THE CORNER ContributeButton.lua uses, under the close button, on whichever frame is up. The
-- two buttons never want it at once: Contribute is shown only for a line the packs do not have,
-- and this only for one they do. ContributeButton.lua is not loaded on the legacy clients, so the
-- placement is copied here rather than borrowed from it.
--
-- Not drawn under a replacement dialog addon: DialogueUI hides QuestFrame and GossipFrame, and
-- a button parented to UIParent would float over nothing.
local L = SpokenEnv.L

local BUTTON_HEIGHT = 20
local BUTTON_WIDTH = 60
-- Room the button's end caps take either side of its label.
local LABEL_PADDING = 24
local GAP = 2
local STRIP_OFFSET = 12
local CORNER_INSET = 32

-- What changes whether the window's line is playing, which no game event reports. They fire
-- for every Spoken addon's clips, so they only relabel the line already found.
local CLIP_EVENTS = { "CLIP_QUEUED", "CLIP_STARTED", "CLIP_STOPPED", "CLIP_DROPPED" }

-- Every page of an NPC window, whichever module reads it. QuestFrame stays shown while its page
-- turns from greeting to quest and back, so a button refreshed only on its own pages' events
-- stayed on the next module's page. Refresh checks its own panel, so another's page hides it.
local WINDOW_EVENTS = { "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_GREETING",
    "GOSSIP_SHOW", "QUEST_FINISHED", "GOSSIP_CLOSED" }

DialoguePlayButton = {}
local Methods = {}

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

--- A button for one module's windows. `spec`:
---   panels   event -> the Blizzard panel it is drawn on, for the events this module reads
---   frames   the windows it sits on, "QuestFrame" and/or "GossipFrame"
---   frameFor fun(event): the window to sit on for `event`
---   wanted   fun(): whether the module wants the button now (part on, not reading by itself)
---   line     fun(): the window's line resolved against the packs, and its event, or nil
---   queued   fun(): the module's clips in the queue
---   remove   fun(clip)
---   read     fun(): read the window's line now
---   offTip   the tooltip's second line, saying why the window did not read itself
---   later    fun(fn, seconds): call fn after a moment
function DialoguePlayButton:New(spec)
    return setmetatable({ spec = spec, refreshEvents = WINDOW_EVENTS }, { __index = Methods })
end

function Methods:Position(frameName)
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

--- The queued clip reading the window's line, or nil. Matched by file rather than by the
--- SoundData the handler built, so a line started from the quest log counts too.
function Methods:QueuedClipFor(line)
    for _, clip in ipairs(self.spec.queued()) do
        if clip.fileName == line.fileName then
            return clip
        end
    end
end

--- Show, hide and label the button for whatever is on screen now. Hidden rather than
--- disabled for a window with no line, for ContributeButton.lua's reason: a greyed-out button
--- invites the player to wonder what is broken.
function Methods:Refresh()
    local button = self.button
    if not button then
        return
    end
    self.line = nil

    if not self.spec.wanted() then
        button:Hide()
        return
    end
    local line, event = self.spec.line()
    -- The panel itself, not merely the event: under DialogueUI the event arrives and the
    -- panel never shows.
    local panel = event and self.spec.panels[event]
    if not line or not panel or not IsFrameVisible(_G[panel]) then
        button:Hide()
        return
    end

    self:Position(self.spec.frameFor(event))
    self.line = line
    self:Relabel()
    button:Show()
end

--- Listen or Stop, for the line already found. All a clip starting or stopping can change.
function Methods:Relabel()
    if self.line then
        self.button:SetText(self:QueuedClipFor(self.line) and L.DIALOGUE_STOP or L.DIALOGUE_LISTEN)
    end
end

function Methods:OnClick()
    self:Refresh()
    if not self.line then
        return
    end
    local clip = self:QueuedClipFor(self.line)
    -- The label follows from the CLIP_ callbacks either of these fires.
    if clip then
        self.spec.remove(clip)
    else
        self.spec.read()
    end
end

--- Build the button and what keeps it current, once. Parented to UIParent for
--- ContributeButton.lua's reason, so its strata is its own.
function Methods:Setup()
    if self.button or not CreateFrame then
        return
    end
    -- Not `this`: that is the global the legacy clients' script handlers read.
    local me = self

    local button = CreateFrame("Button", nil, UIParent, "UIPanelButtonTemplate")
    button:SetHeight(BUTTON_HEIGHT)
    FitToLabels(button, { L.DIALOGUE_LISTEN, L.DIALOGUE_STOP })
    button:SetText(L.DIALOGUE_LISTEN)
    if button.SetFrameStrata then
        button:SetFrameStrata("DIALOG")
    end
    button:Hide()

    button:SetScript("OnClick", function()
        me:OnClick()
    end)
    button:SetScript("OnEnter", function(owner)
        if not GameTooltip then
            return
        end
        GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
        if owner:GetText() == L.DIALOGUE_STOP then
            GameTooltip:SetText(L.DIALOGUE_STOP_TIP)
        else
            GameTooltip:SetText(L.DIALOGUE_READ_TIP)
            GameTooltip:AddLine(me.spec.offTip, 1, 0.8, 0.2, true)
        end
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function()
        if GameTooltip then
            GameTooltip:Hide()
        end
    end)
    self.button = button

    local function Refresh() me:Refresh() end
    local watcher = CreateFrame("Frame")
    for _, event in ipairs(self.refreshEvents) do
        pcall(watcher.RegisterEvent, watcher, event)
    end
    -- Ignored as arguments: 1.12 hands OnEvent none.
    watcher:SetScript("OnEvent", function()
        me:Refresh()
        -- Again a moment later: a Classic quest event can arrive before GetQuestID and the
        -- text globals change, and the first look would label the previous quest. Not while the
        -- module reads the window itself, when there is no button.
        if me.spec.wanted() then
            me.spec.later(Refresh, 0.2)
        end
    end)

    -- Walking away closes the frame without any of the events above, as ContributeButton.lua
    -- found for its own button.
    for _, name in ipairs(self.spec.frames) do
        local host = _G[name]
        if type(host) == "table" and host.HookScript then
            host:HookScript("OnHide", Refresh)
        end
    end

    if _G.Spoken and Spoken.RegisterCallback then
        for _, event in ipairs(CLIP_EVENTS) do
            Spoken:RegisterCallback(event, function() me:Relabel() end)
        end
    end
end

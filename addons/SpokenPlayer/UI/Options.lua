setfenv(1, SpokenEnv)

-- The player's settings: player-wide things only. Each feature addon keeps its own panel
-- and, where the Settings API exists, nests it under this one.
--
-- Settings.RegisterCanvasLayoutCategory is the modern path and exists on every current
-- client. The three legacy clients have no Settings API at all; there the same
-- panel is a movable window opened with /spoken options. One builder, two hosts.
Options = {}

local INDENT = 20
local TOP = 52    -- where the first row starts, under the heading
local BOTTOM = 16 -- the margin under the last row
local panel
local scroller
local pendingLinks = {}

-- Rows, headings and the spacing between them come from UI/Layout.lua, the file every
-- Spoken addon carries a copy of, so the three panels read alike.
local Layout = SpokenLayout

local function Heading(parent, text, x, y, template)
    local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontNormalLarge")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

local CHANNELS = { "Master", "SFX", "Music", "Ambience", "Dialog" }

-- Display labels for the values above, which stay English internally: the stored
-- channel name is what playback passes to the sound API.
local CHANNEL_LABELS = {
    Master = L.OPT_CHANNEL_MASTER,
    SFX = L.OPT_CHANNEL_SFX,
    Music = L.OPT_CHANNEL_MUSIC,
    Ambience = L.OPT_CHANNEL_AMBIENCE,
    Dialog = L.OPT_CHANNEL_DIALOG,
}

local function Build(canvas)
    panel = CreateFrame("Frame", "SpokenOptionsPanel", UIParent)
    panel.name = "Spoken Player"
    -- On the settings canvas the rows are laid out in a scroller, as the books and zones
    -- panels are: the canvas neither scrolls nor clips, and the contributions rows pushed
    -- this panel past its bottom edge, drawing the minimap section over the game world. The
    -- legacy window grows to fit its rows instead (FitWindow), so it keeps laying out on
    -- the panel itself and never meets a ScrollFrame on a client that has not been tried.
    local host = panel
    if canvas then
        scroller = Layout.Scroll(panel)
        host = scroller.child
        panel.content = host
    end
    local cfg = function() return Addon.db.profile.Frame end
    local audio = function() return Addon.db.profile.Audio end
    local mm = function() return Addon.db.profile.Minimap.LibDBIcon end
    local refresh = function() PlayerFrame:RefreshConfig() end

    Heading(host, "Spoken Player", INDENT, -16)
    local layout = Layout.New(host, INDENT, -TOP)
    panel.layout = layout

    layout:Section(L.OPT_WINDOW_TITLE)
    if not Version.IsAnyLegacy then
        layout:Checkbox(L.OPT_MINIMAL_PLAYER, L.OPT_MINIMAL_PLAYER_TIP,
            function() return cfg().MinimalPlayer end, function(v) cfg().MinimalPlayer = v end, refresh)
    end
    layout:Checkbox(L.OPT_LOCK_FRAME, L.OPT_LOCK_FRAME_TIP,
        function() return cfg().LockFrame end, function(v) cfg().LockFrame = v end, refresh)
    layout:Checkbox(L.OPT_HIDE_PORTRAIT, L.OPT_HIDE_PORTRAIT_TIP,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end, refresh)
    if Version.IsCamelot then
        layout:Checkbox(L.OPT_BRONZE_TINT, L.OPT_BRONZE_TINT_TIP,
            function() return cfg().BronzeTint end, function(v) cfg().BronzeTint = v end, refresh)
    end
    -- One row per action an addon declared optional, named by that addon. The player is
    -- not told what any of them do.
    for _, optional in ipairs(Actions.optional) do
        layout:Checkbox(format(L.OPT_HIDE_ACTION, optional.label), L.OPT_HIDE_ACTION_TIP,
            function() return cfg().HiddenActions[optional.id] end,
            function(v) cfg().HiddenActions[optional.id] = v or nil end, refresh)
    end
    -- After the per-action rows: hiding a single button and hiding the window are the same
    -- kind of choice, and this one is the whole of it.
    layout:Checkbox(L.OPT_HIDE_FRAME, L.OPT_HIDE_FRAME_TIP,
        function() return cfg().HideFrame end, function(v) cfg().HideFrame = v end, refresh)
    layout:Slider(L.OPT_SCALE, 0.5, 2, 0.05,
        function() return cfg().FrameScale end, function(v) cfg().FrameScale = v end, refresh)
    layout:Button(L.OPT_RESET, 120, function() PlayerFrame:Reset() end)

    -- No captions on 1.12: its Transcript is a stub (see 1.12\Transcript.lua).
    if not Transcript.unavailable then
        layout:Section(L.TRANSCRIPT)
        local transcript = function() return Addon.db.profile.Transcript end
        local refreshTranscript = function() Transcript:RefreshConfig() end
        layout:Checkbox(L.TRANSCRIPT_SHOW, L.TRANSCRIPT_SHOW_TIP,
            function() return transcript().Enabled end,
            function(v) Transcript:SetEnabled(v) end)
        layout:Slider(L.TRANSCRIPT_LINES, 1, 2, 1,
            function() return transcript().Lines end,
            function(v) transcript().Lines = v end, refreshTranscript, Layout.Number)
        layout:Checkbox(L.TRANSCRIPT_HIGHLIGHT, L.TRANSCRIPT_HIGHLIGHT_TIP,
            function() return transcript().HighlightWord end,
            function(v) transcript().HighlightWord = v end, refreshTranscript)
        layout:Checkbox(L.TRANSCRIPT_AUTO, L.TRANSCRIPT_AUTO_TIP,
            function() return transcript().AutoScroll end,
            function(v) transcript().AutoScroll = v; Transcript.manualScroll = false end, refreshTranscript)
        layout:Slider(L.TRANSCRIPT_SIZE, 12, 26, 1,
            function() return transcript().FontSize end,
            function(v) transcript().FontSize = v end, refreshTranscript, Layout.Number)
        layout:Button(L.TRANSCRIPT_RESET, 210, function() Transcript:Reset() end)
    end

    -- Everything about how a line is played, whichever addon queued it: the two feature
    -- addons each used to carry their own channel control, and a player with both
    -- installed had two settings for one thing.
    layout:Section(L.OPT_AUDIO_TITLE)
    layout:Dropdown(L.OPT_CHANNEL, L.OPT_CHANNEL_TIP, CHANNELS,
        function() return audio().SoundChannel end,
        function(v) audio().SoundChannel = v end,
        -- The handle belongs to the old channel, so a line already speaking cannot move.
        function() SoundQueue:RemoveAllSoundsFromQueue() end,
        function(channel) return CHANNEL_LABELS[channel] or channel end)
    if audio().AutoToggleDialog ~= nil then
        layout:Checkbox(L.OPT_MUTE_DIALOGUE,
            Version.IsLegacyVanilla and L.OPT_MUTE_DIALOGUE_TIP_VANILLA or L.OPT_MUTE_DIALOGUE_TIP,
            function() return audio().AutoToggleDialog end,
            function(v)
                audio().AutoToggleDialog = v
                -- Turning it off while it holds the channel down would leave it muted.
                if not v then
                    SoundUtils:MuteChannel("Dialog", false)
                end
            end)
    end

    layout:Checkbox(L.OPT_CUE_BETWEEN, L.OPT_CUE_BETWEEN_TIP,
        function() return audio().CueBetweenItems end,
        function(v) audio().CueBetweenItems = v end)

    -- 2.4.3 and 3.3.5 only, and absent from the saved variables anywhere else. These had
    -- no rows at all until recently: the settings existed and could only be reached by
    -- editing the saved variables by hand.
    local music = audio().LegacyMusicChannel
    if music then
        layout:Checkbox(L.OPT_MUSIC_CHANNEL, L.OPT_MUSIC_CHANNEL_TIP,
            function() return music.Enabled end,
            function(v) music.Enabled = v end)
        layout:Slider(L.OPT_MUSIC_VOLUME, 0, 1, 0.05,
            function() return music.Volume end,
            function(v) music.Volume = v end)
        layout:Slider(L.OPT_MUSIC_FADE, 0, 2, 0.1,
            function() return music.FadeOutMusic end,
            function(v) music.FadeOutMusic = v end, nil, Layout.Seconds)
    end
    if audio().LegacyHDModels ~= nil then
        layout:Checkbox(L.OPT_HD_MODELS, L.OPT_HD_MODELS_TIP,
            function() return audio().LegacyHDModels end,
            function(v) audio().LegacyHDModels = v end)
    end

    -- The buttons live on Blizzard's quest, book and map frames, not on the player, but
    -- they all open the player's box, so the one switch for them is here. Absent where
    -- Contribute.xml is not loaded (the legacy clients): nothing there to hide.
    if Spoken.Contribute then
        layout:Section(L.OPT_CONTRIBUTE_TITLE)
        layout:Checkbox(L.OPT_HIDE_CONTRIBUTE, L.OPT_HIDE_CONTRIBUTE_TIP,
            function() return Addon.db.profile.Contribute.HideButtons end,
            function(v) Addon.db.profile.Contribute.HideButtons = v end,
            function() Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED") end)
        -- The opt-out the first Contribute click promises. Independent of hiding the buttons:
        -- a player who gathers has no use for them, and hiding them must not stop it.
        if Gather then
            layout:Checkbox(L.OPT_GATHER, L.OPT_GATHER_TIP,
                function() return Gather:IsEnabled() end,
                function(v)
                    -- Choosing here is an answer to the first-click question too.
                    Gather:SetIntroduced()
                    Gather:SetEnabled(v)
                end)
            layout:Button(L.OPT_GATHER_SHARE, 200, function() Spoken:ShowGatherInstructions() end)
            layout:Button(L.OPT_GATHER_CLEAR, 200, function() Gather:Clear() end, L.OPT_GATHER_CLEAR_TIP)
        end
    end

    layout:Section(L.OPT_MINIMAP_TITLE)
    layout:Checkbox(L.OPT_MINIMAP_SHOW, nil,
        function() return not mm().hide end,
        function(v) mm().hide = not v end, function() Minimap:Refresh() end)
    layout:Checkbox(L.OPT_MINIMAP_LOCK, nil,
        function() return mm().lock end,
        function(v) mm().lock = v end, function() Minimap:Refresh() end)
    -- Blizzard's addon compartment exists on the modern clients only; the player's
    -- button shows there too, opening the same menu, and this row switches it.
    if AddonCompartmentFrame then
        layout:Checkbox(L.OPT_MINIMAP_COMPARTMENT, L.OPT_MINIMAP_COMPARTMENT_TIP,
            function() return mm().showInCompartment end,
            function(v) Minimap:ToggleCompartment(v) end)
    end

    -- Feature addons register a button here to reach their own settings. The section is
    -- created with the first of them: with no feature addon installed there is nothing
    -- to head.
    panel.links = {}
    for _, link in ipairs(pendingLinks) do
        Options:AddLink(link.text, link.onClick)
    end
    pendingLinks = {}
    return panel
end

-- The legacy window's height: never shorter than it always was, and tall enough for every
-- row, including a link a feature addon added after the window was built. On the canvas,
-- the scroller's content height instead, for the same late links.
local function FitWindow()
    if scroller and panel then
        scroller:SetContentHeight(TOP + panel.layout:Height() + BOTTOM)
        return
    end
    if not (panel and panel.isWindow) then return end
    local needed = TOP + panel.layout:Height() + BOTTOM
    if needed > (panel:GetHeight() or 0) then
        panel:SetHeight(needed)
    end
end

function Options:Setup()
    if panel then return end
    local canvas = Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory
    Build(canvas)
    if canvas then
        FitWindow()
        self.category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Player")
        Settings.RegisterAddOnCategory(self.category)
    else
        -- No Settings API: a window of our own, opened by /spoken options. Sized to its
        -- rows, which vary by client, rather than a fixed height the rows can outgrow.
        panel.isWindow = true
        panel:SetSize(420, 360)
        FitWindow()
        panel:SetPoint("CENTER")
        panel:SetMovable(true)
        panel:EnableMouse(true)
        panel:SetFrameStrata("DIALOG")
        panel:Hide()
        local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
        close:SetPoint("TOPRIGHT", -4, -4)
        close:SetScript("OnClick", function() panel:Hide() end)
    end
end

--- A button on the player's panel that opens a feature addon's own settings. The
--- quests addon uses this because AceConfigDialog owns its frame lifecycle and nesting
--- it as a canvas subcategory is fragile across six clients.
function Options:AddLink(text, onClick)
    -- Feature addons call this from ADDON_LOADED; the panel is built at PLAYER_LOGIN.
    if not panel then
        table.insert(pendingLinks, { text = text, onClick = onClick })
        return
    end
    if not panel.linksSection then
        panel.linksSection = true
        panel.layout:Section(L.OPT_ADDONS_TITLE)
    end
    table.insert(panel.links, panel.layout:Button(text, 200, onClick))
    FitWindow()
end

function Options:Open()
    if self.category and Settings and Settings.OpenToCategory then
        -- OpenToCategory takes an ID in some builds and the category in others.
        local id = self.category.GetID and self.category:GetID() or nil
        if not (id and pcall(Settings.OpenToCategory, id)) then
            pcall(Settings.OpenToCategory, self.category)
        end
    elseif panel then
        panel:SetShown(not panel:IsShown())
    else
        print("Spoken Player: " .. L.OPT_NO_SETTINGS_API)
    end
end

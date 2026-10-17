setfenv(1, VoiceOver)

-- The module's page in the game's settings, under Spoken's: laid out by Spoken's UI/Layout.lua so
-- the pages read alike.
--
-- The AceConfig table is not replaced. It still backs every `/spq` command, and on the three
-- legacy clients, which have no Settings API at all, it fills the window OpenConfigWindow shows:
-- there the window and the slash commands are the whole interface, as they have always been.

SettingsPanel = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25

-- A language's name as Spoken lists it for every module: its own, in English where the font
-- cannot draw it.
local function LanguageName(code)
    if Spoken and Spoken.LanguageName then return Spoken:LanguageName(code) end
    return Language:GetNativeName(code)
end
local panel

function SettingsPanel:Setup()
    if panel or not (Settings and Settings.RegisterCanvasLayoutCategory) then
        return
    end
    panel = CreateFrame("Frame", "SpokenQuestsOptionsPanel", UIParent)
    panel.name = "Spoken Quests"
    -- The words every module's page shares, kept in Spoken.
    local W = Spoken:Words()

    -- The settings canvas is a fixed size and neither scrolls nor clips what overflows
    -- it, so a panel with more rows than fit draws them over the game world.
    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child

    local layout = SpokenLayout.New(content, INDENT, -16)
    panel.layout = layout
    local audio = function() return Addon.db.profile.Audio end
    local refresh = function() layout:Refresh() end

    -- Its own entry, nested under Spoken in the game's settings list and headed as the game's
    -- pages are, with the module's switch first: off, everything under it is greyed out and says
    -- why, rather than looking live and doing nothing. The module's card on Spoken's page turns
    -- it on and off too.
    local function PartOn() return Addon:IsPartOn() end
    layout:Intro([[Interface\Icons\INV_Scroll_03]], L.OPT_PAGE_TITLE)
    local switch = layout:Checkbox(W.MODULE_SWITCH, nil, PartOn,
        function(value) Spoken:SetPartOn("quests", value) end, refresh)

    layout:Section(W.MODULE_WHEN)
    local autoplay = layout:Checkbox(L.OPT_PANEL_AUTOPLAY, nil,
        function() return Addon:IsAutoplayOn() end,
        function(value) Addon:SetAutoplay(value) end,
        refresh)
    -- NPC chat after a quest is queued only by automatic reading (Followup.lua), so with it off
    -- this does nothing either: under it, greyed, and saying why.
    layout:Indent()
    local followup = layout:Checkbox(L.OPT_PANEL_FOLLOWUP, nil,
        function() return audio().FollowupLines ~= false end,
        function(value) audio().FollowupLines = value end)
    layout:Outdent()
    layout:Requires(followup, function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)
    layout:Checkbox(L.OPT_PANEL_QUEST_PLAY,
        L.OPT_PANEL_QUEST_PLAY_TIP,
        function() return Addon.db.profile.Audio.QuestingAutoplay end,
        function(value) Addon.db.profile.Audio.QuestingAutoplay = value end)
    local stopOnClose = layout:Checkbox(L.OPT_PANEL_STOP_ON_CLOSE, nil,
        function() return audio().StopAudioOnDisengage end,
        function(value) audio().StopAudioOnDisengage = value end)
    -- The NPC's own greeting first, then Spoken's line: for quest windows and gossip windows alike.
    local greetingFirst = layout:Checkbox(L.OPT_PANEL_GAME_GREETING_FIRST,
        L.OPT_PANEL_GAME_GREETING_FIRST_TIP,
        function() return audio().GreetingFirst end,
        function(value)
            audio().GreetingFirst = value
            if value then GreetingFirst:SetDialogApart() end
        end)
    layout:Requires(greetingFirst, function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)
    layout:Requires(layout:Checkbox(L.OPT_PANEL_READ_AFTER_CLOSE, nil,
        function() return audio().ReadAfterClose end,
        function(value) audio().ReadAfterClose = value end),
        function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)

    -- Only with DialogueUI installed, on Spoken's page.
    if DialogueUIBridge and DialogueUIBridge.Problem and IsAddOnLoaded and IsAddOnLoaded("DialogueUI") then
        Spoken:AddDialogueUISettings(function(page)
            return SettingsPanel:DialogueUIRows(page)
        end)
    end

    -- Every pack, a row each named by its language, installed or not: its version where it is
    -- installed, and where it is not, a button with the address to get it -- the game cannot open
    -- a link, so the button hands over one to copy.
    layout:Section(W.PART_VOICE)
    local ALL = "SpokenQuestsAudioAll"
    local function Present(name)
        for _, module in DataModules:GetPresentModules() do
            if module.AddonName == name then return module end
        end
    end
    local present = 0
    for _ in DataModules:GetPresentModules() do present = present + 1 end
    if present == 0 then
        layout:Note(W.MODULE_NO_PACK, nil, 16)
    end
    -- No pack in the voice language, and nothing to fall back on: said here, or the page goes
    -- quiet with no word why.
    local silent = layout:Note("", nil, 32)
    layout:OnRefresh(function() silent:SetText(Spoken:SilentNote("quests") or "") end)
    layout:ShowWhen(silent, function() return Spoken:SilentNote("quests") ~= nil end)
    local listed = {}
    -- The packs to get are the voice language's; any pack installed is listed too. Not the
    -- fallback's to get: on an esMX client English's rows buried the one that mattered. But
    -- a voice language with no pack of its own (zhCN, zhTW) is heard in the fallback's, so those
    -- are the ones to get there. Each row is built whatever is chosen and shown while it is
    -- wanted, so a change of language on Spoken's page shows at once.
    local function Wanted(code, addon)
        local voice = Language:GetVoiceLanguage()
        if code == voice or Present(addon) ~= nil then return true end
        local own = voice == Language.BASE or Spoken:VoicePack("quests", voice)
        return not own and code == Language:GetFallbackLanguage()
    end
    local function PackRow(module, label)
        listed[module.AddonName] = true
        return layout:Download(label or DataModules:GetPackLabel(module), function()
            local installed = Present(module.AddonName)
            if installed then
                if not DataModules:GetModule(module.AddonName) then return "warn", W.MODULE_NOT_LOADED end
                local version = installed.ContentVersion
                return "ok", (version and version ~= "") and version or W.MODULE_INSTALLED
            end
            if module.AddonName ~= ALL and Present(ALL) then return "off", L.OPT_PACK_INCLUDED end
        end, W.MODULE_DOWNLOAD, function() ReportButton:ShowAddress(module.URL) end)
    end
    for _, locale in ipairs(Language.LOCALES) do
        local folder, url = Spoken:VoicePack("quests", locale.code)
        if folder then
            local code = locale.code
            layout:ShowWhen(PackRow({ AddonName = folder, URL = url }, LanguageName(code)),
                function() return Wanted(code, folder) end)
        end
    end
    -- English's, split by faction, where English is the voice or the pack is installed. Not the
    -- retired complete pack, listed below only where a player still has it.
    for _, module in DataModules:GetAvailableModules() do
        if module.AddonName ~= ALL then
            layout:ShowWhen(PackRow(module), function() return Wanted(Language.BASE, module.AddonName) end)
        end
    end
    -- A pack the list does not know, as another language's, after the ones it does.
    for _, module in DataModules:GetPresentModules() do
        if not listed[module.AddonName] then PackRow(module) end
    end
    layout:Button(W.MODULE_TEST_LINE, 200, function() Options:RunSelfTest() end)
    content:SetScript("OnShow", function() layout:Refresh() end)
    -- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
    Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "quests" then layout:Refresh() end end)
    -- The packs load a second after login, after this page was built: their rows say Not loaded until then.
    Spoken:RegisterCallback("VOICE_PACKS_LOADED", function() layout:Refresh() end)

    -- Profiles are Spoken's, on its own page: one choice for every part (Options:ProfileDBs).
    local db = Addon.db

    -- The page's Defaults, as Spoken's has.
    if db.ResetProfile then
        layout:Defaults(function()
            SpokenLayout.Confirm(L.OPT_RESET_PROFILE_CONFIRM, W.MODULE_RESET, W.CANCEL, function()
                db:ResetProfile()
                -- The Compendium's filters are the account's (db.global), which a profile's reset
                -- leaves as they were.
                local filters = db.global and db.global.Compendium
                if filters then filters.FoundOnly, filters.VoicedOnly = nil, nil end
                local tab = rawget(VoiceOver, "QuestsTab")
                if tab and tab.panel and tab.panel:IsVisible() then tab:Refresh() end
                layout:Refresh()
            end)
        end, nil, W.OPT_RESET_ALL_TIP)
    end
    -- Switched off, the module is off: everything on its page greys out but its own switch. Read
    -- Automatically, Stop When Window Closes and NPC Voice Before Reading cover the Gossip window
    -- too, so they stay live while either part is on.
    local function AnyPartOn() return Addon:IsPartOn("quests") or Addon:IsPartOn("gossip") end
    layout:Requires(autoplay, AnyPartOn, W.REASON_PART_OFF)
    layout:Requires(stopOnClose, AnyPartOn, W.REASON_PART_OFF)
    layout:Requires(greetingFirst, AnyPartOn, W.REASON_PART_OFF)
    layout:RequiresAll(PartOn, W.REASON_PART_OFF, switch, autoplay, stopOnClose, greetingFirst)

    -- Derived rather than written down: a hardcoded height is a number nobody updates
    -- when a row is added, and the failure it produces is a section you cannot reach.
    scroller:SetContentHeight(layout:Height() + 40)
    panel.content = content

    -- Under Spoken's own entry, beside the other modules' pages.
    layout:Refresh()
    self.page = Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 1, layout, scroller)
    self.panel = panel
end

--- Adds the DialogueUI section to `layout`, Spoken's page. Returns what resets it, for that
--- page's Defaults.
function SettingsPanel:DialogueUIRows(layout)
    layout:Section(L.OPT_SECTION_DIALOGUEUI)
    local dui = function() return Addon.db.profile.DialogueUI end
    local function Box(key, label, tip)
        local row = layout:Checkbox(label, tip,
            function() return dui()[key] end,
            function(value) dui()[key] = value end,
            function() DialogueUIBridge:Refresh(); layout:Refresh() end)
        -- Problem answers the first of these that holds, so exactly one condition fails
        -- and the row names it. DialogueUI missing is not among them: then there are no rows.
        for _, reason in ipairs({ L.OPT_DUI_NO_PLAYER, L.OPT_DUI_UNKNOWN, L.OPT_DUI_OLD_PLAYER }) do
            layout:Requires(row, function() return DialogueUIBridge:Problem(key) ~= reason end, reason)
        end
        return row
    end
    Box("Captions", L.OPT_DUI_CAPTIONS, L.OPT_DUI_CAPTIONS_TIP)
    -- Scrolling follows the marked words, so it waits on them.
    layout:Indent()
    layout:Requires(Box("AutoScroll", L.OPT_DUI_AUTOSCROLL, nil),
        function() return dui().Captions end, L.REASON_DUI_CAPTIONS)
    layout:Outdent()
    local showPlayer = Box("ShowPlayer", L.OPT_DUI_SHOW_PLAYER, nil)
    -- It keeps Spoken's window or subtitles on screen, and Voice Only has neither.
    if Spoken and Spoken.GetPlayerStyle then
        layout:ShowWhen(showPlayer, function() return Spoken:GetPlayerStyle() ~= "none" end)
    end
    Box("PlayButton", L.OPT_DUI_PLAY_BUTTON, nil)
    return function()
        for key, value in pairs(Addon.DialogueUIDefaults) do dui()[key] = value end
        DialogueUIBridge:Refresh()
    end
end

function SettingsPanel:Open()
    -- Nested under Spoken's entry: Spoken opens this page.
    return self.page ~= nil and self.page.Open() and true or false
end

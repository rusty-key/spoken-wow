setfenv(1, VoiceOver)

-- The addon's face in the interface settings: one canvas panel of sections, laid out by
-- UI/Layout.lua, the file every Spoken addon carries a copy of so the three panels read
-- alike.
--
-- The AceConfig table is not replaced. It still backs every `/spq` command, and it still
-- fills the window OpenConfigWindow shows -- which is where profiles and the sound-pack
-- manager live, both of them AceGUI's to draw. What changed is that the settings a player
-- actually changes are sections on one panel rather than entries in a tree.
--
-- Absent on the three legacy clients, which have no Settings API at all. There the
-- window and the slash commands are the whole interface, as they have always been.

SettingsPanel = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
-- Where a problem that is not about one line is reported: the site the addons share.
local REPORT_URL = "https://spoken.rusty.one"
local panel, category

-- The enum is stored as a number and read as a name. Ordered, because a cycle button
-- steps through them in the order the list is written.
local GOSSIP_ORDER = { "Always", "OncePerQuestNPC", "OncePerNPC", "Never" }
local GOSSIP_LABELS = {
    Always = L.OPT_GREETING_LABEL_ALWAYS,
    OncePerQuestNPC = L.OPT_GREETING_LABEL_ONCE_QUEST,
    OncePerNPC = L.OPT_GREETING_LABEL_ONCE_NPC,
    Never = L.OPT_GREETING_LABEL_NEVER,
}

local function GossipName()
    return Enums.GossipFrequency:GetName(Addon.db.profile.Audio.GossipFrequency) or "Always"
end

function SettingsPanel:Setup()
    if panel or not (Settings and Settings.RegisterCanvasLayoutCategory) then
        return
    end
    panel = CreateFrame("Frame", "SpokenQuestsOptionsPanel", UIParent)
    panel.name = "Spoken Quests"

    -- The settings canvas is a fixed size and neither scrolls nor clips what overflows
    -- it, so a panel with more rows than fit draws them over the game world.
    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child

    local layout = SpokenLayout.New(content, INDENT, -16)
    panel.layout = layout
    local audio = function() return Addon.db.profile.Audio end
    local refresh = function() layout:Refresh() end
    layout:Header(L.OPT_PAGE_TITLE, L.OPT_PANEL_NOTE, nil, [[Interface\Icons\INV_Scroll_03]])

    -- The part's own switch first, as on Spoken's page: off, everything under it is greyed
    -- out and says why, rather than looking live and doing nothing.
    local switch
    local function PartOn() return Addon:IsPartOn() end
    -- Its own entry, nested under Spoken in the game's settings list and headed as the game's
    -- pages are, with its switch first: the page is there whether the part is on or not. The
    -- part's card on Spoken's page turns it on and off too.
    if Spoken and Spoken.SettingsStyle and Spoken:SettingsStyle() == "pages" then
        layout:HideHeader()
        layout:Intro([[Interface\Icons\INV_Scroll_03]], L.OPT_PAGE_TITLE)
        switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
            function(value) Spoken:SetPartOn("quests", value) end, refresh)
    else
        -- A player too old to nest pages: how this part stands -- on or off, and its voice
        -- packs -- before any setting, worded as on its card on Spoken's page.
        if Spoken and Spoken.PartStatus then
            layout:Status(function() return Spoken:PartStatus("quests") end)
        end
        if Spoken and Spoken.IsPartOn then
            switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
                function(value) Spoken:SetPartOn("quests", value) end, refresh)
        end
    end

    layout:Section(L.OPT_SECTION_DIALOGUE)
    layout:Checkbox(L.OPT_PANEL_AUTOPLAY,
        L.OPT_PANEL_AUTOPLAY_TIP,
        function() return Addon:IsAutoplayOn() end,
        function(value) Addon:SetAutoplay(value) end,
        refresh)
    -- Indented under autoplay and greyed out with it off: the frequency only decides which
    -- greetings autoplay reads, and a live control that does nothing reads as broken.
    layout:Indent()
    local greetings = layout:Dropdown(L.OPT_PANEL_GREETINGS, L.OPT_PANEL_GREETINGS_TIP,
        GOSSIP_ORDER,
        GossipName,
        function(name)
            Addon.db.profile.Audio.GossipFrequency = Enums.GossipFrequency[name]
        end,
        nil,
        function(name) return GOSSIP_LABELS[name] or name end)
    layout:Outdent()
    layout:Requires(greetings, function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)
    layout:Checkbox(L.OPT_PANEL_STOP_ON_CLOSE,
        L.OPT_PANEL_STOP_ON_CLOSE_TIP,
        function() return audio().StopAudioOnDisengage end,
        function(value) audio().StopAudioOnDisengage = value end)
    -- Only what autoplay reads waits for the greeting, so with it off this does nothing.
    local greetingFirst = layout:Checkbox(L.OPT_PANEL_GAME_GREETING_FIRST,
        L.OPT_PANEL_GAME_GREETING_FIRST_TIP,
        function() return audio().GreetingFirst end,
        function(value)
            audio().GreetingFirst = value
            if value then GreetingFirst:SetDialogApart() end
        end)
    layout:Requires(greetingFirst, function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)
    -- The two rarely wanted, apart from the everyday choices above.
    layout:Section(L.OPT_SECTION_EXTRAS)
    local followup = layout:Checkbox(L.OPT_PANEL_FOLLOWUP,
        L.OPT_PANEL_FOLLOWUP_TIP,
        function() return audio().FollowupLines ~= false end,
        function(value) audio().FollowupLines = value end)
    -- Follow-up lines are queued only by autoplay (Followup.lua), so with it off this one
    -- does nothing either: greyed, and saying why.
    layout:Requires(followup, function() return Addon:IsAutoplayOn() end, L.REASON_AUTOPLAY)
    layout:Checkbox(L.OPT_OG_THRALL,
        L.OPT_OG_THRALL_TIP,
        function() return audio().OGThrall end,
        function(value) audio().OGThrall = value end)

    -- Only with DialogueUI installed: on Spoken's page, or here with a Spoken too old to have
    -- room for them.
    if DialogueUIBridge and DialogueUIBridge.Problem and IsAddOnLoaded and IsAddOnLoaded("DialogueUI") then
        if Spoken and Spoken.AddDialogueUISettings then
            Spoken:AddDialogueUISettings(function(page)
                return SettingsPanel:DialogueUIRows(page, L.OPT_PAGE_TITLE)
            end)
        else
            self:DialogueUIRows(layout, L.OPT_SECTION_DIALOGUEUI, L.OPT_DUI_NOTE)
        end
    end

    -- The voice language is set once for every module, on Spoken's page. Here only where the
    -- player is too old to have that setting.
    if not (Spoken and Spoken.GetLanguageChoice) then
        layout:Section(L.OPT_SECTION_LANGUAGE)
        local voices, fallbacks = { Language.AUTO }, { "none" }
        for _, locale in ipairs(Language.LOCALES) do
            table.insert(voices, locale.code)
            table.insert(fallbacks, locale.code)
        end
        layout:Dropdown(L.OPT_VOICE_LANGUAGE, L.OPT_VOICE_LANGUAGE_TIP,
            voices,
            function() return audio().VoiceLanguage or Language.AUTO end,
            function(code) audio().VoiceLanguage = code end,
            nil,
            function(code)
                if code == Language.AUTO then
                    return format(L.OPT_LANG_AUTO_FMT, Language:GetNativeName(Language:GetClientLanguage()))
                end
                return Language:GetNativeName(code)
            end)
        layout:Dropdown(L.OPT_FALLBACK_LANGUAGE, L.OPT_FALLBACK_LANGUAGE_TIP,
            fallbacks,
            function() return audio().FallbackLanguage or Language.BASE end,
            function(code) audio().FallbackLanguage = code end,
            nil,
            function(code) return code == "none" and L.OPT_FALLBACK_NONE or Language:GetNativeName(code) end)
    end

    -- What this character has heard, as on the other pages: forgotten, every NPC greets again.
    layout:Section(L.OPT_SECTION_HISTORY)
    layout:Button(L.OPT_FORGET_GREETINGS, 200, function()
        local char = Addon.db and Addon.db.char
        if char then char.hasSeenGossipForNPC = {} end
        print("|cFF00CCFFSpoken Quests:|r " .. L.OPT_FORGET_GREETINGS_DONE)
    end, L.OPT_FORGET_GREETINGS_TIP)

    -- Every pack, a row each, installed or not: its version where it is installed, and where
    -- it is not, a button with the address to get it -- the game cannot open a link, so the
    -- button hands over one to copy. All holds the other four, which then say so.
    layout:Section(L.OPT_SECTION_PACKS)
    local ALL = "SpokenQuestsAudioAll"
    local function Present(name)
        for _, module in DataModules:GetPresentModules() do
            if module.AddonName == name then return module end
        end
    end
    local present = 0
    for _ in DataModules:GetPresentModules() do present = present + 1 end
    if present == 0 then
        layout:Note(L.OPT_NO_PACK, nil, 16)
    end
    local listed = {}
    -- The packs to get are the voice language's; any pack installed is listed too. Not the
    -- fallback's to get: on an esMX client English's five rows buried the one that mattered. But
    -- a voice language with no pack of its own (zhCN, zhTW) is heard in the fallback's, so those
    -- are the ones to get there. Each row is built whatever is chosen and shown while it is
    -- wanted, so a change of language on Spoken's page shows at once.
    local function Wanted(code, addon)
        local voice = Language:GetVoiceLanguage()
        if code == voice or Present(addon) ~= nil then return true end
        local own = voice == Language.BASE or (Spoken and Spoken.VoicePack and Spoken:VoicePack("quests", voice))
        return not own and code == Language:GetFallbackLanguage()
    end
    local function PackRow(module, label)
        listed[module.AddonName] = true
        return layout:Download(format(L.OPT_PACK_NAME_FMT, label or DataModules:GetPackLabel(module)), function()
            local installed = Present(module.AddonName)
            if installed then
                if not DataModules:GetModule(module.AddonName) then return "warn", L.OPT_PACK_NOT_LOADED end
                local version = installed.ContentVersion
                return "ok", (version and version ~= "") and version or L.OPT_PACK_LOADED
            end
            if module.AddonName ~= ALL and Present(ALL) then return "off", L.OPT_PACK_INCLUDED end
        end, L.OPT_DOWNLOAD, function() ReportButton:ShowAddress(module.URL) end,
            module.URL and format(L.OPT_COPY_ADDRESS_FMT, module.URL))
    end
    for _, locale in ipairs(Language.LOCALES) do
        local folder, url = Spoken and Spoken.VoicePack and Spoken:VoicePack("quests", locale.code)
        if folder then
            local code = locale.code
            layout:ShowWhen(PackRow({ AddonName = folder, URL = url }, Language:GetNativeName(code)),
                function() return Wanted(code, folder) end)
        end
    end
    -- English's, split by faction, where English is the voice or the pack is installed.
    for _, module in DataModules:GetAvailableModules() do
        layout:ShowWhen(PackRow(module), function() return Wanted(Language.BASE, module.AddonName) end)
    end
    -- A pack the list does not know, as another language's, after the ones it does.
    for _, module in DataModules:GetPresentModules() do
        if not listed[module.AddonName] then PackRow(module) end
    end
    content:SetScript("OnShow", function() layout:Refresh() end)

    layout:Section(L.OPT_SECTION_TROUBLE)
    layout:Columns(2)
    layout:Button(L.OPT_TEST_LINE, 200, function() Options:RunSelfTest() end,
        L.OPT_TEST_LINE_TIP)
    layout:Button(L.OPT_PRINT_DIAG, 200, function() Options:PrintDiagnostics() end,
        L.OPT_PRINT_DIAG_TIP)
    -- For what belongs to no one line; each line has its own Report. The game cannot open a
    -- link, so it hands over the address to copy.
    layout:Columns(nil)
    layout:Button(L.OPT_REPORT_PROBLEM, 200, function() ReportButton:ShowAddress(REPORT_URL) end,
        L.OPT_REPORT_PROBLEM_TIP)

    -- Profiles are Spoken's, on its own page: one choice for every part (Options:ProfileDBs).
    local db = Addon.db

    -- Every page ends the same way, as Spoken's does: one section, last, to start over.
    if db.ResetProfile then
        layout:StartOver(L.OPT_SECTION_START_OVER, L.OPT_RESET_PROFILE, function()
            SpokenLayout.Confirm(L.OPT_RESET_PROFILE_CONFIRM, L.OPT_RESET, L.OPT_CANCEL, function()
                db:ResetProfile()
                layout:Refresh()
            end)
        end, L.OPT_RESET_PROFILE_TIP)
    end
    -- Switched off, the module is off: everything on its page greys out but its own switch.
    layout:RequiresAll(PartOn, L.REASON_PART_OFF, switch)

    -- Derived rather than written down: a hardcoded height is a number nobody updates
    -- when a row is added, and the failure it produces is a section you cannot reach.
    scroller:SetContentHeight(layout:Height() + 40)
    panel.content = content

    -- Under Spoken's own entry when the player can nest it, beside the other parts' pages;
    -- a top-level entry of its own otherwise.
    layout:Refresh()
    local page = Spoken and Spoken.AddSettingsPage
        and Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 1, layout, scroller)
    if page then
        self.page = page
    else
        category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Quests")
        Settings.RegisterAddOnCategory(category)
    end
    self.panel, self.category = panel, category
end

--- Adds the DialogueUI rows to `layout` under `title`. Returns what resets them, for the
--- Defaults button of Spoken's DialogueUI page.
function SettingsPanel:DialogueUIRows(layout, title, note)
    layout:Section(title)
    if note then layout:Note(note, nil, 32) end
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
    layout:Requires(Box("AutoScroll", L.OPT_DUI_AUTOSCROLL, L.OPT_DUI_AUTOSCROLL_TIP),
        function() return dui().Captions end, L.REASON_DUI_CAPTIONS)
    layout:Outdent()
    Box("ShowPlayer", L.OPT_DUI_SHOW_PLAYER, L.OPT_DUI_SHOW_PLAYER_TIP)
    Box("PlayButton", L.OPT_DUI_PLAY_BUTTON, L.OPT_DUI_PLAY_BUTTON_TIP)
    return function()
        for key, value in pairs(Addon.DialogueUIDefaults) do dui()[key] = value end
        DialogueUIBridge:Refresh()
    end
end

function SettingsPanel:Open()
    -- Nested under Spoken's entry: Spoken opens this page.
    if self.page and self.page.Open and self.page.Open() then return true end
    local category = category or (self.page and self.page.category)
    return SpokenLayout ~= nil and SpokenLayout.OpenCategory(category)
end

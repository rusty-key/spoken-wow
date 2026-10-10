if not SpokenGossipEnv then return end
setfenv(1, SpokenGossipEnv)

-- The addon's page in the interface settings, laid out by UI/Layout.lua, the file every Spoken
-- addon carries a copy of so the pages read alike. Absent on the three legacy clients, which
-- have no Settings API: the options window and /spg are the interface there (Options.lua).

SettingsPanel = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
-- Where a problem that is not about one line is reported: the site the addons share.
local REPORT_URL = "https://spoken.rusty.one"
local ICON = [[Interface\Icons\UI_Chat]]
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
    panel = CreateFrame("Frame", "SpokenGossipOptionsPanel", UIParent)
    panel.name = "Spoken Gossip"

    -- The settings canvas is a fixed size and neither scrolls nor clips what overflows
    -- it, so a panel with more rows than fit draws them over the game world.
    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child

    local layout = SpokenLayout.New(content, INDENT, -16)
    panel.layout = layout
    local audio = function() return Addon.db.profile.Audio end
    local refresh = function() layout:Refresh() end
    layout:Header(L.OPT_PAGE_TITLE, L.OPT_PANEL_NOTE, nil, ICON)

    -- The part's own switch first, as on Spoken's page: off, everything under it is greyed
    -- out and says why, rather than looking live and doing nothing.
    local switch
    local function PartOn() return Addon:IsPartOn() end
    if Spoken and Spoken.SettingsStyle and Spoken:SettingsStyle() == "pages" then
        layout:HideHeader()
        layout:Intro(ICON, L.OPT_PAGE_TITLE)
        switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
            function(value) Spoken:SetPartOn("gossip", value) end, refresh)
    else
        if Spoken and Spoken.PartStatus then
            layout:Status(function() return Spoken:PartStatus("gossip") end)
        end
        if Spoken and Spoken.IsPartOn then
            switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
                function(value) Spoken:SetPartOn("gossip", value) end, refresh)
        end
    end

    layout:Section(L.OPT_SECTION_DIALOGUE)
    layout:Dropdown(L.OPT_PANEL_GREETINGS, L.OPT_PANEL_GREETINGS_TIP,
        GOSSIP_ORDER,
        GossipName,
        function(name)
            Addon.db.profile.Audio.GossipFrequency = Enums.GossipFrequency[name]
            Addon:RefreshConfig()
        end,
        nil,
        function(name) return GOSSIP_LABELS[name] or name end)
    layout:Checkbox(L.OPT_PANEL_STOP_ON_CLOSE,
        L.OPT_PANEL_STOP_ON_CLOSE_TIP,
        function() return audio().StopAudioOnDisengage end,
        function(value) audio().StopAudioOnDisengage = value end)

    layout:Section(L.OPT_SECTION_EXTRAS)
    layout:Checkbox(L.OPT_OG_THRALL,
        L.OPT_OG_THRALL_TIP,
        function() return audio().OGThrall end,
        function(value) audio().OGThrall = value end)

    -- What this character has heard: forgotten, every NPC greets again.
    layout:Section(L.OPT_SECTION_HISTORY)
    layout:Button(L.OPT_FORGET_GREETINGS, 200, function() Addon:ForgetGreetings() end,
        L.OPT_FORGET_GREETINGS_TIP)

    -- The packs that hold gossip, a row each: its version where it is installed, and where it
    -- is not, a button with the address to get it. Each language's one pack holds quests and
    -- gossip both, so those rows are the quests page's too.
    layout:Section(L.OPT_SECTION_PACKS)
    local ALL = "SpokenQuestsAudioAll"
    local function Present(name)
        for _, module in DataModules:GetPresentModules() do
            if module.AddonName == name then return module end
        end
    end
    local present = 0
    for _, module in DataModules:GetPresentModules() do
        if Player:HoldsGossip(module) then present = present + 1 end
    end
    if present == 0 then
        layout:Note(L.OPT_NO_PACK, nil, 16)
    end
    local listed = {}
    -- The packs to get are the voice language's; any pack installed is listed too. A voice
    -- language with no pack of its own is heard in the fallback's, so those are the ones to get
    -- there. Each row is built whatever is chosen and shown while it is wanted, so a change of
    -- language on Spoken's page shows at once.
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
    -- English's that hold gossip: the Gossip pack, and the complete one.
    for _, module in DataModules:GetAvailableModules() do
        if Player:HoldsGossip(module) then
            layout:ShowWhen(PackRow(module, module.AddonName == ALL and L.OPT_PACK_ALL or L.OPT_PACK_GOSSIP),
                function() return Wanted(Language.BASE, module.AddonName) end)
        end
    end
    -- A pack the list does not know, after the ones it does.
    for _, module in DataModules:GetPresentModules() do
        if not listed[module.AddonName] and Player:HoldsGossip(module) then PackRow(module) end
    end
    content:SetScript("OnShow", function() layout:Refresh() end)
    -- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
    if Spoken and Spoken.RegisterCallback then
        Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "gossip" then layout:Refresh() end end)
    end

    layout:Section(L.OPT_SECTION_TROUBLE)
    layout:Columns(2)
    layout:Button(L.OPT_TEST_LINE, 200, function() Addon:RunSelfTest() end, L.OPT_TEST_LINE_TIP)
    layout:Button(L.OPT_PRINT_DIAG, 200, function() Addon:PrintDiagnostics() end, L.OPT_PRINT_DIAG_TIP)
    -- For what belongs to no one line; each line has its own Report. The game cannot open a
    -- link, so it hands over the address to copy.
    layout:Columns(nil)
    layout:Button(L.OPT_REPORT_PROBLEM, 200, function() ReportButton:ShowAddress(REPORT_URL) end,
        L.OPT_REPORT_PROBLEM_TIP)

    -- Profiles are Spoken's, on its own page: one choice for every part.
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
        and Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 2, layout, scroller)
    if page then
        self.page = page
    else
        category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Gossip")
        Settings.RegisterAddOnCategory(category)
    end
    self.panel, self.category = panel, category
end

function SettingsPanel:Open()
    -- Nested under Spoken's entry: Spoken opens this page.
    if self.page and self.page.Open and self.page.Open() then return true end
    local category = category or (self.page and self.page.category)
    return SpokenLayout ~= nil and SpokenLayout.OpenCategory(category)
end

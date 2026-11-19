setfenv(1, VoiceOver)

-- Gossip's page in the game's settings, under Spoken's, beside Quests': laid out by Spoken's
-- UI/Layout.lua so the pages read alike. What an NPC says when you start talking to them is a part
-- of its own on Spoken's page, with its own switch; the settings that only it has are here.

GossipSettingsPanel = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
local MUTED_ROW = 26
local ICON = [[Interface\Icons\UI_Chat]]
local panel

-- The enum is stored as a number and read as a name. Ordered as the menu lists them: from
-- reading the most to the least.
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

function GossipSettingsPanel:Setup()
    if panel then
        return
    end
    panel = CreateFrame("Frame", "SpokenGossipOptionsPanel", UIParent)
    panel.name = "Spoken Gossip"
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

    -- The part's own switch first, as on Spoken's page: off, everything under it is greyed
    -- out and says why, rather than looking live and doing nothing.
    local function PartOn() return Addon:IsPartOn("gossip") end
    layout:Intro(ICON, L.OPT_GOSSIP_PAGE_TITLE)
    local switch = layout:Checkbox(W.MODULE_SWITCH, nil, PartOn,
        function(value) Spoken:SetPartOn("gossip", value) end, refresh)

    -- The first two wait on Read Automatically, which is Quests' page's and covers every NPC
    -- window: they only decide what that reads, and a live control that does nothing reads as
    -- broken.
    layout:Section(W.MODULE_WHEN)
    local function AutoplayOn() return Addon:IsAutoplayOn() end
    local greetings = layout:Dropdown(L.OPT_PANEL_GREETINGS, nil,
        GOSSIP_ORDER,
        GossipName,
        function(name)
            Addon.db.profile.Audio.GossipFrequency = Enums.GossipFrequency[name]
        end,
        refresh,
        function(name) return GOSSIP_LABELS[name] or name end)
    layout:Requires(greetings, AutoplayOn, L.REASON_AUTOPLAY_ON_QUESTS)
    layout:Checkbox(L.OPT_OG_THRALL, nil,
        function() return audio().OGThrall end,
        function(value) audio().OGThrall = value end)

    -- What this character has heard: forgotten, every NPC greets again. It only matters while
    -- a greeting is read once.
    layout:Section(W.MODULE_HISTORY)
    local forget = layout:Button(L.OPT_FORGET_GREETINGS, 200, function()
        local char = Addon.db and Addon.db.char
        if char then char.hasSeenGossipForNPC = {} end
        Addon:GossipSay(L.OPT_FORGET_GREETINGS_DONE)
    end)
    layout:Requires(forget, function()
        local name = GossipName()
        return name == "OncePerNPC" or name == "OncePerQuestNPC"
    end, L.REASON_FORGET_GREETINGS)

    -- A muted NPC never plays on its own again, so this list is where it is unmuted.
    layout:Section(L.OPT_MUTED_NPCS)
    local function Muted()
        local list = {}
        for key, name in pairs(Addon.db.char.ignoredGossipNPCs) do
            table.insert(list, { key = key, name = name })
        end
        table.sort(list, function(a, b) return a.name < b.name end)
        return list
    end
    local function AnyMuted() return next(Addon.db.char.ignoredGossipNPCs) ~= nil end
    layout:ShowWhen(layout:Note(L.OPT_NO_MUTED_NPCS, nil, 34), function() return not AnyMuted() end)

    local list = CreateFrame("Frame", nil, content)
    local rows = {}
    local function Redraw()
        layout:Refresh()
        scroller:SetContentHeight(layout:Height() + 40)
    end
    local function Fill()
        local muted = Muted()
        for i, entry in ipairs(muted) do
            local row = rows[i]
            if not row then
                row = CreateFrame("Frame", nil, list)
                row:SetHeight(MUTED_ROW)
                -- TOPRIGHT, not RIGHT: RIGHT with a top and a height leaves no rect to draw.
                local y = -(i - 1) * MUTED_ROW
                row:SetPoint("TOPLEFT", list, "TOPLEFT", SpokenLayout.LABEL_X, y)
                row:SetPoint("TOPRIGHT", list, "TOPRIGHT", 0, y)
                row.label = row:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
                row.label:SetPoint("LEFT", row, "LEFT", 0, 0)
                row.unmute = SpokenLayout.NewButton(row, L.OPT_UNMUTE_NPC)
                SpokenLayout.FitButton(row.unmute)
                row.unmute:SetPoint("RIGHT", row, "RIGHT", 0, 0)
                row.unmute:SetScript("OnClick", function(self)
                    Addon:SetGossipNPCMutedKey(self.key, nil, false)
                    Addon:GossipSay(format(L.UNMUTE_NPC_DONE, self.name))
                    Redraw()
                end)
                rows[i] = row
            end
            row.label:SetText(entry.name)
            row.unmute.key, row.unmute.name = entry.key, entry.name
            row:Show()
        end
        for i = #muted + 1, #rows do rows[i]:Hide() end
        list.count = #muted
    end
    layout:Custom(list, MUTED_ROW, function(width) list:SetWidth(width - 40) end)
    list.layoutRow.measure = function() return math.max(1, list.count or 0) * MUTED_ROW end
    layout:ShowWhen(list, AnyMuted)
    layout:OnRefresh(Fill)

    local forgetMuted = layout:Button(L.OPT_FORGET_MUTED_NPCS, 200, function()
        Addon:ForgetMutedNPCs()
        Addon:GossipSay(L.OPT_FORGET_MUTED_NPCS_DONE)
        Redraw()
    end)
    layout:ShowWhen(forgetMuted, AnyMuted)

    -- Switched off, the part is off: everything on its page greys out but its own switch.
    layout:RequiresAll(PartOn, W.REASON_PART_OFF, switch)
    content:SetScript("OnShow", Redraw)
    -- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
    Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "gossip" then layout:Refresh() end end)

    -- Derived rather than written down: a hardcoded height is a number nobody updates
    -- when a row is added, and the failure it produces is a section you cannot reach.
    scroller:SetContentHeight(layout:Height() + 40)
    panel.content = content

    -- Under Spoken's own entry, beside the other parts' pages.
    layout:Refresh()
    self.page = Spoken:AddSettingsPage(panel, L.OPT_GOSSIP_PAGE_TITLE, 2, layout, scroller)
    self.panel = panel
end

function GossipSettingsPanel:Open()
    -- Nested under Spoken's entry: Spoken opens this page.
    return self.page ~= nil and self.page.Open() and true or false
end

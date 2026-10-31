setfenv(1, VoiceOver)

-- World Chatter's settings page: its switch and a note, since it has no other settings.

ChatterSettingsPanel = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
local ICON = [[Interface\Icons\UI_Chat]]
local panel

function ChatterSettingsPanel:Setup()
    if panel then
        return
    end
    panel = CreateFrame("Frame", "SpokenChatterOptionsPanel", UIParent)
    panel.name = "Spoken World Chatter"
    local W = Spoken:Words()

    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child

    local layout = SpokenLayout.New(content, INDENT, -16)
    panel.layout = layout
    local refresh = function() layout:Refresh() end

    layout:Intro(ICON, L.OPT_CHATTER_PAGE_TITLE)
    layout:Checkbox(W.MODULE_SWITCH, nil, function() return Addon:IsPartOn("chatter") end,
        function(value) Spoken:SetPartOn("chatter", value) end, refresh)
    layout:Note(L.OPT_CHATTER_NOTE)

    content:SetScript("OnShow", function() layout:Refresh() end)
    -- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
    Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "chatter" then layout:Refresh() end end)

    scroller:SetContentHeight(layout:Height() + 40)
    panel.content = content

    layout:Refresh()
    self.page = Spoken:AddSettingsPage(panel, L.OPT_CHATTER_PAGE_TITLE, 5.5, layout, scroller)
    self.panel = panel
end

function ChatterSettingsPanel:Open()
    -- Nested under Spoken's entry: Spoken opens this page.
    return self.page ~= nil and self.page.Open() and true or false
end

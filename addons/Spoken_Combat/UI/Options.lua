local _, Combat = ...

function Combat:SetupOptions()
    if self.optionsPage or not SpokenLayout or not Spoken:SettingsStyle() then return end
    local L = self.L
    local panel = CreateFrame("Frame")
    panel.name = "Spoken Combat"
    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child
    local layout = SpokenLayout.New(content, 25, -16)
    layout:Intro([[Interface\Icons\Ability_DualWield]], "Combat")
    local function PartOn() return Spoken:IsPartOn("combat") end
    local refresh = function() layout:Refresh() end
    local switch = layout:Checkbox("Enable Module", "Automatically choose an installed English voice for your character's race and sex and speak a short line when combat begins, at most once every 45 seconds. Skips while Spoken is narrating and shows no narrator or subtitles. Saved with your Spoken profile.",
        PartOn, function(value) Spoken:SetPartOn("combat", value) end, refresh)
    for _, option in ipairs({
        { "AllowInParty", L.COMBAT_VOICE_PARTY, L.COMBAT_VOICE_PARTY_TIP },
        { "AllowInDungeon", L.COMBAT_VOICE_DUNGEON, L.COMBAT_VOICE_DUNGEON_TIP },
        { "AllowInRaid", L.COMBAT_VOICE_RAID, L.COMBAT_VOICE_RAID_TIP },
    }) do
        local key = option[1]
        layout:Checkbox(option[2], option[3],
            function() return Combat.settings[key] == true end,
            function(value) Combat:SetContextEnabled(key, value) end, refresh)
    end
    local preview = layout:Button(L.COMBAT_VOICE_PREVIEW, 200,
        function() Combat:Preview() end, L.COMBAT_VOICE_PREVIEW_TIP)
    layout:Requires(preview, function() return Combat:IsReady() end, "No usable recordings for this character. See the voice status below.")
    local status = layout:Note(Combat:VoiceStatus(), nil, 48)
    local packStatus = layout:Note(Combat:PackStatus(), nil, 64)
    layout:ShowWhen(packStatus, function() return Combat:GetVoicePack() ~= nil end)
    layout:OnRefresh(function()
        status:SetText(Combat:VoiceStatus())
        packStatus:SetText(Combat:PackStatus())
    end)
    layout:RequiresAll(PartOn, "Enable the Combat module to use this.", switch)
    layout:Refresh()
    content:SetScript("OnShow", refresh)
    Spoken:RegisterCallback("PART_SWITCHED", function(key) if key == "combat" then refresh() end end)
    scroller:SetContentHeight(layout:Height() + 40)
    self.optionsPage = Spoken:AddSettingsPage(panel, "Combat", 4, layout, scroller)
    self.optionsLayout = layout
end

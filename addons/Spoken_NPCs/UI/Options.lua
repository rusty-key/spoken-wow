local _, NPCs = ...

-- The Bosses page in the game's settings, under Spoken's, laid out by Spoken's UI/Layout.lua so
-- the pages read alike.

local L = NPCs.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
local ICON = [[Interface\Icons\INV_Misc_Head_Dragon_01]]

local panel

function NPCs:SetupOptions()
	if panel or not (Spoken and Spoken.AddSettingsPage and SpokenLayout) then
		return
	end
	if not (Settings and Settings.RegisterCanvasLayoutCategory) then
		return
	end
	-- The words every module's page shares, kept in Spoken.
	local W = Spoken:Words()

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken NPCs"
	-- The settings canvas neither scrolls nor clips: the rows go in the scroller's content frame.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content
	local layout = SpokenLayout.New(content, INDENT, -16)
	panel.layout = layout
	local refresh = function() layout:Refresh() end

	layout:Intro(ICON, L.OPT_PAGE_TITLE)

	layout:Section(W.OPT_COMPENDIUM_TITLE)
	layout:Checkbox(L.OPT_SHOW_ABILITIES, nil,
		function() return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.showAbilities == true end,
		function(value)
			if SpokenNPCsSettings then SpokenNPCsSettings.showAbilities = value end
			NPCs:RefreshBosses()
		end)

	layout:Defaults(function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, W.MODULE_RESET, W.CANCEL, function()
			NPCs:ResetOptions()
			layout:Refresh()
			NPCs:RefreshBosses()
		end)
	end, nil, W.OPT_RESET_ALL_TIP)
	layout:Refresh()
	content:SetScript("OnShow", refresh)
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry, after the other modules' pages.
	NPCs.optionsPage = Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 5, layout, scroller)
	NPCs.optionsPanel = panel
end

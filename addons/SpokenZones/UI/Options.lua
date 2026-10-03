-- SpokenZones -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, which exists on 11509
-- (Leatrix_Maps, Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use
-- it). InterfaceOptions_AddCategory is the legacy-only path and is not used.
--
-- Widget templates are picked from what addons already running on this client
-- use: UICheckButtonTemplate (Syndicator/Options) and UISliderTemplate
-- (Syndicator/Options, Leatrix_Maps, Leatrix_Plus).

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
-- The voice pack this addon is made for, and where to get it.
local AUDIO_ADDON = "SpokenZonesAudio"
local AUDIO_URL = "https://www.curseforge.com/wow/addons/spoken-zones-audio"
-- Where a problem that is not about one story is reported: the site the addons share.
local REPORT_URL = "https://spoken.rusty.one"

local panel, category

--------------------------------------------------------------------------------
-- Apply helpers
--------------------------------------------------------------------------------

local function RedrawPanel()
	if SpokenZones.ApplyPanelOptions then
		SpokenZones:ApplyPanelOptions()
	end
end

local function RedrawEverything()
	RedrawPanel()
	if SpokenZones.RefreshLoreWindow then
		SpokenZones:RefreshLoreWindow()
	end
end

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenZones:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		SpokenZones:Print("|cffffcc00Settings API missing; options panel unavailable (use /spz help)|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Zones"

	-- Everything below is laid out in `content`, not in `panel`. The settings canvas
	-- is a fixed size and neither scrolls nor clips what overflows it, so a panel
	-- with more rows than fit draws them over the game world. See UI/Scroller.lua.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	local layout = SpokenLayout.New(content, INDENT, -16)
	panel.layout = layout
	layout:Header(L.OPT_PAGE_TITLE, L.OPT_NOTE, nil, [[Interface\Icons\INV_Misc_Map_01]])
	local refresh = function() layout:Refresh() end

	-- The part's own switch first, as on Spoken's page: off, everything under it is greyed
	-- out and says why, rather than looking live and doing nothing.
	local switch
	local function PartOn() return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("zones") end
	-- Its own entry, nested under Spoken in the game's settings list and headed as the game's
	-- pages are, with its switch first: the page is there whether the part is on or not. The
	-- part's card on Spoken's page turns it on and off too.
	if Spoken and Spoken.SettingsStyle and Spoken:SettingsStyle() == "pages" then
		layout:HideHeader()
		layout:Intro([[Interface\Icons\INV_Misc_Map_01]], L.OPT_PAGE_TITLE)
		switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
			function(value) Spoken:SetPartOn("zones", value) end, refresh)
	else
		-- A player too old to nest pages: how this part stands -- on or off, and its voice
		-- packs -- before any setting, worded as on its card on Spoken's page.
		if Spoken and Spoken.PartStatus then
			layout:Status(function() return Spoken:PartStatus("zones") end)
		end
		if Spoken and Spoken.IsPartOn then
			switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
				function(value) Spoken:SetPartOn("zones", value) end, refresh)
		end
	end

	-- Every row's position, and the spacing between them, comes from UI/Layout.lua -- the
	-- file every Spoken addon carries a copy of, so the three panels read alike.
	local function Get(key) return function() return SpokenZones:Get(key) end end
	local function Set(key) return function(value) SpokenZones:Set(key, value) end end

	-- Reading aloud first, as the quests and readables pages start with when to read: it is
	-- what most players install this for. The map after, then the lore window.
	layout:Section(L.OPT_SECTION_NARRATION)
	-- The voice itself: off, the stories are text only, and nothing below can read them.
	local voiced = Get("voiceEnabled")
	layout:Checkbox(L.OPT_PLAY_BUTTON,
		L.OPT_PLAY_BUTTON_TIP,
		voiced, Set("voiceEnabled"), function()
			SpokenZones:StopLore()
			SpokenZones:NotifyAudioChanged()
			layout:Refresh()
		end)
	local discovery = layout:Checkbox(L.OPT_AUTOPLAY,
		L.OPT_AUTOPLAY_TIP,
		Get("autoplay"), Set("autoplay"), function()
			if not SpokenZones:Get("autoplay") then
				SpokenZones:StopLore()
			end
			layout:Refresh()
		end)
	layout:Requires(discovery, voiced, L.REASON_VOICE)
	-- Indented and greyed with autoplay off: both only shape what autoplay reads.
	local discovering = Get("autoplay")
	layout:Indent()
	local smaller = layout:Checkbox(L.OPT_AUTOPLAY_SUB,
		L.OPT_AUTOPLAY_SUB_TIP,
		Get("autoplaySubzones"), Set("autoplaySubzones"))
	local before = layout:Checkbox(L.OPT_AUTOPLAY_EXPLORED,
		L.OPT_AUTOPLAY_EXPLORED_TIP,
		Get("autoplayExplored"), Set("autoplayExplored"))
	for _, row in ipairs({ smaller, before }) do
		layout:Requires(row, voiced, L.REASON_VOICE)
		layout:Requires(row, discovering, L.REASON_DISCOVERY)
	end
	layout:Outdent()
	layout:Section(L.OPT_SECTION_MAP)
	layout:Checkbox(L.OPT_MAP_PANEL,
		L.OPT_MAP_PANEL_TIP,
		Get("showMapPanel"), Set("showMapPanel"), function() RedrawPanel(); layout:Refresh() end)
	local besideMap = Get("showMapPanel")
	layout:Checkbox(L.OPT_HOVER,
		L.OPT_HOVER_TIP,
		Get("showHoverPreview"), Set("showHoverPreview"))
	layout:Requires(layout:Slider(L.OPT_PANEL_WIDTH, 220, 520, 10,
		Get("panelWidth"), Set("panelWidth"), RedrawPanel, SpokenLayout.Number, L.OPT_PANEL_WIDTH_TIP),
		besideMap, L.REASON_MAP_PANEL)
	layout:Slider(L.OPT_FONT_SIZE, 9, 20, 1,
		Get("fontSize"), Set("fontSize"), RedrawEverything, SpokenLayout.Number, L.OPT_FONT_SIZE_TIP)

	-- The lore window: every zone's stories to browse, which nothing else on the page leads to.
	layout:Section(L.OPT_SECTION_LORE)
	layout:Button(L.MENU_LORE_WINDOW, 200, function() SpokenZones:ToggleLoreWindow() end, L.OPT_LORE_WINDOW_TIP)

	layout:Section(L.OPT_SECTION_LANGUAGE)
	-- Only finished languages are offered. A player choosing from a list has no way to
	-- know that half a translation is missing, and would report the English that shows
	-- through as a bug; /spz lang <code> force is how an unfinished one gets looked at.
	local langNote
	-- Auto stores no language at all, so it keeps following the client: switch the
	-- game to French and it reads French. Every other entry pins its language.
	local AUTO = {}
	local function DescribeLanguage()
		local available = SpokenZones:GetSelectableLanguages()
		-- The chosen language, which is not always the one on screen: a switch only takes
		-- effect on the next load.
		local chosen = SpokenZones:GetLanguagePreference() or SpokenZones:GetAutoLanguage()
		if #available < 2 then
			langNote:SetText(L.OPT_LANG_ONLY_ENGLISH)
		elseif chosen ~= SpokenZones:GetLanguage() then
			langNote:SetText(L.OPT_LANG_RELOAD)
		else
			langNote:SetText(string.format(L.OPT_LANG_COUNT_FMT, #available))
		end
	end
	local langMenu = layout:Dropdown(L.OPT_LANGUAGE, L.OPT_LANGUAGE_TIP,
		function()
			local values = { AUTO }
			for _, locale in ipairs(SpokenZones:GetSelectableLanguages()) do
				table.insert(values, locale)
			end
			return values
		end,
		function()
			local chosen = SpokenZones:GetLanguagePreference()
			for _, locale in ipairs(SpokenZones:GetSelectableLanguages()) do
				if locale.code == chosen then
					return locale
				end
			end
			return AUTO
		end,
		function(locale)
			local code = locale ~= AUTO and locale.code or nil
			if SpokenZones:SetLanguage(code) then
				-- Asked at once rather than left to a line in chat: the failure to avoid is
				-- a player switching, seeing English, and concluding it did not work.
				SpokenLayout.AskReload(string.format(L.OPT_LANG_SET_FMT,
					SpokenZones:GetLanguageName(code or SpokenZones:GetAutoLanguage())),
					L.OPT_RELOAD_NOW, L.OPT_LATER)
			end
		end,
		function() DescribeLanguage() end,
		function(locale)
			-- Named with what it reads now, since that changes with the client.
			if locale == AUTO then
				return string.format(L.OPT_LANG_AUTO_FMT, SpokenZones:GetLanguageName(SpokenZones:GetAutoLanguage()))
			end
			return locale and SpokenZones:GetLanguageName(locale.code) or SpokenZones:GetLanguageName(nil)
		end)
	langNote = layout:Note("", 460, 32)
	DescribeLanguage()
	-- A menu with one language in it chooses nothing: the section waits for a second one.
	local function Choice() return #SpokenZones:GetSelectableLanguages() > 1 end
	layout:ShowWhen(langMenu, Choice)
	layout:ShowWhen(langNote, Choice)

	-- What this character has heard, as on the other pages: forgotten, every place is new again.
	layout:Section(L.OPT_SECTION_HISTORY)
	layout:Button(L.OPT_FORGET_PLACES, 200, function()
		if SpokenZones.ForgetAutoplayHistory then SpokenZones:ForgetAutoplayHistory() end
		SpokenZones:Print(L.OPT_FORGET_PLACES_DONE)
	end, L.OPT_FORGET_PLACES_TIP)

	-- Every voice pack, a row each, as on the quests page: its version where it is installed,
	-- and where it is not, a button with the address to get it. With more than one installed,
	-- which of them reads.
	layout:Section(L.OPT_SECTION_PACKS)
	local GetMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	local function PackRow(addon, name)
		layout:Download(string.format(L.OPT_PACK_NAME_FMT, name), function()
			for _, pack in ipairs(SpokenZones:GetAudioPacks()) do
				if pack.addon == addon then
					return "ok", (GetMeta and GetMeta(addon, "Version")) or L.OPT_PACK_INSTALLED
				end
			end
		end, L.OPT_DOWNLOAD, function()
			SpokenZones:ShowCopyLink(AUDIO_URL, L.OPT_DOWNLOAD_ADDRESS)
		end, L.OPT_DOWNLOAD_TIP)
	end
	PackRow(AUDIO_ADDON, L.OPT_PACK_OFFICIAL)
	local installed = SpokenZones:GetAudioPacks()
	for _, pack in ipairs(installed) do
		if pack.addon ~= AUDIO_ADDON then
			PackRow(pack.addon, SpokenZones:GetAudioPackLabel(pack))
		end
	end
	if #installed > 1 then
		layout:Dropdown(L.OPT_SOUND_PACK, L.OPT_SOUND_PACK_TIP,
			function() return SpokenZones:GetAudioPacks() end,
			function() return SpokenZones:GetActiveAudioPack() end,
			function(pack) SpokenZones:SetActiveAudioPack(pack.addon) end,
			nil,
			function(pack) return pack and SpokenZones:GetAudioPackLabel(pack) or L.OPT_PACK_NONE_INSTALLED end)
	end

	layout:Section(L.OPT_SECTION_TROUBLE)
	-- The same three as every module's page: a story to check the sound with, what is
	-- installed, and where to report the rest.
	layout:Columns(2)
	layout:Button(L.OPT_TEST_LINE, 200, function() SpokenZones:PlayTestLine() end, L.OPT_TEST_LINE_TIP)
	layout:Button(L.OPT_DIAGNOSTICS, 200, function() SpokenZones:ShowDiagnostics() end, L.OPT_DIAGNOSTICS_TIP)
	layout:Columns(nil)
	-- The per-story Report buttons cover a bad story; this covers everything that belongs to
	-- none -- the addon erroring, the voice wrong throughout, the site.
	layout:Button(L.OPT_REPORT_PROBLEM, 200, function()
		SpokenZones:ShowCopyLink(REPORT_URL, L.OPT_REPORT_ADDRESS)
	end, L.OPT_REPORT_NOTE)
	-- Every page ends the same way, as Spoken's does: one section, last, to start over.
	layout:StartOver(L.OPT_SECTION_START_OVER, L.OPT_RESET_PAGE, function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, L.OPT_RESET, L.OPT_CANCEL, function()
			SpokenZones:ResetOptions()
			RedrawEverything()
			layout:Refresh()
		end)
	end, L.OPT_RESET_PAGE_TIP)
	-- Switched off, the module is off: everything on its page greys out but its own switch.
	layout:RequiresAll(PartOn, L.REASON_PART_OFF, switch)
	layout:Refresh()
	content:SetScript("OnShow", refresh)

	-- Derived rather than written as a number: a hardcoded height is a number nobody
	-- updates when a row is added, and the failure it produces is the one this scroller
	-- exists to fix -- a section you cannot reach.
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry when the player can nest it, beside the other parts' pages;
	-- a top-level entry of its own otherwise, as when the player is not installed.
	local page = Spoken and Spoken.AddSettingsPage
		and Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 3, layout, scroller)
	if page then
		SpokenZones.optionsPage = page
	else
		category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Zones")
		Settings.RegisterAddOnCategory(category)
	end

	SpokenZones.optionsPanel = panel
	SpokenZones.optionsCategory = category
end

function SpokenZones:OpenOptions()
	-- Nested under Spoken's entry: Spoken opens this page.
	if self.optionsPage and self.optionsPage.Open and self.optionsPage.Open() then return end
	local category = category or (self.optionsPage and self.optionsPage.category)
	if not category or not (Settings and Settings.OpenToCategory) then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
		return
	end

	-- OpenToCategory takes an ID in some builds and the category object in others,
	-- so try the ID first and fall back rather than erroring.
	local id = category.GetID and category:GetID() or nil
	local ok = id and pcall(Settings.OpenToCategory, id)
	if not ok then
		ok = pcall(Settings.OpenToCategory, category)
	end
	if not ok then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
	end
end

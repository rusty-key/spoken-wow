-- SpokenZones -- the module's page in the game's settings, under Spoken's, laid out by Spoken's
-- UI/Layout.lua so the pages read alike.

local _, SpokenZones = ...

local L = SpokenZones.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25

-- A language's name as Spoken lists it for every module: its own, in English where the font
-- cannot draw it.
local function LanguageName(code)
    if Spoken and Spoken.LanguageName then return Spoken:LanguageName(code) end
    return SpokenZones:GetLanguageName(code)
end
-- The voice pack this addon is made for, and where to get it.
local AUDIO_ADDON = "SpokenZonesAudio"
local AUDIO_URL = "https://www.curseforge.com/wow/addons/spoken-audio-places"

local panel

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
		SpokenZones:Print("|cffffcc00Settings API missing; options panel unavailable (use /spp help)|r")
		return
	end
	-- The words every module's page shares, kept in Spoken.
	local W = Spoken:Words()

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Places"

	-- Everything below is laid out in `content`, not in `panel`. The settings canvas
	-- is a fixed size and neither scrolls nor clips what overflows it, so a panel
	-- with more rows than fit draws them over the game world.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	local layout = SpokenLayout.New(content, INDENT, -16)
	panel.layout = layout
	local refresh = function() layout:Refresh() end

	-- Its own entry under Spoken's. Spoken's page turns the module on and off: off, everything
	-- under it is greyed out and says why, rather than looking live and doing nothing.
	local function PartOn() return SpokenZones:IsPartOn() end
	layout:Intro([[Interface\Icons\INV_Misc_Map02]], L.OPT_PAGE_TITLE)

	-- Every row's position, and the spacing between them, comes from Spoken's UI/Layout.lua, so
	-- the pages read alike.
	local function Get(key) return function() return SpokenZones:Get(key) end end
	local function Set(key) return function(value) SpokenZones:Set(key, value) end end
	-- The voice itself, lower on the page: off, the stories are text only, and nothing reads them.
	local voiced = Get("voiceEnabled")

	-- When a story is read, first: it is what most players install this for.
	layout:Section(W.MODULE_WHEN)
	local discovery = layout:Checkbox(L.OPT_AUTOPLAY, nil,
		Get("autoplay"), Set("autoplay"), function()
			if not SpokenZones:Get("autoplay") then
				SpokenZones:StopLore()
			end
			layout:Refresh()
		end)
	layout:Requires(discovery, voiced, L.REASON_VOICE)
	-- Indented and greyed with automatic reading off: both only shape what it reads.
	local discovering = Get("autoplay")
	layout:Indent()
	local smaller = layout:Checkbox(L.OPT_AUTOPLAY_SUB, nil,
		Get("autoplaySubzones"), Set("autoplaySubzones"))
	local before = layout:Checkbox(L.OPT_AUTOPLAY_EXPLORED, L.OPT_AUTOPLAY_EXPLORED_TIP,
		Get("autoplayExplored"), Set("autoplayExplored"))
	for _, row in ipairs({ smaller, before }) do
		layout:Requires(row, voiced, L.REASON_VOICE)
		layout:Requires(row, discovering, L.REASON_DISCOVERY)
	end
	layout:Outdent()

	-- The stories themselves: beside the map, with their pictures, read aloud, and in which
	-- language their text is.
	layout:Section(L.OPT_SECTION_MAP)
	layout:Checkbox(L.OPT_MAP_PANEL, nil,
		Get("showMapPanel"), function(value) SpokenZones:SetMapPanelShown(value) end,
		function() RedrawPanel(); layout:Refresh() end)
	local besideMap = Get("showMapPanel")
	layout:Indent()
	layout:Requires(layout:Slider(L.OPT_PANEL_WIDTH, 220, 520, 10,
		Get("panelWidth"), Set("panelWidth"), RedrawPanel, SpokenLayout.Number),
		besideMap, L.REASON_MAP_PANEL)
	layout:Outdent()
	-- Beside the map, in Azeroth's Compendium and in the reading window alike.
	layout:Checkbox(L.OPT_PICTURES, nil,
		Get("showPictures"), Set("showPictures"), RedrawEverything)
	layout:Slider(L.OPT_MAP_HIGHLIGHT, 0, 1, 0.05, Get("highlightOpacity"), Set("highlightOpacity"),
		function() SpokenZones:RefreshMapHighlight() end)
	layout:Checkbox(L.OPT_PLAY_BUTTON, nil,
		voiced, Set("voiceEnabled"), function()
			SpokenZones:StopLore()
			SpokenZones:NotifyAudioChanged()
			layout:Refresh()
		end)
	-- The text's language. The voice is Spoken's Voice Language; this picks only the words.
	-- Only finished languages are offered: a player choosing from a list has no way to know that
	-- half a translation is missing, and would report the English that shows through as a bug.
	-- Auto stores no language at all, so it keeps following the client: switch the game to French
	-- and the text is French. Every other entry pins its language.
	local AUTO = {}
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
		refresh,
		function(locale)
			-- Named with what it reads now, since that changes with the client.
			if locale == AUTO then
				return string.format(L.OPT_LANG_AUTO_FMT, SpokenZones:GetLanguageName(SpokenZones:GetAutoLanguage()))
			end
			return locale and SpokenZones:GetLanguageName(locale.code) or SpokenZones:GetLanguageName(nil)
		end)
	-- A switch takes effect on the next load, which the note says until then.
	local langNote = layout:Note(L.OPT_LANG_RELOAD, 460, 16)
	-- A menu with one language in it chooses nothing.
	local function Choice() return #SpokenZones:GetSelectableLanguages() > 1 end
	layout:ShowWhen(langMenu, Choice)
	layout:ShowWhen(langNote, function()
		local chosen = SpokenZones:GetLanguagePreference() or SpokenZones:GetAutoLanguage()
		return Choice() and chosen ~= SpokenZones:GetLanguage()
	end)

	-- Every voice pack, a row each named by its language, as on the quests page: its version
	-- where it is installed, and where it is not, a button with the address to get it.
	layout:Section(W.PART_VOICE)
	local GetMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	-- No pack in the voice language, and nothing to fall back on: said here, or the page goes
	-- quiet with no word why.
	local silent = layout:Note("", nil, 32)
	layout:OnRefresh(function() silent:SetText(Spoken:SilentNote("zones") or "") end)
	layout:ShowWhen(silent, function() return Spoken:SilentNote("zones") ~= nil end)
	-- The packs to get are the voice language's; any pack installed is listed too. Not the
	-- fallback's to get, unless the voice language has no pack of its own (itIT).
	local function Installed(addon)
		for _, pack in ipairs(SpokenZones:GetAudioPacks()) do
			if pack.addon == addon then return true end
		end
		return false
	end
	local function Wanted(code, addon)
		local voice = SpokenZones:GetVoiceLanguage()
		if code == voice or Installed(addon) then return true end
		local own = voice == "enUS" or Spoken:VoicePack("zones", voice)
		return not own and code == SpokenZones:GetFallbackLanguage()
	end
	-- The packs for what the player will hear, each language's shown while that language is wanted.
	local listed = {}
	local function PackRow(addon, name, url)
		listed[addon] = true
		return layout:Download(name, function()
			if Installed(addon) then
				return "ok", (GetMeta and GetMeta(addon, "Version")) or W.MODULE_INSTALLED
			end
		end, W.MODULE_DOWNLOAD, function()
			SpokenZones:ShowCopyLink(url or AUDIO_URL, L.OPT_DOWNLOAD_ADDRESS)
		end)
	end
	for _, locale in ipairs(SpokenZones.LOCALES or {}) do
		local folder, url = Spoken:VoicePack("zones", locale.code)
		if folder then
			local code = locale.code
			layout:ShowWhen(PackRow(folder, LanguageName(code), url), function() return Wanted(code, folder) end)
		end
	end
	layout:ShowWhen(PackRow(AUDIO_ADDON, LanguageName("enUS")), function() return Wanted("enUS", AUDIO_ADDON) end)
	-- A pack the list does not know, after the ones it does.
	for _, pack in ipairs(SpokenZones:GetAudioPacks()) do
		if not listed[pack.addon] then
			PackRow(pack.addon, SpokenZones:GetAudioPackLabel(pack))
		end
	end
	layout:Button(W.MODULE_TEST_LINE, 200, function() SpokenZones:PlayTestLine() end)

	-- What this character has heard, as on the other pages: forgotten, every place is new again.
	layout:Section(W.MODULE_HISTORY)
	layout:Button(L.OPT_FORGET_PLACES, 200, function()
		if SpokenZones.ForgetAutoplayHistory then SpokenZones:ForgetAutoplayHistory() end
		SpokenZones:Print(L.OPT_FORGET_PLACES_DONE)
	end)

	-- The page's Defaults, as Spoken's has.
	layout:Defaults(function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, W.MODULE_RESET, W.CANCEL, function()
			SpokenZones:ResetOptions()
			RedrawEverything()
			layout:Refresh()
		end)
	end, nil, W.OPT_RESET_ALL_TIP)
	-- Switched off, the module is off: everything on its page greys out.
	layout:RequiresAll(PartOn, W.REASON_PART_OFF)
	layout:Refresh()
	content:SetScript("OnShow", refresh)
	-- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
	Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "zones" then refresh() end end)

	-- Derived rather than written as a number: a hardcoded height is a number nobody
	-- updates when a row is added, and the failure it produces is the one this scroller
	-- exists to fix -- a section you cannot reach.
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry, beside the other modules' pages.
	SpokenZones.optionsPage = Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 3, layout, scroller)
	SpokenZones.optionsPanel = panel
end

function SpokenZones:OpenOptions()
	-- Nested under Spoken's entry: Spoken opens this page.
	if not (self.optionsPage and self.optionsPage.Open()) then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken -> Zones")
	end
end

-- Spoken > Developer: why a place was or was not read, in chat; and the text languages not
-- finished yet, offered under Text Language (otherwise /spp lang <code> force).
if Spoken and Spoken.AddDeveloperSettings then
	Spoken:AddDeveloperSettings(function(layout)
		layout:Checkbox(L.OPT_DEV_DEBUG, nil, function() return SpokenZones:Get("debug") end,
			function(value) SpokenZones:Set("debug", value) end)
		return function() SpokenZones:Set("debug", false) end
	end, "chat", 3)
	Spoken:AddDeveloperSettings(function(layout)
		layout:Checkbox(L.OPT_DEV_PREVIEW, nil, function() return SpokenZones:IsPreviewingLanguage() end,
			function(value) SpokenZones:SetLanguagePreview(value) end)
		return function() SpokenZones:SetLanguagePreview(false) end
	end, "testing", 3)
end

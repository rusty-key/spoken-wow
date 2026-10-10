-- SpokenBooks -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, and laid out by the UI/Layout.lua
-- every Spoken addon carries a copy of, so this panel and the other three read alike.
-- UI/Options.lua on the zones side is the same file one size larger; the reasoning for both
-- choices is written down there.
--
-- Every switch here also has a slash command, and always will: the settings panel is the
-- Settings API's, and a client that does not offer one must still leave the addon
-- configurable. /spb is what the Print below points at when that happens.

local ADDON_NAME, SpokenBooks = ...

local L = SpokenBooks.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
-- The voice pack this addon is made for, and where to get it.
local AUDIO_ADDON = "SpokenBooksAudio"
local AUDIO_URL = "https://www.curseforge.com/wow/addons/spoken-books-audio"

local panel, category

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenBooks:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		self:Print("|cffffcc00Settings API missing; options panel unavailable (use /spb)|r")
		return
	end

	if not SpokenLayout then
		-- Carried, not shared, so this can only be a broken install -- and saying so beats a
		-- panel that half-draws.
		self:Print("|cffffcc00UI/Layout.lua did not load; options panel unavailable|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Books"

	-- Laid out in the scroller's content frame rather than on the panel itself: the settings
	-- canvas is a fixed size and neither scrolls nor clips, so rows that overflow it draw
	-- over the game world. Three rows fit today; the next one added should not have to
	-- discover this.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	local layout = SpokenLayout.New(content, INDENT, -16)
	layout:Header(L.OPT_PAGE_TITLE, L.OPT_NOTE, nil, [[Interface\Icons\INV_Misc_Book_09]])
	local refresh = function() layout:Refresh() end

	-- The part's own switch first, as on Spoken's page: off, everything under it is greyed
	-- out and says why, rather than looking live and doing nothing.
	local switch
	local function PartOn() return SpokenBooks:IsPartOn() end
	-- Its own entry, nested under Spoken in the game's settings list and headed as the game's
	-- pages are, with its switch first: the page is there whether the part is on or not. The
	-- part's card on Spoken's page turns it on and off too.
	if Spoken and Spoken.SettingsStyle and Spoken:SettingsStyle() == "pages" then
		layout:HideHeader()
		layout:Intro([[Interface\Icons\INV_Misc_Book_09]], L.OPT_PAGE_TITLE)
		switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
			function(value) Spoken:SetPartOn("books", value) end, refresh)
	else
		-- A player too old to nest pages: how this part stands -- on or off, and its voice
		-- packs -- before any setting, worded as on its card on Spoken's page.
		if Spoken and Spoken.PartStatus then
			layout:Status(function() return Spoken:PartStatus("books") end)
		end
		if Spoken and Spoken.IsPartOn then
			switch = layout:Checkbox(L.OPT_PART_SWITCH, L.OPT_PART_SWITCH_TIP, PartOn,
				function(value) Spoken:SetPartOn("books", value) end, refresh)
		end
	end

	local function Get(key)
		return function() return SpokenBooksSettings and SpokenBooksSettings[key] end
	end
	local function Set(key)
		return function(value) if SpokenBooksSettings then SpokenBooksSettings[key] = value end end
	end

	layout:Section(L.OPT_SECTION_READING)
	local autoplay = Get("autoplay")
	layout:Checkbox(L.OPT_AUTOPLAY,
		L.OPT_AUTOPLAY_TIP,
		autoplay, Set("autoplay"), refresh)
	-- Indented under it and greyed with it off: only automatic reading skips a book already
	-- heard (Events.lua); Play reads it again whatever this says.
	layout:Indent()
	local once = layout:Checkbox(L.OPT_READ_ONCE,
		L.OPT_READ_ONCE_TIP,
		Get("readOnce"), Set("readOnce"))
	layout:Outdent()
	layout:Requires(once, function() return SpokenBooksSettings ~= nil and autoplay() ~= false end, L.REASON_AUTOPLAY)
	layout:Checkbox(L.OPT_WHOLE_BOOK,
		L.OPT_WHOLE_BOOK_TIP,
		Get("readWholeBook"), Set("readWholeBook"))
	layout:Checkbox(L.OPT_STOP_ON_CLOSE,
		L.OPT_STOP_ON_CLOSE_TIP,
		Get("stopOnClose"), Set("stopOnClose"))

	-- The voice language is set once for every module, on Spoken's page. Here only where the
	-- player is too old to have that setting.
	if not (Spoken and Spoken.GetLanguageChoice) then
		layout:Section(L.OPT_SECTION_LANGUAGE)
		local voices = { SpokenBooks.AUTO_LANGUAGE }
		local fallbacks = { "none" }
		for _, locale in ipairs(SpokenBooks.LOCALES or {}) do
			table.insert(voices, locale.code)
			table.insert(fallbacks, locale.code)
		end
		layout:Dropdown(L.OPT_VOICE_LANGUAGE, L.OPT_VOICE_LANGUAGE_TIP,
			voices, Get("voiceLanguage"), Set("voiceLanguage"), nil, function(code)
				if code == SpokenBooks.AUTO_LANGUAGE then
					return L.OPT_LANG_AUTO_FMT:format(
						SpokenBooks:GetLanguageName(SpokenBooks:GetClientLanguage()))
				end
				return SpokenBooks:GetLanguageName(code)
			end)
		layout:Dropdown(L.OPT_FALLBACK_LANGUAGE, L.OPT_FALLBACK_LANGUAGE_TIP,
			fallbacks, Get("fallbackLanguage"), Set("fallbackLanguage"), nil, function(code)
				return code == "none" and L.OPT_FALLBACK_NONE or SpokenBooks:GetLanguageName(code)
			end)
	end

	-- What this character has heard, before the voice packs, as on the other modules' pages.
	layout:Section(L.OPT_SECTION_READ)
	layout:Button(L.OPT_FORGET, 200, function()
		local count = SpokenBooks:ForgetRead()
		SpokenBooks:Print(L.OPT_FORGET_DONE_FMT:format(count))
	end, L.OPT_FORGET_TIP)

	-- Every writing, found or not, in Azeroth's Compendium (UI/Readables.lua): opened, and unlocked,
	-- from Spoken's page where Spoken is installed (Spoken:ShowsCompendium). Here only without it.
	if SpokenBooks.ShowReadables and not (Spoken and Spoken.ShowsCompendium) then
		layout:Section(L.COMPENDIUM_TITLE)
		layout:Button(L.OPT_OPEN_READABLES, 200, function() SpokenBooks:ShowReadables() end, L.OPT_OPEN_READABLES_TIP)
		layout:Checkbox(L.OPT_UNLOCK_UNFOUND, L.OPT_UNLOCK_UNFOUND_TIP,
			Get("unlockUnfound"), Set("unlockUnfound"),
			function() if SpokenBooks.RefreshReadables then SpokenBooks:RefreshReadables() end end)
	end

	-- Every voice pack, a row each, as on the quests page: its version where it is installed,
	-- and where it is not, a button with the address to get it.
	layout:Section(L.OPT_SECTION_PACKS)
	local GetMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	-- The packs to get are the voice language's; any pack installed is listed too. Not the
	-- fallback's to get: it buried the one that mattered. But a voice language with no pack of its
	-- own (itIT) is heard in the fallback's, so that is the one to get there.
	local function Installed(addon)
		for _, pack in ipairs(SpokenBooks:GetAudioPacks()) do
			if pack.addon == addon then return true end
		end
		return false
	end
	local function Wanted(code, addon)
		local voice = SpokenBooks:GetVoiceLanguage()
		if code == voice or Installed(addon) then return true end
		local own = voice == "enUS" or (Spoken and Spoken.VoicePack and Spoken:VoicePack("books", voice))
		return not own and code == SpokenBooks:GetFallbackLanguage()
	end
	-- Each language's row shown while it is wanted.
	local listed = {}
	local function PackRow(addon, name, url)
		listed[addon] = true
		return layout:Download(L.OPT_PACK_NAME_FMT:format(name), function()
			for _, pack in ipairs(SpokenBooks:GetAudioPacks()) do
				if pack.addon == addon then
					return "ok", (GetMeta and GetMeta(addon, "Version")) or L.OPT_PACK_INSTALLED
				end
			end
		end, L.OPT_DOWNLOAD, function()
			SpokenBooks:ShowCopyLink(url or AUDIO_URL, L.OPT_DOWNLOAD_ADDRESS)
		end, L.OPT_DOWNLOAD_TIP)
	end
	for _, locale in ipairs(SpokenBooks.LOCALES or {}) do
		local folder, url = Spoken and Spoken.VoicePack and Spoken:VoicePack("books", locale.code)
		if folder then
			local code = locale.code
			layout:ShowWhen(PackRow(folder, SpokenBooks:GetLanguageName(code), url), function() return Wanted(code, folder) end)
		end
	end
	layout:ShowWhen(PackRow(AUDIO_ADDON, L.OPT_PACK_OFFICIAL), function() return Wanted("enUS", AUDIO_ADDON) end)
	-- A pack the list does not know, after the ones it does.
	for _, pack in ipairs(SpokenBooks:GetAudioPacks()) do
		if not listed[pack.addon] then PackRow(pack.addon, pack.title or pack.addon) end
	end

	-- The same three as every module's page: a page to check the sound with, what is
	-- installed, and where to report the rest.
	layout:Section(L.OPT_SECTION_TROUBLE)
	layout:Columns(2)
	layout:Button(L.OPT_TEST_LINE, 200, function() SpokenBooks:PlayTestLine() end, L.OPT_TEST_LINE_TIP)
	layout:Button(L.OPT_DIAGNOSTICS, 200, function() SpokenBooks:ShowStatus() end, L.OPT_DIAGNOSTICS_TIP)
	layout:Columns(nil)
	layout:Button(L.OPT_REPORT_PROBLEM, 200, function()
		SpokenBooks:ShowCopyLink(SpokenBooks.SITE_URL, L.OPT_REPORT_ADDRESS)
	end, L.OPT_REPORT_PROBLEM_TIP)

	-- Every page ends the same way, as Spoken's does: one section, last, to start over.
	layout:StartOver(L.OPT_SECTION_START_OVER, L.OPT_RESET_PAGE, function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, L.OPT_RESET, L.OPT_CANCEL, function()
			SpokenBooks:ResetOptions()
			layout:Refresh()
		end)
	end, L.OPT_RESET_PAGE_TIP)
	-- Switched off, the module is off: everything on its page greys out but its own switch.
	layout:RequiresAll(PartOn, L.REASON_PART_OFF, switch)
	layout:Refresh()
	content:SetScript("OnShow", refresh)
	-- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
	if Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "books" then refresh() end end)
	end

	-- Derived rather than written as a number: a hardcoded height is a number nobody updates
	-- when a row is added, and what that produces is a section you cannot scroll to.
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry when the player can nest it, named as DialogueUI names the
	-- same things; a top-level entry of its own otherwise.
	local page = Spoken and Spoken.AddSettingsPage
		and Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 3, layout, scroller)
	if page then
		SpokenBooks.optionsPage = page
	else
		category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Books")
		Settings.RegisterAddOnCategory(category)
	end

	SpokenBooks.optionsPanel = panel
	SpokenBooks.optionsCategory = category
end

--- Open the panel, or say why there is none. Reached by `/spb settings`, the player's
--- minimap menu and the settings link on the player's own panel.
function SpokenBooks:OpenOptions()
	-- Nested under Spoken's entry: Spoken opens this page.
	if self.optionsPage and self.optionsPage.Open and self.optionsPage.Open() then return end
	local category = category or (self.optionsPage and self.optionsPage.category)
	if not (SpokenLayout and SpokenLayout.OpenCategory(category)) then
		self:Print(self.optionsPage and "open Game Menu -> Options -> AddOns -> Spoken -> Books"
			or "open Game Menu -> Options -> AddOns -> Spoken Books")
	end
end

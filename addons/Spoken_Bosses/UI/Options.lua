local _, Bosses = ...

-- The Bosses page in the game's settings, under Spoken's, laid out by Spoken's UI/Layout.lua so
-- the pages read alike.

local L = Bosses.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25

-- The voice pack this addon is made for, and where to get it. CurseForge has no bosses project: the
-- pack is in the Places and Bosses download.
local AUDIO_ADDON = "SpokenBossesAudio"
local AUDIO_URL = "https://www.curseforge.com/wow/addons/spoken-audio-places"
-- The languages a pack beside English's may be in: Spoken:VoicePack says which have one.
local LANGUAGES = { "deDE", "esES", "esMX", "frFR", "itIT", "ptBR", "ruRU", "koKR", "zhCN", "zhTW" }

local panel

function Bosses:SetupOptions()
	if panel or not (Spoken and Spoken.AddSettingsPage and SpokenLayout) then
		return
	end
	-- The words every module's page shares, kept in Spoken.
	local W = Spoken:Words()

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Bosses"
	-- The settings canvas neither scrolls nor clips: the rows go in the scroller's content frame.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content
	local layout = SpokenLayout.New(content, INDENT, -16)
	panel.layout = layout
	local refresh = function() layout:Refresh() end

	layout:Intro(Bosses.ICON, L.OPT_PAGE_TITLE)

	-- Every voice pack, a row each named by its language, as on the Places and Readables pages:
	-- its version where it is installed, and where it is not, a button with the address to get it.
	layout:Section(W.PART_VOICE)
	local GetMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	-- No pack in the voice language, and nothing to fall back on: said here, or the page goes
	-- quiet with no word why.
	local silent = layout:Note("", nil, 32)
	layout:OnRefresh(function() silent:SetText(Spoken:SilentNote("bosses") or "") end)
	layout:ShowWhen(silent, function() return Spoken:SilentNote("bosses") ~= nil end)
	-- The packs to get are the voice language's; any pack installed is listed too. Not the
	-- fallback's to get, unless the voice language has no pack of its own.
	local function Installed(addon)
		for _, pack in ipairs(Bosses:GetAudioPacks()) do
			if pack.addon == addon then return true end
		end
		return false
	end
	local function Wanted(code, addon)
		local voice = Bosses:GetVoiceLanguage()
		if code == voice or Installed(addon) then return true end
		local own = voice == "enUS" or Spoken:VoicePack("bosses", voice)
		return not own and code == Bosses:GetFallbackLanguage()
	end
	local listed = {}
	local function PackRow(addon, name, url)
		listed[addon] = true
		return layout:Download(name, function()
			if Installed(addon) then
				return "ok", (GetMeta and GetMeta(addon, "Version")) or W.MODULE_INSTALLED
			end
		end, W.MODULE_DOWNLOAD, function()
			Bosses:ShowCopyLink(url or AUDIO_URL, L.OPT_DOWNLOAD_ADDRESS)
		end)
	end
	for _, code in ipairs(LANGUAGES) do
		local folder, url = Spoken:VoicePack("bosses", code)
		if folder then
			layout:ShowWhen(PackRow(folder, Spoken:LanguageName(code), url), function() return Wanted(code, folder) end)
		end
	end
	layout:ShowWhen(PackRow(AUDIO_ADDON, Spoken:LanguageName("enUS")), function() return Wanted("enUS", AUDIO_ADDON) end)
	-- A pack the list does not know, after the ones it does.
	for _, pack in ipairs(Bosses:GetAudioPacks()) do
		if not listed[pack.addon] then PackRow(pack.addon, pack.title or pack.addon) end
	end

	-- What this character was shown: forgotten, each story shows once more.
	layout:Section(W.MODULE_HISTORY)
	layout:Button(L.OPT_FORGET_STORIES, 200, function()
		print("|cff66bbffSpoken:|r " .. L.OPT_FORGET_STORIES_DONE_FMT:format(Bosses:ForgetStories()))
	end)

	layout:Defaults(function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, W.MODULE_RESET, W.CANCEL, function()
			Bosses:ResetOptions()
			layout:Refresh()
			Bosses:RefreshBosses()
		end)
	end, nil, W.OPT_RESET_ALL_TIP)
	layout:Refresh()
	content:SetScript("OnShow", refresh)
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry, after the other modules' pages.
	Bosses.optionsPage = Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 5, layout, scroller)
	Bosses.optionsPanel = panel
end

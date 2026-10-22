-- SpokenBooks -- the module's page in the game's settings, under Spoken's, laid out by Spoken's
-- UI/Layout.lua so the pages read alike.
--
-- Every switch here also has a slash command, and always will: the settings panel is the
-- Settings API's, and a client that does not offer one must still leave the addon
-- configurable. /spr is what the Print below points at when that happens.

local _, SpokenBooks = ...

local L = SpokenBooks.L

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25

-- A language's name as Spoken lists it for every module: its own, in English where the font
-- cannot draw it.
local function LanguageName(code)
    if Spoken and Spoken.LanguageName then return Spoken:LanguageName(code) end
    return SpokenBooks:GetLanguageName(code)
end
-- The voice pack this addon is made for, and where to get it.
local AUDIO_ADDON = "SpokenBooksAudio"
local AUDIO_URL = "https://www.curseforge.com/wow/addons/spoken-audio-readables"

local panel

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenBooks:SetupOptions()
	if panel then
		return
	end

	-- The words every module's page shares, kept in Spoken.
	local W = Spoken:Words()

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Readables"

	-- Laid out in the scroller's content frame rather than on the panel itself: the settings
	-- canvas is a fixed size and neither scrolls nor clips, so rows that overflow it draw
	-- over the game world.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	local layout = SpokenLayout.New(content, INDENT, -16)
	local refresh = function() layout:Refresh() end

	-- Its own entry under Spoken's. Spoken's page turns the module on and off: off, everything
	-- under it is greyed out and says why, rather than looking live and doing nothing.
	local function PartOn() return SpokenBooks:IsPartOn() end
	layout:Intro([[Interface\Icons\INV_Misc_Book_09]], L.OPT_PAGE_TITLE)

	local function Get(key)
		return function() return SpokenBooks:Get(key) end
	end
	local function Set(key)
		return function(value) SpokenBooks:Set(key, value) end
	end

	layout:Section(W.MODULE_WHEN)
	local autoplay = Get("autoplay")
	layout:Checkbox(L.OPT_AUTOPLAY, nil, autoplay, Set("autoplay"), refresh)
	-- Indented under it and greyed with it off: only automatic reading skips a book already
	-- heard (Events.lua); Play reads it again whatever this says.
	layout:Indent()
	local once = layout:Checkbox(L.OPT_READ_ONCE, nil, Get("readOnce"), Set("readOnce"), refresh)
	layout:Outdent()
	layout:Requires(once, function() return autoplay() ~= false end, L.REASON_AUTOPLAY)
	local whole = Get("readWholeBook")
	layout:Checkbox(L.OPT_WHOLE_BOOK, nil, whole, Set("readWholeBook"), refresh)
	-- One line for the whole book is only a choice where the whole book is read.
	layout:Indent()
	local oneLine = layout:Checkbox(L.OPT_ONE_LINE, nil, Get("bookAsOneLine"), Set("bookAsOneLine"))
	layout:Outdent()
	layout:Requires(oneLine, function() return whole() ~= false end, L.REASON_WHOLE_BOOK)
	layout:Checkbox(L.OPT_STOP_ON_CLOSE, nil, Get("stopOnClose"), Set("stopOnClose"))
	layout:Checkbox(L.OPT_CLOSE_WHEN_READ, nil, Get("closeWhenRead"), Set("closeWhenRead"))

	-- Every voice pack, a row each named by its language, as on the quests page: its version
	-- where it is installed, and where it is not, a button with the address to get it.
	layout:Section(W.PART_VOICE)
	local GetMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	-- No pack in the voice language, and nothing to fall back on: said here, or the page goes
	-- quiet with no word why.
	local silent = layout:Note("", nil, 32)
	layout:OnRefresh(function() silent:SetText(Spoken:SilentNote("books") or "") end)
	layout:ShowWhen(silent, function() return Spoken:SilentNote("books") ~= nil end)
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
		local own = voice == "enUS" or Spoken:VoicePack("books", voice)
		return not own and code == SpokenBooks:GetFallbackLanguage()
	end
	-- Each language's row shown while it is wanted.
	local listed = {}
	local function PackRow(addon, name, url)
		listed[addon] = true
		return layout:Download(name, function()
			if Installed(addon) then
				return "ok", (GetMeta and GetMeta(addon, "Version")) or W.MODULE_INSTALLED
			end
		end, W.MODULE_DOWNLOAD, function()
			SpokenBooks:ShowCopyLink(url or AUDIO_URL, L.OPT_DOWNLOAD_ADDRESS)
		end)
	end
	for _, locale in ipairs(SpokenBooks.LOCALES or {}) do
		local folder, url = Spoken:VoicePack("books", locale.code)
		if folder then
			local code = locale.code
			layout:ShowWhen(PackRow(folder, LanguageName(code), url), function() return Wanted(code, folder) end)
		end
	end
	layout:ShowWhen(PackRow(AUDIO_ADDON, LanguageName("enUS")), function() return Wanted("enUS", AUDIO_ADDON) end)
	-- A pack the list does not know, after the ones it does.
	for _, pack in ipairs(SpokenBooks:GetAudioPacks()) do
		if not listed[pack.addon] then PackRow(pack.addon, pack.title or pack.addon) end
	end
	layout:Button(W.MODULE_TEST_LINE, 200, function() SpokenBooks:PlayTestLine() end)

	-- What this character has heard, as on the other modules' pages. It only matters while a
	-- writing is read once.
	layout:Section(W.MODULE_HISTORY)
	local forget = layout:Button(L.OPT_FORGET, 200, function()
		local count = SpokenBooks:ForgetRead()
		SpokenBooks:Print(L.OPT_FORGET_DONE_FMT:format(count))
	end)
	layout:Requires(forget, function() return SpokenBooks:Get("readOnce") == true end, L.REASON_READ_ONCE)

	-- The page's Defaults, as Spoken's has.
	layout:Defaults(function()
		SpokenLayout.Confirm(L.OPT_RESET_PAGE_CONFIRM, W.MODULE_RESET, W.CANCEL, function()
			SpokenBooks:ResetOptions()
			layout:Refresh()
			-- Found Only, Voiced Only and By Zone are among them: a Readables tab open beside this page
			-- is drawn again for them.
			if SpokenBooks.RefreshReadables then SpokenBooks:RefreshReadables() end
		end)
	end, nil, W.OPT_RESET_ALL_TIP)
	-- Switched off, the module is off: everything on its page greys out.
	layout:RequiresAll(PartOn, W.REASON_PART_OFF)
	layout:Refresh()
	content:SetScript("OnShow", refresh)
	-- Switched on or off from Spoken's page while this one was hidden: drawn again for it.
	Spoken:RegisterCallback("PART_SWITCHED", function(part) if part == "books" then refresh() end end)

	-- Derived rather than written as a number: a hardcoded height is a number nobody updates
	-- when a row is added, and what that produces is a section you cannot scroll to.
	scroller:SetContentHeight(layout:Height() + 40)

	-- Under Spoken's own entry, beside the other modules' pages.
	SpokenBooks.optionsPage = Spoken:AddSettingsPage(panel, L.OPT_PAGE_TITLE, 4, layout, scroller)
	SpokenBooks.optionsPanel = panel
end

--- Open the panel, or say why there is none. Reached by `/spr settings`, the player's
--- minimap menu and the settings link on the player's own panel.
function SpokenBooks:OpenOptions()
	-- Nested under Spoken's entry: Spoken opens this page.
	if not (self.optionsPage and self.optionsPage.Open()) then
		self:Print("open Game Menu -> Options -> AddOns -> Spoken -> Readables")
	end
end

-- Spoken > Developer: why a page was or was not read, in chat (/spr debug).
if Spoken and Spoken.AddDeveloperSettings then
	Spoken:AddDeveloperSettings(function(layout)
		layout:Checkbox(L.OPT_DEV_DEBUG, nil, function() return SpokenBooks:Get("debug") end,
			function(value) SpokenBooks:Set("debug", value) end)
		return function() SpokenBooks:Set("debug", false) end
	end, "chat", 4)
end

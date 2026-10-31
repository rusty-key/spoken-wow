-- SpokenPlaces -- the language axis.
--
-- Two identifiers live here and are deliberately never merged:
--
--   client locale   GetLocale(). Decides what GetSubZoneText and
--                   MapUtil.FindBestAreaNameAtMouse hand back, and therefore
--                   which alias table turns those names into corpus keys. Also
--                   decides which glyphs the client's fonts can draw -- and,
--                   for that same reason, which interface strings load: a client
--                   only ever loads its own locale's file, so its UI is always
--                   renderable.
--
--   content language  What the player chose to read and hear. Decides which
--                   lore table is primary and which sound pack plays. Deliberately
--                   NOT which UI strings are used: those follow the client, so a
--                   translation shows the moment it exists instead of waiting for
--                   the whole lore corpus to be finished.
--
-- A German client reading English lore still needs German aliases. Getting that
-- backwards is the failure that presents as "the addon just does not work in
-- German", so every function below says which of the two it takes.
--
-- This file loads before Core.lua and before anything under Data/, because the
-- generated data files ask ShouldLoadLanguage whether to build their tables at
-- all. That question can only be answered this early because Spoken_Places.toc sets
-- LoadSavedVariablesFirst -- SpokenPlacesSettings is already populated when these files
-- run. Removing that .toc line does not error; it silently pins every player to
-- English.

local ADDON_NAME, SpokenPlaces = ...

-- The saved variables were SpokenZonesSettings and SpokenZonesCharacter before the module was
-- Places. The .toc lists the old names after the new, so they are loaded once more and carried
-- over here; left nil, they are not saved again.
if SpokenPlacesSettings == nil then SpokenPlacesSettings = SpokenZonesSettings end
if SpokenPlacesCharacter == nil then SpokenPlacesCharacter = SpokenZonesCharacter end
SpokenZonesSettings, SpokenZonesCharacter = nil, nil

-- The settings live in Spoken's profile (Spoken:BindModuleSettings), copied from
-- SpokenZonesSettings the first time. `dump` is a developer's scratch table, not a setting.
-- Bound here, before anything reads the language, and again in Core.lua's InitConfig.
function SpokenPlaces:BindSettings()
	if not (Spoken and Spoken.BindModuleSettings) then return end
	Spoken:BindModuleSettings("Places", SpokenPlacesSettings, function(settings)
		SpokenPlacesSettings = settings
		if SpokenPlaces.OnSettingsBound then SpokenPlaces:OnSettingsBound() end
	end, { dump = true })
end
SpokenPlaces:BindSettings()

-- Every locale a Classic Era or Anniversary client can run in, plus the
-- languages a community translates into that no client ships (`client = false`:
-- Italian, Vietnamese). GetLocale() never returns one of those, so it has no aliases and no
-- interface strings, and Auto never lands on it; a player reads it by choosing
-- it. A code absent here can never be selected, so the list is the addon's definition of "a
-- language", not a list of languages that have content -- readiness is a
-- separate question, answered by Data/Languages.lua.
--
-- `script` is what the client's fonts must be able to draw. `name` is ASCII so
-- it survives being printed on a client whose fonts cannot draw `native`.
-- `native` is the endonym shown wherever a language is listed -- Latin-script
-- endonyms draw on every client, and anything else is only ever listed where
-- CanRenderLanguage already passed, so no list can show boxes.
--
-- Must stay in step with LOCALES in tools/lib/locales.mjs; tools/validate.mjs
-- fails the build if the two lists drift.
SpokenPlaces.LOCALES = {
	{ code = "enUS", name = "English", native = "English", script = "latin" },
	{ code = "deDE", name = "German", native = "Deutsch", script = "latin" },
	{ code = "esES", name = "Spanish (EU)", native = "Español (España)", script = "latin" },
	{ code = "esMX", name = "Spanish (AL)", native = "Español (América Latina)", script = "latin" },
	{ code = "frFR", name = "French", native = "Français", script = "latin" },
	{ code = "itIT", name = "Italian", native = "Italiano", script = "latin", client = false },
	{ code = "ptBR", name = "Portuguese", native = "Português", script = "latin" },
	{ code = "ruRU", name = "Russian", native = "Русский", script = "cyrillic" },
	{ code = "koKR", name = "Korean", native = "한국어", script = "korean" },
	{ code = "zhCN", name = "Chinese (S)", native = "简体中文", script = "simplifiedchinese" },
	{ code = "zhTW", name = "Chinese (T)", native = "繁體中文", script = "traditionalchinese" },
	{ code = "viVN", name = "Vietnamese", native = "Tiếng Việt", script = "vietnamese", client = false },
}

local BASE = "enUS"

local byCode = {}
for i = 1, #SpokenPlaces.LOCALES do
	byCode[SpokenPlaces.LOCALES[i].code] = SpokenPlaces.LOCALES[i]
end

SpokenPlaces.clientLocale = GetLocale()

-- Whether a game client runs in this language. See `client` on LOCALES.
function SpokenPlaces:IsClientLanguage(code)
	local locale = code and byCode[code]
	return locale ~= nil and locale.client ~= false
end

-- Localized area name -> English corpus key, keyed by *client* locale.
-- Populated by Data/<locale>/Aliases.lua.
SpokenPlaces.Aliases = {}
-- Localized area name -> uiMapID -> English corpus key, for a name the client gives more than
-- one place. Only in the alias files built since the table existed.
SpokenPlaces.ZoneAliases = {}

--------------------------------------------------------------------------------
-- Readiness
--------------------------------------------------------------------------------

-- Coverage per language, generated by tools/locale/build-languages.mjs into
-- Data/Languages.lua. Declared here so this file works before that one loads and
-- on a build where it is missing: without it only English exists, which is the
-- state the addon shipped in for its whole life so far.
SpokenPlaces.Languages = SpokenPlaces.Languages or {}

local function coverage(code)
	local list = SpokenPlaces.Languages
	for i = 1, #list do
		if list[i].code == code then
			return list[i]
		end
	end
	return nil
end

-- A language is ready when every lore line has a translation (and, for a
-- non-English language a client runs in, an alias table). Interface strings are not required -- they
-- fall back to English per key. Computed at build time rather than counted
-- here, because the addon cannot know how many lines there are supposed to be.
function SpokenPlaces:IsLanguageReady(code)
	if code == BASE then
		return true
	end
	local entry = coverage(code)
	return (entry and entry.ready) and true or false
end

-- The pages set font files, which lack the font object's fallbacks, so the language must draw in
-- the file itself.
function SpokenPlaces:LanguageDraws(code, path)
	return Spoken:LanguageDraws(code, path)
end

-- The fonts clients ship for the other scripts, which the game's font objects fall back to and a
-- page that sets a file has to name itself, the first that draws the language taken.
local SCRIPT_FONTS = {
	cyrillic = { "Fonts\\FRIZQT___CYR.TTF" },
	korean = { "Fonts\\2002.TTF" },
	simplifiedchinese = { "Fonts\\ARKai_T.ttf" },
	-- An English Forever client has no blei00d.TTF, which its font objects still name.
	traditionalchinese = { "Fonts\\blei00d.TTF", "Fonts\\bKAI00M.TTF" },
	-- Not a font for the script, only the stock one most likely to draw ệ and ữ.
	vietnamese = { "Fonts\\ARIALN.TTF" },
}

--- The font file to write `code` (the lore's language by default) in where a page uses
--- `fontObject`: the object's own file where it draws that script, else the client's font for the
--- script. Nil where neither draws it.
function SpokenPlaces:FontFor(fontObject, code)
	local path = fontObject and fontObject.GetFont and fontObject:GetFont()
	local locale = byCode[code or self:GetLanguage()]
	if not path or not locale or locale.script == "latin" then
		return path
	end
	local client = byCode[self.clientLocale]
	if client ~= nil and client.script == locale.script then
		return path
	end
	self.fonts = self.fonts or {}
	local key = path .. "|" .. locale.code
	if self.fonts[key] == nil then
		self.fonts[key] = false
		for _, font in ipairs({ path, unpack(SCRIPT_FONTS[locale.script] or {}) }) do
			if self:LanguageDraws(locale.code, font) then
				self.fonts[key] = font
				break
			end
		end
	end
	return self.fonts[key] or nil
end

-- Whether this client's fonts can draw this language: in the pages' own font files where they
-- have its script, else in the client's font for it (FontFor). Without either, Chinese lore on a
-- German client is a screen of boxes, a bug report that looks like corrupted data. English is
-- always allowed: it is what the addon falls back to, and every client can draw it. Another
-- script is tested once a session by drawing the language's own name.
function SpokenPlaces:CanRenderLanguage(code)
	if code == BASE then
		return true
	end
	local locale = byCode[code]
	if not locale then
		return false
	end
	if locale.script == "latin" then
		return true
	end
	local client = byCode[self.clientLocale]
	if client ~= nil and client.script == locale.script then
		return true
	end
	self.drawable = self.drawable or {}
	if self.drawable[code] == nil then
		local tried, drawn = false, true
		for _, fontObject in ipairs({ _G.GameFontHighlight, _G.QuestFont }) do
			if fontObject and fontObject.GetFont and fontObject:GetFont() then
				tried = true
				drawn = drawn and self:FontFor(fontObject, code) ~= nil
			end
		end
		self.drawable[code] = tried and drawn
	end
	return self.drawable[code]
end

--------------------------------------------------------------------------------
-- Selection
--------------------------------------------------------------------------------

-- The stored preference, or nil for "follow the client". The two are not the
-- same: a player who never chose should start reading German the day German
-- ships, while one who explicitly picked English must keep English.
function SpokenPlaces:GetLanguagePreference()
	local pref = SpokenPlacesSettings and SpokenPlacesSettings.language
	return type(pref) == "string" and byCode[pref] and pref or nil
end

function SpokenPlaces:IsPreviewingLanguage()
	return (SpokenPlacesSettings and SpokenPlacesSettings.languagePreview) and true or false
end

-- Whether a language may be selected at all. Preview mode relaxes readiness so
-- an unfinished translation can be looked at, but never relaxes the font check:
-- previewing boxes tells you nothing.
function SpokenPlaces:IsLanguageSelectable(code)
	if not byCode[code] then
		return false
	end
	if not self:CanRenderLanguage(code) then
		return false
	end
	return self:IsLanguageReady(code) or self:IsPreviewingLanguage()
end

-- What Auto reads: the client's own language once it is finished, English until
-- then. Options names it beside Auto, so a player can see what they will get
-- without having to pick it -- and picking it would pin them to it.
function SpokenPlaces:GetAutoLanguage()
	local client = self.clientLocale
	if self:IsClientLanguage(client) and self:IsLanguageReady(client) and self:CanRenderLanguage(client) then
		return client
	end
	return BASE
end

local function resolve()
	local pref = SpokenPlaces:GetLanguagePreference()
	if pref and SpokenPlaces:IsLanguageSelectable(pref) then
		return pref
	end
	return SpokenPlaces:GetAutoLanguage()
end

-- What the settings in force now would read: not what was loaded (GetLanguage), which a profile
-- chosen later can disagree with until the interface reloads.
function SpokenPlaces:ResolveLanguage()
	return resolve()
end

-- Resolved once, at load, and never recomputed: the generated data files consult
-- it as they load and only get one chance to build their table. Everything that
-- changes the answer therefore asks for a /reload.
SpokenPlaces.language = resolve()

function SpokenPlaces:GetLanguage()
	return self.language
end

-- Every language the player could pick right now, in LOCALES order.
function SpokenPlaces:GetSelectableLanguages()
	local out = {}
	for i = 1, #self.LOCALES do
		local locale = self.LOCALES[i]
		if self:IsLanguageSelectable(locale.code) then
			table.insert(out, locale)
		end
	end
	return out
end

function SpokenPlaces:GetLocaleInfo(code)
	return byCode[code]
end

-- Display name of a language: its own endonym. Only call it where the name is
-- drawable -- the dropdown, the language list and the pack label all list
-- renderable languages only. Anywhere else (the no-fonts warning) uses the code,
-- which is ASCII on every client.
function SpokenPlaces:GetLanguageName(code)
	local locale = byCode[code or BASE]
	if not locale then
		return tostring(code)
	end
	return locale.native or locale.name
end

-- Stores the preference, or nil for Auto. Returns false when the language is not
-- selectable, so the caller can say why rather than storing a choice that resolves
-- to English. A language picked here is kept on every client, whatever language it
-- runs in; Auto is the one choice that follows the client.
--
-- Takes effect on /reload. Nothing here fakes a live switch: the tables for a
-- language that was not active at load were never built, and pretending
-- otherwise would show half-translated screens.
function SpokenPlaces:SetLanguage(code)
	if code ~= nil and not self:IsLanguageSelectable(code) then
		return false
	end
	SpokenPlacesSettings.language = code
	return true
end

function SpokenPlaces:SetLanguagePreview(enabled)
	SpokenPlacesSettings.languagePreview = enabled and true or false
end

--------------------------------------------------------------------------------
-- Interface strings
--
-- SpokenPlaces.L is every string the interface can show, looked up by name:
-- the active language first, English second, and the key itself last so a
-- missing string is legible on screen rather than a nil concatenation error.
--
-- SCAFFOLDING. Only a few files draw their text from here so far -- see
-- Locale/enUS.lua for which -- and the rest still hold English literals. The
-- pattern to follow when converting one is in UI/SoundQueueUI.lua, and the rule
-- that matters is positional format arguments (%1$s), because word order is
-- exactly what a translator cannot fix inside a Lua concatenation.
--------------------------------------------------------------------------------

SpokenPlaces.Strings = { enUS = {} }

local warnedMissing = {}

SpokenPlaces.L = setmetatable({}, {
	__index = function(_, key)
		-- Interface strings follow the client, not the content language: the
		-- locale file for any other code never loads on this client, so there
		-- is nothing else it could fall back to before English.
		local active = SpokenPlaces.Strings[SpokenPlaces.clientLocale]
		local value = active and active[key]
		if value ~= nil then
			return value
		end

		value = SpokenPlaces.Strings.enUS[key]
		if value ~= nil then
			return value
		end

		-- Only in debug mode, and only once: a key with no English string is a
		-- bug in this addon rather than a gap in a translation, and it should be
		-- findable by playing rather than by grepping.
		if SpokenPlaces:Get("debug") and not warnedMissing[key] then
			warnedMissing[key] = true
			SpokenPlaces:Print("|cffffcc00no string for|r [[%s]]", key)
		end
		return "[[" .. key .. "]]"
	end,
})

-- Called by Locale/<code>.lua, which guards itself on the client locale in
-- the same way every WoW addon does: interface strings are useful the moment
-- one of them exists, unlike lore, which is only offered whole.
--
-- STRINGS DO FALL BACK TO ENGLISH, unlike the lore. A missing string is an unlabelled
-- button, and an English label is a strictly better answer than an empty one; a
-- missing line of lore has an honest empty state, which prose from another language
-- does not improve on. The readiness gate demands 100% of both before a language is
-- offered, so both paths are safety nets rather than plans.
function SpokenPlaces:RegisterStrings(code, strings)
	self.Strings[code] = strings
end

--------------------------------------------------------------------------------
-- Registration
--
-- The generated data files hand their tables here rather than assigning the
-- globals directly. That indirection is the escape hatch: if parsing every
-- language at login becomes measurable, each Data/<code>/ moves into its own
-- LoadOnDemand addon inside the same zip and calls exactly these functions.
--------------------------------------------------------------------------------

-- Whether a generated data file for `code` should build its table.
--
-- Keep English available for captions when a translated sound pack lacks a clip.
-- The lore browser still uses only the selected language.
function SpokenPlaces:ShouldLoadLanguage(code)
	if code == self.language or code == BASE then return true end
	if not self:CanRenderLanguage(code) then return false end
	-- Packs can load after the lore tables. Their metadata is available before
	-- their Lua, and keeps switching voices possible without retaining every language.
	local count = (C_AddOns and C_AddOns.GetNumAddOns) or GetNumAddOns
	local metadata = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
	if count and metadata then
		for index = 1, count() do
			-- X-SpokenZones-Language: a pack released under the old name.
			local language = metadata(index, "X-SpokenPlaces-Language") or metadata(index, "X-SpokenZones-Language")
			if language == code then return true end
		end
	end
	return false
end

function SpokenPlaces:RegisterLoreData(code, kind, data)
	if not self:ShouldLoadLanguage(code) then
		return
	end
	self.CaptionLore = self.CaptionLore or {}
	self.CaptionLore[code] = self.CaptionLore[code] or {}
	self.CaptionLore[code][kind] = data
	if code == self.language then
		self[(kind == "zones") and "Zones" or "Subzones"] = data
	end
end

-- Aliases are keyed by client locale, not content language, so this guard is
-- deliberately not ShouldLoadLanguage.
function SpokenPlaces:ShouldLoadAliases(locale)
	return locale == self.clientLocale
end

function SpokenPlaces:RegisterAliases(locale, data, byZone)
	self.Aliases[locale] = data
	self.ZoneAliases[locale] = byZone
end

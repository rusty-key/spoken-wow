-- SpokenReadables -- the language axis of the sound packs, as SpokenQuests has it.
--
-- Three identifiers, deliberately distinct:
--
--   client locale     GetLocale(). What the page on screen is written in, and so which index
--                     finds it (see Reader.lua).
--
--   pack language     The `language` a pack's Data/Sounds.lua declares. Absent is English:
--                     every pack published before the field was read is an English pack.
--
--   voice language    What the player chose to hear. "auto" follows the client.
--
-- A page is narrated in the voice language, then the fallback language, then not at all.
-- The page id is the same in every language, so every pack names a page the same way and
-- falling back is per page.

local ADDON_NAME, SpokenReadables = ...

-- Kept in step with SpokenPlaces.LOCALES (addons/Spoken_Places/Language.lua): the addons sit
-- side by side, and a language offered in one and missing from the other is a setting the
-- player makes once and finds half-honoured. tests/lua/readables_language_test.lua holds them
-- together.
--
-- `client = false` is a language no game client runs in -- Italian and Vietnamese, which a
-- community translates. A player hears it by choosing it; "auto" never lands on it, because
-- GetLocale() never says it.
SpokenReadables.LOCALES = {
	{ code = "enUS", name = "English", native = "English" },
	{ code = "deDE", name = "German", native = "Deutsch" },
	{ code = "esES", name = "Spanish (EU)", native = "Español (España)" },
	{ code = "esMX", name = "Spanish (AL)", native = "Español (América Latina)" },
	{ code = "frFR", name = "French", native = "Français" },
	{ code = "itIT", name = "Italian", native = "Italiano", client = false },
	{ code = "plPL", name = "Polish", native = "Polski", client = false },
	{ code = "ptBR", name = "Portuguese", native = "Português" },
	{ code = "ruRU", name = "Russian", native = "Русский" },
	{ code = "koKR", name = "Korean", native = "한국어" },
	{ code = "zhCN", name = "Chinese (S)", native = "简体中文" },
	{ code = "zhTW", name = "Chinese (T)", native = "繁體中文" },
	{ code = "viVN", name = "Vietnamese", native = "Tiếng Việt", client = false },
}

SpokenReadables.BASE_LANGUAGE = "enUS"
-- "Follow the client": stored as itself rather than resolved, so a player who never chose
-- starts hearing German the day a German pack is installed.
SpokenReadables.AUTO_LANGUAGE = "auto"

local byCode = {}
for _, locale in ipairs(SpokenReadables.LOCALES) do
	byCode[locale.code] = locale
end

--- A code this addon can speak of, or English: absent, empty and unknown all read as enUS.
function SpokenReadables:NormalizeLanguage(code)
	if code and byCode[code] then
		return code
	end
	return self.BASE_LANGUAGE
end

function SpokenReadables:GetLanguageName(code)
	local locale = code and byCode[code]
	if not locale then
		return tostring(code)
	end
	-- The endonym, so every language names itself: a picker lists all of them at
	-- once, and translated exonyms would need a table per interface language for
	-- what one field already says. Latin-script endonyms draw on every client;
	-- the others stay ASCII transliterations for the same reason.
	return locale.native or locale.name
end

--- Whether a game client runs in this language. See `client` on LOCALES.
function SpokenReadables:IsClientLanguage(code)
	local locale = code and byCode[code]
	return locale ~= nil and locale.client ~= false
end

function SpokenReadables:GetClientLanguage()
	local locale = GetLocale and GetLocale()
	if self:IsClientLanguage(locale) then
		return locale
	end
	return self.BASE_LANGUAGE
end

--- The language the player wants to hear, resolved: "auto" becomes the client's.
function SpokenReadables:GetVoiceLanguage()
	-- The one choice on Spoken's page for every module, once made; this addon's own until then.
	local shared = Spoken and Spoken.GetLanguageChoice and Spoken:GetLanguageChoice()
	local stored = shared or (SpokenReadablesSettings and SpokenReadablesSettings.voiceLanguage)
	if stored == nil or stored == self.AUTO_LANGUAGE or not byCode[stored] then
		return self:GetClientLanguage()
	end
	return stored
end

--- The language to try when the voice language has no clip for a page. Nil means none: the
--- page is silent rather than read in a language nobody asked for.
function SpokenReadables:GetFallbackLanguage()
	-- Called on its own: an `and` chain would keep only the first of its two answers.
	local shared
	if Spoken and Spoken.GetLanguageChoice then
		local _
		_, shared = Spoken:GetLanguageChoice()
	end
	local stored = shared or (SpokenReadablesSettings and SpokenReadablesSettings.fallbackLanguage)
	if stored == nil then
		return self.BASE_LANGUAGE
	end
	if stored == "none" or not byCode[stored] then
		return nil
	end
	return stored
end

--- The languages a page may be read in, most wanted first. Never more than two.
function SpokenReadables:LanguageOrder()
	local voice = self:GetVoiceLanguage()
	local order = { voice }
	local fallback = self:GetFallbackLanguage()
	if fallback and fallback ~= voice then
		table.insert(order, fallback)
	end
	return order
end

--- The language a pack is recorded in.
function SpokenReadables:PackLanguage(pack)
	return self:NormalizeLanguage(pack and pack.language)
end

--- The language the player's packs speak to them: the first in LanguageOrder that an
--- installed pack is recorded in, or the voice language when none is. What a report is filed
--- under when there is no clip to ask, and what a contribution says the player was hearing.
function SpokenReadables:GetPackLanguage()
	local order = self:LanguageOrder()
	local packs = self:GetAudioPacks()
	for _, language in ipairs(order) do
		for _, pack in ipairs(packs) do
			if self:PackLanguage(pack) == language then
				return language
			end
		end
	end
	return order[1]
end

--- The .toc Version of the installed pack recorded in `language`, or "none" when no pack
--- speaks it: what a contribution says the player was hearing with. One pack per language
--- ships, so the first found (GetAudioPacks sorts by folder) is the one.
function SpokenReadables:GetPackVersion(language)
	for _, pack in ipairs(self:GetAudioPacks()) do
		if self:PackLanguage(pack) == language then
			local version = self.GetAddOnMeta and pack.addon and self.GetAddOnMeta(pack.addon, "Version")
			if type(version) == "string" and version ~= "" then
				return version
			end
		end
	end
	return "none"
end

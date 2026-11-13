-- SpokenReadables -- the language axis of the sound packs, as SpokenQuests has it.
--
-- Three identifiers, deliberately distinct:
--
--   client locale     GetLocale(). What the page on screen is written in, and so which index
--                     finds it (see Reader.lua).
--
--   pack language     The `language` a pack's Data/Sounds.lua declares. Absent is English:
--                     every pack published before the field was read is an English pack.
--                     Any well-formed code is a language: the pack's TOC names it for Spoken's
--                     registry, and Audio.lua declares the packs that cannot.
--
--   voice language    What the player chose to hear. "auto" follows the client.
--
-- A page is narrated in the voice language, then the fallback language, then not at all.
-- The page id is the same in every language, so every pack names a page the same way and
-- falling back is per page.

local ADDON_NAME, SpokenReadables = ...

-- The languages a game client runs in, which Spoken's registry keeps for every module. They are
-- the only ones this addon lists by itself: any other language is one an installed pack
-- declares, found by asking Spoken, and a pack for it needs no change here. Without Spoken (a
-- hand install) the list is just English.
SpokenReadables.LOCALES = Spoken and Spoken.BuiltinLanguages and Spoken:BuiltinLanguages()
	or { { code = "enUS", name = "English", native = "English" } }

SpokenReadables.BASE_LANGUAGE = "enUS"
-- "Follow the client": stored as itself rather than resolved, so a player who never chose
-- starts hearing German the day a German pack is installed.
SpokenReadables.AUTO_LANGUAGE = "auto"

--- The registry's entry for a language, or nil where it is neither built in nor declared by an
--- installed pack. Without Spoken nothing is known, and the entry is nil.
local function Entry(code)
	return code and Spoken and Spoken.Language and Spoken:Language(code) or nil
end

--- Whether a value is shaped like a language code, with or without Spoken's registry.
local function IsCode(value)
	if Spoken and Spoken.IsLanguageCode then return Spoken:IsLanguageCode(value) end
	return type(value) == "string" and string.find(value, "^%l%l%u%u$") ~= nil
end

--- A language code, or English: absent, empty and no code at all read as enUS. A code is taken
--- as it stands, since the pack that declares it has told Spoken's registry.
function SpokenReadables:NormalizeLanguage(code)
	if IsCode(code) then
		-- A game client in British English runs the English pack, as the registry reads it.
		return code == "enGB" and self.BASE_LANGUAGE or code
	end
	return self.BASE_LANGUAGE
end

function SpokenReadables:GetLanguageName(code)
	local locale = Entry(code)
	if not locale then
		return tostring(code)
	end
	-- The endonym, so every language names itself: a picker lists all of them at
	-- once, and translated exonyms would need a table per interface language for
	-- what one field already says. Latin-script endonyms draw on every client;
	-- the others stay ASCII transliterations for the same reason.
	return locale.native or locale.name or tostring(code)
end

--- Whether a game client runs in this language: a built-in one, which the registry marks `client`.
function SpokenReadables:IsClientLanguage(code)
	local locale = Entry(code)
	return locale ~= nil and locale.client == true
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
	-- A code is kept even where no pack of it is installed: the choice outlives the pack, and the
	-- fallback answers meanwhile.
	if stored == nil or stored == self.AUTO_LANGUAGE or not IsCode(stored) then
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
	if stored == "none" or not IsCode(stored) then
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

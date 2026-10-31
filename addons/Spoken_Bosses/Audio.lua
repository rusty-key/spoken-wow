local _, Bosses = ...

-- The voice of a boss's story: its clip in an installed SpokenBossesAudio pack. The packs register
-- themselves at load (their Data/Sounds.lua), so the registry is read on demand and always holds
-- what is loaded. With none, every story is words alone.

-- The shape of pack.bosses this build reads. A pack of another format may name its clips otherwise.
local PACK_FORMAT = 1

--- The language a story is heard in: Spoken's Voice Language, "Auto" being the client's.
function Bosses:GetVoiceLanguage()
	if Spoken and Spoken.VoiceLanguage then return Spoken:VoiceLanguage() end
	return GetLocale and GetLocale() or "enUS"
end
local function VoiceLanguage() return Bosses:GetVoiceLanguage() end

--- Spoken's If a Voice Is Missing, English unless the player chose otherwise; nil for Stay Silent.
function Bosses:GetFallbackLanguage()
	local fallback
	if Spoken and Spoken.GetLanguageChoice then
		local _
		_, fallback = Spoken:GetLanguageChoice()
	end
	if fallback == "none" then return nil end
	return fallback or "enUS"
end
local function FallbackLanguage() return Bosses:GetFallbackLanguage() end

--- Every installed pack this build reads, best first: the voice language's, then the client's,
--- then by bitrate, then by folder name, so two copies of one pack resolve the same way every time.
--- `lang` narrows the list to one language.
function Bosses:GetAudioPacks(lang)
	local packs = {}
	for name, pack in pairs(_G.SpokenBossesAudioPacks or {}) do
		if type(pack) == "table" and pack.version == PACK_FORMAT then
			pack.addon = pack.addon or name
			pack.language = pack.language or "enUS"
			if lang == nil or pack.language == lang then table.insert(packs, pack) end
		end
	end
	local voice, client = VoiceLanguage(), GetLocale and GetLocale()
	local function Rank(pack)
		if pack.language == voice then return 0 end
		if pack.language == client then return 1 end
		return 2
	end
	table.sort(packs, function(a, b)
		local ra, rb = Rank(a), Rank(b)
		if ra ~= rb then return ra < rb end
		if (a.bitrate or 0) ~= (b.bitrate or 0) then return (a.bitrate or 0) > (b.bitrate or 0) end
		return tostring(a.addon) < tostring(b.addon)
	end)
	return packs
end

--- The folder names of the installed packs, for the count on Spoken's page.
function Bosses:PackNames()
	local names = {}
	for _, pack in ipairs(self:GetAudioPacks()) do table.insert(names, pack.addon) end
	return names
end

--- The recording of the boss `key` of `map`: `{ path, len, times, language }`, from the voice
--- language's packs, else the fallback language's, best first; nil where none has it. With Stay
--- Silent, only the voice language's are tried.
function Bosses:GetAudioClip(map, key)
	local voice = VoiceLanguage()
	local candidates = self:GetAudioPacks(voice)
	local fallback = FallbackLanguage()
	if fallback and fallback ~= voice then
		for _, pack in ipairs(self:GetAudioPacks(fallback)) do table.insert(candidates, pack) end
	end
	for _, pack in ipairs(candidates) do
		local entry = pack.bosses and pack.bosses[map] and pack.bosses[map][key]
		if entry and entry.file then
			return {
				path = "Interface\\AddOns\\" .. pack.addon .. "\\Sounds\\" .. entry.file .. ".mp3",
				len = entry.len,
				times = entry.times,
				language = pack.language,
			}
		end
	end
	return nil
end

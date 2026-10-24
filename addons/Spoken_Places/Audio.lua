-- SpokenPlaces -- narrated lore playback.
--
-- This file knows what a lore entry sounds like -- which pack narrates it, where
-- the file is, how long it runs -- and hands that to the Spoken player, which owns
-- the queue, the frame and playback itself. This addon is one *source* on that
-- player: its clips wait their turn behind whatever another Spoken addon queued,
-- and Stop here stops lore, not a quest line that happens to be speaking.
--
-- Audio ships in separate sound-pack addons, all of them optional: without one
-- there is nothing to play, so the Play button does not appear and autoplay stays
-- quiet.
--
-- More than one pack can be installed at a time -- one per language, plus the
-- retired 64 kbps English pack for anyone who kept it. Each registers itself into
-- SpokenPlacesAudioPacks (and, while packs built for the old names are still in
-- circulation, SpokenZonesAudioPacks or ZoneLoreAudioPacks) under its own folder name;
-- this file picks which one to play from.
--
-- Every pack has the same structure and the same keys, so any installed pack is
-- playable regardless of the language being read: a player reading German with
-- only the English pack installed hears English narration rather than nothing.
-- When several packs are installed the player picks one; unpicked,
-- the language being read wins, then the client's own locale.

local ADDON_NAME, SpokenPlaces = ...

local L = SpokenPlaces.L

-- THERE IS NO STAND-IN CLIP. A line with no audio in the installed pack plays
-- nothing and says why.
--
-- There used to be one: Sounds/placeholder.mp3, a quest line borrowed from
-- ../wow-voiceover so the playback controls could be exercised before any real
-- narration existed. It was returned for every entry the pack did not cover, which
-- on a client with no pack installed is every entry there is -- so players heard a
-- stranger's quest audio about the League of Arathor over Elwynn Forest, Dun Morogh,
-- Felwood and Red Cloud Mesa, and reported it as the lore being wrong. They were
-- right: substituting unrelated audio is worse than silence, because silence is
-- honest about what is missing and this was not.

-- The pack table shape this version knows how to read. A pack declaring anything
-- else is ignored with a warning: refusing to read it is recoverable, guessing at
-- an unknown layout plays silence and reports nothing.
local PACK_FORMAT = 1

-- Playback state lives in the Spoken player. The clip being spoken is the head of
-- its queue, so there is one place to ask what is happening rather than a `current`,
-- a `paused` shadow copy and a staleness token that have to agree with each other.
--
-- What has not changed is that the client can start and stop a sound file and
-- nothing in between -- there is no seek, and no way to ask how far into a clip
-- playback has reached. So "pause" is stop, and "resume" replays from the
-- beginning. The player's tooltip says so rather than letting anyone discover it.

-- Callbacks fired whenever playback starts or stops, so every button showing the
-- same entry agrees on its glyph without polling. Bridged from the player's own
-- AUDIO_CHANGED in SetupAudio, so a change caused by another addon's clip -- ours
-- finishing because theirs started -- reaches these listeners too.
SpokenPlaces.audioChangedCallbacks = {}

function SpokenPlaces:OnAudioChanged(fn)
	table.insert(self.audioChangedCallbacks, fn)
end

-- Public because toggling the feature off has to refresh every button too, not
-- just the transitions that start and stop a clip.
function SpokenPlaces:NotifyAudioChanged()
	local list = self.audioChangedCallbacks
	for i = 1, #list do
		local ok, err = pcall(list[i])
		if not ok then
			SpokenPlaces:Print("|cffff5555error|r: %s", tostring(err))
		end
	end
end

--------------------------------------------------------------------------------
-- The player
--------------------------------------------------------------------------------

local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]
local warnedNoPlayer = false

--- The zone's icon, or its zone's for a subzone; the book without an icon.
function SpokenPlaces:Portrait(mapID)
	local icon, crop
	if Spoken and Spoken.ZoneIcon then icon, crop = Spoken:ZoneIcon(mapID) end
	if icon then return { kind = "texture", texture = icon, texCoord = crop } end
	return { kind = "texture", texture = BOOK }
end

-- The Spoken source this addon speaks through, or nil when the player addon is not
-- installed. Said once, on the first thing that would have made a sound: a missing
-- dependency that stays silent is the bug report nobody can reproduce.
local function Source()
	if SpokenPlaces.source then
		return SpokenPlaces.source
	end
	if not warnedNoPlayer then
		warnedNoPlayer = true
		SpokenPlaces:Print("|cffffcc00Spoken is not installed|r -- stories cannot be read aloud without it")
	end
	return nil
end

-- Registers with the player. Runs once the world is up, after the player itself has
-- loaded; everything here degrades to "no narration" when it has not.
function SpokenPlaces:SetupAudio()
	if self.source then
		return
	end
	local Spoken = _G.Spoken
	if not (Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then
		return
	end

	self.source = Spoken:RegisterSource("places", {
		title = L.OPT_PAGE_TITLE,
		addon = ADDON_NAME,
		order = 3,
		-- How many clips may wait behind the one speaking. Discoveries arrive in
		-- bursts when crossing a cluster of small subzones, and narration that has
		-- fallen minutes behind is describing somewhere the player already left.
		queueLimit = 3,
		-- Durations come from a generated lookup and are exact; upstream's larger gap
		-- absorbs durations that are not.
		interClipGap = 0.25,
		-- Printed after Spoken's own by its Show Diagnostics.
		diagnostics = function() SpokenPlaces:ShowDiagnostics() end,
		-- What Spoken's settings show on this part's card: which voice packs are installed.
		packs = function()
			local names = {}
			for _, pack in ipairs(SpokenPlaces:GetAudioPacks()) do
				table.insert(names, pack.addon or SpokenPlaces:GetAudioPackLabel(pack))
			end
			return names
		end,
	})

	-- Switchable from the player's settings, named there by this addon. The quests addon
	-- declares the same id, so one setting covers whichever is speaking.
	if Spoken.RegisterOptionalAction then
		Spoken:RegisterOptionalAction("report", L.REPORT_BUTTON)
	end

	Spoken:RegisterCallback("AUDIO_CHANGED", function()
		SpokenPlaces:NotifyAudioChanged()
	end)

	-- Switched off or on in Spoken's settings: the map panel follows, and so does the Compendium's
	-- Places tab.
	if Spoken.RegisterCallback then
		Spoken:RegisterCallback("PART_SWITCHED", function(key)
			if key ~= "places" then return end
			if SpokenPlaces.RefreshPanel then SpokenPlaces:RefreshPanel() end
			if SpokenCompendium and SpokenCompendium.Relayout then SpokenCompendium:Relayout() end
		end)
	end

	-- The Compendium is in Spoken's own part of the menu where Spoken has one.
	if not Spoken.ShowsCompendium then
		Spoken.Minimap:AddEntry("places", { id = "lore", text = L.MENU_LORE_WINDOW, order = 1,
			onClick = function() SpokenPlaces:ToggleLoreWindow() end })
	end
	Spoken.Minimap:AddEntry("places", { id = "settings", text = L.MENU_ZONE_SETTINGS, order = 2,
		onClick = function() SpokenPlaces:OpenOptions() end })
end

--------------------------------------------------------------------------------
-- Sound packs
--------------------------------------------------------------------------------

-- Warned-about folder names, so an unreadable pack says so once per session
-- rather than on every lookup.
local warnedFormat = {}

-- Every installed pack this version can read, best match first. Packs are
-- registered by the data addons themselves at load time, so this is cheap enough
-- to walk on demand and always reflects what is loaded.
--
-- Every pack is listed whatever it narrates -- packs are interchangeable, and an
-- English pack under German text beats silence. Pass `lang` only to
-- narrow the answer to one language.
function SpokenPlaces:GetAudioPacks(lang)
	local packs = {}
	-- Three generations of the registry, newest first. SpokenZonesAudioPacks and before it
	-- ZoneLoreAudioPacks are what packs published under those names write into, and those files
	-- are on players' disks and cannot be changed, so reading them is permanent. Packs built from
	-- now on write only SpokenPlacesAudioPacks. All are keyed by folder name, so a pack in two is
	-- seen once, and a SpokenZonesAudio folder beside its SpokenPlacesAudio replacement is
	-- not seen at all: the same pack, one release older.
	local seen = {}
	local found = false

	-- Not a loop over a table of the two: a nil first registry would end an ipairs
	-- immediately and the second would never be read.
	local function Collect(registry)
		if type(registry) ~= "table" then
			return
		end
		for name, pack in pairs(registry) do
			if type(pack) ~= "table" or seen[name] or seen[(name:gsub("^SpokenZonesAudio", "SpokenPlacesAudio"))] then
				-- Already taken from a newer registry, replaced by its renamed folder, or not a pack.
			elseif pack.version == PACK_FORMAT then
				seen[name] = true
				found = true
				-- A pack published before languages existed carries no language and
				-- is English, which is the same default Sounds.lua applies. Filled in
				-- here, once, so nothing that reads a pack from this list re-applies it.
				pack.language = pack.language or "enUS"
				if lang == nil or pack.language == lang then
					table.insert(packs, pack)
				end
			else
				seen[name] = true
				found = true
				if not warnedFormat[name] then
					warnedFormat[name] = true
					self:Print(
						"|cffffcc00%s is built for a different version of Spoken Places|r "
							.. "(pack format %s, this build reads %d) -- update both to the same major version",
						name, tostring(pack.version), PACK_FORMAT
					)
				end
			end
		end
	end
	Collect(_G.SpokenPlacesAudioPacks)
	Collect(_G.SpokenZonesAudioPacks)
	Collect(_G.ZoneLoreAudioPacks)

	if not found and type(_G.ZoneLoreAudioData) == "table" and _G.ZoneLoreAudioData.version == PACK_FORMAT then
		-- A pack predating the registry. It only knew the one folder name.
		local legacy = _G.ZoneLoreAudioData
		legacy.addon = legacy.addon or "ZoneLoreAudio"
		legacy.quality = legacy.quality or "standard"
		legacy.bitrate = legacy.bitrate or 0
		legacy.language = legacy.language or "enUS"
		if lang == nil or legacy.language == lang then
			table.insert(packs, legacy)
		end
	end

	-- Best default first: the voice language, then the client's own locale,
	-- then bitrate descending, then folder name so the order is stable when two
	-- packs report the same bitrate (or none at all).
	local reading = self:GetVoiceLanguage()
	local client = self.clientLocale
	local function rank(pack)
		local language = pack.language
		if language == reading then
			return 0
		elseif language == client then
			return 1
		end
		return 2
	end
	table.sort(packs, function(a, b)
		local ra, rb = rank(a), rank(b)
		if ra ~= rb then
			return ra < rb
		end
		if (a.bitrate or 0) ~= (b.bitrate or 0) then
			return (a.bitrate or 0) > (b.bitrate or 0)
		end
		return tostring(a.addon) < tostring(b.addon)
	end)

	return packs
end

-- The language narration is heard in: Spoken's Voice Language, as every module's is, "Auto"
-- being the client's. The text's language (GetLanguage) is a choice apart.
function SpokenPlaces:GetVoiceLanguage()
	local Spoken = _G.Spoken
	if Spoken and Spoken.VoiceLanguage then
		return Spoken:VoiceLanguage()
	end
	return self:GetLanguage()
end

-- The language a story is heard in where the voice language has no recording of it: Spoken's
-- If a Voice Is Missing, English unless the player chose otherwise. Nil for Stay Silent.
function SpokenPlaces:GetFallbackLanguage()
	local Spoken = _G.Spoken
	local fallback
	if Spoken and Spoken.GetLanguageChoice then
		local _
		_, fallback = Spoken:GetLanguageChoice()
	end
	if fallback == "none" then
		return nil
	end
	return fallback or "enUS"
end

-- The pack narration plays from: one in the voice language, else one in the fallback language,
-- else nil.
--
-- Between two packs of one language (a retired 64 kbps pack beside the current one), the one
-- /spp audio chose, kept as a folder name rather than an index: a player who uninstalls the
-- high-quality pack should fall back to whatever is left instead of pointing at whichever pack
-- happens to occupy that slot afterwards.
function SpokenPlaces:GetActiveAudioPack()
	local packs = self:GetAudioPacks(self:GetVoiceLanguage())
	local fallback = self:GetFallbackLanguage()
	if #packs == 0 and fallback then
		packs = self:GetAudioPacks(fallback)
	end
	if #packs == 0 then
		return nil
	end

	local stored = self:Get("audioPack")
	local preferred = type(stored) == "table" and stored[packs[1].language] or nil
	if type(preferred) == "string" then
		for i = 1, #packs do
			if packs[i].addon == preferred then
				return packs[i]
			end
		end
	end

	-- No preference, or the preferred pack is gone: best available wins.
	return packs[1]
end

-- Switches packs. Returns false when the name is not an installed pack, so the
-- caller can say so rather than storing a preference that resolves to nothing.
function SpokenPlaces:SetActiveAudioPack(name)
	local packs = self:GetAudioPacks()
	for i = 1, #packs do
		if packs[i].addon == name then
			local stored = self:Get("audioPack")
			if type(stored) ~= "table" then
				stored = {}
			end
			stored[packs[i].language] = name
			self:Set("audioPack", stored)
			self:StopLore()
			self:NotifyAudioChanged()
			return true
		end
	end
	return false
end

-- "Deutsch" -- for the options dropdown and /spp audio. A pack is named by the
-- language it narrates, the one being read included: there is one pack per language,
-- so that is what tells them apart. Bitrate is added only when two installed packs
-- share a language, which now means someone kept the retired 64 kbps pack beside the
-- current one. A pack in a language this client cannot draw keeps its ASCII code,
-- which every client can draw, instead of boxes.
function SpokenPlaces:GetAudioPackLabel(pack)
	if not pack then
		return "none"
	end
	local language = pack.language
	local label = language
	if self:CanRenderLanguage(language) then
		local info = self:GetLocaleInfo(language)
		label = (info and info.native) or language
	end
	if pack.bitrate and pack.bitrate > 0 then
		for _, other in ipairs(self:GetAudioPacks(language)) do
			if other ~= pack and other.language == language then
				return ("%s (%d kbps)"):format(label, pack.bitrate)
			end
		end
	end
	return label
end

--------------------------------------------------------------------------------
-- Lookup
--------------------------------------------------------------------------------

function SpokenPlaces:IsVoiceEnabled()
	return self:Get("voiceEnabled") and true or false
end

-- Path and duration for a lore entry. `areaKey` is a canonical subzone key (see
-- SpokenPlaces:NormaliseAreaKey), or nil for the zone itself.
--
-- Duration comes from the generated lookup because there is no way to ask the
-- client how long a sound file is; without one the button could never reset itself.
function SpokenPlaces:GetAudioClip(mapID, areaKey)
	if not mapID then
		return nil, nil
	end

	local active = self:GetActiveAudioPack()
	if not active then
		return nil, nil
	end

	-- The active pack, then the fallback language's, entry by entry: a German pack that has not
	-- narrated an area yet leaves it to the English one rather than to silence, the way a quest
	-- line falls back. The entry keys are the same in every language, so any pack names the area
	-- alike. With Stay Silent, nothing else is tried.
	local candidates = { active }
	local fallback = self:GetFallbackLanguage()
	if fallback and active.language ~= fallback then
		for _, pack in ipairs(self:GetAudioPacks(fallback)) do
			table.insert(candidates, pack)
		end
	end

	for _, pack in ipairs(candidates) do
		local clip
		if areaKey then
			local zoneClips = pack.subzones and pack.subzones[mapID]
			clip = zoneClips and zoneClips[areaKey]
		else
			clip = pack.zones and pack.zones[mapID]
		end
		if clip and clip.file then
			return "Interface\\AddOns\\" .. pack.addon .. "\\Sounds\\" .. clip.file .. ".mp3",
				clip.len, pack, clip.file
		end
	end

	return nil, nil
end

--- The language narration plays in: the active pack's, or the one being read when there is
--- no pack. What a contribution says the player was hearing.
function SpokenPlaces:GetPackLanguage()
	local pack = self:GetActiveAudioPack()
	return pack and pack.language or self:GetLanguage()
end

-- The button the player shows under a lore clip: this addon's own Report, told which
-- entry it now stands beside. There is no Read button. The text is reached from the map,
-- the minimap menu and /spp, and a button on the player that opened a window over the very
-- thing being read was one way too many.
local ACTIONS = {
	{
		id = "report",
		-- An icon in the corner rather than a word beside the line.
		icon = [[Interface\HelpFrame\HelpIcon-Bug]],
		label = L.OPT_REPORT_PROBLEM,
		anchor = "topright",
		tooltip = function(tooltip)
			tooltip:SetText(L.OPT_REPORT_PROBLEM)
		end,
		onClick = function(clip)
			if not clip then
				return
			end
			-- Filed under the voice language, not the pack the clip came from: an entry the
			-- active pack lacks plays the English fallback, and "no German" belongs beside
			-- the German entry.
			SpokenPlaces:ShowReport(clip.mapID, clip.areaKey, SpokenPlaces:GetVoiceLanguage())
		end,
	}
}

--- The place one level up from a zone, as Azeroth's Compendium nests them: a city's zone, a
--- zone's continent, a continent's world. Nil for the world.
function SpokenPlaces:PlaceAbove(mapID)
	local C = _G.SpokenCompendium
	-- A Compendium that failed to load costs the header, not the clip.
	if not C or mapID == C.WORLD then return nil end
	for _, continent in ipairs(C.CONTINENTS) do
		if continent == mapID then return C.WORLD end
	end
	return C.CITY_IN[mapID] or C.ContinentOf(mapID) or C.WORLD
end

-- A Spoken clip for a lore entry, or nil when the installed pack cannot narrate it.
-- One factory so that every route to a clip -- a click, a slash command, a
-- discovery -- produces the same shape.
--
-- The key is the line id the website and the generation pipeline use -- z:{mapID} or
-- s:{mapID}:{key} -- and it is frozen: it is what the player dedups on, what a report
-- names, and what audio-history is keyed by.
function SpokenPlaces:NewLoreSound(mapID, areaKey)
	local path, length, pack, fileName = self:GetAudioClip(mapID, areaKey)
	if not path then
		return nil
	end

	local label = self:GetAudioLabel(mapID, areaKey)
	-- The place's picture and its frayed edge, for a window that shows one over the words.
	local picture, mask
	if self.Picture then picture, mask = self:Picture(mapID, areaKey) end
	-- The words are in the Text Language the player picked, whatever the voice: French words under
	-- an English voice. The pack's own language only where the Text Language has no such entry.
	local language, entry
	for _, code in ipairs({ self:GetLanguage(), pack.language or "enUS" }) do
		local data = self.CaptionLore and self.CaptionLore[code]
		local entries = data and (areaKey and data.subzones or data.zones)
		local found = entries and entries[mapID]
		if areaKey then found = found and found[areaKey] end
		if found and found.full then
			language, entry = code, found
			break
		end
	end
	language = language or pack.language or "enUS"
	-- Captions set a font file, which has none of the font object's fallbacks: lore in a script
	-- the client's file cannot draw names the file that can. Otherwise the window's own is kept.
	local font = self.FontFor and self:FontFor(GameFontNormal, language)
	if font == GameFontNormal:GetFont() then font = nil end
	-- An area is headed by the zone Azeroth's Compendium lists it in: Razorfen Downs by The Barrens,
	-- where its entrance is, and Strahnbrad by Alterac Mountains, their stories kept under Thousand
	-- Needles and Hillsbrad Foothills.
	local zone = areaKey and (self.AreaZone and self:AreaZone(mapID, areaKey) or mapID)
	return {
		key = areaKey and ("s:" .. mapID .. ":" .. areaKey) or ("z:" .. mapID),
		path = path,
		length = length,
		fileName = fileName,
		pack = pack,
		mapID = mapID,
		areaKey = areaKey,
		present = {
			-- An area under its zone; anything else under the place above it.
			header = areaKey and (self:GetMapName(zone) or label) or self:GetMapName(self:PlaceAbove(mapID)),
			label = label,
			transcript = entry and entry.full,
			font = font,
			bullet = "zone",
			portrait = self:Portrait(mapID),
			picture = picture and { file = picture, mask = mask } or nil,
			actions = ACTIONS,
		},
		-- Recorded when the clip starts rather than when it is queued, so that
		-- every route to a clip counts and a backlog that overflows does not spend
		-- areas on silence. Include Places Found Before, the check on a discovery and a
		-- dungeon's once-per-character story all read it.
		startCallback = function(item)
			if SpokenPlaces.MarkHeard then
				SpokenPlaces:MarkHeard(item.mapID, item.areaKey)
			end
		end,
	}
end

-- Appends a clip that waits its turn: autoplay's, or one the player `asked` for with a shift-click.
-- Returns whether it was admitted; the player refuses duplicates and silence of its own accord.
function SpokenPlaces:EnqueueLore(item, asked)
	local source = Source()
	if not source or not item then
		return false
	end
	return source:Enqueue(item, asked) ~= nil
end

--- A story behind what is playing, as a shift-click on its row in Azeroth's Compendium asks: once,
--- where a pack has it and it is not locked. Returns whether it was queued.
function SpokenPlaces:QueueLore(mapID, areaKey)
	if not self:IsVoiceEnabled() or (self.IsLocked and self:IsLocked(mapID, areaKey)) then
		return false
	end
	-- Asked for, so read in a battleground too.
	return self:EnqueueLore(self:NewLoreSound(mapID, areaKey), true)
end

function SpokenPlaces:HasAudio(mapID, areaKey)
	return self:GetAudioClip(mapID, areaKey) ~= nil
end

-- Why there is no clip, phrased for the player. Distinguishes "you have no sound
-- pack" from "your pack does not cover this line": the first is a download, the
-- second is nothing they can do, and telling them apart is the whole point of
-- saying anything at all.
function SpokenPlaces:DescribeMissingAudio()
	if #self:GetAudioPacks() == 0 then
		return "no voice pack installed -- get Spoken Audio: Places to hear the lore read aloud"
	end
	return "no narration for this entry in the installed voice pack yet"
end

--------------------------------------------------------------------------------
-- Playback
--------------------------------------------------------------------------------

-- The head of the player's queue if it is one of ours, else nil.
local function OurHead()
	local Spoken = _G.Spoken
	if not SpokenPlaces.source or not Spoken then
		return nil
	end
	local head = Spoken:GetCurrent()
	if head and head.source == SpokenPlaces.source then
		return head
	end
	return nil
end

-- Playing, as opposed to merely queued. An entry can sit at the head of the queue
-- unstarted while a gate holds it -- waiting out a pull, say -- and a button
-- reading "Stop" over an entry that has made no sound would stop a queue instead
-- of a clip. The player's IsPlaying is the liveness test, not presence at the head.
function SpokenPlaces:IsPlayingLore(mapID, areaKey)
	local head = OurHead()
	if not head or not _G.Spoken:IsPlaying() then
		return false
	end
	if mapID == nil then
		return true
	end
	return head.mapID == mapID and head.areaKey == areaKey
end

--- This story at the head of the queue, whether speaking or paused: what the Play button
--- pauses and resumes rather than starting again.
--- This story's line in the queue, nearest the head, or nil: what a page's Play stops or replays.
function SpokenPlaces:LoreClip(mapID, areaKey)
	local Spoken = _G.Spoken
	if not self.source or not (Spoken and Spoken.GetQueue) then return nil end
	for _, clip in ipairs(Spoken:GetQueue()) do
		if clip.source == self.source and clip.mapID == mapID and clip.areaKey == areaKey then return clip end
	end
end

function SpokenPlaces:IsLoreAtHead(mapID, areaKey)
	local head = OurHead()
	return head ~= nil and head.mapID == mapID and head.areaKey == areaKey
end

function SpokenPlaces:IsPaused()
	local head = OurHead()
	return head ~= nil and _G.Spoken:IsPaused()
end

-- What the floating controls are controlling: mapID, areaKey, isPaused. Nil when
-- nothing of ours is playing or paused, which is also what hides the controls.
function SpokenPlaces:GetNowPlaying()
	-- Deliberately not "whatever is at the head". An entry held by a gate sits
	-- there making no sound, and controls offering Pause over silence would be
	-- lying; the window says why a held line waits. So: playing, or paused.
	local Spoken = _G.Spoken
	local head = Spoken and Spoken:GetNowPlaying()
	if not head or head.source ~= self.source then
		return nil, nil, false
	end
	return head.mapID, head.areaKey, Spoken:IsPaused()
end

-- How many of our entries are waiting behind the one playing. Drives the Next
-- button. Ours only: a quest line queued behind a discovery is not lore waiting.
function SpokenPlaces:QueueLength()
	local Spoken = _G.Spoken
	if not self.source or not Spoken then
		return 0
	end
	local waiting = 0
	for index, clip in ipairs(Spoken:GetQueue()) do
		local speaking = index == 1 and Spoken:IsPlaying()
		if clip.source == self.source and not speaking then
			waiting = waiting + 1
		end
	end
	return waiting
end

-- A readable name for an entry, for the controls to label what is playing.
function SpokenPlaces:GetAudioLabel(mapID, areaKey)
	if not mapID then
		return ""
	end
	if areaKey then
		local zoneTable = self.Subzones[mapID]
		local entry = zoneTable and zoneTable[areaKey]
		return (entry and entry.name) or areaKey
	end
	return self:GetMapName(mapID) or tostring(mapID)
end

-- The player asking for silence, as opposed to playback being reset on the way to
-- starting something else. Stop has to mean stop, not skip to the next discovered
-- area -- and it means *lore*: another Spoken addon's clips are left alone.
function SpokenPlaces:StopLore()
	local source = SpokenPlaces.source
	if source then
		source:StopAll()
	end
end

-- Pause is the player's, not this addon's: pausing lore pauses whatever is speaking.
function SpokenPlaces:PauseLore()
	return _G.Spoken and _G.Spoken:Pause() or false
end

function SpokenPlaces:ResumeLore()
	return _G.Spoken and _G.Spoken:Resume() or false
end

-- Plays this entry now, ahead of anything waiting. Pressing Play has always meant
-- now in SpokenPlaces, so this front-inserts rather than appending; producers such as
-- autoplay append instead.
function SpokenPlaces:PlayLore(mapID, areaKey)
	if not self:IsVoiceEnabled() then
		SpokenPlaces:NotifyAudioChanged()
		return false
	end

	local source = Source()
	if not source then
		return false
	end

	local item = self:NewLoreSound(mapID, areaKey)
	if not item then
		-- Said out loud, because this is the case players used to experience as
		-- "the narration is about the wrong zone". Autoplay never reaches here --
		-- it refuses to queue an entry with no clip -- so this only speaks when
		-- somebody asked for this line by clicking Play or typing /spp play.
		self:Print("|cffffcc00%s|r", self:DescribeMissingAudio())
		SpokenPlaces:NotifyAudioChanged()
		return false
	end

	local playing, reason = source:PlayNow(item)
	if not playing and reason then
		self:Print("|cffffcc00cannot play lore: %s|r", reason)
	end
	return playing and true or false
end

--------------------------------------------------------------------------------
-- Why nothing here stops playback on its own
--------------------------------------------------------------------------------
--
-- Narration only stops when the player stops it, or when another clip starts.
-- Closing the map, navigating it, walking into another zone and hiding the lore
-- window all leave it running.
--
-- The alternative -- stopping when the entry scrolls out of view -- reads well as
-- a rule and is wrong in practice: the intended use is to start a zone's lore and
-- then close the map and walk, which that rule would cut off immediately. The
-- button always shows the state of the entry in front of it, so stopping is never
-- more than one click away.

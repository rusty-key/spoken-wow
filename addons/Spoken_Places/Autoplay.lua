-- SpokenZones -- narrate an area when the player discovers it.
--
-- The trigger is the game's own discovery, the moment it prints "Discovered
-- Durotar". Nothing else comes close:
--
--   * Zone-change events do not fire for it. A new orc stands in Valley of Trials,
--     which is a subzone of Durotar, so GetBestMapForUnit already answers "Durotar"
--     from the first second. Walking out into open Durotar changes no map ID.
--   * Tracking first visits ourselves means deciding when a visit starts, and any
--     answer to that is a guess. The client already knows, exactly, and remembers
--     per character across sessions for free.
--
-- The game fires a discovery once and never again, which is precisely the
-- semantics this feature wanted.
--
-- The cost of leaning on it is that a character who explored Azeroth before
-- installing SpokenZones already spent every discovery it will ever get, and so is
-- narrated nothing at all. The `autoplayExplored` option answers that by keeping
-- the record here instead -- see "Per-character record" below -- and narrating on
-- zone change rather than on discovery. It is off by default, and on a fresh
-- character it changes nothing observable: the discovery message still arrives
-- first and marks the area heard, leaving the override with nothing to say.

local ADDON_NAME, SpokenZones = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

-- The queue itself is the Spoken player's, shared with every other route to a clip
-- and with every other Spoken addon. This file decides what deserves narrating and
-- hands it over; the depth cap, the dedup and the retry after combat are the
-- player's business, configured on this addon's source in Audio.lua.

--------------------------------------------------------------------------------
-- Reading the client's own discovery messages
--------------------------------------------------------------------------------
--
-- ERR_ZONE_EXPLORED_XP is "Discovered %s: %d experience gained." and
-- ERR_ZONE_EXPLORED is "Discovered %s." -- but only in English. Building the
-- patterns from the globals the running client defines makes this work in every
-- locale without shipping a translation table, and makes a Blizzard rewording a
-- non-event.

local patterns = nil

-- How many of the two message forms this client actually defines. Reported by /spp,
-- so "the feature cannot work here" is distinguishable from "nothing has been
-- discovered yet" without another character.
local formCount = 0

-- Two patterns per message form. The anchored one is exact; the loose one matches
-- the same text sitting inside a longer line, which is what happens if the client
-- ever prefixes or colours the message. Anchoring alone would reject that
-- silently, and every test of this feature costs a fresh character to run.
local function BuildPatterns(globalString)
	if type(globalString) ~= "string" or globalString == "" then
		return nil, nil
	end
	-- Escape the Lua pattern magic characters first, so the literal parts of the
	-- message match themselves, then reopen the format specifiers as captures.
	local escaped = globalString:gsub("([%^%$%(%)%%%.%[%]%*%+%-%?])", "%%%1")
	escaped = escaped:gsub("%%%%d", "%%d+")

	-- Greedy inside anchors, since the whole line is the message. Non-greedy when
	-- loose, so a trailing sentence is not swallowed into the area name.
	local anchored = "^" .. escaped:gsub("%%%%s", "(.+)") .. "$"
	local loose = escaped:gsub("%%%%s", "(.-)")
	return anchored, loose
end

local function DiscoveryPatterns()
	if patterns then
		return patterns
	end
	patterns = {}

	-- Every anchored form before any loose one: an exact match on the plain message
	-- is better evidence than a loose match on the experience one.
	local anchoredSet, looseSet = {}, {}
	-- The XP form first within each set: it is the more specific of the two, and at
	-- max level the client falls back to the plain form.
	for _, name in ipairs({ "ERR_ZONE_EXPLORED_XP", "ERR_ZONE_EXPLORED" }) do
		local anchored, loose = BuildPatterns(_G[name])
		if anchored then
			table.insert(anchoredSet, anchored)
			table.insert(looseSet, loose)
		end
	end
	formCount = #anchoredSet

	for _, pattern in ipairs(anchoredSet) do
		table.insert(patterns, pattern)
	end
	for _, pattern in ipairs(looseSet) do
		table.insert(patterns, pattern)
	end
	return patterns
end

local function AreaFromMessage(message)
	if type(message) ~= "string" then
		return nil
	end
	for _, pattern in ipairs(DiscoveryPatterns()) do
		local area = message:match(pattern)
		if area then
			return area
		end
	end
	return nil
end

--------------------------------------------------------------------------------
-- Queue
--------------------------------------------------------------------------------

-- Whether an intro cinematic or a movie is up. InCinematic as well as the frame: it is
-- already true while CINEMATIC_START is being delivered, when CinematicFrame may not
-- have shown itself yet.
local function CinematicUp()
	return (InCinematic and InCinematic())
		or (CinematicFrame and CinematicFrame:IsShown())
		or (MovieFrame and MovieFrame:IsShown())
		or false
end

-- Why a queued clip may not start yet. Registered onto the queue at setup, and
-- consulted every time it tries to advance.
--
-- Combat is worth waiting out rather than skipping: a clip starting mid-pull
-- competes with everything the player actually needs to hear. The queue holds
-- rather than drops, and retries once the pull or the movie ends.
--
-- The item is inspected, not just the moment, because none of this applies to a
-- player who pressed Play: clicking Play mid-pull means now. Only what this file
-- queued waits.
local function HoldReason(item)
	if not item.autoplay then
		return nil
	end
	local switch = item.flight and "flightLore" or "autoplay"
	if not SpokenZones:Get(switch) or not SpokenZones:IsVoiceEnabled() then
		return SpokenZones.L.QUEUE_HELD_OFF
	end
	if UnitAffectingCombat("player") then
		return SpokenZones.L.QUEUE_HELD_COMBAT
	end
	-- A starting-zone cinematic is the one moment a new character is guaranteed to
	-- be discovering things, so narrating over it is the likeliest collision there
	-- is.
	if CinematicUp() then
		return SpokenZones.L.QUEUE_HELD_CINEMATIC
	end
	return nil
end

-- A continent is never autoplayed.
--
-- "Eastern Kingdoms" and "Kalimdor" are lore in their own right and the map panel and
-- /spp play will read them on request, but they are not somewhere a character arrives:
-- every player who ever logs in is standing on one, so autoplaying them means every new
-- character is greeted with the history of a landmass rather than with the valley it
-- woke up in. They reach the queue by accident anyway -- GetLoreWithFallback climbs the
-- parent chain, so any map without lore of its own eventually resolves to its continent,
-- and a player's map resolves to exactly that for the first moments after login.
--
-- Guarded here rather than at each caller because all three autoplay routes -- the login
-- greeting, a discovery, and the already-explored sweep -- share this queue and all three
-- resolve their map the same way.
local CONTINENT_MAP_TYPE = (Enum and Enum.UIMapType and Enum.UIMapType.Continent) or 2

local function IsAutoplayableMap(mapID)
	if not mapID then
		return false
	end
	local info = C_Map.GetMapInfo(mapID)
	-- An unknown map type is allowed through: this is a filter against three specific
	-- maps, and refusing everything it cannot classify would silence the feature on a
	-- client whose map table this addon has not seen.
	if not info or not info.mapType then
		return true
	end
	return info.mapType > CONTINENT_MAP_TYPE
end

-- The zone the last flight read on the way there, kept until the player is on the ground
-- somewhere else. A discovery or the explored sweep on landing would read it a second time.
local flownTo = nil

-- Returns whether the entry was queued, which the login greeting needs: a greeting that
-- resolved nothing must not count as having greeted. `flight` is the destination of a flight
-- just taken, the one entry read in the air.
local function Enqueue(mapID, areaKey, flight)
	-- Skip flyover lore so it cannot queue up for landing.
	if not flight and ((UnitOnTaxi and UnitOnTaxi("player")) or (IsFlying and IsFlying())) then
		return false
	end
	if not flight and not areaKey and mapID == flownTo then
		if SpokenZones:Get("debug") then
			SpokenZones:Print("autoplay: %s was read on the flight here -- not queued", tostring(SpokenZones:GetMapName(mapID)))
		end
		return false
	end

	-- A subzone of a continent is not a thing, so the guard applies to the zone-level
	-- entries only -- but those are the ones that carry the continent lore.
	if not areaKey and not IsAutoplayableMap(mapID) then
		if SpokenZones:Get("debug") then
			SpokenZones:Print("autoplay: %s is a continent -- not queued", tostring(SpokenZones:GetMapName(mapID)))
		end
		return false
	end

	-- An entry the installed pack cannot narrate never enters the queue. PlayLore
	-- would refuse it anyway, but silently queueing it would spend one of three slots
	-- on nothing and make the Next button count clips that will not play.
	if not SpokenZones:HasAudio(mapID, areaKey) then
		if SpokenZones:Get("debug") then
			SpokenZones:Print("autoplay: no clip for %s/%s -- not queued", tostring(mapID), tostring(areaKey))
		end
		return false
	end

	local item = SpokenZones:NewLoreSound(mapID, areaKey)
	if not item then
		return false
	end

	-- Marks this as something the player did not ask for, which is what the hold
	-- above keys on and what keeps a background failure from printing.
	item.autoplay = true
	-- Held by its own switch rather than Read on Discovery's.
	item.flight = flight or nil

	-- The queue refuses a duplicate of its own accord: the login greeting and a
	-- real discovery message can name the same area, and an area on a zone border
	-- can be announced twice. Narrating it twice in a row is worse than missing it.
	return SpokenZones:EnqueueLore(item)
end

--------------------------------------------------------------------------------
-- Per-character record
--------------------------------------------------------------------------------
--
-- What this character has already been narrated. Only `autoplayExplored` reads it;
-- everything writes it, because an area heard from the map panel is still an area
-- the player has heard.
--
-- Marking happens when playback starts rather than when an area is queued. The
-- queue holds three, so riding across an explored Stranglethorn drops most of what
-- it queues; marking on entry would spend those areas on silence and the player
-- would never get them back. Marking on playback leaves them eligible, at the price
-- of a place passed through weeks ago narrating late.

local function CharDB()
	if type(SpokenZonesCharacter) ~= "table" then
		SpokenZonesCharacter = {}
	end
	return SpokenZonesCharacter
end

-- String keys throughout, including for zones, so the two kinds cannot collide and
-- the saved variable reads the same way for both.
local function HeardKey(mapID, areaKey)
	if areaKey then
		return mapID .. "/" .. areaKey
	end
	return tostring(mapID)
end

local function HeardSet()
	local db = CharDB()
	if type(db.heard) ~= "table" then
		db.heard = {}
	end
	return db.heard
end

function SpokenZones:HasHeard(mapID, areaKey)
	if not mapID then
		return false
	end
	return HeardSet()[HeardKey(mapID, areaKey)] == true
end

-- Called by SpokenZones:PlayLore once a clip is confirmed started, whatever asked for
-- it. That is what keeps a discovery and a zone change landing together from
-- narrating the same area twice.
function SpokenZones:MarkHeard(mapID, areaKey)
	if not mapID then
		return
	end
	HeardSet()[HeardKey(mapID, areaKey)] = true
end

function SpokenZones:HeardCount()
	local count = 0
	for _ in pairs(HeardSet()) do
		count = count + 1
	end
	return count
end

--------------------------------------------------------------------------------
-- Narrating what the client already considers explored
--------------------------------------------------------------------------------
--
-- Zone changes, not discoveries. Core dispatches these from ZONE_CHANGED,
-- ZONE_CHANGED_INDOORS and ZONE_CHANGED_NEW_AREA, which between them cover subzone
-- transitions as well as zone ones -- and unlike a discovery they fire every time,
-- which is exactly why the record above has to exist.

local function NarrateUnheard()
	if not SpokenZones:Get("autoplayExplored") then
		return
	end
	if not SpokenZones:Get("autoplay") or not SpokenZones:IsVoiceEnabled() then
		return
	end

	local _, mapID = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	if not mapID then
		return
	end

	-- The zone first: entering a new zone at one of its subzones leaves both
	-- unheard, and the wider piece is the one that sets up the other.
	if not SpokenZones:HasHeard(mapID, nil) and SpokenZones:GetLore(mapID) then
		Enqueue(mapID, nil)
	end

	if not SpokenZones:Get("autoplaySubzones") then
		return
	end

	local subZone = NotSecret(GetSubZoneText())
	if not subZone or subZone == "" then
		return
	end

	local entry, key, storyMapID = SpokenZones:GetSubzoneLore(mapID, subZone)
	if entry and key and not SpokenZones:HasHeard(storyMapID, key) then
		Enqueue(storyMapID, key)
	end
end

--------------------------------------------------------------------------------
-- The one discovery that cannot be placed
--------------------------------------------------------------------------------
--
-- A new character's spawn area is announced while the player's map is still the
-- continent, so OnAreaDiscovered finds no lore for it. The greeting narrates it instead.
--
-- Its once-per-character flag is a saved variable, which a crash or a wiped WTF folder
-- loses. So it also needs level 1 in a starting area, or a character parked in Stormwind
-- is greeted with Stormwind.

local LOGIN_SEED_DELAY = 2

local STARTING_AREAS = {
	[1411] = "valley of trials", -- Durotar
	[1412] = "camp narache", -- Mulgore
	[1420] = "deathknell", -- Tirisfal Glades
	[1426] = "coldridge valley", -- Dun Morogh
	[1429] = "northshire valley", -- Elwynn Forest
	[1438] = "shadowglen", -- Teldrassil
}

-- A brand-new character is the worst case for asking the client where it is: the world
-- is still loading, the intro cinematic is up, and GetBestMapForUnit answers with the
-- continent -- which is how a dwarf who should hear Coldridge Valley was greeted with
-- the history of the Eastern Kingdoms instead. So the greeting retries rather than
-- spending its one turn on whatever the first answer happened to be.
local LOGIN_SEED_ATTEMPTS = 8

-- Whether the greeting is settled: it queued something, or there is nothing it will ever
-- queue. False means "ask again shortly".
local function SeedLoginArea(attempt)
	local db = CharDB()
	local debugOn = SpokenZones:Get("debug")

	if db.greeted then
		return true
	end

	if (UnitLevel("player") or 1) > 1 then
		if debugOn then
			SpokenZones:Print("greeting: level %d -- not a new character", UnitLevel("player"))
		end
		return true
	end
	if not SpokenZones:Get("autoplay") or not SpokenZones:IsVoiceEnabled() then
		-- Deliberately without setting the flag, so turning autoplay on later still
		-- greets on the next login rather than having silently used up its turn.
		if debugOn then
			SpokenZones:Print("greeting: autoplay %s, voice %s -- nothing to do",
				SpokenZones:Get("autoplay") and "on" or "off",
				SpokenZones:IsVoiceEnabled() and "on" or "off")
		end
		return true
	end

	-- Every step of the resolution, because a greeting that says nothing is
	-- indistinguishable from a greeting that never ran -- and reproducing either costs a
	-- fresh character.
	local playerMap = SpokenZones:GetPlayerMapID()
	local _, mapID = SpokenZones:GetLoreWithFallback(playerMap)
	local subZone = NotSecret(GetSubZoneText())
	if debugOn then
		SpokenZones:Print("greeting %d: player map %s (%s), resolved %s (%s), subzone \"%s\"",
			attempt or 0, tostring(playerMap), tostring(SpokenZones:GetMapName(playerMap)),
			tostring(mapID), tostring(mapID and SpokenZones:GetMapName(mapID)),
			tostring(subZone))
	end
	-- The continent: the map has not settled, so ask again.
	if not mapID or not IsAutoplayableMap(mapID) then
		return false
	end
	if not STARTING_AREAS[mapID] then
		if debugOn then
			SpokenZones:Print("greeting: map %s is not a starting zone -- not a new character", tostring(mapID))
		end
		return true
	end
	-- The subzone not filled in yet: ask again.
	if not subZone or subZone == "" then
		return false
	end

	local entry, key, storyMapID = SpokenZones:GetSubzoneLore(mapID, subZone)
	if key ~= STARTING_AREAS[mapID] then
		if debugOn then
			SpokenZones:Print("greeting: \"%s\" is not a starting area -- not a new character", subZone)
		end
		return true
	end

	-- The subzone is the more specific answer, the same preference /spp play and the
	-- lore window both apply.
	if SpokenZones:Get("autoplaySubzones") and entry and Enqueue(storyMapID, key) then
		db.greeted = true
		return true
	end

	if SpokenZones:GetLore(mapID) and Enqueue(mapID, nil) then
		db.greeted = true
		return true
	end

	-- Nothing queued: no clip installed. Worth another look, and the flag stays unset so a
	-- later login still greets if this one never resolves.
	if debugOn then
		SpokenZones:Print("greeting %d: nothing queued for map %s -- retrying", attempt or 0, tostring(mapID))
	end
	return false
end

-- Everything this character is remembered for: the greeting it has had, and the
-- areas it has been narrated. Lets both be tested without rolling another
-- character, and lets a player hear the lot again.
function SpokenZones:ForgetAutoplayHistory()
	local db = CharDB()
	db.greeted = nil
	db.heard = nil
end

--------------------------------------------------------------------------------
-- Discovery handling
--------------------------------------------------------------------------------

-- Discovering the area that shares the zone's name -- stepping out of Valley of
-- Trials into open Durotar -- is what "discovered a zone" means. Everything else
-- the client announces is a subzone.
local function IsZoneDiscovery(areaName, mapID)
	local zoneName = SpokenZones:GetMapName(mapID)
	if not zoneName then
		return false
	end
	return SpokenZones:NormaliseAreaKey(areaName) == SpokenZones:NormaliseAreaKey(zoneName)
end

function SpokenZones:OnAreaDiscovered(areaName)
	if not areaName or areaName == "" then
		return
	end

	local debugOn = self:Get("debug")

	if not self:Get("autoplay") or not self:IsVoiceEnabled() then
		if debugOn then
			self:Print('discovered "%s" -- autoplay off, ignoring', areaName)
		end
		return
	end

	local _, mapID = self:GetLoreWithFallback(self:GetPlayerMapID())
	if not mapID then
		return
	end

	if IsZoneDiscovery(areaName, mapID) then
		if self:GetLore(mapID) then
			if debugOn then
				self:Print('discovered zone "%s" -- queued', areaName)
			end
			Enqueue(mapID, nil)
		end
		return
	end

	if not self:Get("autoplaySubzones") then
		if debugOn then
			self:Print('discovered subzone "%s" -- subzone autoplay is off', areaName)
		end
		return
	end

	local entry, key, storyMapID = self:GetSubzoneLore(mapID, areaName)
	if entry and key then
		if debugOn then
			self:Print('discovered subzone "%s" -> key "%s" -- queued', areaName, key)
		end
		Enqueue(storyMapID, key)
	elseif debugOn then
		self:Print('discovered subzone "%s" -> key "%s" -- no lore', areaName, tostring(key))
	end
end

--------------------------------------------------------------------------------
-- Flights
--------------------------------------------------------------------------------
--
-- A flight reads the zone it lands in, once, while the player is in the air. Nothing flown
-- over is read (Enqueue refuses it on a taxi), and the destination is not read again on
-- landing (flownTo).
--
-- TakeTaxiNode gives only the node's index. Its name says where it is ("Crossroads, The
-- Barrens"), in the client's language, as the map names are; where the name matches no zone,
-- the node's position on its continent's map does.

-- How often, and how many times, to look for the player on the taxi after taking a flight. A
-- flight that never starts (too little money, a node out of reach) reads nothing.
local FLIGHT_CHECK_DELAY = 0.5
local FLIGHT_CHECKS = 20

-- Bumped by every flight taken, so the checks left over from an earlier one stop.
local takeoff = 0

local function OnTaxi()
	return UnitOnTaxi and UnitOnTaxi("player") or false
end

local function ContinentOf(mapID)
	local hops = 0
	while mapID and hops < 8 do
		local info = C_Map.GetMapInfo(mapID)
		if not info then
			return nil
		end
		if info.mapType == CONTINENT_MAP_TYPE then
			return mapID
		end
		mapID = info.parentMapID ~= 0 and info.parentMapID or nil
		hops = hops + 1
	end
	return nil
end

-- The zone or city with lore whose name is `name`, or with `partly`, whose name starts with it
-- ("Stranglethorn" for Stranglethorn Vale). Two answers are no answer.
local function LoreMapNamed(name, partly)
	local wanted = name:lower()
	local match
	for mapID in pairs(SpokenZones.Zones) do
		local own = (SpokenZones:GetMapName(mapID) or ""):lower()
		if (own == wanted or (partly and own:sub(1, #wanted) == wanted)) and IsAutoplayableMap(mapID) then
			if match and match ~= mapID then
				return nil
			end
			match = mapID
		end
	end
	return match
end

-- The place first, then what it is in: "Thunder Bluff, Mulgore" lands in the city.
local function DestinationByName(name, partly)
	if type(name) ~= "string" then
		return nil
	end
	-- The Chinese clients separate the two with a full-width comma.
	name = name:gsub("\239\188\140", ",")
	for part in name:gmatch("[^,]+") do
		part = part:match("^%s*(.-)%s*$")
		local mapID = part ~= "" and LoreMapNamed(part, partly)
		if mapID then
			return mapID
		end
	end
	return nil
end

-- Where the node sits on its continent's map. C_TaxiMap is missing on some clients, and its
-- positions are only trusted on a continent's map.
local function DestinationByPosition(index)
	if not (C_TaxiMap and C_TaxiMap.GetAllTaxiNodes and C_Map.GetMapInfoAtPosition) then
		return nil
	end
	local maps = {}
	if GetTaxiMapID then
		local ok, id = pcall(GetTaxiMapID)
		if ok and id then
			table.insert(maps, id)
		end
	end
	local continent = ContinentOf(SpokenZones:GetPlayerMapID())
	if continent then
		table.insert(maps, continent)
	end
	for _, uiMapID in ipairs(maps) do
		local info = C_Map.GetMapInfo(uiMapID)
		local ok, nodes = false, nil
		if info and info.mapType == CONTINENT_MAP_TYPE then
			ok, nodes = pcall(C_TaxiMap.GetAllTaxiNodes, uiMapID)
		end
		for _, node in ipairs(ok and type(nodes) == "table" and nodes or {}) do
			local at = node.position
			local x, y = at and at.x, at and at.y
			if node.slotIndex == index and x and y and x >= 0 and x <= 1 and y >= 0 and y <= 1 then
				local okAt, found = pcall(C_Map.GetMapInfoAtPosition, uiMapID, x, y)
				local _, mapID = SpokenZones:GetLoreWithFallback(okAt and found and found.mapID or nil)
				if mapID and IsAutoplayableMap(mapID) then
					return mapID
				end
			end
		end
	end
	return nil
end

--- The zone or city with lore that the flight to taxi node `index` lands in, or nil.
function SpokenZones:FlightDestination(index)
	local name = TaxiNodeName and TaxiNodeName(index)
	return DestinationByName(name, false) or DestinationByPosition(index) or DestinationByName(name, true)
end

local function OnFlightTaken(index)
	takeoff = takeoff + 1
	flownTo = nil
	local debugOn = SpokenZones:Get("debug")
	if not SpokenZones:Get("flightLore") or not SpokenZones:IsVoiceEnabled() then
		return
	end
	if TaxiNodeGetType and TaxiNodeGetType(index) ~= "REACHABLE" then
		return
	end
	local mapID = SpokenZones:FlightDestination(index)
	if debugOn then
		SpokenZones:Print('flight to "%s" -> %s', tostring(TaxiNodeName and TaxiNodeName(index)),
			tostring(mapID and SpokenZones:GetMapName(mapID)))
	end
	if not mapID then
		return
	end
	-- A flight inside the zone the player is in has nothing new to tell.
	local _, here = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	if here == mapID then
		return
	end
	-- A place Azeroth's Compendium keeps locked is not read here either.
	if SpokenZones.IsFound and SpokenZones.ShowsUndiscovered
		and not SpokenZones:ShowsUndiscovered() and not SpokenZones:IsFound(mapID) then
		if debugOn then
			SpokenZones:Print("flight: %s is not discovered -- not queued", tostring(SpokenZones:GetMapName(mapID)))
		end
		return
	end

	local mine, checks = takeoff, 0
	local function Check()
		if mine ~= takeoff then
			return
		end
		checks = checks + 1
		if not UnitOnTaxi or OnTaxi() then
			if Enqueue(mapID, nil, true) then
				flownTo = mapID
			end
		elseif checks < FLIGHT_CHECKS then
			C_Timer.After(FLIGHT_CHECK_DELAY, Check)
		end
	end
	Check()
end

-- Landed and walked on into another zone: that zone's lore is the player's again.
local function LeaveDestination()
	if not flownTo or OnTaxi() then
		return
	end
	local _, mapID = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	-- The continent, for a moment after landing, is not somewhere else.
	if mapID and mapID ~= flownTo and IsAutoplayableMap(mapID) then
		flownTo = nil
	end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

-- Four events, because the message's route is not something to bet on. Its text
-- lives in a global named ERR_*, and ERR_ strings normally arrive on
-- UI_INFO_MESSAGE / UI_ERROR_MESSAGE; but exploration also awards experience,
-- which is CHAT_MSG_COMBAT_XP_GAIN territory, and plain system text is
-- CHAT_MSG_SYSTEM. Registering all four costs nothing -- anything that is not a
-- discovery fails the patterns -- and betting on one costs a play session.
local DISCOVERY_EVENTS = {
	"CHAT_MSG_SYSTEM",
	"CHAT_MSG_COMBAT_XP_GAIN",
	"UI_INFO_MESSAGE",
	"UI_ERROR_MESSAGE",
}

-- A cinematic can start after a clip has. The hold above is asked only before a clip
-- starts, and the login greeting fires two seconds after load -- before a new
-- character's intro, often enough -- so without these it narrates over the whole thing.
local CINEMATIC_EVENTS = {
	CINEMATIC_START = true,
	PLAY_MOVIE = true,
}

-- Stops our clip if the hold now applies to it, keeping it queued to replay once the
-- cinematic ends. Asked twice: now, and a frame later, because MovieFrame shows itself
-- from its own PLAY_MOVIE handler and the order frames receive an event in is not
-- defined. InCinematic covers CINEMATIC_START on the first ask.
local function RecheckForCinematic()
	local source = SpokenZones.source
	if source and source.RecheckGates then
		source:RecheckGates()
	end
end

local function OnCinematicStart()
	RecheckForCinematic()
	C_Timer.After(0, RecheckForCinematic)
end

-- The payload is not in the same position across those events: CHAT_MSG_* put the
-- text first, while UI_*_MESSAGE put a numeric messageType first and the text
-- second. Rather than encode that per event, take whichever argument is a string.
-- A secret one yields nothing: indexing it from addon code raises a Lua error, and the
-- strings after it are sender and channel fields, not the message.
local function TextFrom(...)
	for i = 1, select("#", ...) do
		local value = select(i, ...)
		if type(value) == "string" then
			return NotSecret(value)
		end
	end
	return nil
end

function SpokenZones:SetupAutoplay()
	local frame = CreateFrame("Frame")
	for _, event in ipairs(DISCOVERY_EVENTS) do
		frame:RegisterEvent(event)
	end
	for event in pairs(CINEMATIC_EVENTS) do
		frame:RegisterEvent(event)
	end

	frame:SetScript("OnEvent", function(_, event, ...)
		if CINEMATIC_EVENTS[event] then
			OnCinematicStart()
			return
		end
		local message = TextFrom(...)
		local area = AreaFromMessage(message)
		if area then
			SpokenZones:OnAreaDiscovered(area)
		elseif message and SpokenZones:Get("debug") then
			-- Under debug only, and for every watched event rather than one of
			-- them. If a discovery ever stops being recognised, this is the line
			-- that shows which event carried it and what it actually said.
			SpokenZones:Print("|cff888888%s: %s|r", event, message)
		end
	end)

	-- The hold applies to this addon's clips only; the player asks the gate per clip.
	if self.source then
		self.source:AddGate(HoldReason)
	end
	self:OnZoneChanged(LeaveDestination)
	self:OnZoneChanged(NarrateUnheard)
	self.autoplayFrame = frame
	-- An error here is printed rather than raised from inside the flight master's click.
	if TakeTaxiNode and hooksecurefunc then
		hooksecurefunc("TakeTaxiNode", function(index)
			local ok, err = pcall(OnFlightTaken, index)
			if not ok then
				SpokenZones:Print("|cffff5555error|r: %s", tostring(err))
			end
		end)
	end

	-- Delayed because GetSubZoneText is not reliably populated the instant the
	-- world finishes loading, and repeated because on a new character the map is not
	-- either. The greeting queues as soon as it can; the hold above keeps it there
	-- until the intro ends, and the cinematic events stop it if the intro starts late.
	local attempts = 0
	local seed
	seed = function()
		-- An intro does not spend the greeting's attempts. The character is not standing
		-- in its valley while it plays -- on some clients the intro is somewhere else
		-- entirely, with a loading screen after it -- so every answer is wrong, and a
		-- player who watched it to the end arrived after the last attempt and was greeted
		-- by nothing. The attempts start counting once it is over.
		if CinematicUp() then
			C_Timer.After(LOGIN_SEED_DELAY, seed)
			return
		end
		attempts = attempts + 1
		local settled = SeedLoginArea(attempts)
		-- Logging in is not a zone change, so without this a player who logs out
		-- and back in somewhere unheard stands there in silence until they walk
		-- into the next subzone. The greeting runs first and Enqueue refuses a
		-- duplicate, so the spawn area cannot end up queued by both.
		NarrateUnheard()
		if not settled and attempts < LOGIN_SEED_ATTEMPTS then
			C_Timer.After(LOGIN_SEED_DELAY, seed)
		end
	end
	C_Timer.After(LOGIN_SEED_DELAY, seed)
end

-- Reports whether the client defined the strings this feature is built on, so a
-- silent failure can be told apart from "nothing has been discovered yet".
function SpokenZones:DescribeAutoplay()
	DiscoveryPatterns()
	local found = formCount
	if found == 0 then
		self:Print("|cffff5555autoplay cannot work|r: this client defines neither "
			.. "ERR_ZONE_EXPLORED nor ERR_ZONE_EXPLORED_XP")
		return
	end
	self:Print("autoplay %s, matching %d discovery message form(s); subzones %s",
		self:Get("autoplay") and "on" or "off", found,
		self:Get("autoplaySubzones") and "included" or "excluded")

	-- The count distinguishes "the option is doing nothing yet" from "everything
	-- around here is already marked", which otherwise sound identical: silence.
	if self:Get("autoplayExplored") then
		self:Print("already-explored areas included -- %d narrated on this character so far",
			self:HeardCount())
	end
end

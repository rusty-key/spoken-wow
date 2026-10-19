-- SpokenZones -- Core: namespace, saved variables, events, zone resolution.
-- Client targets: WoW Classic Era 1.15.9 (11509) and Anniversary 2.5.6 (20506).
-- The two share a uiMapID space, so nothing here branches on the client.

local ADDON_NAME, SpokenZones = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

-- C_AddOns is the modern home of GetAddOnMetadata; the global is the older one.
-- Reading through whichever exists costs a line and removes a whole class of
-- load-time failure on a client this addon has not been run on.
local GetAddOnMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata

SpokenZones.name = ADDON_NAME
SpokenZones.version = GetAddOnMeta(ADDON_NAME, "Version") or "dev"

-- Populated by Data/<language>/Zones.lua and Subzones.lua (both generated),
-- through SpokenZones:RegisterLoreData. Declared here so every other file can rely
-- on the tables existing even when a data file is empty or failed to load.
SpokenZones.Zones = SpokenZones.Zones or {}
SpokenZones.Subzones = SpokenZones.Subzones or {}

-- The subzone the player clicked on the world map, or nil to show zone lore:
-- { mapID = <parent uiMapID>, areaName = <client name>, entry = <lore> }
SpokenZones.selected = nil

-- Callbacks fired when the lore shown to the player should change. UI modules
-- register into this rather than each hooking WorldMapFrame independently.
SpokenZones.mapChangedCallbacks = {}
SpokenZones.zoneChangedCallbacks = {}

local defaults = {
	showMapPanel = true,
	mapPanelCollapsed = false,
	-- Wide enough that a zone's name fits on one line beside the header's round buttons.
	panelWidth = 360,
	fontSize = 12,
	showPictures = true,
	-- How bright the area under the pointer lights on a zone map; 0 turns the highlight off.
	highlightOpacity = 0.35,
	-- Off, so Azeroth's Compendium opens only the places this character has found (Discovery.lua).
	showUndiscovered = false,
	-- Azeroth's Compendium's Discovered Only, under its list: off, so every place is listed.
	loreDiscoveredOnly = false,
	loreVoicedOnly = false,
	voiceEnabled = true,
	autoplay = true,
	autoplaySubzones = true,
	-- Off, because it replaces the client's own record of what a character has
	-- discovered with one SpokenZones keeps itself. Only a character who explored
	-- before installing the addon needs that; see Autoplay.lua.
	autoplayExplored = false,
	-- A flight reads the zone it lands in (Autoplay.lua).
	flightLore = true,
	-- Off, so a player cannot end up reading an unfinished translation without
	-- having asked for one (Spoken > Developer). See Language.lua.
	languagePreview = false,
	-- `audioPack` has no default: nil means "the best pack in the voice language", which is a
	-- rule rather than a folder name, and naming a default here would pin the player to
	-- a pack they may never install. See Audio.lua.
	-- `language` likewise: nil means "follow the client locale", which is not the
	-- same answer as "enUS" -- a player who never chose should start reading their
	-- own language the day it ships, and one who picked English should not.
	debug = false,
}

--------------------------------------------------------------------------------
-- Output
--------------------------------------------------------------------------------

local PREFIX = "|cff66bbffSpoken Places|r: "

function SpokenZones:Print(fmt, ...)
	local msg = select("#", ...) > 0 and fmt:format(...) or fmt
	DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. msg)
end

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

-- Merge defaults into the saved table without clobbering stored values, so new
-- options added in later versions appear for existing users. Runtime reads and
-- writes go straight to SpokenZonesSettings.
local function MergeDefaults()
	if type(SpokenZonesSettings) ~= "table" then
		SpokenZonesSettings = {}
	end
	for key, value in pairs(defaults) do
		if SpokenZonesSettings[key] == nil then
			SpokenZonesSettings[key] = value
		end
	end

	SpokenZones.db = SpokenZonesSettings
end

local function InitConfig()
	SpokenZones:BindSettings()
	MergeDefaults()
end

-- Spoken has bound a profile's table. Before ADDON_LOADED that is the first binding, which
-- InitConfig finishes; after it, another profile was chosen, copied over this one or reset. Only
-- merges: binding again from here would call this again.
function SpokenZones:OnSettingsBound()
	if not SpokenZones.db then return end
	MergeDefaults()
	-- The stories' language was settled at load: say when this profile wants another.
	local wanted = self:ResolveLanguage()
	if wanted ~= self:GetLanguage() then
		self:Print("%s", string.format(self.L.OPT_LANG_PROFILE_FMT, self:GetLanguageName(wanted)))
	end
end

-- Safe before ADDON_LOADED has run.
function SpokenZones:Get(key)
	-- Text Size is Azeroth's Compendium's, on Spoken's page.
	if key == "fontSize" and Spoken then
		return Spoken:CompendiumFontSize()
	end
	if SpokenZonesSettings == nil then
		return defaults[key]
	end
	local value = SpokenZonesSettings[key]
	if value == nil then
		return defaults[key]
	end
	return value
end

function SpokenZones:Set(key, value)
	SpokenZonesSettings[key] = value
end

-- Switched on, by the setting or by /spp panel, the player means to see the panel, not the
-- button that reopens it.
function SpokenZones:SetMapPanelShown(shown)
	SpokenZones:Set("showMapPanel", shown)
	if shown then SpokenZones:Set("mapPanelCollapsed", false) end
end

--- Every setting back to its default. The language chosen and the record of places already
--- narrated are not settings in that sense, and stay.
function SpokenZones:ResetOptions()
	if SpokenZonesSettings == nil then return end
	-- Unlock Undiscovered Zones and Text Size are on Spoken's page where Spoken is installed, and
	-- not this one's.
	local elsewhere = Spoken and Spoken.ShowsCompendium and { showUndiscovered = true, fontSize = true } or {}
	for key, value in pairs(defaults) do
		if not elsewhere[key] then SpokenZonesSettings[key] = value end
	end
	-- Applied as the checkboxes apply them, not only written: the play buttons follow the voice
	-- being on again.
	SpokenZones:NotifyAudioChanged()
end

--- Whether the player has this part of Spoken switched on (Spoken's settings). Without the
--- player there is no switch to read, and the part counts as on. Off, the map's panel and its
--- play buttons stay hidden.
function SpokenZones:IsPartOn()
	return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("zones")
end

--------------------------------------------------------------------------------
-- Zone resolution
--------------------------------------------------------------------------------

-- The uiMapID the world map is currently displaying (nil if the map is not up).
function SpokenZones:GetDisplayedMapID()
	return WorldMapFrame and WorldMapFrame.mapID
end

-- The uiMapID the player is physically standing in.
function SpokenZones:GetPlayerMapID()
	return NotSecret(C_Map.GetBestMapForUnit("player"))
end

-- Prefer the client's own zone name over the name baked into the generated data,
-- so Era-specific naming (e.g. "The Barrens" rather than retail's "Northern
-- Barrens") is always correct regardless of what the wiki page was titled.
function SpokenZones:GetMapName(mapID)
	if not mapID then
		return nil
	end
	local info = C_Map.GetMapInfo(mapID)
	if info and info.name and info.name ~= "" then
		return info.name
	end
	local entry = self.Zones[mapID]
	return entry and entry.name or nil
end

-- A place the client can name that nobody has written about yet. The corpus ships these
-- so the addon can list the subzone and say so, rather than leaving a place the player is
-- standing in absent from the panel entirely.
--
-- The empty-string check is not belt and braces: in Lua "" is truthy, so every
-- `entry.full or entry.short or fallback` in the UI would render a blank body for one of
-- these. Ask this instead of asking whether the entry exists.
function SpokenZones:IsPending(entry)
	if not entry then
		return false
	end
	if entry.pending then
		return true
	end
	return (entry.full or "") == "" and (entry.short or "") == ""
end

--- The place's picture and its edge mask, or nil without one or with pictures turned off.
function SpokenZones:Picture(mapID, key)
	local pictures = self.pictures and mapID and self.pictures[mapID]
	local picture = pictures and pictures[key or ""]
	if not picture or self:Get("showPictures") == false then return nil end
	local folder = [[Interface\AddOns\Spoken_Places\Textures\Pictures\]]
	return folder .. picture[1], folder .. "Mask" .. picture[2]
end

function SpokenZones:GetLore(mapID)
	if not mapID then
		return nil
	end
	return self.Zones[mapID]
end

-- Walks up the map hierarchy looking for an ancestor that does have lore, so a
-- dungeon or micro-map falls back to its parent zone instead of showing nothing.
-- Returns the entry and the mapID it was found on.
function SpokenZones:GetLoreWithFallback(mapID)
	local id, hops = mapID, 0
	while id and hops < 6 do
		local entry = self.Zones[id]
		if entry then
			return entry, id
		end
		local info = C_Map.GetMapInfo(id)
		id = info and info.parentMapID
		if id == 0 then
			id = nil
		end
		hops = hops + 1
	end
	return nil, nil
end

--------------------------------------------------------------------------------
-- Subzones
--
-- Subzones are areas, not uiMapIDs, and MapUtil.FindBestAreaNameAtMouse returns
-- a name rather than an ID -- so lore is keyed by name, scoped to the parent
-- zone. Client and wiki disagree on cosmetic details ("The Bulwark" versus a
-- page titled "Bulwark"), so both sides are reduced to the same canonical key.
--
-- This must stay in step with normaliseKey in tools/lib/wiki.mjs.
--------------------------------------------------------------------------------

function SpokenZones:NormaliseAreaKey(name)
	if type(name) ~= "string" then
		return nil
	end
	local key = name:lower()
	key = key:gsub("'", "")
	key = key:gsub("^the%s+", "")
	key = key:gsub("[^a-z0-9]+", " ")
	key = key:gsub("^%s+", "")
	key = key:gsub("%s+$", "")
	if key == "" then
		return nil
	end
	return key
end

-- The corpus key for a name the client just reported. The corpus is keyed by
-- English name in every language -- a place is one place regardless of what it
-- is called -- so on a non-English client the name has to come back through the
-- alias table generated from the client's own AreaTable first.
--
-- The alias table is chosen by client locale and never by content language: a
-- German client reading English lore is still handed "Sengende Schlucht", and
-- without this it matches nothing at all. That was the state of the addon for
-- every non-English player before this existed.
--
-- The alias table is keyed by the raw client name, not a normalised one, and is
-- consulted before normalisation for that reason: NormaliseAreaKey reduces a
-- name to [a-z0-9 ], which leaves nothing at all of "Дун Морог". Both sides come
-- from the client's own AreaTable, so an exact match is available and is the
-- most precise thing on offer.
--
-- Falls through to the normalised name when there is no alias. That covers an
-- English client, and every place whose name Blizzard left in English -- which
-- is around one subzone in eight for German.
function SpokenZones:ResolveAreaKey(name)
	if type(name) ~= "string" then
		return nil
	end
	local aliases = self.Aliases[self.clientLocale]
	local aliased = aliases and aliases[name]
	if aliased then
		return aliased
	end
	-- Forever's spelling of a place the lore keeps under another key (Data/ForeverAreas.lua).
	local key = self:NormaliseAreaKey(name)
	return self.ForeverNames and self.ForeverNames[key] or key
end

--------------------------------------------------------------------------------
-- Report links
--
-- The game cannot open a URL or send anything anywhere, so the only way a player
-- can report a bad line is to copy an address and open it themselves. The site
-- resolves /{lang}/zones/r/{mapID}/{slug} back to a line by matching that path
-- against the audio file paths it already assigns, which is why the slug is built
-- the same way here as slugFor does in tools/voice/naming.mjs -- and why "zone",
-- the file name a zone's own line gets, doubles as the slug for it.
--
-- The language in the address is the one being READ, not the client's locale: a
-- report is about the text and narration on screen, and the site shows that
-- language's line so the people who can act on it see it beside the line it is
-- about.
--
-- tools/validate.mjs fails the build if these two ever drift, or if two subzones
-- in one zone come to share a slug: the JS side has a hash fallback for that
-- collision, and nothing here can reproduce it.
--------------------------------------------------------------------------------

--- Spoken's site, or nil when Spoken is not loaded: no clip plays without it, so there is no
--- report to send.
function SpokenZones:SiteURL()
	return _G.Spoken and _G.Spoken.SITE_URL
end

-- `language` is the voice language, for a report made from the player about a clip; the lore
-- window's report is about the text on screen and passes none.
function SpokenZones:ReportURL(mapID, areaKey, language)
	if not mapID or not self:SiteURL() then
		return nil
	end
	local slug = "zone"
	if areaKey then
		slug = areaKey:gsub("%s+", "-")
		slug = slug:gsub("[^a-z0-9%-]", "")
		if slug == "" then
			slug = "zone"
		end
	end
	return _G.Spoken:ReportURL("zones", ("%d/%s"):format(mapID, slug), language or self:GetLanguage())
end

--------------------------------------------------------------------------------
-- Areas the client puts in another zone than their story's
--
-- Two tables name them: Spoken's Data/Dungeons.lua lists each dungeon with the zone of its entrance
-- and the area that tells its story, and the hand-kept Data/AreaZones.lua the other areas, under
-- the zone their story is kept under, with the zone the client puts them in (`zone`) and any more
-- it has an area of that name in (`also`). An area is listed in its zone, found and told there and
-- on its `also` maps, and its story is still kept, recorded, pictured and reported under its own
-- frozen id. A `zone` this client has no map for is left out: Forever's Shen'dralas, on Era.
--------------------------------------------------------------------------------

--- The dungeons and raids that have a story, by the zone of their entrance: each { mapID, key } of
--- the area telling it and `dungeon`, its instance map, from Spoken's table of them (`all`, by map).
function SpokenZones.DungeonsByZone(all)
	local byZone, maps = {}, {}
	for map in pairs(all or {}) do table.insert(maps, map) end
	table.sort(maps)
	for _, map in ipairs(maps) do
		local dungeon = all[map]
		if dungeon.story and dungeon.zone then
			byZone[dungeon.zone] = byZone[dungeon.zone] or {}
			table.insert(byZone[dungeon.zone], { mapID = dungeon.story[1], key = dungeon.story[2], dungeon = map })
		end
	end
	return byZone
end
SpokenZones.Dungeons = SpokenZones.DungeonsByZone(_G.SpokenDungeons and SpokenDungeons.dungeons)

-- Built once from both tables: `story` [found on][key] = the story's map, `zone` [story's map][key]
-- = the zone it is listed in, `on` [story's map][key] = every map it is found on but the story's,
-- `into` [zone] = the areas listed there whose story is kept under another zone.
local placeIndex, placesFrom = nil, {}

local function HasMap(mapID)
	return not (C_Map and C_Map.GetMapInfo) or C_Map.GetMapInfo(mapID) ~= nil
end

local function PlaceIndex()
	local dungeons, moved = SpokenZones.Dungeons, SpokenZones.AreaZones
	if placeIndex and placesFrom[1] == dungeons and placesFrom[2] == moved then
		return placeIndex
	end
	placesFrom = { dungeons, moved }
	local index = { story = {}, zone = {}, on = {}, into = {} }
	local function FoundOn(storyMapID, key, mapID)
		index.story[mapID] = index.story[mapID] or {}
		index.story[mapID][key] = storyMapID
		index.on[storyMapID] = index.on[storyMapID] or {}
		index.on[storyMapID][key] = index.on[storyMapID][key] or {}
		table.insert(index.on[storyMapID][key], mapID)
	end
	local function Listed(storyMapID, key, zone)
		index.zone[storyMapID] = index.zone[storyMapID] or {}
		index.zone[storyMapID][key] = zone
		index.into[zone] = index.into[zone] or {}
		table.insert(index.into[zone], { mapID = storyMapID, key = key })
		FoundOn(storyMapID, key, zone)
	end
	for entrance, list in pairs(dungeons or {}) do
		for _, dungeon in ipairs(list) do
			if dungeon.mapID ~= entrance then Listed(dungeon.mapID, dungeon.key, entrance) end
		end
	end
	for storyMapID, areas in pairs(moved or {}) do
		for key, area in pairs(areas) do
			if area.zone and HasMap(area.zone) then Listed(storyMapID, key, area.zone) end
			for _, mapID in ipairs(area.also or {}) do FoundOn(storyMapID, key, mapID) end
		end
	end
	placeIndex = index
	return index
end

--- Where the story of the area `key` found on the map `mapID` is kept: the map and key its text,
--- recording, picture and report are under. Razorfen Downs, found at its entrance in The Barrens,
--- is told under Thousand Needles, and Strahnbrad, found in Alterac Mountains, under Hillsbrad
--- Foothills; an area found where its story is kept is told there.
function SpokenZones:StoryPlace(mapID, key)
	local at = key and PlaceIndex().story[mapID]
	return at and at[key] or mapID, key
end

--- The zone the area `key`, whose story is kept under `mapID`, is listed in: the zone of a
--- dungeon's entrance, the zone the client puts any other area in.
function SpokenZones:AreaZone(mapID, key)
	local at = key and PlaceIndex().zone[mapID]
	return at and at[key] or mapID
end

--- The maps besides `mapID` that the area `key`, whose story is kept under `mapID`, is found on.
function SpokenZones:FoundOn(mapID, key)
	local at = key and PlaceIndex().on[mapID]
	return at and at[key] or {}
end

--- The areas with a story listed under the zone `zone`, each { mapID = the map its story is kept
--- under, key = }: the zone's own stories but those the client puts elsewhere, and the stories
--- kept elsewhere that it puts here. On Forever, not those no Forever player can reach
--- (Data/ForeverAreas.lua's NotOnForever).
local onForever
function SpokenZones:AreasIn(zone)
	local index = PlaceIndex()
	local away = index.zone[zone] or {}
	if onForever == nil then
		-- Forever's client has a map of Mount Hyjal.
		onForever = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(2482) ~= nil or false
	end
	local unreachable = onForever and self.NotOnForever or {}
	local function Reachable(mapID, key)
		return not (unreachable[mapID] and unreachable[mapID][key])
	end
	local list = {}
	for key in pairs(self.Subzones[zone] or {}) do
		if not away[key] and Reachable(zone, key) then table.insert(list, { mapID = zone, key = key }) end
	end
	for _, area in ipairs(index.into[zone] or {}) do
		if self.Subzones[area.mapID] and self.Subzones[area.mapID][area.key] and Reachable(area.mapID, area.key) then
			table.insert(list, area)
		end
	end
	return list
end

-- Returns the lore entry, the key that was looked up and the map the story is kept under
-- (SpokenZones:StoryPlace). The key is returned even on a miss so /spp debug can report what
-- failed to match.
function SpokenZones:GetSubzoneLore(parentMapID, areaName)
	local key = self:ResolveAreaKey(areaName)
	if not key then
		return nil, nil
	end

	local storyMapID = self:StoryPlace(parentMapID, key)
	local zoneTable = self.Subzones[storyMapID]
	if not zoneTable then
		return nil, key, storyMapID
	end
	return zoneTable[key], key, storyMapID
end

function SpokenZones:IsZoneMap(mapID)
	local info = mapID and C_Map.GetMapInfo(mapID)
	if not info then
		return false
	end
	local zoneType = (Enum and Enum.UIMapType and Enum.UIMapType.Zone) or 3
	return info.mapType == zoneType
end

-- Subzone name under a normalised canvas position, or nil.
function SpokenZones:GetAreaNameAt(mapID, x, y)
	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		return nil
	end
	local ok, name = pcall(MapUtil.FindBestAreaNameAtMouse, mapID, x, y)
	if ok then
		return name
	end
	return nil
end

--- The city inside the zone `mapID` that the area `areaName` is, if it is one, and its story. Each
--- city is a map of its own under its continent in the game's map tree (Stormwind City under the
--- Eastern Kingdoms, not Elwynn Forest), so on its zone's map the game reports it only by its area
--- name, and the zone no longer lists it as one of its own areas (SpokenZones.CityIn, the lore
--- window's). Matched by the city map's name in the client's language, or its story's.
function SpokenZones:CityAt(mapID, areaName)
	if not (mapID and areaName and self.CityIn) then
		return nil
	end
	local wanted = string.lower(areaName)
	for city, zone in pairs(self.CityIn) do
		if zone == mapID then
			local info = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(city)
			local entry = self:GetLore(city)
			if (info and info.name and string.lower(info.name) == wanted)
				or (entry and entry.name and string.lower(entry.name) == wanted) then
				return city, entry
			end
		end
	end
	return nil
end

--- The area at a normalised canvas position on the zone map `mapID`: the name the game gives it,
--- and the zone's story for that name and its key; or, for a city inside the zone, the city's own
--- story and its map (name, entry, nil, cityMapID). The click (UI/SubzoneClick.lua) and the map
--- highlight (UI/MapHighlight.lua) both ask this, so what lights up under the pointer is what a
--- click there opens.
function SpokenZones:AreaAt(mapID, x, y)
	if not mapID or not x or not y then
		return nil
	end
	local areaName = self:GetAreaNameAt(mapID, x, y)
	if not areaName then
		return nil
	end
	local entry, key = self:GetSubzoneLore(mapID, areaName)
	if entry then
		return areaName, entry, key
	end
	local city, cityEntry = self:CityAt(mapID, areaName)
	if city and cityEntry then
		return areaName, cityEntry, nil, city
	end
	return areaName
end

function SpokenZones:SelectSubzone(mapID, areaName, entry)
	self.selected = { mapID = mapID, areaName = areaName, entry = entry }
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end

function SpokenZones:ClearSubzone()
	if not self.selected then
		return
	end
	self.selected = nil
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end

--------------------------------------------------------------------------------
-- Callback dispatch
--------------------------------------------------------------------------------

function SpokenZones:OnMapChanged(fn)
	table.insert(self.mapChangedCallbacks, fn)
end

function SpokenZones:OnZoneChanged(fn)
	table.insert(self.zoneChangedCallbacks, fn)
end

local function Dispatch(list, ...)
	for i = 1, #list do
		local ok, err = pcall(list[i], ...)
		if not ok then
			SpokenZones:Print("|cffff5555error|r: %s", tostring(err))
		end
	end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

local initialised = false

local function SetupHooks()
	if initialised then
		return
	end
	initialised = true

	-- Map is showing a different zone. Covers both player-driven navigation and
	-- programmatic SetMapID calls; OnMapChanged is the single funnel for both.
	hooksecurefunc(WorldMapFrame, "OnMapChanged", function()
		Dispatch(SpokenZones.mapChangedCallbacks, WorldMapFrame.mapID)
	end)

	WorldMapFrame:HookScript("OnShow", function()
		Dispatch(SpokenZones.mapChangedCallbacks, WorldMapFrame.mapID)
	end)

	-- Audio before autoplay: autoplay registers its combat hold on the source audio creates. Each
	-- step on its own, its error printed and reported, so one that fails does not keep the rest
	-- from being set up: without audio's source, Spoken's page calls Zones not installed.
	for _, step in ipairs({ "SetupMapPanel", "SetupSubzoneClicks", "SetupMapHighlight", "SetupDiscovery",
		"SetupLoreWindow", "SetupAudio", "SetupAutoplay", "SetupOptions" }) do
		if SpokenZones[step] then
			local ok, err = pcall(SpokenZones[step], SpokenZones)
			if not ok then
				SpokenZones:Print("|cffff5555%s failed:|r %s", step, tostring(err))
				-- To BugSack and the game's error frame too, which a chat line never reaches.
				if geterrorhandler then geterrorhandler()(err) end
			end
		end
	end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ZONE_CHANGED")
events:RegisterEvent("ZONE_CHANGED_INDOORS")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:SetScript("OnEvent", function(self, event, arg1)
	if event == "ADDON_LOADED" then
		if arg1 == ADDON_NAME then
			InitConfig()
			self:UnregisterEvent("ADDON_LOADED")
		end
	elseif event == "PLAYER_ENTERING_WORLD" then
		SetupHooks()
		-- Said every login, not once: an override you have forgotten you enabled
		-- turns every gap in an unfinished translation into a bug report nobody
		-- can reproduce.
		if SpokenZones:IsPreviewingLanguage() then
			SpokenZones:Print(
				"|cffffcc00previewing unfinished languages|r -- reading %s. /spp lang off to stop",
				SpokenZones:GetLanguage()
			)
		end
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
	else
		Dispatch(SpokenZones.zoneChangedCallbacks, SpokenZones:GetPlayerMapID())
	end
end)

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

-- Recursively enumerate the map tree so tools/seed/zones.json can be built from
-- the client itself rather than transcribed by hand. Results land in
-- SpokenZonesSettings.dump, which is only written to disk on logout or /reload.
local MAP_TYPE_NAMES = { [0] = "Cosmic", [1] = "World", [2] = "Continent", [3] = "Zone", [4] = "Dungeon", [5] = "Micro", [6] = "Orphan" }

local function DumpMapTree(rootID, out, seen, depth)
	if not rootID or seen[rootID] or depth > 8 then
		return
	end
	seen[rootID] = true

	local info = C_Map.GetMapInfo(rootID)
	if info then
		table.insert(out, {
			mapID = rootID,
			name = info.name,
			mapType = info.mapType,
			mapTypeName = MAP_TYPE_NAMES[info.mapType] or tostring(info.mapType),
			parentMapID = info.parentMapID,
			hasArt = C_Map.MapHasArt(rootID) or false,
		})
	end

	local children = C_Map.GetMapChildrenInfo(rootID)
	if children then
		for i = 1, #children do
			DumpMapTree(children[i].mapID, out, seen, depth + 1)
		end
	end
end

local function CmdDump()
	local out, seen = {}, {}
	DumpMapTree(947, out, seen, 0)   -- Azeroth (world)
	DumpMapTree(1414, out, seen, 0)  -- Kalimdor
	DumpMapTree(1415, out, seen, 0)  -- Eastern Kingdoms
	SpokenZonesSettings.dump = out
	SpokenZones:Print("dumped %d maps to SpokenZonesSettings.dump. Run /reload, then:", #out)
	SpokenZones:Print("  node pipelines/zones/tools/seed-from-dump.mjs")
end

-- Cross-check the generated data against the live client. Catches wrong uiMapIDs
-- and names that differ between Era and the wiki (the main data risk).
local function CmdVerify()
	local total, missing, mismatched = 0, 0, 0
	local ids = {}
	for mapID in pairs(SpokenZones.Zones) do
		table.insert(ids, mapID)
	end
	table.sort(ids)

	for i = 1, #ids do
		local mapID = ids[i]
		local entry = SpokenZones.Zones[mapID]
		total = total + 1
		local info = C_Map.GetMapInfo(mapID)
		if not info then
			missing = missing + 1
			SpokenZones:Print("|cffff5555%d|r (%s): no such map on this client", mapID, tostring(entry.name))
		elseif entry.name and info.name ~= entry.name then
			mismatched = mismatched + 1
			SpokenZones:Print("|cffffcc00%d|r: data says %q, client says %q", mapID, entry.name, info.name)
		end
	end

	SpokenZones:Print("verified %d entries: %d unknown to client, %d name mismatches", total, missing, mismatched)
	if missing == 0 and mismatched == 0 then
		SpokenZones:Print("|cff55ff55all entries resolve correctly|r")
	end
end

local function CmdStatus()
	local playerMap = SpokenZones:GetPlayerMapID()
	local shownMap = SpokenZones:GetDisplayedMapID()

	local zoneCount = 0
	for _ in pairs(SpokenZones.Zones) do
		zoneCount = zoneCount + 1
	end

	local subzoneZones, subzoneCount = 0, 0
	for _, tbl in pairs(SpokenZones.Subzones) do
		subzoneZones = subzoneZones + 1
		for _ in pairs(tbl) do
			subzoneCount = subzoneCount + 1
		end
	end

	SpokenZones:Print(
		"v%s -- %d zones, %d subzones across %d zones",
		SpokenZones.version, zoneCount, subzoneCount, subzoneZones
	)
	-- Both axes, always, because almost every "it shows nothing" report is one of
	-- the two being something other than what was assumed.
	local aliases = SpokenZones.Aliases[SpokenZones.clientLocale]
	local aliasCount = 0
	if aliases then
		for _ in pairs(aliases) do
			aliasCount = aliasCount + 1
		end
	end
	SpokenZones:Print(
		"reading %s on a %s client -- %d area name aliases",
		SpokenZones:GetLanguage(), SpokenZones.clientLocale, aliasCount
	)

	SpokenZones:Print("player is in: %s (uiMapID %s)", tostring(SpokenZones:GetMapName(playerMap)), tostring(playerMap))
	SpokenZones:Print("map is showing: %s (uiMapID %s)", tostring(SpokenZones:GetMapName(shownMap)), tostring(shownMap))

	local entry = SpokenZones:GetLore(playerMap)
	if entry then
		SpokenZones:Print("lore for current zone: %d characters", #(entry.full or ""))
	else
		SpokenZones:Print("|cffffcc00no lore recorded for the current zone|r")
	end

	-- Report the subzone the player is standing in. This exercises the same
	-- name-keyed lookup the map click uses, without needing the map open, so a
	-- name mismatch can be spotted just by walking around.
	local subZone = NotSecret(GetSubZoneText())
	if subZone and subZone ~= "" then
		local subEntry, key = SpokenZones:GetSubzoneLore(playerMap, subZone)
		local raw = SpokenZones:NormaliseAreaKey(subZone)
		SpokenZones:Print(
			'standing in subzone "%s" -> key "%s"%s -> %s',
			subZone, tostring(key),
			-- Naming the alias step only when it fired keeps the common line short
			-- and makes a missing alias visible as the absence of this clause.
			(key and raw and key ~= raw) and (' (aliased from "' .. raw .. '")') or "",
			subEntry and "lore found" or "|cffffcc00no lore|r"
		)
	end

	if SpokenZones.DescribeAutoplay then
		SpokenZones:DescribeAutoplay()
	end

	local waiting = SpokenZones:QueueLength()
	if waiting > 0 then
		SpokenZones:Print("queue: %d waiting", waiting)
	end

	local pack = SpokenZones:GetActiveAudioPack()
	if pack then
		SpokenZones:Print("voice pack: %s -- %s", pack.addon, SpokenZones:GetAudioPackLabel(pack))
	else
		SpokenZones:Print("|cffffcc00no voice pack installed|r -- install Spoken Audio: Places to hear the lore")
	end

	if SpokenZones:Get("debug") then
		SpokenZones:Print("|cff66bbffdebug mode is on|r")
	end
end

-- What /spp play narrates: the subzone the player is standing in if it has lore,
-- otherwise the zone. The same "more specific answer wins" preference the lore
-- window applies when it opens.
local function CurrentAudioTarget()
	local _, resolved = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	if not resolved then
		return nil, nil
	end

	local subZone = NotSecret(GetSubZoneText())
	if subZone and subZone ~= "" then
		local entry, key, storyMapID = SpokenZones:GetSubzoneLore(resolved, subZone)
		if entry then
			return storyMapID, key
		end
	end

	return resolved, nil
end

local function CmdPlay()
	local mapID, key = CurrentAudioTarget()
	if not mapID then
		SpokenZones:Print("|cffffcc00no lore for where you are standing|r")
		return
	end

	if not SpokenZones:IsVoiceEnabled() then
		SpokenZones:Print("|cffffcc00narration is turned off|r -- /spp voice to turn it on")
		return
	end

	if not SpokenZones:PlayLore(mapID, key) then
		return
	end

	-- Nothing to report when PlayLore returned false above: it has already said why.
	local what = key or SpokenZones:GetMapName(mapID) or tostring(mapID)
	SpokenZones:Print("playing lore for %s", what)
end

-- `/spp audio` lists installed sound packs; `/spp audio <folder>` switches to one.
-- Worth a command of its own because having two tiers installed at once is the
-- case where the addon's behaviour is otherwise invisible: both play, and only
-- the disk footprint differs.
local function CmdAudioPack(arg)
	local packs = SpokenZones:GetAudioPacks()
	if #packs == 0 then
		-- Any pack would do -- packs are interchangeable across languages -- so an
		-- empty list really does mean nothing is installed.
		SpokenZones:Print("|cffffcc00no voice pack installed|r")
		-- Named by CurseForge project, not by folder: a player with the pre-rename pack has a
		-- ZoneLoreAudio folder, and saying that name sends them looking for a project that no
		-- longer exists.
		SpokenZones:Print("  install Spoken Audio: Places alongside Spoken Places")
		return
	end

	if arg and arg ~= "" then
		-- Matched case-insensitively: the player is reading the folder name off a
		-- listing and retyping it, and "zoneloreaudiohq" is the same request.
		for i = 1, #packs do
			if packs[i].addon:lower() == arg:lower() then
				SpokenZones:SetActiveAudioPack(packs[i].addon)
				SpokenZones:Print("now playing from %s -- %s", packs[i].addon, SpokenZones:GetAudioPackLabel(packs[i]))
				return
			end
		end
		SpokenZones:Print('|cffffcc00"%s" is not an installed voice pack|r', arg)
		return
	end

	local active = SpokenZones:GetActiveAudioPack()
	SpokenZones:Print("voice packs:")
	for i = 1, #packs do
		local pack = packs[i]
		SpokenZones:Print(
			"  %s %s -- %s, v%s",
			pack == active and "|cff66bbff*|r" or " ",
			pack.addon, SpokenZones:GetAudioPackLabel(pack), tostring(pack.packVersion)
		)
	end
	if #packs > 1 then
		SpokenZones:Print("  /spp audio <name> to switch")
	end
end

--- What the settings' Show Diagnostics prints: the voice packs, and how reading is set up.
function SpokenZones:ShowDiagnostics()
	CmdAudioPack(nil)
	local stories = 0
	for _ in pairs(SpokenZones.Zones or {}) do stories = stories + 1 end
	SpokenZones:Print("voice %s, read on discovery %s, %d zones with stories, language %s",
		SpokenZones:IsVoiceEnabled() and "on" or "off", SpokenZones:Get("autoplay") and "on" or "off",
		stories, tostring(SpokenZones:GetLanguage()))
end

-- The first zone, by uiMapID, the installed voice pack has a clip for.
local function FirstZoneWithAudio()
	local ids = {}
	for id in pairs(SpokenZones.Zones or {}) do table.insert(ids, id) end
	table.sort(ids)
	for _, id in ipairs(ids) do
		if SpokenZones:HasAudio(id, nil) then return id end
	end
end

--- A story played the way a real one is, to check it can be heard: the one for where the
--- player stands, or else the first one the voice pack has.
function SpokenZones:PlayTestLine()
	if not SpokenZones:IsVoiceEnabled() then
		SpokenZones:Print("|cffffcc00Read Stories Aloud is off|r")
		return
	end
	-- Only a story with a clip is tried, and only one: PlayLore says why it failed.
	local mapID, key = CurrentAudioTarget()
	if not (mapID and SpokenZones:HasAudio(mapID, key)) then
		mapID, key = FirstZoneWithAudio(), nil
	end
	if not mapID then
		SpokenZones:Print("|cffffcc00%s|r", SpokenZones:DescribeMissingAudio())
		return
	end
	SpokenZones:PlayLore(mapID, key)
end

-- `/spp lang` lists the languages that can be read; `/spp lang <code>` switches;
-- `/spp lang auto` goes back to following the client;
-- `/spp lang <code> force` and `/spp lang off` turn the preview override on and
-- off. The override exists so an unfinished translation can be looked at in the
-- game rather than only in the explorer, and it is deliberately not in Options:
-- a player who finds it by accident is a player reading half-English screens.
local function CmdLanguage(arg)
	local code, modifier = (arg or ""):match("^(%S*)%s*(%S*)$")

	if code == "off" then
		SpokenZones:SetLanguagePreview(false)
		SpokenZones:Print("language preview off -- /reload to go back to a finished language")
		return
	end

	if code == "auto" then
		SpokenZones:SetLanguage(nil)
		SpokenZones:Print("language set to auto (%s) -- |cffffcc00/reload to apply|r",
			SpokenZones:GetAutoLanguage())
		return
	end

	if code and code ~= "" then
		local locale = SpokenZones:GetLocaleInfo(code)
		-- Matched case-insensitively against the codes, since "dede" is the same
		-- request as "deDE" and nobody remembers Blizzard's capitalisation.
		if not locale then
			for i = 1, #SpokenZones.LOCALES do
				if SpokenZones.LOCALES[i].code:lower() == code:lower() then
					locale = SpokenZones.LOCALES[i]
				end
			end
		end

		if not locale then
			SpokenZones:Print('|cffffcc00"%s" is not a WoW language code|r -- /spp lang to list', code)
			return
		end

		-- Preview relaxes the readiness check inside SetLanguage, so it has to be
		-- on before the attempt -- but it must not survive a refusal, or the one
		-- remaining refusal (no fonts) leaves the override stuck on and every
		-- login printing the preview warning for a switch that never happened.
		local wasPreviewing = SpokenZones:IsPreviewingLanguage()
		if modifier == "force" then
			SpokenZones:SetLanguagePreview(true)
		end

		if not SpokenZones:SetLanguage(locale.code) then
			if modifier == "force" then
				SpokenZones:SetLanguagePreview(wasPreviewing)
			end
			if not SpokenZones:CanRenderLanguage(locale.code) then
				SpokenZones:Print(
					"|cffffcc00this client has no fonts for %s|r -- it would draw as boxes",
					locale.code
				)
			else
				SpokenZones:Print(
					"|cffffcc00%s is not finished yet|r -- /spp lang %s force to preview it anyway",
					SpokenZones:GetLanguageName(locale.code), locale.code
				)
			end
			return
		end

		SpokenZones:Print("language set to %s -- |cffffcc00/reload to apply|r", SpokenZones:GetLanguageName(locale.code))
		return
	end

	local selectable = SpokenZones:GetSelectableLanguages()
	SpokenZones:Print("languages:")
	for i = 1, #selectable do
		local locale = selectable[i]
		SpokenZones:Print(
			"  %s %s -- %s",
			locale.code == SpokenZones:GetLanguage() and "|cff66bbff*|r" or " ",
			locale.code, SpokenZones:GetLanguageName(locale.code)
		)
	end
	if SpokenZones:GetLanguagePreference() == nil then
		SpokenZones:Print("  auto (%s) -- follows the client", SpokenZones:GetAutoLanguage())
	end
	if #selectable > 1 then
		SpokenZones:Print("  /spp lang <code> to switch, /spp lang auto to follow the client")
	end
end

local function CmdHelp()
	local L = SpokenZones.L
	SpokenZones:Print(L.CMD_HEADING)
	-- A player's commands. discover, found, debug, verify and dump are a developer's, and still
	-- answer.
	for _, key in ipairs({
		"CMD_STATUS", "CMD_DIAGNOSTICS", "CMD_OPTIONS", "CMD_WINDOW", "CMD_PANEL",
		"CMD_PLAY", "CMD_STOP", "CMD_VOICE", "CMD_AUTOPLAY", "CMD_AUDIO",
		"CMD_LANG", "CMD_FORGET",
	}) do
		SpokenZones:Print(L[key])
	end
end

-- /spokenplaces and /spp, matching /spoken and /sp on the player and /spokenquests and
-- /spq on Spoken Quests. The pre-rename /zonelore and /zl are not registered: the addon
-- answers to one name, and a command that still worked would keep the retired one alive
-- in macros and in what players tell each other. /spokenzones and /spz still work, for the macros
-- written since.
_G.SLASH_SPOKENZONES1 = "/spokenplaces"
_G.SLASH_SPOKENZONES2 = "/spp"
_G.SLASH_SPOKENZONES3 = "/spokenzones"
_G.SLASH_SPOKENZONES4 = "/spz"
SlashCmdList["SPOKENZONES"] = function(msg)
	local cmd = (msg or ""):lower():match("^%s*(%S*)")
	if cmd == "dump" then
		CmdDump()
	elseif cmd == "verify" then
		CmdVerify()
	elseif cmd == "panel" then
		local enabled = not SpokenZones:Get("showMapPanel")
		SpokenZones:SetMapPanelShown(enabled)
		SpokenZones:Print(enabled and SpokenZones.L.PANEL_SHOWN or SpokenZones.L.PANEL_HIDDEN)
		Dispatch(SpokenZones.mapChangedCallbacks, SpokenZones:GetDisplayedMapID())
	elseif cmd == "settings" or cmd == "options" or cmd == "config" or cmd == "opt" then
		if SpokenZones.OpenOptions then
			SpokenZones:OpenOptions()
		end
	elseif cmd == "window" or cmd == "w" or cmd == "compendium" then
		if SpokenZones.ToggleLoreWindow then
			SpokenZones:ToggleLoreWindow()
		end
	elseif cmd == "play" then
		CmdPlay()
	elseif cmd == "stop" then
		SpokenZones:StopLore()
		SpokenZones:Print("narration stopped")
	elseif cmd == "voice" then
		local enabled = not SpokenZones:Get("voiceEnabled")
		SpokenZones:Set("voiceEnabled", enabled)
		if not enabled then
			SpokenZones:StopLore()
		end
		SpokenZones:NotifyAudioChanged()
		SpokenZones:Print("narration %s", enabled and "enabled" or "disabled")
	elseif cmd == "audio" then
		CmdAudioPack((msg or ""):match("^%s*%S+%s+(.-)%s*$"))
	elseif cmd == "lang" or cmd == "language" then
		CmdLanguage((msg or ""):match("^%s*%S+%s+(.-)%s*$"))
	elseif cmd == "autoplay" then
		local enabled = not SpokenZones:Get("autoplay")
		SpokenZones:Set("autoplay", enabled)
		if not enabled then
			SpokenZones:StopLore()
		end
		SpokenZones:Print("autoplay %s", enabled and "enabled" or "disabled")
	elseif cmd == "forget" then
		if SpokenZones.ForgetAutoplayHistory then
			SpokenZones:ForgetAutoplayHistory()
			SpokenZones:Print(SpokenZones.L.OPT_FORGET_PLACES_DONE)
		end
	elseif cmd == "diagnostics" then
		SpokenZones:ShowDiagnostics()
	elseif cmd == "discover" then
		-- Simulates a discovery, because the real one happens once per character
		-- ever and is otherwise untestable without rolling a fresh alt.
		local areaName = (msg or ""):match("^%s*%S+%s+(.-)%s*$")
		if not areaName or areaName == "" then
			areaName = NotSecret(GetSubZoneText())
			if not areaName or areaName == "" then
				areaName = NotSecret(GetZoneText())
			end
		end
		SpokenZones:Print('simulating discovery of "%s"', tostring(areaName))
		SpokenZones:OnAreaDiscovered(areaName)
	elseif cmd == "found" then
		-- What Azeroth's Compendium counts as found for this character, and why: for finding a place
		-- counted found that should not be.
		if SpokenZones.PrintFound then SpokenZones:PrintFound() end
	elseif cmd == "debug" then
		local enabled = not SpokenZones:Get("debug")
		SpokenZones:Set("debug", enabled)
		SpokenZones:Print("debug mode %s", enabled and "on -- click the map to see area names" or "off")
	elseif cmd == "help" then
		CmdHelp()
	else
		CmdStatus()
	end
end

-- SpokenZones -- Core: namespace, saved variables, events, zone resolution.
-- Client targets: WoW Classic Era 1.15.9 (11509) and Anniversary 2.5.6 (20506).
-- The two share a uiMapID space, so nothing here branches on the client.

local ADDON_NAME, SpokenZones = ...

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
	panelSide = "RIGHT",
	panelWidth = 300,
	fontSize = 12,
	showHoverPreview = true,
	showMinimapButton = true,
	voiceEnabled = true,
	-- Dialog so narration rides the player's dialog volume slider rather than
	-- competing with it. See Audio.lua for the channels PlaySoundFile accepts.
	autoplay = true,
	autoplaySubzones = true,
	-- Off, because it replaces the client's own record of what a character has
	-- discovered with one SpokenZones keeps itself. Only a character who explored
	-- before installing the addon needs that; see Autoplay.lua.
	autoplayExplored = false,
	-- Off, so Read means "read along". Stopping discards the queue as well, which
	-- is not something to do to a player who only wanted to see the words.
	-- Off, so a player cannot end up reading an unfinished translation without
	-- having asked for one. See Language.lua.
	languagePreview = false,
	-- `audioPack` likewise: nil means "the best pack installed", which is a rule
	-- rather than a folder name, and naming a default here would pin the player to
	-- a pack they may never install. See Audio.lua.
	-- `language` likewise: nil means "follow the client locale", which is not the
	-- same answer as "enUS" -- a player who never chose should start reading their
	-- own language the day it ships, and one who picked English should not.
	debug = false,
	-- `hide` and `minimapPos` are intentionally absent: LibDBIcon owns those keys
	-- inside SpokenZonesDB and writes them itself. See UI/MinimapButton.lua.
}

--------------------------------------------------------------------------------
-- Output
--------------------------------------------------------------------------------

local PREFIX = "|cff66bbffSpoken Zones|r: "

function SpokenZones:Print(fmt, ...)
	local msg = select("#", ...) > 0 and fmt:format(...) or fmt
	DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. msg)
end

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

-- Merge defaults into the saved table without clobbering stored values, so new
-- options added in later versions appear for existing users. Runtime reads and
-- writes go straight to SpokenZonesDB.
-- Whether the client handed back anything it saved. Read before the tables below are
-- created, because creating one is what makes the question unanswerable afterwards.
--
-- False means one of two things: a first run, or a client that does not restore saved
-- variables at all. The 1.60.1 beta is the second - it writes both files correctly every
-- logout and never reads either back, for any addon, which leaves every feature that
-- remembers something across a login repeating itself. Autoplay's login greeting is the
-- one a player hears; see SeedLoginArea.
local function InitConfig()
	SpokenZones.savedVariablesRestored =
		type(SpokenZonesDB) == "table" or type(SpokenZonesCharDB) == "table"

	if type(SpokenZonesDB) ~= "table" then
		SpokenZonesDB = {}
	end
	for key, value in pairs(defaults) do
		if SpokenZonesDB[key] == nil then
			SpokenZonesDB[key] = value
		end
	end

	-- `audioPack` was a folder name back when there was only one language to
	-- choose a pack for; it is now one folder name per content language. The type
	-- check makes this idempotent, which is why no stored schema version is needed.
	-- The old value was necessarily an English pack, so that is where it lands.
	if type(SpokenZonesDB.audioPack) == "string" then
		SpokenZonesDB.audioPack = { enUS = SpokenZonesDB.audioPack }
	end

	SpokenZones.db = SpokenZonesDB
end

-- Safe before ADDON_LOADED has run.
function SpokenZones:Get(key)
	if SpokenZonesDB == nil then
		return defaults[key]
	end
	local value = SpokenZonesDB[key]
	if value == nil then
		return defaults[key]
	end
	return value
end

function SpokenZones:Set(key, value)
	SpokenZonesDB[key] = value
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
	return C_Map.GetBestMapForUnit("player")
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
-- is around one subzone in eight for German, and all of them for Italian.
function SpokenZones:ResolveAreaKey(name)
	if type(name) ~= "string" then
		return nil
	end
	local aliases = self.Aliases[self.clientLocale]
	local aliased = aliases and aliases[name]
	if aliased then
		return aliased
	end
	return self:NormaliseAreaKey(name)
end

--------------------------------------------------------------------------------
-- Report links
--
-- The game cannot open a URL or send anything anywhere, so the only way a player
-- can report a bad line is to copy an address and open it themselves. The site
-- resolves /{lang}/r/{mapID}/{slug} back to a line by matching that path against
-- the audio file paths it already assigns, which is why the slug is built the
-- same way here as slugFor does in tools/voice/naming.mjs -- and why "zone", the
-- file name a zone's own line gets, doubles as the slug for it.
--
-- The language in the address is the one being READ, not the client's locale: a
-- report is about the text and narration on screen, and the site files it under
-- that language so the people who can act on it see it beside the line it is
-- about. Builds up to 0.3.1 sent /r/... with no language; the site still takes that
-- and treats it as English, which is what it meant when it was written.
--
-- tools/validate.mjs fails the build if these two ever drift, or if two subzones
-- in one zone come to share a slug: the JS side has a hash fallback for that
-- collision, and nothing here can reproduce it.
--------------------------------------------------------------------------------

SpokenZones.SITE_URL = "https://lore.rusty.one"

-- `language` names the narration being reported, for a report made from the player about a
-- clip; the lore window's report is about the text on screen and passes none.
function SpokenZones:ReportURL(mapID, areaKey, language)
	if not mapID then
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
	return ("%s/%s/r/%d/%s"):format(self.SITE_URL, language or self:GetLanguage(), mapID, slug)
end

-- Returns the lore entry and the key that was looked up. The key is returned
-- even on a miss so /spz debug can report what failed to match.
function SpokenZones:GetSubzoneLore(parentMapID, areaName)
	local key = self:ResolveAreaKey(areaName)
	if not key then
		return nil, nil
	end

	local zoneTable = self.Subzones[parentMapID]
	if not zoneTable then
		return nil, key
	end
	return zoneTable[key], key
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

-- What the cursor is over, at a normalised canvas position on the map `mapID`.
-- Shared by the click handler and the hover preview so both agree.
--
-- Returns kind ("zone"|"subzone"), display name, lore entry, and the resolved
-- uiMapID for the "zone" case. Returns nil when nothing is resolvable.
function SpokenZones:ResolveAt(mapID, x, y)
	if not mapID or not x or not y then
		return nil
	end

	-- A child *map* under the cursor: a zone on a continent map, or a dungeon
	-- entrance on a zone map. Prefer this when we actually have lore for it.
	local childInfo = C_Map.GetMapInfoAtPosition(mapID, x, y)
	if childInfo and childInfo.mapID and childInfo.mapID ~= mapID then
		local entry = self:GetLore(childInfo.mapID)
		if entry then
			return "zone", childInfo.name or entry.name, entry, childInfo.mapID
		end
	end

	-- Otherwise fall back to the area (subzone) name, which has no uiMapID.
	local areaName = self:GetAreaNameAt(mapID, x, y)
	if areaName then
		local entry = self:GetSubzoneLore(mapID, areaName)
		if entry then
			return "subzone", areaName, entry, nil
		end
		-- Name but no lore: still useful to the caller for debug reporting.
		return "subzone", areaName, nil, nil
	end

	return nil
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

	if SpokenZones.SetupMapPanel then
		SpokenZones:SetupMapPanel()
	end
	if SpokenZones.SetupSubzoneClicks then
		SpokenZones:SetupSubzoneClicks()
	end
	if SpokenZones.SetupHoverPreview then
		SpokenZones:SetupHoverPreview()
	end
	if SpokenZones.SetupLoreWindow then
		SpokenZones:SetupLoreWindow()
	end
	if SpokenZones.SetupMinimapButton then
		SpokenZones:SetupMinimapButton()
	end
	-- Before autoplay: it registers its combat hold on the source this creates.
	if SpokenZones.SetupAudio then
		SpokenZones:SetupAudio()
	end
	if SpokenZones.SetupAutoplay then
		SpokenZones:SetupAutoplay()
	end
	if SpokenZones.SetupOptions then
		SpokenZones:SetupOptions()
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
			-- The old folder may hold the real old addon, which must not narrate over this
			-- one. Its variables were copied at load, so disabling it is safe now.
			local disable = (C_AddOns and C_AddOns.DisableAddOn) or DisableAddOn
			local info = (C_AddOns and C_AddOns.GetAddOnInfo) or GetAddOnInfo
			local meta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
			-- The literal folder name, not this addon's own: what may still be installed
			-- under it is the addon this one was renamed from. Writing the namespace here
			-- instead would have the addon disable itself on first login.
			--
			-- DoesAddOnExist, not the truthiness of GetAddOnInfo: Camelot answers for a
			-- folder that is not installed by handing the name straight back, so the old
			-- test disabled ZoneLore on every login of a client that has never had it -
			-- visible as `ZoneLore: disabled` in a fresh AddOns.txt. SpokenQuests met the
			-- same trap on the same client, and asks AceAddon which players registered
			-- instead; this addon is not an Ace addon and has no such register to ask.
			local exists = C_AddOns and C_AddOns.DoesAddOnExist
			local installed = exists and exists("ZoneLore") or (not exists and info and info("ZoneLore"))
			-- The tombstone this release ships under the old name is not the old addon: one
			-- .toc, no code, there only to keep ZoneLoreDB loading for Migration.lua. Current
			-- clients reserve enabling and disabling an addon for their own UI and answer with
			-- their own "blocked from an action only available to the Blizzard UI" dialog, so
			-- disabling a folder that cannot narrate spends that dialog for nothing - and on a
			-- fresh install the folder came out of this addon's own zip. X-Spoken-Tombstone is
			-- a field this project invented, so only a .toc it wrote can be carrying it.
			local tombstone = meta and meta("ZoneLore", "X-Spoken-Tombstone") == "1"
			if disable and installed and not tombstone then
				pcall(disable, "ZoneLore")
			end
			self:UnregisterEvent("ADDON_LOADED")
		end
	elseif event == "PLAYER_ENTERING_WORLD" then
		SetupHooks()
		-- Once the world is up, so every addon waiting on the player has registered.
		if SpokenZones.PromptForPlayer then
			SpokenZones:PromptForPlayer()
		end
		-- Said every login, not once: an override you have forgotten you enabled
		-- turns every gap in an unfinished translation into a bug report nobody
		-- can reproduce.
		if SpokenZones:IsPreviewingLanguage() then
			SpokenZones:Print(
				"|cffffcc00previewing unfinished languages|r -- reading %s. /spz lang off to stop",
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
-- SpokenZonesDB.dump, which is only written to disk on logout or /reload.
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
	SpokenZonesDB.dump = out
	SpokenZones:Print("dumped %d maps to SpokenZonesDB.dump. Run /reload, then:", #out)
	SpokenZones:Print("  node tools/seed-from-dump.mjs")
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
	local subZone = GetSubZoneText()
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
		SpokenZones:Print("sound pack: %s -- %s", pack.addon, SpokenZones:GetAudioPackLabel(pack))
	else
		SpokenZones:Print("|cffffcc00no sound pack installed|r -- install Spoken Zones Audio to hear the lore")
	end

	if SpokenZones:Get("debug") then
		SpokenZones:Print("|cff66bbffdebug mode is on|r")
	end
end

-- What /spz play narrates: the subzone the player is standing in if it has lore,
-- otherwise the zone. The same "more specific answer wins" preference the lore
-- window applies when it opens.
local function CurrentAudioTarget()
	local _, resolved = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	if not resolved then
		return nil, nil
	end

	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" then
		local entry, key = SpokenZones:GetSubzoneLore(resolved, subZone)
		if entry then
			return resolved, key
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
		SpokenZones:Print("|cffffcc00narration is turned off|r -- /spz voice to turn it on")
		return
	end

	if not SpokenZones:PlayLore(mapID, key) then
		return
	end

	-- Nothing to report when PlayLore returned false above: it has already said why.
	local what = key or SpokenZones:GetMapName(mapID) or tostring(mapID)
	SpokenZones:Print("playing lore for %s", what)
end

-- `/spz audio` lists installed sound packs; `/spz audio <folder>` switches to one.
-- Worth a command of its own because having two tiers installed at once is the
-- case where the addon's behaviour is otherwise invisible: both play, and only
-- the disk footprint differs.
local function CmdAudioPack(arg)
	local packs = SpokenZones:GetAudioPacks()
	if #packs == 0 then
		-- Any pack would do -- packs are interchangeable across languages -- so an
		-- empty list really does mean nothing is installed.
		SpokenZones:Print("|cffffcc00no sound pack installed|r")
		-- Named by CurseForge project, not by folder: a player with the pre-rename pack has a
		-- ZoneLoreAudio folder, and saying that name sends them looking for a project that no
		-- longer exists.
		SpokenZones:Print("  install Spoken Zones Audio alongside Spoken Zones")
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
		SpokenZones:Print('|cffffcc00"%s" is not an installed sound pack|r', arg)
		return
	end

	local active = SpokenZones:GetActiveAudioPack()
	SpokenZones:Print("sound packs:")
	for i = 1, #packs do
		local pack = packs[i]
		SpokenZones:Print(
			"  %s %s -- %s, v%s",
			pack == active and "|cff66bbff*|r" or " ",
			pack.addon, SpokenZones:GetAudioPackLabel(pack), tostring(pack.packVersion)
		)
	end
	if #packs > 1 then
		SpokenZones:Print("  /spz audio <name> to switch")
	end
end

-- `/spz lang` lists the languages that can be read; `/spz lang <code>` switches;
-- `/spz lang auto` goes back to following the client;
-- `/spz lang <code> force` and `/spz lang off` turn the preview override on and
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
			SpokenZones:Print('|cffffcc00"%s" is not a WoW language code|r -- /spz lang to list', code)
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
					"|cffffcc00%s is not finished yet|r -- /spz lang %s force to preview it anyway",
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
		SpokenZones:Print("  /spz lang <code> to switch, /spz lang auto to follow the client")
	end
end

local function CmdHelp()
	local L = SpokenZones.L
	SpokenZones:Print(L.CMD_HEADING)
	for _, key in ipairs({
		"CMD_STATUS", "CMD_OPTIONS", "CMD_WINDOW", "CMD_PANEL", "CMD_HOVER",
		"CMD_PLAY", "CMD_STOP", "CMD_VOICE", "CMD_AUTOPLAY", "CMD_AUDIO",
		"CMD_LANG", "CMD_DISCOVER", "CMD_FORGET", "CMD_BAR", "CMD_MINIMAP",
		"CMD_DEBUG", "CMD_VERIFY", "CMD_DUMP",
	}) do
		SpokenZones:Print(L[key])
	end
end

-- /spokenzones and /spz, matching /spoken and /sp on the player and /spokenquests and
-- /spq on Spoken Quests. The pre-rename /zonelore and /zl are not registered: the addon
-- answers to one name, and a command that still worked would keep the retired one alive
-- in macros and in what players tell each other.
_G.SLASH_SPOKENZONES1 = "/spokenzones"
_G.SLASH_SPOKENZONES2 = "/spz"
SlashCmdList["SPOKENZONES"] = function(msg)
	local cmd = (msg or ""):lower():match("^%s*(%S*)")
	if cmd == "dump" then
		CmdDump()
	elseif cmd == "verify" then
		CmdVerify()
	elseif cmd == "panel" then
		local enabled = not SpokenZones:Get("showMapPanel")
		SpokenZones:Set("showMapPanel", enabled)
		SpokenZones:Print("world map panel %s", enabled and "enabled" or "disabled")
		Dispatch(SpokenZones.mapChangedCallbacks, SpokenZones:GetDisplayedMapID())
	elseif cmd == "options" or cmd == "config" or cmd == "opt" then
		if SpokenZones.OpenOptions then
			SpokenZones:OpenOptions()
		end
	elseif cmd == "window" or cmd == "w" then
		if SpokenZones.ToggleLoreWindow then
			SpokenZones:ToggleLoreWindow()
		end
	elseif cmd == "minimap" then
		if SpokenZones.ToggleMinimapButton then
			local enabled = SpokenZones:ToggleMinimapButton()
			SpokenZones:Print("minimap button %s", enabled and "shown" or "hidden")
		end
	elseif cmd == "hover" then
		local enabled = not SpokenZones:Get("showHoverPreview")
		SpokenZones:Set("showHoverPreview", enabled)
		if not enabled and SpokenZones.HideHoverPreview then
			SpokenZones.HideHoverPreview()
		end
		SpokenZones:Print("hover preview %s", enabled and "enabled" or "disabled")
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
			SpokenZones:Print("this character's narration history is cleared -- the "
				.. "greeting returns on next login, and every area counts as unheard again")
		end
	elseif cmd == "discover" then
		-- Simulates a discovery, because the real one happens once per character
		-- ever and is otherwise untestable without rolling a fresh alt.
		local areaName = (msg or ""):match("^%s*%S+%s+(.-)%s*$")
		if not areaName or areaName == "" then
			areaName = GetSubZoneText()
			if not areaName or areaName == "" then
				areaName = GetZoneText()
			end
		end
		SpokenZones:Print('simulating discovery of "%s"', tostring(areaName))
		SpokenZones:OnAreaDiscovered(areaName)
	elseif cmd == "bar" then
		if SpokenZones.ResetPlayerPosition then
			SpokenZones:ResetPlayerPosition()
			SpokenZones:Print("player moved back to the middle of the screen")
		end
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

-- SpokenNPCs -- the bosses in Azeroth's Compendium (Spoken's UI/Compendium.lua): every boss of every
-- dungeon and raid, with the instance it is in and its story.
--
-- The list is laid out as the places' (Spoken Places' tab): a banner for each continent, a line for
-- each of its dungeons or raids, and in an opened dungeon its bosses. World bosses have no line of
-- their own and are listed straight under their continent. After the continents, Other Lands' banner
-- lists the dungeons on none. Which bosses a dungeon has comes from Data/Bosses.lua, and their
-- stories from Data/Stories.lua, where there is one. A boss not met yet is listed greyed, with a
-- padlock, and its page says so, until Unlock Unfound Bosses (Spoken's page) is on; Found Only
-- leaves out what holds none met. A search lists the bosses and dungeons whose name has the words,
-- each opened.

local _, NPCs = ...

local L = NPCs.L

local C = SpokenCompendium
local VERSION = SpokenEnv and SpokenEnv.Version
local CONTINENTS, CITY_IN = C.CONTINENTS, C.CITY_IN
local MapName, ContinentOf = C.MapName, C.ContinentOf
local Dungeon, DungeonName = C.Dungeon, C.DungeonName

local list, page
local selection          -- { boss = true, map = map, key = key } | { mapID = zone, dungeon = map }
                         -- | { mapID = zone or continent } | { lands = true } | nil
local landed             -- the selection made for the player, where they stood; any other they chose
local dungeonOpen = {}   -- ["zone:map"] = true: a dungeon's line, opened
local continentOpen = { [1414] = true, [1415] = true }
local bannerOpen = {}    -- .lands = true: Other Lands' banner, opened
local filter = ""

--------------------------------------------------------------------------------
-- What there is
--------------------------------------------------------------------------------

-- A boss's or a dungeon's name in the client's language, else English.
local function Name(entry)
	return entry[GetLocale and GetLocale() or "enUS"] or entry[1]
end

local index
-- zones[zone][map] = the bosses of the dungeon `map` whose entrance is in `zone`, a city's
-- dungeons filed under the zone around it; zoneOf[map] = zone; world[map] = true for the map of
-- a world boss, which has no line of its own; all[map] = every boss of the map, whatever zone it stands in
-- (the map of world bosses in different zones lists each under its own, `bossZone["map:key"]`);
-- byKey["map:key"] = the boss; count = every boss listed. on[continent or "lands"], the sorted
-- zones, are kept once worked out.
local function Index()
	if index then return index end
	index = { zones = {}, zoneOf = {}, world = {}, all = {}, bossZone = {}, byKey = {}, on = {}, count = 0 }
	local maps = _G.SpokenBosses and SpokenBosses.maps or {}
	local worlds = _G.SpokenDungeons and SpokenDungeons.worldBosses or {}
	for map, bosses in pairs(maps) do
		local dungeon = Dungeon(map)
		local world = worlds[map]
		local home = (dungeon or world) and (dungeon or world).zone
		if home and #bosses > 0 then
			local zone = CITY_IN[home] or home
			if world and dungeon == nil and world.bossZones then
				for _, boss in ipairs(bosses) do
					local at = world.bossZones[boss.key] or home
					at = CITY_IN[at] or at
					index.zones[at] = index.zones[at] or {}
					index.zones[at][map] = index.zones[at][map] or {}
					table.insert(index.zones[at][map], boss)
					index.bossZone[map .. ":" .. boss.key] = at
				end
			else
				index.zones[zone] = index.zones[zone] or {}
				index.zones[zone][map] = bosses
			end
			index.all[map] = bosses
			for _, boss in ipairs(bosses) do index.byKey[map .. ":" .. boss.key] = boss end
			index.zoneOf[map] = zone
			index.world[map] = world ~= nil and dungeon == nil or nil
			index.count = index.count + #bosses
		end
	end
	return index
end

local function Found(map, key)
	return NPCs:IsBossFound(map, key)
end

local function Unlocked()
	return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.unlockUnfound == true
end

local function AbilitiesShown()
	return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.showAbilities == true
end

local function OnlyFound()
	return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.compendiumFoundOnly == true
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

local function ByName(a, b)
	local na, nb = MapName(a), MapName(b)
	if na == nb then return a < b end
	return na < nb
end

-- Dungeons by name, then the world bosses by their boss's.
local function ByDungeonName(a, b)
	local wa, wb = Index().world[a] == true, Index().world[b] == true
	if wa ~= wb then return wb end
	local na = wa and Index().all[a][1][1] or DungeonName(a)
	local nb = wb and Index().all[b][1][1] or DungeonName(b)
	if na == nb then return a < b end
	return na < nb
end

-- The zones that have a dungeon or a raid on `continent`; nil for the zones on none, which the
-- game has a map for: a line for a map this client has never heard of would lead nowhere.
local function ZonesOn(continent)
	local memo = continent or "lands"
	if Index().on[memo] then return Index().on[memo] end
	local out = {}
	for zone in pairs(Index().zones) do
		if continent then
			if ContinentOf(zone) == continent then table.insert(out, zone) end
		elseif not ContinentOf(zone) and not (C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(zone) == nil) then
			table.insert(out, zone)
		end
	end
	table.sort(out, ByName)
	Index().on[memo] = out
	return out
end

-- Bosses met of one dungeon's, or, given `zone`, of those of its map that stand in that zone.
local function TallyOf(map, zone)
	zone = zone or Index().zoneOf[map]
	local found, total = 0, 0
	for _, boss in ipairs(zone and Index().zones[zone][map] or {}) do
		total = total + 1
		if Found(map, boss.key) then found = found + 1 end
	end
	return found, total
end

-- Bosses met out of all the dungeons of `zones` hold.
local function Tally(zones)
	local found, total = 0, 0
	for _, zone in ipairs(zones) do
		for map in pairs(Index().zones[zone] or {}) do
			local f, t = TallyOf(map, zone)
			found, total = found + f, total + t
		end
	end
	return found, total
end

-- A boss's story (key = its key): a string, or the client's language beside the English that is
-- its first.
local function Story(map, key)
	local stories = _G.SpokenBossStories
	local text = stories and stories[map] and stories[map][key]
	if type(text) == "table" then text = Name(text) end
	return type(text) == "string" and text ~= "" and text or nil
end

-- What Data/Creatures.lua knows of a boss (its creature, appearance and spells), or nil.
local function Creature(map, key)
	local known = _G.SpokenBossCreatures
	return known and known[map] and known[map][key]
end

-- Whether a boss has a story and a known appearance.
local function Complete(map, key)
	local entry = Creature(map, key)
	return Story(map, key) ~= nil and entry ~= nil and entry.display ~= nil
end

-- Every zone that has a dungeon or a raid.
local function AllZones()
	local out = {}
	for zone in pairs(Index().zones) do table.insert(out, zone) end
	return out
end

--------------------------------------------------------------------------------
-- The rows
--------------------------------------------------------------------------------

-- A dungeon's line, with the bosses met out of those it holds.
local function Group(item, found, total)
	item.style = "group"
	item.count, item.total = found, total
	item.tick = total > 0 and found == total
	item.none = found == 0
	return item
end

-- `item`, then `inside` while it is shown.
local function Holding(item, inside, shown)
	local rows = { item }
	if shown then
		for _, row in ipairs(inside) do table.insert(rows, row) end
	end
	return rows
end

-- A dungeon's or a raid's line and, opened (or a search finds a boss in it), its bosses. `whole`:
-- what holds it was named by the search, so every boss is listed.
local function DungeonRows(zone, map, nest, whole)
	local world = Index().world[map] == true
	local name = world and "" or DungeonName(map)
	whole = whole or (filter ~= "" and not world and Matches(name))
	local found, total = TallyOf(map, zone)
	if OnlyFound() and found == 0 then return {} end
	local open = world or dungeonOpen[zone .. ":" .. map] == true or filter ~= ""
	local inside = {}
	local at = world and nest or nest + 1
	for _, boss in ipairs(open and Index().zones[zone][map] or {}) do
		local met = Found(map, boss.key)
		if (met or not OnlyFound()) and (whole or Matches(Name(boss))) then
			table.insert(inside, { kind = "boss", leaf = true, map = map, key = boss.key, label = Name(boss), nest = at,
				locked = not met and not Unlocked(), done = met,
				missing = (met or Unlocked()) and not Complete(map, boss.key) })
		end
	end
	-- A world boss has no line of its own: its lines stand directly under the continent.
	if world then return inside end
	if filter ~= "" and #inside == 0 then return {} end
	return Holding(Group({ kind = "dungeon", mapID = zone, dungeon = map, label = name, nest = nest, open = open },
		found, total), inside, open)
end

-- The dungeon maps whose entrance is filed under a continent, by dungeon name. World bosses are
-- omitted here because one map can have bosses filed under several zones.
local function DungeonsOn(continent)
	local out = {}
	for map, zone in pairs(Index().zoneOf) do
		if not Index().world[map] and ((continent and ContinentOf(zone) == continent)
			or (not continent and not ContinentOf(zone))) then
			table.insert(out, { map = map, zone = zone })
		end
	end
	table.sort(out, function(a, b) return ByDungeonName(a.map, b.map) end)
	return out
end

-- The rows directly under a continent: dungeon/raid lines followed by world-boss lines. A world
-- boss is emitted once for each zone in which it stands, so multi-zone world-boss maps retain their
-- existing zone-specific boss lists without putting those zones in the panel.
local function RowsOn(continent, nest, whole)
	local rows = {}
	for _, entry in ipairs(DungeonsOn(continent)) do
		for _, row in ipairs(DungeonRows(entry.zone, entry.map, nest, whole)) do table.insert(rows, row) end
	end
	local worlds = {}
	for _, zone in ipairs(ZonesOn(continent)) do
		for map in pairs(Index().zones[zone] or {}) do
			if Index().world[map] then table.insert(worlds, { map = map, zone = zone }) end
		end
	end
	table.sort(worlds, function(a, b)
		if ByDungeonName(a.map, b.map) then return true end
		if ByDungeonName(b.map, a.map) then return false end
		return a.zone < b.zone
	end)
	for _, entry in ipairs(worlds) do
		for _, row in ipairs(DungeonRows(entry.zone, entry.map, nest, whole)) do table.insert(rows, row) end
	end
	return rows
end

-- A banner and, opened (or a search finds something under it), a line for each dungeon or raid.
local function Banner(item, continent, opened)
	local whole = filter ~= "" and Matches(item.label)
	local open = filter ~= "" or opened == true
	local rows = {}
	if open then
		rows = RowsOn(continent, 0, whole)
	end
	if filter ~= "" and #rows == 0 then return {} end
	local found, total = Tally(ZonesOn(continent))
	if OnlyFound() and found == 0 then return {} end
	Group(item, found, total).style = "banner"
	item.open = open and #rows > 0
	return Holding(item, rows, open)
end

local function BuildRows()
	local out = {}
	local continents = {}
	for _, continent in ipairs(CONTINENTS) do
		if #ZonesOn(continent) > 0 then
			table.insert(continents, { continent = continent, label = MapName(continent) })
		end
	end
	table.sort(continents, function(a, b) return a.label < b.label end)
	for _, entry in ipairs(continents) do
		for _, row in ipairs(Banner({ kind = "continent", mapID = entry.continent, label = entry.label },
			entry.continent, continentOpen[entry.continent])) do
			table.insert(out, row)
		end
	end
	local lands = ZonesOn(nil)
	if #lands > 0 then
		for _, row in ipairs(Banner({ kind = "lands", label = L.GROUP_LANDS }, nil, bannerOpen.lands)) do
			table.insert(out, row)
		end
	end
	return out
end

local function IsSelected(row)
	if not selection then return false end
	if row.kind == "boss" then return selection.boss == true and selection.map == row.map and selection.key == row.key end
	if row.kind == "lands" then return selection.lands == true end
	if row.kind == "dungeon" then return selection.dungeon == row.dungeon and selection.mapID == row.mapID end
	return selection.mapID == row.mapID and not selection.boss and not selection.dungeon
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

--- The boss named `name`, in the client's language or English, of the dungeon or raid the player
--- is in: { map, key }, or nil.
function NPCs:BossNamed(name)
	if type(name) ~= "string" then return nil end
	local map = NPCs:InstanceMap()
	for _, boss in ipairs(map and Index().all[map] or {}) do
		if Name(boss) == name or boss[1] == name then return { map = map, key = boss.key } end
	end
end

-- Nothing to play or to report yet: a boss's story is words alone until it is voiced.
local PLAY = { has = function() return false end, find = function() end, start = function() end, tip = "" }
local REPORT = { has = function() return false end, open = function() end, title = "", tip = "" }

local function Boss(map, key)
	return Index().byKey[map .. ":" .. key]
end

-- The zone a boss is filed under: its own where the map's bosses stand in several, else the map's.
local function BossZone(map, key)
	return Index().bossZone[map .. ":" .. key] or Index().zoneOf[map]
end

-- How fast a story is read, in words a second, and the least time one stays in the narrator.
local READING_SPEED, LEAST_SECONDS = 2.5, 6

local SKULL = [[Interface\TargetingFrame\UI-RaidTargetingIcon_8]]

--- The story of the boss `key` of `map` as a line for Spoken's narrator, words with no voice; nil
--- where it has none.
function NPCs:StoryClip(map, key)
	local story = Story(map, key)
	if not story then return nil end
	local boss = Boss(map, key)
	if not boss then return nil end
	local _, words = story:gsub("%S+", "")
	local entry = Creature(map, key)
	return {
		key = "boss:" .. map .. ":" .. key,
		length = math.max(LEAST_SECONDS, words / READING_SPEED),
		present = {
			header = Index().world[map] and MapName(BossZone(map, key)) or DungeonName(map),
			label = Name(boss),
			transcript = story,
			bullet = "boss",
			portrait = entry and entry.display and { kind = "model", creatureID = entry.creature, displayID = entry.display }
				or { kind = "texture", texture = SKULL },
		},
	}
end

local function Count(found, total)
	return L.BOSSES_FOUND_FMT:format(found, total)
end

local function CountLine(where, found, total)
	return L.BOSS_IN_FMT:format(where) .. " · " .. Count(found, total)
end

-- A boss's portrait, at the left of its name, and what the database says it casts, under its story
-- in two columns: a card for each spell (Data/Creatures.lua), named and drawn by the client.
local CARD_HEIGHT, PLATE_HEIGHT, PLATE_DROP, UNKNOWN_ICON = 64, 54, 5, 134400
-- A spell as the spellbook lays it out (numbers read from its own frames): a 40 square holding the
-- icon (36, rounded by the book's mask) with the ornate frame round it, and beside it the name and,
-- under it, what the client says of the spell. Under all of it, the book's plate, faint and brighter
-- under the pointer.
local PLATE, ICON_MASK = "spellbook-item-backplate", "spellbook-item-spellicon-mask"
local FRAME, FRAME_HOVER = "spellbook-item-iconframe", "spellbook-item-iconframe-hover"
local MASK = [[Interface\CharacterFrame\TempPortraitAlphaMask]]
local PLATE_REST, PLATE_HOVER, HOVER_ALPHA = 0.3, 0.7, 0.35
local BUTTON, ICON, EDGE, GAP = 40, 36, 14, 12
local NAME_SIZE, SUB_SIZE, LINE_GAP = 16, 12, 2
local cards

-- The skull in the ring's small socket, where a quest's portrait has its badge.
if Spoken and Spoken.RegisterBullet then Spoken:RegisterBullet("boss", SKULL, 16) end

local function SpellLook(id)
	if C_Spell and C_Spell.GetSpellInfo then
		local info = C_Spell.GetSpellInfo(id)
		if info then return info.name, info.iconID end
	elseif GetSpellInfo then
		local name, _, icon = GetSpellInfo(id)
		return name, icon
	end
end

local function Card(position)
	cards = cards or {}
	if cards[position] then return cards[position] end
	if not page then return nil end
	local card = CreateFrame("Frame", nil, page.body.child)
	card:SetHeight(CARD_HEIGHT)
	local plate = card:CreateTexture(nil, "BACKGROUND")
	plate:SetPoint("LEFT", card, "LEFT", 0, -PLATE_DROP)
	plate:SetPoint("RIGHT", card, "RIGHT", 0, -PLATE_DROP)
	plate:SetHeight(PLATE_HEIGHT)
	if not C.Atlas(plate, PLATE) then plate:SetColorTexture(1, 1, 1, 0.1) end
	plate:SetAlpha(PLATE_REST)
	-- The 40 square the icon, frame and highlight are measured from.
	local button = CreateFrame("Frame", nil, card)
	button:SetSize(BUTTON, BUTTON)
	button:SetPoint("LEFT", card, "LEFT", EDGE, 0)
	-- Only the icon answers the pointer, as in the spellbook.
	button:EnableMouse(true)
	local icon = card:CreateTexture(nil, "ARTWORK")
	icon:SetSize(ICON, ICON)
	icon:SetPoint("CENTER", button, "CENTER")
	local mask = card.CreateMaskTexture and card:CreateMaskTexture()
	if type(mask) == "table" and icon.AddMaskTexture then
		if not C.Atlas(mask, ICON_MASK) then mask:SetTexture(MASK, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE") end
		-- Leave a small margin so the mask trims any square pixels at the icon's corners.
		mask:SetSize(ICON - 4, ICON - 4)
		mask:SetPoint("CENTER", icon, "CENTER")
		icon:AddMaskTexture(mask)
	end
	-- Era has no extra border; Forever keeps the spellbook's own frame.
	local era = VERSION and VERSION.IsRetailVanilla and not VERSION.IsCamelot
	if not era then
		local frame = card:CreateTexture(nil, "OVERLAY", nil, 1)
		if C.Atlas(frame, FRAME) then
			frame:SetPoint("TOPLEFT", button, "TOPLEFT", -11, 1)
			frame:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", 1, -7)
		end
	end
	local glow = card:CreateTexture(nil, "OVERLAY", nil, 2)
	if C.Atlas(glow, FRAME_HOVER) then glow:SetAllPoints(button) end
	glow:SetAlpha(HOVER_ALPHA)
	glow:Hide()
	-- The spellbook's own lines: the name over what the client says of the spell, in its dark brown,
	-- cut short with an ellipsis where the card is narrow.
	local text = CreateFrame("Frame", nil, card)
	text:SetPoint("LEFT", button, "RIGHT", GAP, 0)
	text:SetPoint("RIGHT", card, "RIGHT", -6, 0)
	text:SetHeight(NAME_SIZE + LINE_GAP + SUB_SIZE)
	local function Line(size)
		local line = text:CreateFontString(nil, "ARTWORK", "GameFontNormal")
		local file = _G.GameFontNormal and _G.GameFontNormal.GetFont and _G.GameFontNormal:GetFont()
		if file then line:SetFont(file, size, "") end
		line:SetTextColor(0.18, 0.11, 0.06, 1)
		line:SetShadowColor(0, 0, 0, 0)
		line:SetJustifyH("LEFT")
		if line.SetWordWrap then line:SetWordWrap(false) end
		if line.SetMaxLines then line:SetMaxLines(1) end
		return line
	end
	local name, sub = Line(NAME_SIZE), Line(SUB_SIZE)
	card.icon, card.name, card.sub, card.plate, card.glow = icon, name, sub, plate, glow
	function card:SetLines(title, subtitle)
		name:SetText(title)
		sub:SetText(subtitle or "")
		name:ClearAllPoints()
		sub:ClearAllPoints()
		if subtitle and subtitle ~= "" then
			name:SetPoint("TOPLEFT", text, "TOPLEFT")
			name:SetPoint("TOPRIGHT", text, "TOPRIGHT")
			sub:SetPoint("TOPLEFT", name, "BOTTOMLEFT", 0, -LINE_GAP)
			sub:SetPoint("TOPRIGHT", name, "BOTTOMRIGHT", 0, -LINE_GAP)
		else
			name:SetPoint("LEFT", text, "LEFT")
			name:SetPoint("RIGHT", text, "RIGHT")
		end
	end
	button:SetScript("OnEnter", function()
		local self = card
		self.plate:SetAlpha(PLATE_HOVER)
		self.glow:Show()
		if self.spell and GameTooltip and GameTooltip.SetSpellByID then
			GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
			GameTooltip:SetSpellByID(self.spell)
			GameTooltip:Show()
		end
	end)
	button:SetScript("OnLeave", function()
		local self = card
		self.plate:SetAlpha(PLATE_REST)
		self.glow:Hide()
		if GameTooltip then GameTooltip:Hide() end
	end)
	card:Hide()
	cards[position] = card
	return card
end

-- One table for each picture, so the page draws a portrait again only for another one.
local UNKNOWN = C.UnknownIcon("boss")
local portraits = {}

-- A boss's portrait for the page's header and the part with its spells, either nil where there is none.
local function Details(map, key)
	local entry = Creature(map, key)
	if not (entry and (entry.creature or entry.display or (entry.spells and entry.spells[1]))) then
		return UNKNOWN, nil
	end
	local spells = {}
	for _, id in ipairs(AbilitiesShown() and entry.spells or {}) do
		local name, icon = SpellLook(id)
		local card = name and Card(#spells + 1)
		if card then
			card.spell = id
			local sub = C_Spell and C_Spell.GetSpellSubtext and C_Spell.GetSpellSubtext(id)
			card:SetLines(name, type(sub) == "string" and sub or nil)
			card.icon:SetTexture(icon or UNKNOWN_ICON)
			spells[#spells + 1] = card
		end
	end
	-- A portrait only from a known appearance: asked of the client, a creature it has not met answers
	-- with the player's own face.
	if not entry.display then return UNKNOWN, spells[1] and { cards = spells, columns = 2 } or nil end
	local id = map .. ":" .. key
	local portrait = portraits[id]
	if not (portrait and portrait.creatureID == entry.creature and portrait.displayID == entry.display) then
		portrait = { creatureID = entry.creature, displayID = entry.display, bullet = "boss" }
		portraits[id] = portrait
	end
	return portrait, spells[1] and { cards = spells, columns = 2 } or nil
end

local function ShowEntry()
	if not page then return end
	if not selection then
		page:Show({ title = L.COMPENDIUM_BOSSES, subtitle = Count(Tally(AllZones())) })
		return
	end
	if selection.boss then
		local map, key = selection.map, selection.key
		local boss = Boss(map, key)
		if not boss then return end
		local where = Index().world[map] and L.BOSS_IN_FMT:format(MapName(BossZone(map, key)))
			or (L.BOSS_IN_FMT:format(DungeonName(map)) .. " · " .. MapName(Index().zoneOf[map]))
		if not Found(map, key) and not Unlocked() then
			page:Show({ title = Name(boss), subtitle = where, text = L.BOSS_NOT_FOUND, icon = UNKNOWN })
			return
		end
		local story = Story(map, key)
		local words = story or C.NotWritten()
		local portrait, abilities = Details(map, key)
		page:Show({ title = Name(boss), subtitle = where, icon = portrait,
			parts = abilities and { { text = words }, abilities } or nil,
			text = not abilities and words or nil, unwritten = story == nil })
		return
	end
	if selection.dungeon then
		page:Show({ title = DungeonName(selection.dungeon),
			subtitle = CountLine(MapName(selection.mapID), TallyOf(selection.dungeon)),
			icon = C.PlaceIcon(nil, selection.dungeon),
			picture = C.PlacePicture({ mapID = selection.mapID, dungeon = selection.dungeon }) })
		return
	end
	if selection.lands then
		page:Show({ title = L.GROUP_LANDS, subtitle = Count(Tally(ZonesOn(nil))) })
		return
	end
	if C.IsContinent(selection.mapID) then
		page:Show({ title = MapName(selection.mapID),
			subtitle = Count(Tally(ZonesOn(selection.mapID))), icon = C.PlaceIcon(selection.mapID) })
		return
	end
	page:Show({ title = MapName(selection.mapID),
		subtitle = CountLine(MapName(ContinentOf(selection.mapID) or C.WORLD), Tally({ selection.mapID })),
		icon = C.PlaceIcon(selection.mapID), picture = C.PlacePicture({ mapID = selection.mapID }) })
end

--------------------------------------------------------------------------------
-- The tab
--------------------------------------------------------------------------------

local function Continents()
	local out = {}
	for _, continent in ipairs(CONTINENTS) do
		if #ZonesOn(continent) > 0 then table.insert(out, continent) end
	end
	return out
end

-- The dungeon or raid the player is in, and the zone it is filed under.
local function PlayerDungeon()
	local map = NPCs:InstanceMap()
	local zone = map and Index().zoneOf[map]
	if zone then return map, zone end
end

local function OpenAround(zone) C.OpenAround(zone, continentOpen, bannerOpen) end

-- Choose where the player stands: the line of the dungeon they are in, opened, else their
-- continent's banner.
local function LandOnPlayer()
	local map, zone = PlayerDungeon()
	if map then
		selection = { mapID = zone, dungeon = map }
		dungeonOpen[zone .. ":" .. map] = true
		OpenAround(zone)
	else
		local continent = C.PlayerContinent(Continents())
		selection = continent and { mapID = continent } or nil
		if continent then continentOpen[continent] = true end
	end
	landed = selection
end

local function OnClick(row)
	local searching = filter ~= ""
	if row.kind == "boss" then
		selection = { boss = true, map = row.map, key = row.key }
	elseif row.kind == "lands" then
		if not searching then bannerOpen.lands = not bannerOpen.lands end
		selection = { lands = true }
	elseif row.kind == "continent" then
		if not searching then continentOpen[row.mapID] = not continentOpen[row.mapID] end
		selection = { mapID = row.mapID }
	elseif row.kind == "dungeon" then
		local key = row.mapID .. ":" .. row.dungeon
		if not searching then dungeonOpen[key] = not dungeonOpen[key] or nil end
		selection = { mapID = row.mapID, dungeon = row.dungeon }
	else
		selection = { mapID = row.mapID }
	end
	NPCs:RefreshBosses()
end

function NPCs:RefreshBosses(scrollToSelection)
	if not list then return end
	if not selection then
		LandOnPlayer()
		scrollToSelection = true
	end
	local items = list:Render()
	if scrollToSelection and selection then list:ScrollToChosen(items) end
	ShowEntry()
end

local function Build(panel)
	list = SpokenCompendium.NewList(panel, {
		search = L.BOSSES_SEARCH,
		none = L.BOSSES_NONE,
		only = L.BOSSES_FOUND_ONLY,
		onlyGet = OnlyFound,
		onlySet = function(on) if SpokenNPCsSettings then SpokenNPCsSettings.compendiumFoundOnly = on end end,
		locked = function() return SpokenCompendium.LockedReason("OPT_UNLOCK_BOSSES") end,
		-- Found Only left the chosen row out: back to where the player stands.
		onHidden = function()
			selection = nil
			NPCs:RefreshBosses(true)
		end,
		build = BuildRows,
		isSelected = IsSelected,
		onClick = OnClick,
		onSearch = function(text)
			filter = text
			NPCs:RefreshBosses()
		end,
		addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
	})
	panel.Refresh = function() NPCs:RefreshBosses() end
	panel.inset, panel.filterButton, panel.filterMenu, panel.noMatch = list.inset, list.filterButton, list.filterMenu, list.noMatch

	page = C.NewPage(C.PageHolder(panel, list), NPCs, PLAY, REPORT)
	-- Text Size, on Spoken's page, fires no game event: the page is drawn again at the new size.
	if Spoken and Spoken.RegisterCallback then Spoken:RegisterCallback("COMPENDIUM_FONT_CHANGED", ShowEntry) end
	panel.page = page
	NPCs.bosses, NPCs.list = panel, list
end

--- Open the bosses, on where the player stands now, unless they chose something here.
function NPCs:ShowBosses()
	if not SpokenCompendium then return end
	if selection == landed then selection = nil end
	if list then
		list:ClearSearch()
		filter = ""
	end
	SpokenCompendium:Open("bosses")
	SpokenCompendium:Expand()
	NPCs:RefreshBosses(true)
end

function NPCs:SetupBosses()
	if not SpokenCompendium or SpokenCompendium:Tab("bosses") then return end
	SpokenCompendium:Register("bosses", {
		label = L.COMPENDIUM_BOSSES,
		order = 3,
		build = Build,
		open = function() NPCs:ShowBosses() end,
		-- Come back to from another tab: where the player stands now, unless they chose here.
		onShow = function() if selection == landed then selection = nil end end,
		enabled = function() return Index().count > 0 end,
		-- Unlock Unfound Bosses, on Spoken's page.
		unlock = {
			get = function() return Unlocked() end,
			set = function(value)
				if SpokenNPCsSettings then SpokenNPCsSettings.unlockUnfound = value end
				NPCs:RefreshBosses()
			end,
		},
	})
end

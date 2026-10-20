-- SpokenNPCs -- the bosses in Azeroth's Compendium (Spoken's UI/Compendium.lua): every boss of every
-- dungeon and raid, with the instance it is in and its story.
--
-- The list is laid out as the places' (Spoken Places' tab): a banner for each continent, a card for
-- each of its zones that has a dungeon or a raid (a zone with none is not listed, and no area is),
-- in an opened zone the card of each dungeon or raid whose entrance is there, and in an opened
-- dungeon its bosses; a world boss (Lord Kazzak) is listed straight under its zone, with no card. After the continents, Other Lands' banner for the zones on none. Which bosses
-- a dungeon has comes from Data/Bosses.lua, and their stories from Data/Stories.lua, where there is
-- one. A boss not met yet is listed greyed, with a padlock, and its page says so, until Unlock
-- Unfound Bosses (Spoken's page) is on; Found Only leaves out what holds none met. A search lists
-- the bosses, dungeons and zones whose name has the words, each opened.

local _, NPCs = ...

local L = NPCs.L

local C = SpokenCompendium
local CONTINENTS, CITY_IN = C.CONTINENTS, C.CITY_IN
local MapName, ContinentOf = C.MapName, C.ContinentOf
local Dungeon, DungeonName = C.Dungeon, C.DungeonName

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

local list, page
local selection          -- { boss = true, map = map, key = key } | { mapID = zone, dungeon = map }
                         -- | { mapID = zone or continent } | { lands = true } | nil
local landed             -- the selection made for the player, where they stood; any other they chose
local openZones = {}     -- [zone] = true: a zone's card, opened
local dungeonOpen = {}   -- ["zone:map"] = true: a dungeon's card, opened
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
-- a world boss, which has no card; all[map] = every boss of the map, whatever zone it stands in
-- (the map of world bosses in different zones lists each under its own, `bossZone["map:key"]`);
-- count = every boss listed.
local function Index()
	if index then return index end
	index = { zones = {}, zoneOf = {}, world = {}, all = {}, bossZone = {}, count = 0 }
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
-- game has a map for: a card for a map this client has never heard of would lead nowhere.
local function ZonesOn(continent)
	local out = {}
	for zone in pairs(Index().zones) do
		if continent then
			if ContinentOf(zone) == continent then table.insert(out, zone) end
		elseif not ContinentOf(zone) and not (C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(zone) == nil) then
			table.insert(out, zone)
		end
	end
	table.sort(out, ByName)
	return out
end

local function Maps(zone)
	local out = {}
	for map in pairs(Index().zones[zone] or {}) do table.insert(out, map) end
	table.sort(out, ByDungeonName)
	return out
end

-- Bosses met out of all the dungeons of `zones` hold.
local function Tally(zones)
	local found, total = 0, 0
	for _, zone in ipairs(zones) do
		for map, bosses in pairs(Index().zones[zone] or {}) do
			for _, boss in ipairs(bosses) do
				total = total + 1
				if Found(map, boss.key) then found = found + 1 end
			end
		end
	end
	return found, total
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

-- A boss's story (key = its key): a string, or the client's language beside the English that is
-- its first.
local function Story(map, key)
	local stories = _G.SpokenBossStories
	local text = stories and stories[map] and stories[map][key]
	if type(text) == "table" then text = text[GetLocale and GetLocale() or "enUS"] or text[1] end
	return type(text) == "string" and text ~= "" and text or nil
end

-- Whether a boss has a story and a known appearance.
local function Complete(map, key)
	local known = _G.SpokenBossCreatures
	local entry = known and known[map] and known[map][key]
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

-- A zone's or a dungeon's card, with the bosses met out of those it holds.
local function Card(item, found, total)
	item.style = "card"
	item.count, item.total = found, total
	item.ratio = total > 0 and found / total or 0
	item.tick = total > 0 and found == total
	item.none = found == 0
	if item.kind == "zone" and Spoken and Spoken.ZoneIcon then
		item.icon, item.iconCrop = Spoken:ZoneIcon(item.mapID)
	elseif item.kind == "dungeon" and Spoken and Spoken.DungeonIcon then
		item.icon, item.iconCrop = Spoken:DungeonIcon(item.dungeon)
	end
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

-- A dungeon's or a raid's card and, opened (or a search finds a boss in it), its bosses. `whole`:
-- what holds it was named by the search, so every boss is listed.
local function DungeonRows(zone, map, nest, whole)
	local world = Index().world[map] == true
	local name = world and "" or DungeonName(map)
	whole = whole or (filter ~= "" and not world and Matches(name))
	local found, total = TallyOf(map, zone)
	if OnlyFound() and found == 0 then return {} end
	local inside = {}
	local at = world and nest or nest + 1
	for _, boss in ipairs(Index().zones[zone][map]) do
		local met = Found(map, boss.key)
		if (met or not OnlyFound()) and (whole or Matches(Name(boss))) then
			table.insert(inside, { kind = "boss", leaf = true, map = map, key = boss.key, label = Name(boss), nest = at,
				locked = not met and not Unlocked(), done = met,
				missing = (met or Unlocked()) and not Complete(map, boss.key) })
		end
	end
	-- A world boss has no card: its lines stand directly under the zone.
	if world then return inside end
	if filter ~= "" and #inside == 0 then return {} end
	local open = dungeonOpen[zone .. ":" .. map] == true or filter ~= ""
	return Holding(Card({ kind = "dungeon", mapID = zone, dungeon = map, label = name, nest = nest, open = open },
		found, total), inside, open)
end

-- A zone's dungeons and raids, a card for each.
local function DungeonsIn(zone, nest, whole)
	local rows = {}
	for _, map in ipairs(Maps(zone)) do
		for _, row in ipairs(DungeonRows(zone, map, nest, whole)) do table.insert(rows, row) end
	end
	return rows
end

-- A zone's card and, opened (or a search finds something in it), its dungeons and raids.
local function ZoneRows(zone, nest, whole)
	local name = MapName(zone)
	whole = whole or (filter ~= "" and Matches(name))
	local found, total = Tally({ zone })
	if OnlyFound() and found == 0 then return {} end
	local open = openZones[zone] == true or filter ~= ""
	local inside = open and DungeonsIn(zone, nest + 1, whole) or {}
	if filter ~= "" and #inside == 0 then return {} end
	return Holding(Card({ kind = "zone", mapID = zone, label = name, nest = nest, open = open },
		found, total), inside, open)
end

-- A banner and, opened (or a search finds something under it), a card for each of `zones`.
local function Banner(item, zones)
	local whole = filter ~= "" and Matches(item.label)
	local open = filter ~= "" or item.isOpen()
	local rows = {}
	if open then
		for _, zone in ipairs(zones) do
			for _, row in ipairs(ZoneRows(zone, 0, whole)) do table.insert(rows, row) end
		end
	end
	if filter ~= "" and #rows == 0 then return {} end
	local found, total = Tally(zones)
	if OnlyFound() and found == 0 then return {} end
	item.style, item.count, item.total = "banner", found, total
	item.ratio = total > 0 and found / total or 0
	item.tick = total > 0 and found == total
	item.none = found == 0
	item.open = open and #rows > 0
	item.isOpen = nil
	return Holding(item, rows, open)
end

local function BuildRows()
	local out = {}
	local continents = {}
	for _, continent in ipairs(CONTINENTS) do
		local zones = ZonesOn(continent)
		if #zones > 0 then
			table.insert(continents, { continent = continent, zones = zones, label = MapName(continent) })
		end
	end
	table.sort(continents, function(a, b) return a.label < b.label end)
	for _, entry in ipairs(continents) do
		local continent = entry.continent
		for _, row in ipairs(Banner({ kind = "continent", mapID = continent, label = entry.label,
			isOpen = function() return continentOpen[continent] end }, entry.zones)) do
			table.insert(out, row)
		end
	end
	local lands = ZonesOn(nil)
	if #lands > 0 then
		for _, row in ipairs(Banner({ kind = "lands", label = L.GROUP_LANDS,
			isOpen = function() return bannerOpen.lands end }, lands)) do
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

-- Nothing to play or to report yet: a boss's story is words alone until it is voiced.
local PLAY = { has = function() return false end, find = function() end, start = function() end, tip = "" }
local REPORT = { has = function() return false end, open = function() end, title = "", tip = "" }

local function Bosses(map)
	return Index().all[map] or {}
end

-- The zone a boss is filed under: its own where the map's bosses stand in several, else the map's.
local function BossZone(map, key)
	return Index().bossZone[map .. ":" .. key] or Index().zoneOf[map]
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
local SKULL = [[Interface\TargetingFrame\UI-RaidTargetingIcon_8]]
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
		mask:SetSize(ICON, ICON)
		mask:SetPoint("CENTER", icon, "CENTER")
		icon:AddMaskTexture(mask)
	end
	local frame = card:CreateTexture(nil, "OVERLAY", nil, 1)
	if C.Atlas(frame, FRAME) then
		frame:SetPoint("TOPLEFT", button, "TOPLEFT", -11, 1)
		frame:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", 1, -7)
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

-- A boss's portrait for the page's header and the part with its spells, either nil where there is none.
local function Details(map, key)
	local known = _G.SpokenBossCreatures
	local entry = known and known[map] and known[map][key]
	if not (entry and (entry.creature or entry.display or (entry.spells and entry.spells[1]))) then
		return C.UnknownIcon("boss"), nil
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
	local portrait = entry.display and { creatureID = entry.creature, displayID = entry.display, bullet = "boss" } or C.UnknownIcon("boss")
	return portrait, spells[1] and { cards = spells, columns = 2 } or nil
end

local function ShowEntry()
	if not page then return end
	if not selection then
		page:Show({ title = L.COMPENDIUM_BOSSES, subtitle = Count(Tally(AllZones())), empty = true })
		return
	end
	if selection.boss then
		local map, key = selection.map, selection.key
		for _, boss in ipairs(Bosses(map)) do
			if boss.key == key then
				local where = Index().world[map] and L.BOSS_IN_FMT:format(MapName(BossZone(map, key)))
					or (L.BOSS_IN_FMT:format(DungeonName(map)) .. " · " .. MapName(Index().zoneOf[map]))
				if not Found(map, key) and not Unlocked() then
					page:Show({ title = Name(boss), subtitle = where, text = L.BOSS_NOT_FOUND, icon = C.UnknownIcon("boss") })
				else
					local story = Story(map, key)
					local words = story or C.NotWritten()
					local portrait, abilities = Details(map, key)
					page:Show({ title = Name(boss), subtitle = where, icon = portrait,
						parts = abilities and { { text = words }, abilities } or nil,
						text = not abilities and words or nil, unwritten = story == nil })
				end
				return
			end
		end
		return
	end
	if selection.dungeon then
		page:Show({ title = DungeonName(selection.dungeon),
			subtitle = CountLine(MapName(selection.mapID), TallyOf(selection.dungeon)),
			empty = true, icon = C.PlaceIcon(nil, selection.dungeon),
			picture = C.PlacePicture({ mapID = selection.mapID, dungeon = selection.dungeon }) })
		return
	end
	if selection.lands then
		page:Show({ title = L.GROUP_LANDS, subtitle = Count(Tally(ZonesOn(nil))), empty = true })
		return
	end
	if C.IsContinent(selection.mapID) then
		page:Show({ title = MapName(selection.mapID),
			subtitle = Count(Tally(ZonesOn(selection.mapID))), empty = true, icon = C.PlaceIcon(selection.mapID) })
		return
	end
	page:Show({ title = MapName(selection.mapID),
		subtitle = CountLine(MapName(ContinentOf(selection.mapID) or C.WORLD), Tally({ selection.mapID })),
		empty = true, icon = C.PlaceIcon(selection.mapID), picture = C.PlacePicture({ mapID = selection.mapID }) })
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
	if not GetInstanceInfo then return nil end
	local map = NotSecret((select(8, GetInstanceInfo())))
	local zone = map and Index().zoneOf[map]
	if zone then return map, zone end
end

local function OpenAround(zone) C.OpenAround(zone, continentOpen, bannerOpen) end

-- Choose where the player stands: the card of the dungeon they are in, opened, else their zone's
-- if it has a dungeon, else their continent's banner.
local function LandOnPlayer()
	local map, zone = PlayerDungeon()
	if map then
		selection = { mapID = zone, dungeon = map }
		openZones[zone], dungeonOpen[zone .. ":" .. map] = true, true
		OpenAround(zone)
	else
		local here = C.PlayerZone(function(candidate) return Index().zones[CITY_IN[candidate] or candidate] ~= nil end)
		if here then
			zone = CITY_IN[here] or here
			selection = { mapID = zone }
			openZones[zone] = true
			OpenAround(zone)
		else
			local continent = C.PlayerContinent(Continents())
			selection = continent and { mapID = continent } or nil
		end
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
		if not searching then openZones[row.mapID] = not openZones[row.mapID] or nil end
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
		unlocked = Unlocked,
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

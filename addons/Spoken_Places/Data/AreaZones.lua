-- The areas whose story is kept under another zone than the one the client puts them in. The
-- stories follow warcraft.wiki.gg, which files some areas by the map after the Cataclysm; their
-- ids (s:<mapID>:<key>), recordings, pictures and reports stay keyed by the zone they are kept
-- under, and the addon lists, finds and tells each where the client has it (SpokenPlaces:StoryPlace).
--
-- Keyed as Subzones.lua is: the zone the story is kept under, then the area's key.
--   zone  the zone the client puts the area in (its AreaTable parent): Azeroth's Compendium lists
--         and counts it there, and it is found and told there. On a client with no map of that
--         zone the area stays where its story is.
--   also  more zones the client has an area of that name in, at a border: found and told there
--         too, and listed only once, where `zone` (or else its story) is.
--
-- Spoken's Data/Dungeons.lua does the same for a dungeon kept under another zone than its
-- entrance's (Razorfen Downs), which needs no entry here. Kept by hand; tests/lua/places_area_zones_test.lua
-- checks every entry against the stories.

local _, SpokenPlaces = ...

SpokenPlaces.AreaZones = {
	-- Hillsbrad Foothills: the wiki's since the Cataclysm, Alterac Mountains' in Classic.
	[1424] = {
		["chillwind point"] = { zone = 1416 },
		["corrahns dagger"] = { zone = 1416 },
		["crushridge hold"] = { zone = 1416 },
		["gallows corner"] = { zone = 1416 },
		["gavins naze"] = { zone = 1416 },
		["growless cave"] = { zone = 1416 },
		["headland"] = { zone = 1416 },
		["misty shore"] = { zone = 1416 },
		["ravenholdt manor"] = { zone = 1416 },
		["slaughter hollow"] = { zone = 1416 },
		["soferas naze"] = { zone = 1416 },
		["strahnbrad"] = { zone = 1416 },
	},
	-- Desolace: Forever's client puts the Valley of Bones in Shen'dralas, a map Era has not got.
	[1443] = {
		["valley of bones"] = { zone = 2652 },
	},
	-- Silverpine Forest: the lake is an area of Alterac Mountains too.
	[1421] = {
		["lordamere lake"] = { also = { 1416 } },
	},
	-- Western Plaguelands: the lake is an area of the Eastern Plaguelands too.
	[1422] = {
		["darrowmere lake"] = { also = { 1423 } },
	},
	-- Thousand Needles: the lift's top is an area of The Barrens.
	[1441] = {
		["great lift"] = { also = { 1413 } },
	},
}

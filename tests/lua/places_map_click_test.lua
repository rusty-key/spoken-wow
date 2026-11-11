-- Clicks on the world map: an area of the zone shown opens its story, and a click on a continent
-- that opens a zone does not also open the area under the cursor on the zone's map. On OpenMap's
-- stitched map, the area of whatever zone is under the cursor, and a drag is never a click.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local PLACES = here .. "/../../addons/Spoken_Places/"

local KALIMDOR, MULGORE = 1414, 1412
local hooks, cursor, screen = {}, { 0.5, 0.5 }, { 400, 300 }
GetCursorPosition = function() return screen[1], screen[2] end
WorldMapFrame = {
    mapID = KALIMDOR,
    ScrollContainer = {
        HookScript = function(_, name, fn) hooks[name] = fn end,
        GetNormalizedCursorPosition = function() return cursor[1], cursor[2] end,
    },
}
MapUtil = { FindBestAreaNameAtMouse = function() end }

local opened, marked
local settings = { showMapPanel = true, mapPanelCollapsed = false }
local Z = {
    IsPartOn = function() return true end,
    Get = function(_, key) return settings[key] end,
    SetMapPanelCollapsed = function(_, collapsed) settings.mapPanelCollapsed = collapsed end,
    IsMapPanelOpen = function() return settings.showMapPanel and not settings.mapPanelCollapsed end,
    Print = function() end,
    IsZoneMap = function(_, mapID) return mapID ~= KALIMDOR end,
    AreaAt = function(_, mapID)
        if mapID ~= MULGORE then return nil end
        return "Bloodhoof Village", { name = "Bloodhoof Village" }, "bloodhoof village"
    end,
    SelectSubzone = function(_, mapID, name) opened = mapID .. ":" .. name end,
    MarkFound = function(_, mapID, key) marked = mapID .. "/" .. key end,
}
assert(loadfile(PLACES .. "UI/OpenMap.lua"))("Spoken_Places", Z)
assert(loadfile(PLACES .. "UI/SubzoneClick.lua"))("Spoken_Places", Z)
Z:SetupSubzoneClicks()

local container = WorldMapFrame.ScrollContainer
local function Click(mapAfter, dragged)
    opened = nil
    hooks.OnMouseDown(container, "LeftButton")
    -- Blizzard's own handler runs first and may move the map to the zone clicked.
    WorldMapFrame.mapID = mapAfter or WorldMapFrame.mapID
    if dragged then screen[1] = screen[1] + dragged end
    hooks.OnMouseUp(container, "LeftButton")
    return opened
end

WorldMapFrame.mapID = KALIMDOR
Expect("a click on Mulgore on Kalimdor's map opens the zone, not one of its areas", Click(MULGORE), nil)

WorldMapFrame.mapID = MULGORE
Expect("a click on Mulgore's map opens the area under the cursor", Click(), MULGORE .. ":Bloodhoof Village")
-- Only an explored area resolves under a click, so the click finds it, whatever the map's samples
-- missed of its shape (Discovery.lua).
Expect("...and finds it", marked, MULGORE .. "/bloodhoof village")

-- Closed beside the map, the panel opens on the area clicked.
settings.mapPanelCollapsed = true
Click()
Expect("a click on an area with a story opens the panel when it is closed", settings.mapPanelCollapsed, false)
-- Turned off in the settings, it stays off.
settings.showMapPanel, settings.mapPanelCollapsed = false, true
Click()
Expect("...but not when the panel is turned off in the settings", settings.mapPanelCollapsed, true)
settings.showMapPanel = true
-- An area with no story opens nothing, and leaves the panel as it is.
local areaAt = Z.AreaAt
Z.AreaAt = function(_, mapID) if mapID == MULGORE then return "Bloodhoof Village" end end
settings.mapPanelCollapsed = true
Click()
Expect("...nor for an area with no story", settings.mapPanelCollapsed, true)
Z.AreaAt = areaAt
-- A city inside the zone: no area of the zone's by its name, so the click opens the city's own map.
local THUNDER_BLUFF = 1456
local shownMap
WorldMapFrame.SetMapID = function(_, id) shownMap = id end
-- As SpokenPlaces:AreaAt gives it: the city's story and its map.
Z.AreaAt = function(_, mapID)
    if mapID == MULGORE then return "Thunder Bluff", { name = "Thunder Bluff" }, nil, THUNDER_BLUFF end
end
Expect("a click on a city inside the zone selects no area of the zone's", Click(), nil)
Expect("...and opens the city's own map, whose story the panel tells", shownMap, THUNDER_BLUFF)
-- Closed beside the map, the panel opens on the city too.
settings.mapPanelCollapsed = true
Click()
Expect("...and opens the panel when it is closed, as an area does", settings.mapPanelCollapsed, false)

-- Blizzard's map moves its map point with the cursor, so a hand that drifts on screen still clicks.
Z.AreaAt = function(_, mapID)
    if mapID == MULGORE then return "Bloodhoof Village", { name = "Bloodhoof Village" }, "bloodhoof village" end
end
Expect("without OpenMap, a click that drifted on screen is still a click", Click(nil, 20), MULGORE .. ":Bloodhoof Village")

-- OpenMap's stitched map: its map is the continent while the view already shows a whole zone.
local DUROTAR = 1411
local zoneUnder, zoom = MULGORE, 6
OpenMapAPI = {
    major = 1, version = 4,
    IsStitched = function() return true end,
    GetView = function() return 0.3, 0.6, zoom end,
    CursorPosition = function() return 0.3, 0.6 end,
    MapAt = function() return zoneUnder end,
    MapFromWorld = function() return 0.4, 0.5 end,
}
Z.AreaAt = function(_, mapID)
    if mapID == MULGORE then return "Bloodhoof Village", { name = "Bloodhoof Village" }, "bloodhoof village" end
    if mapID == DUROTAR then return "Razor Hill", { name = "Razor Hill" }, "razor hill" end
end
-- A drag that kept the same map point under the cursor, as OpenMap pans: the screen says it moved.
WorldMapFrame.mapID = MULGORE
Expect("stitched, a drag is not a click, though the map point under the cursor stayed", Click(nil, 200), nil)
Expect("...while a click that barely moves still is", Click(nil, 2), MULGORE .. ":Bloodhoof Village")
WorldMapFrame.mapID = KALIMDOR
Expect("stitched, a click opens the area of the zone under the cursor on the continent's map",
    Click(), MULGORE .. ":Bloodhoof Village")
WorldMapFrame.mapID = MULGORE
zoneUnder = DUROTAR
Expect("...and of a neighbour of the zone the view is on", Click(), DUROTAR .. ":Razor Hill")
zoom = 2
Expect("...but not zoomed out to where OpenMap's click picks a zone", Click(), nil)
zoom = 6
-- With the panel not beside OpenMap's map, the click is OpenMap's alone, and the panel stays away.
settings.mapPanelCollapsed = true
Expect("stitched, with the panel folded away, a click opens nothing", Click(), nil)
Expect("...and leaves the panel folded", settings.mapPanelCollapsed, true)
settings.mapPanelCollapsed = false
zoom = 6
zoneUnder = MULGORE
shownMap, Z.selected = nil, nil
Z.AreaAt = function(_, mapID)
    if mapID == MULGORE then return "Thunder Bluff", { name = "Thunder Bluff" }, nil, THUNDER_BLUFF end
end
Click()
Expect("a city tells its story without opening its map under OpenMap's moving view", shownMap, nil)
Expect("...as its own map's story", Z.selected and Z.selected.map and Z.selected.mapID, THUNDER_BLUFF)

-- Anywhere in a zone with no area story under the cursor, the zone's own story.
Z.GetLore = function(_, mapID) if mapID == MULGORE then return { name = "Mulgore" } end end
Z.AreaAt = function(_, mapID) if mapID == MULGORE then return "Red Rocks" end end
Z.selected = nil
Click()
Expect("stitched, a click off any area with a story chooses the zone's", Z.selected and Z.selected.map and Z.selected.mapID, MULGORE)
Z.AreaAt = function() end
Z.selected = nil
Click()
Expect("...as does one where no area is explored", Z.selected and Z.selected.mapID, MULGORE)
OpenMapAPI = nil
WorldMapFrame.mapID = MULGORE
Z.selected = nil
Click()
Expect("without OpenMap the panel already tells the zone shown: nothing is chosen", Z.selected, nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places map click tests passed")

-- Clicks on the world map: an area of the zone shown opens its story, and a click on a continent
-- that opens a zone does not also open the area under the cursor on the zone's map.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local PLACES = here .. "/../../addons/Spoken_Places/"

local KALIMDOR, MULGORE = 1414, 1412
local hooks, cursor, screen = {}, { 0.5, 0.5 }, { 400, 300 }
_G.GetCursorPosition = function() return screen[1], screen[2] end
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
    Print = function() end,
    IsZoneMap = function(_, mapID) return mapID ~= KALIMDOR end,
    AreaAt = function(_, mapID)
        if mapID ~= MULGORE then return nil end
        return "Bloodhoof Village", { name = "Bloodhoof Village" }, "bloodhoof village"
    end,
    SelectSubzone = function(_, mapID, name) opened = mapID .. ":" .. name end,
    MarkFound = function(_, mapID, key) marked = mapID .. "/" .. key end,
}
assert(loadfile(PLACES .. "UI/SubzoneClick.lua"))("Spoken_Places", Z)
Z:SetupSubzoneClicks()

local container = WorldMapFrame.ScrollContainer
local function Click(mapAfter, dragBy)
    opened = nil
    hooks.OnMouseDown(container, "LeftButton")
    -- Blizzard's own handler runs first and may move the map to the zone clicked.
    WorldMapFrame.mapID = mapAfter or WorldMapFrame.mapID
    local x = screen[1]
    screen[1] = x + (dragBy or 0)
    hooks.OnMouseUp(container, "LeftButton")
    screen[1] = x
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

-- OpenMap pans its own map without moving Blizzard's scroll container, so the position on the map
-- under a drag stays the same (#921): the cursor's travel on the screen tells the drag.
shownMap = nil
Expect("a drag across the screen that ends where it began on the map opens nothing", Click(nil, 40) or shownMap, nil)
Click(nil, 3)
Expect("...while a press that wobbles a pixel or two is still a click", shownMap, THUNDER_BLUFF)
-- OpenMap zooms into the city with its own click.
_G.OpenMapAPI = {}
shownMap = nil
Click()
Expect("with OpenMap a click on a city leaves the zoom to OpenMap", shownMap, nil)
_G.OpenMapAPI = nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places map click tests passed")

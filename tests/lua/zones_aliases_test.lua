-- A localized area name the client gives more than one place (Data/<locale>/Aliases.lua's byZone,
-- from pipelines/zones/tools/locale/build-aliases.mjs): told apart by the map it is reported on,
-- and an alias file without that table resolves as it always has. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local ZONES = here .. "/../../addons/Spoken_Places/"

local ELWYNN, BARRENS, SWAMP, REDRIDGE, THUNDER_BLUFF, ALTERAC, HILLSBRAD, ZEPHRAS =
    1429, 1413, 1435, 1433, 1456, 1416, 1424, 2521

local Z = H.LoadZones(ZONES)
Z.Subzones = {
    [THUNDER_BLUFF] = { ["spirit rise"] = { name = "Spirit Rise", full = "The elders' rise." } },
    [ZEPHRAS] = { ["rise of spirits"] = { name = "Rise of Spirits", pending = true } },
    [BARRENS] = { ["sludge fen"] = { name = "The Sludge Fen", full = "A fen." } },
    [SWAMP] = { stagalbog = { name = "Stagalbog", full = "A bog." } },
    [HILLSBRAD] = { strahnbrad = { name = "Strahnbrad", full = "A town." } },
}
Z.AreaZones = { [HILLSBRAD] = { strahnbrad = { zone = ALTERAC } } }

---------------------------------------------------------------- with the table
Z.clientLocale = "ruRU"
Z:RegisterAliases("ruRU", {
    ["Крепость Каменной Стражи"] = "stonewatch keep",
    ["진흙늪"] = "stagalbog",
}, {
    ["Вершина Духов"] = { [THUNDER_BLUFF] = "spirit rise", [ZEPHRAS] = "rise of spirits" },
    ["진흙늪"] = { [BARRENS] = "sludge fen", [SWAMP] = "stagalbog" },
    ["Страхнбрад"] = { [HILLSBRAD] = "strahnbrad", [ELWYNN] = "elsewhere" },
})

Expect("a shared name on Thunder Bluff's map is Spirit Rise", Z:ResolveAreaKey("Вершина Духов", THUNDER_BLUFF), "spirit rise")
Expect("...and its story plays there", Z:GetSubzoneLore(THUNDER_BLUFF, "Вершина Духов").full, "The elders' rise.")
Expect("the same name on Forever's map of Zephras Isle is Rise of Spirits", Z:ResolveAreaKey("Вершина Духов", ZEPHRAS), "rise of spirits")
Expect("on a map neither is kept under, it resolves as without the table",
    Z:ResolveAreaKey("Вершина Духов", REDRIDGE), Z:NormaliseAreaKey("Вершина Духов"))
Expect("...and with no map too", Z:ResolveAreaKey("Вершина Духов"), Z:NormaliseAreaKey("Вершина Духов"))

Expect("a name the flat table gives Stagalbog is Sludge Fen on The Barrens' map", Z:ResolveAreaKey("진흙늪", BARRENS), "sludge fen")
Expect("...and its story plays there", Z:GetSubzoneLore(BARRENS, "진흙늪").full, "A fen.")
Expect("...Stagalbog on the Swamp of Sorrows' map", Z:ResolveAreaKey("진흙늪", SWAMP), "stagalbog")
Expect("...and the flat table's answer anywhere else", Z:ResolveAreaKey("진흙늪", ELWYNN), "stagalbog")
Expect("...or with no map", Z:ResolveAreaKey("진흙늪"), "stagalbog")

Expect("a shared name found on another map than its story's is that story's place",
    Z:ResolveAreaKey("Страхнбрад", ALTERAC), "strahnbrad")
Expect("...and its story plays there", Z:GetSubzoneLore(ALTERAC, "Страхнбрад").full, "A town.")

Expect("a name only the flat table has resolves through it, map or not",
    Z:ResolveAreaKey("Крепость Каменной Стражи", REDRIDGE), "stonewatch keep")

---------------------------------------------------------------- a file without the table
local real = H.LoadZones(ZONES)
real.clientLocale = "ruRU"
assert(loadfile(ZONES .. "Data/ruRU/Aliases.lua"))("Spoken_Places", real)
local northshire
for name, key in pairs(real.Aliases.ruRU) do
    if key == "northshire abbey" then northshire = name end
end
Expect("the ruRU alias file loads", northshire ~= nil, true)
Expect("an alias resolves on a map as it does without one",
    real:ResolveAreaKey(northshire, ELWYNN), real:ResolveAreaKey(northshire))
Expect("...which is the flat table's key", real:ResolveAreaKey(northshire, ELWYNN), "northshire abbey")
if real.ZoneAliases.ruRU == nil then
    Expect("a name with no alias resolves on a map as it does without one",
        real:ResolveAreaKey("Вершина Духов", THUNDER_BLUFF), real:ResolveAreaKey("Вершина Духов"))
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones alias tests passed")

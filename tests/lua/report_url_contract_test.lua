-- Every shape of report address the modules build, as the site is tested against it. Run with
-- `make test-player`.
--
-- The addresses are kept in tests/fixtures/report-urls.txt, and
-- apps/web/src/lib/reports/report-urls.test.ts resolves each one through the site's language
-- rewrite to its /r/ page. A change to how an address is built fails here until
-- `make contribute-fixtures` rewrites the file, and then on the site's side if the site
-- cannot open it.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local BOSSES = here .. "/../../addons/Spoken_Bosses/"
local FIXTURE = here .. "/../fixtures/report-urls.txt"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
local VO = stub.LoadQuests(QUESTS, SPOKEN)
local R, E = VO.ReportButton, VO.Enums
local Z = H.LoadPlaces(PLACES)
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
local D = {}
assert(loadfile(BOSSES .. "Core.lua"))("Spoken_Bosses", D)

-- English, a language of each script, and Italian, which no client runs in.
local urls = {
    R:Link(R:TargetForQuest(9123, E.SoundEvent.QuestAccept)),
    R:Link(R:TargetForQuest(9123, E.SoundEvent.QuestProgress), "deDE"),
    R:Link(R:TargetForQuest(9123, E.SoundEvent.QuestComplete), "zhTW"),
    R:Link(R:TargetForGUID("Creature-0-1-2-3-68-0000000001")),
    R:Link(R:TargetForGUID("GameObject-0-1-2-3-68-0000000001"), "ruRU"),
    -- With the file that played, which picks one line out of an address several answer to.
    R:Link(R:TargetForQuest(96774, E.SoundEvent.QuestAccept), nil, "96774-accept-troll-male-shaman"),
    R:Link(R:TargetForGUID("Creature-0-1-2-3-68-0000000001"), "deDE", "f-1a2b3c"),
    Z:ReportURL(1411, nil, "enUS"),
    Z:ReportURL(1411, "valley of trials", "esMX"),
    Z:ReportURL(1413, "razorfen downs", "koKR"),
    B:ReportURL(261),
    B:ReportURL(261, "itIT"),
    D:ReportURL(36, "edwin vancleef"),
    D:ReportURL(409, "majordomo executus", "frFR"),
}
local built = table.concat(urls, "\n") .. "\n"

if os.getenv("SPOKEN_WRITE_FIXTURES") then
    local file = assert(io.open(FIXTURE, "wb"))
    file:write(built)
    file:close()
end

local file = assert(io.open(FIXTURE, "rb"))
local kept = file:read("*a"):gsub("\r\n", "\n")
file:close()
Expect("every address is one the site is tested against (make contribute-fixtures)", built, kept)
Expect("...fourteen of them, none missing", #urls, 14)

os.exit(Failures() == 0 and 0 or 1)

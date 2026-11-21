-- Places and Readables settings were account-wide, and every character has a profile of its own in
-- Spoken's settings. What a player had saved comes to each character's profile at login; a profile
-- made or reset later starts from the defaults. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

-- The callbacks Spoken registers with AceDB, kept so a switch or a reset can fire them: the stub's
-- profile calls fire none.
local callbacks = {}
do
    local AceDB = _G.LibStub("AceDB-3.0")
    local realNew = AceDB.New
    AceDB.New = function(lib, name, defaults)
        local made = realNew(lib, name, defaults)
        made.RegisterCallback = function(_, event, fn) callbacks[event] = fn end
        return made
    end
end

local env, db
--- A login of the character on `profile`, with the old Readables table as the client reads it.
local function Login(profile, legacy)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.StartProfile = profile
    _G.SpokenReadablesSettings, _G.SpokenReadablesCharacter = legacy, nil
    env = stub.LoadSpoken(SPOKEN)
    db = env.Addon.db
    local B = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core" }) do
        assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
    end
    B:InitDB()
    return B
end

_G.SpokenSettings = nil
local first = Login("Alice", { autoplay = false, readOnce = true })
Expect("the first character's profile has what was saved", SpokenReadablesSettings.autoplay == false and SpokenReadablesSettings.readOnce == true, true)
-- Playing on: the table is the profile's, and the old global the game saves is that table.
first:Set("readOnce", false)

Login("Bob", _G.SpokenReadablesSettings)
Expect("a second character, on a profile of its own, has what was saved before too",
    SpokenReadablesSettings.autoplay == false and SpokenReadablesSettings.readOnce == true, true)
Expect("...not what the first character has changed since", SpokenReadablesSettings.readOnce, true)
SpokenReadablesSettings.stopOnClose = true

local function Switch(name)
    db:SetProfile(name)
    callbacks.OnProfileChanged("OnProfileChanged", db, name)
end
Switch("Brand new")
Expect("a profile made from the Profiles page starts from the defaults",
    SpokenReadablesSettings.autoplay == true and SpokenReadablesSettings.readOnce == false and SpokenReadablesSettings.stopOnClose == false, true)
Switch("Bob")
Expect("...and the character's own is still there", SpokenReadablesSettings.stopOnClose, true)

db:ResetProfile()
callbacks.OnProfileReset("OnProfileReset", db)
Expect("a reset profile starts from the defaults, not from what was saved", SpokenReadablesSettings.autoplay == true and SpokenReadablesSettings.readOnce == false, true)

Login("Bob", _G.SpokenReadablesSettings)
Expect("a later login changes nothing", SpokenReadablesSettings.autoplay == true and SpokenReadablesSettings.readOnce == false, true)
local old = db.global.ModulesLegacy and db.global.ModulesLegacy.Readables
Expect("what was saved is kept apart, as it was, whatever the profiles did",
    old ~= nil and old.autoplay == false and old.readOnce == true and old.stopOnClose ~= true, true)

stub.StartProfile = nil
if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end

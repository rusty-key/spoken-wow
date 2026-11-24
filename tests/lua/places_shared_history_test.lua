-- Sharing places is opt-in and account-wide, without discarding the older per-character records.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local PLACES = here .. "/../../addons/Spoken_Places/"

local now = 10000
_G.time = function() return now end

local function Character(record)
    SpokenPlacesCharacter = record or {}
    local Z = {}
    assert(loadfile(PLACES .. "History.lua"))("Spoken_Places", Z)
    return Z
end

SpokenPlacesAccountHistory = nil
local first = Character({ heard = { ["1411"] = true }, readAt = { ["1411"] = now - 10 },
    visited = { ["1411"] = true } })
Expect("sharing is off by default", first:SharesHistory(), false)
first:RememberHistory("heard", "1413", true)
Expect("sharing off still records locally", SpokenPlacesCharacter.heard["1413"], true)
Expect("sharing off creates no account record", SpokenPlacesAccountHistory, nil)

first:SetSharesHistory(true)
Expect("turning on keeps existing heard places", first:HistorySet("heard")["1411"], true)
Expect("...and the ones just played", first:HistorySet("heard")["1413"], true)
Expect("...and the known places", first:HistorySet("visited")["1411"], true)
first:RememberHistory("readAt", "1413", now)
first:RememberHistory("visited", "1413", true)

local second = Character({ heard = { ["1420"] = true }, readAt = { ["1420"] = now - 20 },
    visited = { ["1420"] = true } })
Expect("another character inherits the enabled account setting", second:SharesHistory(), true)
Expect("...and the first character's heard zones", second:HistorySet("heard")["1411"], true)
Expect("...and its discovered zones", second:HistorySet("visited")["1413"], true)
Expect("logging in merges the second character's old listening history", second:HistorySet("heard")["1420"], true)
Expect("...and its old visited places", second:HistorySet("visited")["1420"], true)

local third = Character({ heard = { ["1451"] = true }, readAt = { ["1451"] = now - 30 },
    visited = { ["1451"] = true } })
third:MergeHistory()
Expect("login merges an alt's heard record without waiting for discovery", third:HistorySet("heard")["1451"], true)
Expect("...and its last-read times", third:HistorySet("readAt")["1451"], now - 30)
Expect("...and the discovered locations", third:HistorySet("visited")["1451"], true)

SpokenPlacesCharacter = { heard = { ["1420"] = true }, readAt = { ["1420"] = now - 20 },
    visited = { ["1420"] = true } }

second:SetSharesHistory(false)
Expect("turning off exposes only this character's record", second:HistorySet("heard")["1411"], nil)
second:MergeHistory()
Expect("login merge while sharing is off leaves the account record alone",
    SpokenPlacesAccountHistory.heard["1454"], nil)
second:RememberHistory("heard", "1454", true)
second:SetSharesHistory(true)
Expect("re-enabling imports changes made while sharing was off", second:HistorySet("heard")["1454"], true)

second:ForgetHeardHistory()
Expect("forgetting clears account-wide heard history", second:HistorySet("heard")["1411"], nil)
Expect("...and account-wide reading times", second:HistorySet("readAt")["1413"], nil)
Expect("...but not account-wide visited places", second:HistorySet("visited")["1413"], true)
Expect("...nor local visited places", SpokenPlacesCharacter.visited["1420"], true)

local backToFirst = Character({ heard = { ["1411"] = true },
    readAt = { ["1411"] = now - 10 }, visited = { ["1411"] = true } })
Expect("an old alt cannot resurrect forgotten account history", backToFirst:HistorySet("heard")["1411"], nil)
now = now + 1
backToFirst:RememberHistory("heard", "1411", true)
backToFirst:RememberHistory("readAt", "1411", now)
Expect("a place heard again after forgetting is remembered", backToFirst:HistorySet("heard")["1411"], true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll shared places history tests passed")

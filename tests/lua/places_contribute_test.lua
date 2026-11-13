-- What the Places addon sends for a place it has no lore for. Run with `make test-player`.
--
-- No text: zone lore is wiki-sourced, so the client has nothing to give. The envelope names the
-- place the panel shows, and the contribute page asks the player to describe it.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
local env = stub.LoadSpoken(SPOKEN)

-- The addon's own .toc Version, deliberately unlike "dev" so the assertion below cannot pass
-- by coincidence -- it is pinning that CaptureContribution reads a real version, not
-- confirming a particular one. See addons/Spoken_Quests/Contribute.lua's Contribute:Capture
-- for the same pattern; SpokenPlaces.VERSION does not exist, only the lowercase
-- SpokenPlaces.version Core.lua already computes from the .toc.
stub.SetAddOns({ { folder = "Spoken_Places", meta = { Version = "9.9.9" } } })

local Z = H.LoadPlaces(PLACES)   -- the loader that loads Core.lua for real, unlike stub.LoadZones

-- The player stands somewhere else entirely: what is sent is the place the panel shows.
stub.SetZone({ map = 1453, zone = "Stormwind City", x = 0.5, y = 0.5 })

Expect("contributing is offered with a current player", Z:CanContribute(), true)
env.Addon.db.profile.Contribute.HideButtons = true
Expect("...but not when Contribute buttons are hidden in the player settings", Z:CanContribute(), false)
env.Addon.db.profile.Contribute.HideButtons = false

Z.Zones[1537] = { name = "Ironforge", pending = true }
local envelope = Z:CaptureContribution(1537, "A Nook With No Lore")
H.WriteCapturedFixture(here, "places-subzone", envelope)
Expect("the source is places", envelope:match("^!SPOKEN1 places\n") ~= nil, true)
Expect("the map is the one shown, not the player's", envelope:match("\nmap=1537\n") ~= nil, true)
Expect("the zone is named from the map", envelope:match("\nzone=Ironforge\n") ~= nil, true)
Expect("the subzone is carried", envelope:match("\nsubzone=A Nook With No Lore\n") ~= nil, true)
Expect("no position: every place is already known", envelope:match("\nx=") == nil and envelope:match("\ny=") == nil, true)
Expect("there is no text block -- the description is written on the page", envelope:match("text<<") == nil, true)
Expect("the addon field carries the real .toc version, not the \"dev\" fallback",
    envelope:match("\naddon=Spoken_Places/9%.9%.9\n") ~= nil, true)
Expect("with no pack installed, the pack version says none", envelope:match("\npackVersion=none\n") ~= nil, true)

do
    local active = Z.GetActiveAudioPack
    Z.GetActiveAudioPack = function() return { addon = "SpokenPlacesAudio_deDE", language = "deDE" } end
    stub.SetAddOns({
        { folder = "Spoken_Places", meta = { Version = "9.9.9" } },
        { folder = "SpokenPlacesAudio_deDE", meta = { Version = "1.4.2" } },
    })
    Expect("...and with one, the version in its .toc",
        Z:CaptureContribution(1537, nil):match("\npackVersion=1%.4%.2\n") ~= nil, true)
    Z.GetActiveAudioPack = active
    stub.SetAddOns({ { folder = "Spoken_Places", meta = { Version = "9.9.9" } } })
end

local zoneOnly = Z:CaptureContribution(1537, nil)
H.WriteCapturedFixture(here, "places-zone", zoneOnly)
Expect("a zone with no subzone leaves the key out rather than sending it empty", zoneOnly:match("\nsubzone=") == nil, true)
Expect("nothing is captured without a map", Z:CaptureContribution(nil, nil), nil)

------------------------------------------------------------------------------- Show()
-- Compression must run on the click alone; this spies on Encode rather than trusting the
-- comment, so a future edit that moved the call earlier would fail here.
local encodeCalls = 0
local realEncode = env.Spoken.Contribute.Encode
env.Spoken.Contribute.Encode = function(...)
    encodeCalls = encodeCalls + 1
    return realEncode(...)
end
Z:CanContribute()
Z:CaptureContribution(1537, "A Nook With No Lore")
Expect("CanContribute/CaptureContribution never encode", encodeCalls, 0)

Z:ShowContribution(1537, "A Nook With No Lore")
Expect("...only Show() does", encodeCalls, 1)
local box = env.Spoken.ContributeBox
Expect("Show() puts a link in the box, not the raw envelope",
    box.editBox:GetText():match("^https://spoken%.quest/contribute#e1=") ~= nil, true)
Expect("...with the link hint", box.hint:GetText(), "Copy this and open it in your browser:")
env.Spoken.Contribute.Encode = realEncode

-- The fallback an older bundled Spoken still gets: no Encode at all.
env.Spoken.Contribute.Encode = nil
Z:ShowContribution(1537, "A Nook With No Lore")
Expect("...falls back to the raw envelope when Encode is absent",
    box.editBox:GetText():match("^!SPOKEN1 places\n") ~= nil, true)
Expect("...with the old two-copy hint", box.hint:GetText(), "Press Ctrl+C, then paste it at:")
Expect("...and the address shown again", box.address:GetText(), "https://spoken.quest/contribute")
env.Spoken.Contribute.Encode = realEncode

os.exit(Failures() == 0 and 0 or 1)

-- Bronze Border on the round buttons: on Forever (1.60.1, interface 16001), every round button's
-- ring takes the bronze the small window wears while the setting is on, and goes back to its own
-- colour when it is turned off. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
stub.LoadSpoken(SPOKEN)
local env = _G.SpokenEnv
env.Addon:Enable()
local frame = env.Addon.db.profile.Frame

-- What colour each ring was last given.
local function Recorded(button)
    local ring = button.ring
    ring.SetVertexColor = function(self, r, g, b) self.colour = string.format("%.2f %.2f %.2f", r, g, b) end
    return ring
end

frame.BronzeTint = true
local play = _G.Spoken:CreateRoundButton(UIParent, "play")
local picture = _G.Spoken:CreateRoundButton(UIParent, "icon", nil, [[Interface\Icons\INV_Misc_Book_11]])
local rings = { Recorded(play), Recorded(picture) }
env.Actions.RefreshRings()
Expect("on Forever, with Bronze Border on, a round button's ring is bronze", rings[1].colour, "0.95 0.68 0.35")
Expect("...a picture's ring too", rings[2].colour, "0.95 0.68 0.35")

frame.BronzeTint = false
env.PlayerFrame:RefreshConfig()
Expect("...its own colour again when the setting is turned off", rings[1].colour, "1.00 1.00 1.00")
Expect("...on every ring", rings[2].colour, "1.00 1.00 1.00")

frame.BronzeTint = true
env.PlayerFrame:RefreshConfig()
Expect("...and bronze again when it is turned back on, through the player's refresh", rings[1].colour, "0.95 0.68 0.35")

if not env.Subtitle.frame then env.Subtitle:Build() end
local subtitleRing = env.Subtitle.ring
subtitleRing.SetVertexColor = function(self, r, g, b) self.colour = string.format("%.2f %.2f %.2f", r, g, b) end
env.PlayerFrame:RefreshConfig()
Expect("the subtitles' portrait ring bronze with the round buttons'", subtitleRing.colour, "0.95 0.68 0.35")
frame.BronzeTint = false
env.PlayerFrame:RefreshConfig()
Expect("...and its own colour with them when the setting is turned off", subtitleRing.colour, "1.00 1.00 1.00")
frame.BronzeTint = true

-- The large window's mover ring, a page's face and the small window's menu border take it too, and
-- give it back, with every ring.
local function Colour(region)
    local c = region.vertexColor or region.backdropBorderColor
    return c and string.format("%.2f %.2f %.2f", c[1], c[2], c[3]) or "none"
end
local mover = env.PlayerFrame.frame.mover.background
local face = _G.Spoken:CreateSpeakerFace(UIParent, 44)
_G.UISpecialFrames = _G.UISpecialFrames or {}
frame.Style = "minimal"
env.PlayerFrame:RefreshConfig()
local menu = env.MinimalPlayer.menu
Expect("the large window's mover ring is bronze", Colour(mover), "0.95 0.68 0.35")
Expect("...a page's face ring too", Colour(face.ring), "0.95 0.68 0.35")
Expect("...and the small window's menu border", Colour(menu), "0.95 0.68 0.35")
frame.BronzeTint = false
env.PlayerFrame:RefreshConfig()
Expect("...all three their own colours with it off: the mover ring", Colour(mover), "1.00 1.00 1.00")
Expect("...the face ring, without drawing the face again", Colour(face.ring), "1.00 1.00 1.00")
Expect("...the menu border the tooltip border's grey", Colour(menu), "0.60 0.57 0.48")
frame.BronzeTint = true

-- Classic Era (1.15.9, interface 11509): no bronze frames to match, so the rings stay their own.
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.LoadSpoken(SPOKEN)
env = _G.SpokenEnv
env.Addon:Enable()
env.Addon.db.profile.Frame.BronzeTint = true
local era = Recorded(_G.Spoken:CreateRoundButton(UIParent, "play"))
env.Actions.RefreshRings()
Expect("on Classic Era, with Bronze Border on, a round button's ring keeps its own colour", era.colour, "1.00 1.00 1.00")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll bronze ring tests passed")

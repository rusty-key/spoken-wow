-- The round buttons look pressed while held: the glyph sinks a pixel and darkens, as the game's
-- own buttons do, and comes back on release or when the button hides mid-press. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.LoadSpoken(SPOKEN)
local env = _G.SpokenEnv
env.Addon:Enable()

local function Fire(button, script, ...)
    for _, fn in ipairs(button.hooks[script] or {}) do fn(button, ...) end
end

local function Watched(texture)
    texture.dx, texture.dy = 0, 0
    function texture:AdjustPointsOffset(x, y) self.dx, self.dy = self.dx + x, self.dy + y end
    return texture
end

local function Look(texture)
    local c = texture.vertexColor or { 1, 1, 1 }
    return string.format("%d,%d %.2f", texture.dx, texture.dy, c[1])
end

local play = _G.Spoken:CreateRoundButton(UIParent, "play")
local glyph = Watched(play.glyph)
Fire(play, "OnMouseDown", "LeftButton")
Expect("a held round button's glyph sinks a pixel down and right and darkens", Look(glyph), "1,-1 0.70")
Fire(play, "OnMouseDown", "LeftButton")
Expect("...once, however many presses arrive before the release", Look(glyph), "1,-1 0.70")
Fire(play, "OnMouseUp", "LeftButton")
Expect("...and is back where it was, in its own colour, on release", Look(glyph), "0,0 1.00")

Fire(play, "OnMouseDown", "RightButton")
Expect("a right-click, which clicks nothing, leaves it where it is", Look(glyph), "0,0 1.00")

Fire(play, "OnMouseDown", "LeftButton")
Fire(play, "OnHide")
Expect("a button hidden while held, which never hears the release, is let go", Look(glyph), "0,0 1.00")

play:Disable()
Fire(play, "OnMouseDown", "LeftButton")
Expect("a disabled button does not sink", Look(glyph), "0,0 1.00")
play:Enable()

-- A tint another look gave the glyph is darkened and given back, not replaced with white.
glyph.vertexColor = { 0.5, 0.5, 0.5 }
Fire(play, "OnMouseDown", "LeftButton")
Expect("a tinted glyph darkens from its own tint", Look(glyph), "1,-1 0.35")
Fire(play, "OnMouseUp", "LeftButton")
Expect("...and gets that tint back on release", Look(glyph), "0,0 0.50")

-- Skip's bar is drawn beside the glyph, so it darkens with it.
local skip = _G.Spoken:CreateRoundButton(UIParent, "skip")
Watched(skip.glyph)
local bar = Watched(skip.bar)
Fire(skip, "OnMouseDown", "LeftButton")
Expect("Skip's bar darkens with its glyph", string.format("%.2f", bar.vertexColor[1]), "0.70")
Fire(skip, "OnMouseUp", "LeftButton")
Expect("...and comes back with it", string.format("%.2f", bar.vertexColor[1]), "1.00")

-- A picture round button and the player's own Stop are the same button.
local picture = _G.Spoken:CreateRoundButton(UIParent, "icon", nil, [[Interface\Icons\INV_Misc_Book_11]])
local face = Watched(picture.glyph)
Fire(picture, "OnMouseDown", "LeftButton")
Expect("a picture round button sinks too", Look(face), "1,-1 0.70")
Fire(picture, "OnMouseUp", "LeftButton")

local stop = env.Actions.StopButton(UIParent)
local stopGlyph = Watched(stop.glyph)
Fire(stop, "OnMouseDown", "LeftButton")
Expect("the player's Stop sinks too", Look(stopGlyph), "1,-1 0.70")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll round button press tests passed")

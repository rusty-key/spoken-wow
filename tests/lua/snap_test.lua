-- Dragging a narrator window: where it comes to rest against the screen's edges and middle, and its
-- home, and how it lets go. How it looks is checked in game. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
_G.UISpecialFrames = _G.UISpecialFrames or {}
local created, createFrame = {}, CreateFrame
_G.CreateFrame = function(...)
    local frame = createFrame(...)
    created[#created + 1] = frame
    return frame
end
local env = stub.LoadSpoken(SPOKEN)
_G.CreateFrame = createFrame
local Snap = env.Snap
UIParent:SetSize(1000, 800)
local W, SH = UIParent:GetWidth(), UIParent:GetHeight()

local function Fit(left, top, width, height, homeLeft, homeTop)
    local l, t, x, y = Snap.Fit(left, top, width, height, homeLeft, homeTop)
    return string.format("%d,%d|%s|%s", l, t, tostring(x), tostring(y))
end

Expect("a window far from every line stays where it is", Fit(300, 500, 200, 100), "300,500|nil|nil")
Expect("its left edge near the screen's comes to it", Fit(6, 500, 200, 100), "0,500|0|nil")
Expect("its right edge near the screen's comes to it", Fit(W - 204, 500, 200, 100), string.format("%d,500|%d|nil", W - 200, W))
Expect("its middle near the screen's comes to it", Fit(W / 2 - 100 + 5, 500, 200, 100),
    string.format("%d,500|%d|nil", W / 2 - 100, W / 2))
Expect("its top near the screen's comes to it", Fit(300, SH - 4, 200, 100), string.format("300,%d|nil|%d", SH, SH))
Expect("its bottom near the screen's comes to it", Fit(300, 104, 200, 100), "300,100|nil|0")
Expect("its middle height near the screen's comes to it", Fit(300, SH / 2 + 50 - 3, 200, 100),
    string.format("300,%d|nil|%d", SH / 2 + 50, SH / 2))
Expect("its top left near its home comes to it", Fit(303, 497, 200, 100, 300, 500), "300,500|300|500")
Expect("where two lines are near, the nearer wins", Fit(3, 500, 200, 100, 6, nil), "0,500|0|nil")

local frame = CreateFrame("Frame", nil, UIParent)
frame:SetSize(200, 100)
-- The stub's frames have no place of their own: this one keeps where it was put.
function frame:SetPoint(_, _, _, x, y) self.left, self.top = x, y end
function frame:ClearAllPoints() end
function frame:GetLeft() return self.left end
function frame:GetTop() return self.top end
frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", 300, 500)
local cursor = { 0, 0 }
_G.GetCursorPosition = function() return cursor[1], cursor[2] end
local shift = false
_G.IsShiftKeyDown = function() return shift end
local buttons = { LeftButton = true }
_G.IsMouseButtonDown = function(button) return buttons[button] or false end
frame:Show()

Snap.Start(frame, {})
local driver
for _, candidate in ipairs(created) do
    if candidate:GetScript("OnUpdate") == Snap.Move then driver = candidate; break end
end
assert(driver, "the active drag has an update driver")
Expect("a drag is under way", Snap.Active(), frame)
cursor[1], cursor[2] = 50, -30
Snap.Move()
Expect("it follows the pointer", frame:GetLeft() .. "," .. frame:GetTop(), "350,470")
cursor[1], cursor[2] = -295, -30
Snap.Move()
Expect("...and holds at the screen's edge near it", frame:GetLeft(), 0)
shift = true
cursor[1] = -293
Snap.Move()
Expect("with Shift held it drags free", frame:GetLeft(), 7)
shift = false
Snap.Stop()
Expect("letting go ends the drag", Snap.Active(), nil)

local locked = false
Snap.Start(frame, { locked = function() return locked end })
locked = true
Snap.Move()
Expect("a window locked mid-drag is let go", Snap.Active(), nil)

local placements = 0
local function Place() placements = placements + 1 end
for i = 1, 20 do
    buttons.LeftButton, buttons.RightButton = true, false
    Snap.Start(frame, { place = Place })
    driver:GetScript("OnUpdate")()
    Expect("a held drag still moves, cycle " .. i, placements, i)
    buttons.LeftButton, buttons.RightButton = false, true
    cursor[1] = cursor[1] + 40
    -- No release event reaches the handle; another button is still held.
    driver:GetScript("OnUpdate")()
    Expect("release stops before moving again, cycle " .. i, placements, i)
    Expect("release clears the active drag, cycle " .. i, Snap.Active(), nil)
    Expect("release removes the update handler, cycle " .. i, driver:GetScript("OnUpdate"), nil)
end

Snap.Start(frame, { button = "RightButton", place = Place })
driver:GetScript("OnUpdate")()
Expect("a right-button drag follows its initiating button", placements, 21)
buttons.LeftButton, buttons.RightButton = true, false
driver:GetScript("OnUpdate")()
Expect("releasing right stops before another move while left stays held", placements, 21)
Expect("right-button release removes the update handler", driver:GetScript("OnUpdate"), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll snap tests passed")

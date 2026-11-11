-- The boss camera editor in Spoken Developer (Camera.lua): the hooks it hands Spoken's TextView, the
-- changes it keeps (rounded, one function for a drag, the wheel and a reset), editing that only
-- takes a model that has been framed, and /spokenbosscam. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local DEVELOPER = here .. "/../../addons/Spoken_Developer/"
local Expect, Failures = H.Expecter(print)

stub.ResetFrames()
H.Fresh(stub, SPOKEN)
Expect("a player, with no developer module, has no editor hooks",
    tostring(SpokenTextView.cameraEdits) .. "|" .. tostring(SpokenTextView.onCreate), "nil|nil")
local plain = SpokenTextView.Create(CreateFrame("Frame"))
Expect("...and a view made then has nothing to call", plain.onModel, nil)

local Dev = stub.LoadDeveloper(DEVELOPER)
local Camera = Dev.Camera
Expect("the module hands TextView the edits and the hook", type(SpokenTextView.cameraEdits) .. "|" .. type(SpokenTextView.onCreate),
    "function|function")
Expect("...keeps its edits in its own saved variable", type(_G.SpokenDeveloperDB.cameraEdits), "table")

local function Chat()
    local text = table.concat(stub.chat, "\n")
    for i = #stub.chat, 1, -1 do stub.chat[i] = nil end
    return text
end

_G.SpokenBossCameraGroups = { [2030] = 2029 }
-- A boss is framed from its actor's box once its model has loaded (the stub's default box is 2 high and 1
-- wide), on a frame of the shared watcher TextView makes with the first model, and not before. The camera
-- stands BASE from the middle of the box, and the box's middle is 1 up.
local BASE = tonumber(string.format("%.4f", 2 / (0.85 * 2 * math.tan(math.rad(27.78) / 2)) + 0.5))
local FRAMED = string.format("%g,0,1", BASE)
local watcher
local function Tick(elapsed) watcher.scripts.OnUpdate(watcher, elapsed or 0.02) end
local function Make(place)
    local view = SpokenTextView.Create(CreateFrame("Frame"))
    view.cameraPlace = place
    local counts = { n = 0 }
    -- The scene is told the camera once each time a boss is framed or edited.
    view.model.SetCameraPosition = function(_, x, y, z)
        counts.n = counts.n + 1
        counts.position = string.format("%g,%g,%g", tonumber(string.format("%.4f", x)),
            tonumber(string.format("%.4f", y)), tonumber(string.format("%.4f", z)))
    end
    return view, counts
end
local view, counts = Make()
Expect("a view made after the module loaded is taken in", type(view.onModel), "function")
do
    local made, create = {}, _G.CreateFrame
    _G.CreateFrame = function(...)
        local f = create(...)
        made[#made + 1] = f
        return f
    end
    view:SetModel({ displayID = 2029 })
    _G.CreateFrame = create
    for _, f in ipairs(made) do
        if f.scripts.OnUpdate then watcher = f end
    end
end
Expect("a boss has no camera to edit while its model loads", tostring(view.modelCamera) .. "|" .. counts.n, "nil|0")
Tick()
Expect("...and has one a frame after its box is known", FRAMED .. "|" .. counts.position, FRAMED .. "|" .. FRAMED)
counts.n = 0

local function Row(place, group)
    local edits = _G.SpokenDeveloperDB.cameraEdits
    local row = edits[place or "compendium"] and edits[place or "compendium"][group or 2029]
    return row and table.concat(row, ",") or nil
end

-- One function writes a change, rounded to four places.
Expect("an edit starts from no change", Row(), nil)
Expect("a drag is kept", Camera:Edit(view, 0.123456, 0.00004, 1, 0), true)
Expect("...rounded to four places", Row(), "0.1235,0,1,0")
Expect("...the model drawn again at once", counts.n, 1)
Camera:Edit(view, 0, 0, 2, 0.25)
Expect("a zoom multiplies, a turn adds", Row(), "0.1235,0,2,0.25")
Camera:Edit(view, 0.1, 0.2, 1, 0)
Expect("a move after a zoom counts in the frame as it is drawn, so half as far at the base", Row(), "0.1735,0.1,2,0.25")
Expect("TextView draws through what was kept", view:CameraNudge()[3], 2)
Expect("a reset is a change like any other, to no change", Camera:Reset(view) and Row(), "0,0,1,0")
_G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
view:SetModel({ displayID = 2029 })
Tick()
Expect("...and wins over a shipped nudge", counts.position, FRAMED)
_G.SpokenBossCameraNudges = nil

-- Bosses on one model file, in one place, move together; another place does not.
local sameGroup, sameCounts = Make()
sameGroup:SetModel({ displayID = 2030 })
local story, storyCounts = Make("story")
story:SetModel({ displayID = 2029 })
Tick()
sameCounts.n, storyCounts.n, counts.n = 0, 0, 0
Camera:Edit(view, 0.1, 0, 1, 0)
Expect("a boss on another display of the same model file is drawn again", sameCounts.n, 1)
Expect("...the one in another place is not", storyCounts.n, 0)
Expect("...and its change is kept under the file's group", Row("compendium", 2029) ~= nil and Row("compendium", 2030) == nil, true)
Expect("a place's edits are its own", Row("story", 2029), nil)

-- A model that has not been framed yet is not edited.
local bare, bareCounts = Make()
stub.actorLoaded = false
bare:SetModel({ displayID = 7 })
Tick(1)
Expect("nothing is written for a model that is still loading", tostring(Camera:Edit(bare, 0.1, 0, 1, 0)) .. "|" .. tostring(Row("compendium", 7)), "false|nil")
Expect("...nor for a view with no model", Camera:Edit(plain, 0.1, 0, 1, 0), false)

-- Editing: on for a model with a camera, off for the rest.
Expect("editing is off to begin with", Camera.editing, false)
local function Hooked(v)
    local scripts = v.model.scripts
    return (scripts.OnMouseDown and "d" or "-") .. (scripts.OnMouseUp and "u" or "-") .. (scripts.OnHide and "h" or "-")
        .. (scripts.OnUpdate and "p" or "-") .. (scripts.OnMouseWheel and "w" or "-")
end
Expect("a model is not given the mouse while editing is off", Hooked(view) .. "|" .. tostring(view.model.mouseEnabled), "-----|false")
Camera:SetEditing(true)
Expect("with editing on, a boss with a camera takes the drag, the wheel and a hide",
    Hooked(view) .. "|" .. tostring(view.model.mouseEnabled), "duhpw|true")
Expect("...a model still loading takes none of them", Hooked(bare) .. "|" .. tostring(bare.model.mouseEnabled), "-----|false")
stub.actorLoaded = true
Tick()
Expect("...until it has been framed", Hooked(bare), "duhpw")
stub.actorLoaded = false
bare:SetModel({ displayID = 8 })
Expect("...and not once it shows another that has not loaded", Hooked(bare) .. "|" .. tostring(bare.model.mouseEnabled), "-----|false")
bare:SetModel(nil)
stub.actorLoaded = true
view:SetModel({ displayID = 2030 })
Expect("a boss shown after another while editing is not edited until it is framed", Hooked(view), "-----")
Tick()
Expect("...and is then", Hooked(view), "duhpw")

-- The drag, the right-drag and the wheel go through Edit.
local cx, cy = 100, 100
_G.GetCursorPosition = function() return cx, cy end
local high = view.model:GetHeight() * view.model:GetEffectiveScale()
Camera:Reset(view)
view.model.scripts.OnMouseDown(view.model, "LeftButton")
cx, cy = 100 + high * 0.1, 100 + high * 0.05
view.model.scripts.OnUpdate(view.model)
Expect("dragging moves the boss by the frame heights dragged", Row(), "0.1,0.05,1,0")
view.model.scripts.OnMouseUp(view.model)
cx = cx + high
view.model.scripts.OnUpdate(view.model)
Expect("...and stops when the button is let go", Row(), "0.1,0.05,1,0")
view.model.scripts.OnMouseDown(view.model, "RightButton")
cx = cx + high * 0.1
view.model.scripts.OnUpdate(view.model)
Expect("a right-drag turns it", Row(), "0.1,0.05,1,0.3")
view.model.scripts.OnHide(view.model)
cx = cx + high
view.model.scripts.OnUpdate(view.model)
Expect("...and stops when the model is hidden", Row(), "0.1,0.05,1,0.3")
view.model.scripts.OnMouseWheel(view.model, 1)
Expect("the wheel zooms by a small step", Row(), "0.1,0.05,1.03,0.3")
view.model.scripts.OnMouseWheel(view.model, -1)
Expect("...either way", Row(), "0.1,0.05,1,0.3")
Camera:Edit(view, 0, 0, 100, 0)
Expect("a zoom stops at 8 times the framing", Row(), "0.1,0.05,8,0.3")
Camera:Edit(view, 0, 0, 0.0001, 0)
Expect("...and at a quarter of it, never at a row TextView would ignore", Row(), "0.1,0.05,0.25,0.3")
Expect("...which TextView still draws through", view:CameraNudge() ~= nil and view:CameraNudge()[3], 0.25)
Camera:Edit(view, 0, 0, 4, 0)
Expect("...and zooms back from there", Row(), "0.1,0.05,1,0.3")

-- The guide frame over the model.
local createFrame = _G.CreateFrame
Camera:SetEditing(false)
Expect("with editing off nothing is hooked, the mouse is given back and the hide script is gone",
    Hooked(view) .. "|" .. tostring(view.model.mouseEnabled), "-----|false")
local guided = Make()
guided:SetModel({ displayID = 2029 })
Tick()
local made
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if parent == guided.modelEdgeFrame then made = frame end
    return frame
end
Camera:SetEditing(true)
_G.CreateFrame = createFrame
Expect("a guide is drawn over a boss being edited, with a hint naming the place and the model",
    made ~= nil and made:IsShown() and made.hint.text:find("compendium 2029: drag to move", 1, true) ~= nil, true)
Camera:SetEditing(false)
Expect("...and hidden when editing stops", made:IsShown(), false)
Camera:SetEditing(true)
Expect("...shown again when it starts", made:IsShown(), true)

-- A guide that cannot be built is said once in chat; the boss can still be edited.
local failing = SpokenTextView.Create(CreateFrame("Frame"))
failing.model.SetCameraPosition = function() end
_G.CreateFrame = function(kind, name, parent, template)
    if parent == failing.modelEdgeFrame then error("no frames today") end
    return createFrame(kind, name, parent, template)
end
Chat()
failing:SetModel({ displayID = 2029 })
Tick()
failing:SetModel({ displayID = 2029 })
Tick()
_G.CreateFrame = createFrame
local said = Chat()
local _, times = said:gsub("camera guide could not be built", "")
Expect("a guide that fails to build is said once", times, 1)
Expect("...and the boss is still editable", Hooked(failing), "duhpw")

-- /spokenbosscam
local function Say(msg) SlashCmdList.SPOKENBOSSCAM(msg); return Chat() end
Expect("the command has a short form", _G.SLASH_SPOKENBOSSCAM1 .. " " .. _G.SLASH_SPOKENBOSSCAM2, "/spokenbosscam /spbc")
Expect("count says how many models have a change", Say("count"):find("models changed by hand: 1", 1, true) ~= nil, true)
view.model:Show()
bare.model:Hide()
story.model:Hide()
sameGroup.model:Hide()
failing.model:Hide()
Camera:Edit(view, 0.3, 0, 1, 0)
Expect("reset drops the change of the boss in view", Say("reset"):find("reset the boss in view", 1, true) ~= nil and Row(), "0,0,1,0")
view.model:Hide()
Expect("...and says so when none is in view", Say("reset"):find("no boss with a camera is in view", 1, true) ~= nil, true)
Expect("an unknown word says the usage", Say("nonsense"):find("/spokenbosscam [on | off | reset | count]", 1, true) ~= nil, true)
Expect("no word switches editing off when it is on", Say(""):find("camera editing off", 1, true) ~= nil and Camera.editing, false)
Expect("...and on when it is off", Say(""):find("camera editing on", 1, true) ~= nil and Camera.editing, true)
Expect("off and on say what they do", (Say("off"):find("editing off", 1, true) ~= nil) and (Say("on"):find("editing on", 1, true) ~= nil), true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll developer camera tests passed")

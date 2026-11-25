-- Looks another addon registers for the Small and the Large Window (Spoken:RegisterLook): offered
-- under Theme, asked for every line while chosen, and drawn by Spoken, which keeps its own art for a
-- line the look gives nothing for or fails on. How a look looks is checked in game.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
_G.UISpecialFrames = _G.UISpecialFrames or {}
local env = stub.LoadSpoken(SPOKEN)
env.Addon.db.profile.Frame.Style = "minimal"
local Spoken, M, P, Looks = _G.Spoken, env.MinimalPlayer, env.PlayerFrame, env.Looks
local frame = env.Addon.db.profile.Frame

-- Suggested before Spoken has its settings: kept, and asked once it has them.
local TRIM = { horizontal = "Edge", vertical = "EdgeV", corner = "Join", size = 14 }
local asked, answer = {}, nil
local function Look(clip, window)
    table.insert(asked, window .. " " .. clip.key)
    if answer == "throw" then error("broken look") end
    return answer
end
Spoken:RegisterLook("trim", { name = "Trim", windows = { "small", "large" }, Look = Look,
    settings = function(layout)
        layout:Section("Trim")
        layout:Checkbox("Trim Everything", nil, function() return true end, function() end)
    end })
Spoken:SuggestLook("trim")
Expect("a suggestion before Spoken has its settings asks nothing yet", #stub.popups, 0)
env.Addon:Enable()
Expect("...and asks once it has them", #stub.popups, 1)
local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
local function Line(key)
    return H.Clip({ key = key, length = 30, present = { header = "Grull", label = "One", transcript = "Words here.",
        portrait = { kind = "none" } } })
end

---------------------------------------------------------------- registering
local function Raises(fn) return not pcall(fn) end
Expect("a look needs a name, its windows and Look", tostring(Raises(function() Spoken:RegisterLook("x", { name = "X" }) end))
    .. " " .. tostring(Raises(function() Spoken:RegisterLook("x", { name = "X", windows = { "subtitle" }, Look = Look }) end))
    .. " " .. tostring(Raises(function() Spoken:RegisterLook("x", { name = "X", windows = {}, Look = Look }) end)), "true true true")
Expect("Supports names looks", Spoken:Supports("looks"), true)
Expect("the Small Window's Theme lists it after Spoken's own", table.concat(Looks:Values("small"), ","), "parchment,dark,trim")
Expect("...and the Large Window's, after its own", table.concat(Looks:Values("large"), ","), "default,trim")

---------------------------------------------------------------- the Small Window
quests:Enqueue(Line("q1"))
Expect("not chosen, its Look is never asked", #asked, 0)
Expect("...and the window stays on parchment", M.paper.texture, [[Interface\AddOns\Spoken\Textures\MinimalParchment]])

stub.popups[1].dialog.OnAccept()
Expect("taking the suggestion chooses it for each of its windows", frame.MinimalBackground .. " " .. frame.ClassicLook, "trim trim")
Spoken:SuggestLook("trim")
Expect("...and it is never suggested again", #stub.popups, 1)

answer = { tint = { .1, .2, .3, .7 }, border = TRIM, ring = { .5, .6, .7 } }
Spoken:RefreshLook()
Expect("chosen, Look is asked for the line shown, in the Small Window", asked[#asked], "small q1")
Expect("...the rock under its tint", M.paper.texture .. " " .. tostring(M.tint:IsShown()),
    [[Interface\AddOns\Spoken\Textures\MinimalBackground true]])
Expect("...its border in place of Spoken's edge", tostring(M.trim.topLeft:IsShown()) .. " " .. M.trim.topLeft.texture .. " "
    .. M.trim.leftTop.texture .. " " .. M.trim.cornerTopLeft.texture .. " " .. M.panel.backdropBorderColor[4], "true Edge EdgeV Join 0")
Expect("...and the portrait's ring in its colour", table.concat(M.ring.vertexColor, " ", 1, 3), "0.5 0.6 0.7")

answer = { background = "Paper" }
Spoken:RefreshLook()
Expect("a look's own background, with no border, keeps Spoken's edge", M.paper.texture .. " " .. tostring(M.trim.topLeft:IsShown())
    .. " " .. M.panel.backdropBorderColor[4] .. " " .. tostring(M.tint:IsShown()), "Paper false 1 false")

answer = nil
Spoken:RefreshLook()
Expect("nil for a line: Spoken's own art, parchment", M.paper.texture .. " " .. tostring(M.trim.topLeft:IsShown()),
    [[Interface\AddOns\Spoken\Textures\MinimalParchment false]])
answer = "throw"
Spoken:RefreshLook()
Expect("a look that throws costs only its art: the line still shows", tostring(M.look) .. " " .. tostring(M.wanted), "nil true")
answer = { ring = "gold" }
Spoken:RefreshLook()
Expect("...and so does an answer Spoken cannot draw", tostring(M.look), "nil")

answer = { border = TRIM }
Spoken:StopAll()
quests:Enqueue(Line("q2"))
Expect("each new line is asked for", asked[#asked], "small q2")

---------------------------------------------------------------- the Large Window
env.Addon:SetPlayerStyle("classic")
answer = { background = "Box", tint = { 0, 0, 0, .5 }, border = TRIM, ring = { .2, .3, .4 } }
P:RefreshConfig()
Expect("the Large Window asks for its own", asked[#asked], "large q2")
Expect("...its box, wash, border and ring drawn", P.frame.background.texture .. " " .. tostring(P.frame.lookTint:IsShown()) .. " "
    .. tostring(P.frame.trim.topLeft:IsShown()) .. " " .. table.concat(P.frame.portrait.border.texture.vertexColor, " ", 1, 3),
    "Box true true 0.2 0.3 0.4")
answer = nil
Spoken:RefreshLook()
Expect("...and with none, Spoken's own again", tostring(P.frame.background.texture ~= "Box") .. " " .. tostring(P.frame.lookTint:IsShown())
    .. " " .. tostring(P.frame.trim.topLeft:IsShown()) .. " " .. table.concat(P.frame.portrait.border.texture.vertexColor, " ", 1, 3),
    "true false false 1 1 1")

---------------------------------------------------------------- its rows, and a look gone
env.Options:UpdateRows()
local main = _G.SpokenOptionsPanel.layout
main:Refresh()
local function Shown(label)
    for _, entry in ipairs(main.entries) do
        if entry.label == label then return entry.frame:IsShown() end
    end
    return "missing"
end
Expect("the look's own rows show while it is chosen", Shown("Trim Everything"), true)
Looks:Choose("large", "default")
main:Refresh()
Expect("...and not while another is", Shown("Trim Everything"), false)

frame.MinimalBackground, frame.ClassicLook = "gone", "gone"
Expect("a look whose addon is gone reads as Spoken's own", Looks:Chosen("small") .. " " .. Looks:Chosen("large"),
    "parchment default")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll look tests passed")

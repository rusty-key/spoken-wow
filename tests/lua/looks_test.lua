-- Narrator styles another addon registers (Spoken:RegisterLook): a card of their own among Spoken's,
-- drawn in the Small or the Large Window, asked for every line while chosen, and drawn by Spoken,
-- which keeps the window's own art for a line the look gives nothing for or fails on. How a look
-- looks is checked in game.
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
-- Whatever style the player has: a look offers itself all the same.
env.Addon.db.profile.Frame.Style = "subtitle"
local Spoken, M, P = _G.Spoken, env.MinimalPlayer, env.PlayerFrame
local frame = env.Addon.db.profile.Frame

local TRIM = { horizontal = "Edge", vertical = "EdgeV", corner = "Join", size = 14 }
local asked, answer = {}, nil
local function Look(clip, window)
    table.insert(asked, window .. " " .. clip.key)
    if answer == "throw" then error("broken look") end
    return answer
end
Spoken:RegisterLook("trim", { title = "Trim", description = "Trimmed by race.", window = "small", Look = Look,
    settings = function(layout)
        layout:Section("Trim")
        layout:Checkbox("Trim Everything", nil, function() return true end, function() end)
    end })
Spoken:RegisterLook("trim-large", { title = "Trim, Large", description = "Trimmed and bigger.", window = "large", Look = Look })
Spoken:SuggestLook("trim")
Expect("a suggestion before Spoken has its settings asks nothing yet", #stub.popups, 0)
env.Addon:Enable()
Expect("...and asks once it has them, under any style", #stub.popups, 1)
local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
local function Line(key)
    return H.Clip({ key = key, length = 30, present = { header = "Grull", label = "One", transcript = "Words here.",
        portrait = { kind = "none" } } })
end

---------------------------------------------------------------- registering
local function Raises(fn) return not pcall(fn) end
local function Info(fields)
    local info = { title = "X", description = "Y", window = "small", Look = Look }
    for k, v in pairs(fields) do info[k] = v end
    return info
end
Expect("a look needs a title, a description, a window and Look", tostring(Raises(function() Spoken:RegisterLook("x", { title = "X" }) end))
    .. " " .. tostring(Raises(function() Spoken:RegisterLook("x", Info({ window = "subtitle" })) end))
    .. " " .. tostring(Raises(function() Spoken:RegisterLook("x", Info({ description = false })) end)), "true true true")
Expect("...and cannot take one of Spoken's own styles' names", Raises(function() Spoken:RegisterLook("minimal", Info({})) end), true)
Expect("Supports names looks", Spoken:Supports("looks"), true)
Expect("each is a narrator style of its own, before Voice Only", table.concat(env.Options:Styles(), ","),
    "subtitle,minimal,classic,trim,trim-large,none")
local card = env.Options:StyleCard("trim")
Expect("...its card in its own words, over its window's sketch", card.title .. " / " .. card.text .. " "
    .. tostring(card.art == env.Options.SKETCHES.minimal), "Trim / Trimmed by race. true")

---------------------------------------------------------------- the Small Window
quests:Enqueue(Line("q1"))
Expect("not chosen, its Look is never asked", #asked, 0)

stub.popups[1].dialog.OnAccept()
Expect("taking the suggestion makes it the narrator style", frame.Style .. " " .. env.Addon:StyleChoice() .. " "
    .. env.Addon:PlayerStyle(), "trim trim minimal")
Spoken:SuggestLook("trim")
Expect("...and it is never suggested again", #stub.popups, 1)
Expect("Look is asked for the line shown, in its window", asked[#asked], "small q1")

answer = { tint = { .1, .2, .3, .7 }, border = TRIM, ring = { .5, .6, .7 } }
Spoken:RefreshLook()
Expect("drawn: the rock under its tint", M.paper.texture .. " " .. tostring(M.tint:IsShown()),
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
Expect("nil for a line: the window's own art, its Theme's", M.paper.texture .. " " .. tostring(M.trim.topLeft:IsShown()),
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

---------------------------------------------------------------- its rows
env.Options:UpdateRows()
local main = _G.SpokenOptionsPanel.layout
main:Refresh()
local function Shown(label)
    for _, entry in ipairs(main.entries) do
        if entry.label == label then return entry.frame:IsShown() end
    end
    return "missing"
end
Expect("the look's own rows show while it is the style", Shown("Trim Everything"), true)

---------------------------------------------------------------- the Large Window
env.Addon:SetPlayerStyle("trim-large")
answer = { background = "Box", tint = { 0, 0, 0, .5 }, border = TRIM, ring = { .2, .3, .4 } }
P:RefreshConfig()
main:Refresh()
Expect("a look of the Large Window draws there", asked[#asked] .. " " .. env.Addon:PlayerStyle(), "large q2 classic")
Expect("...its box, wash, border and ring", P.frame.background.texture .. " " .. tostring(P.frame.lookTint:IsShown()) .. " "
    .. tostring(P.frame.trim.topLeft:IsShown()) .. " " .. table.concat(P.frame.portrait.border.texture.vertexColor, " ", 1, 3),
    "Box true true 0.2 0.3 0.4")
Expect("...and another look's rows hide", Shown("Trim Everything"), false)
answer = nil
Spoken:RefreshLook()
Expect("...and with none, Spoken's own again", tostring(P.frame.background.texture ~= "Box") .. " " .. tostring(P.frame.lookTint:IsShown())
    .. " " .. tostring(P.frame.trim.topLeft:IsShown()) .. " " .. table.concat(P.frame.portrait.border.texture.vertexColor, " ", 1, 3),
    "true false false 1 1 1")

---------------------------------------------------------------- previewed, and gone
env.Addon:SetPlayerStyle("classic")
env.Options:Preview("trim")
Expect("a look previewed shows in its window", env.Addon:DisplayStyle() .. " " .. tostring(env.Looks:Current()), "minimal trim")
env.Options:Preview(nil)
frame.Style = "gone"
Expect("a look whose addon is gone falls back to the Small Window", env.Addon:PlayerStyle() .. " " .. env.Addon:StyleChoice()
    .. " " .. tostring(env.Looks:Current()), "minimal minimal nil")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll look tests passed")

-- Narrator styles another addon registers and draws itself (Spoken:RegisterNarrator): a card of
-- their own among Spoken's, told what line to show while chosen, with Spoken's own windows put
-- away. How one looks is the addon's own.
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
-- Whatever style the player has: a narrator offers itself all the same.
env.Addon.db.profile.Frame.Style = "classic"
local Spoken, M, P = _G.Spoken, env.MinimalPlayer, env.PlayerFrame
local frame = env.Addon.db.profile.Frame

local told, failing = {}, false
local function Update(clip)
    table.insert(told, clip and clip.key or "nothing")
    if failing then error("broken narrator") end
end
local function Last() return told[#told] end
Spoken:RegisterNarrator("scroll", { title = "Scroll", description = "Words on a scroll.", picture = "Scroll", Update = Update,
    settings = function(layout)
        layout:Section("Scroll")
        layout:Checkbox("Roll Up", nil, function() return true end, function() end)
    end })
Spoken:RegisterNarrator("other", { title = "Other", description = "Another one.", Update = function() end })
Spoken:SuggestNarrator("scroll")
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
    local info = { title = "X", description = "Y", Update = Update }
    for k, v in pairs(fields) do info[k] = v end
    return info
end
Expect("a narrator needs a title, a description and Update",
    tostring(Raises(function() Spoken:RegisterNarrator("x", { title = "X" }) end)) .. " "
    .. tostring(Raises(function() Spoken:RegisterNarrator("x", Info({ description = false })) end)) .. " "
    .. tostring(Raises(function() Spoken:RegisterNarrator("x", Info({ picture = 5 })) end)), "true true true")
Expect("...and cannot take one of Spoken's own styles' names", Raises(function() Spoken:RegisterNarrator("minimal", Info({})) end), true)
Expect("Supports names narrators", Spoken:Supports("narrators"), true)
Expect("each is a narrator style of its own, before Voice Only", table.concat(env.Options:Styles(), ","),
    "subtitle,minimal,classic,scroll,other,none")
local card = env.Options:StyleCard("scroll")
Expect("...its card in its own words, with its picture", card.title .. " / " .. card.text .. " " .. type(card.art),
    "Scroll / Words on a scroll. function")

---------------------------------------------------------------- chosen
quests:Enqueue(Line("q1"))
Expect("not chosen, it is never told anything", #told, 0)
Expect("...and the Large Window shows the line", P.shown and P.shown.key, "q1")

stub.popups[1].dialog.OnAccept()
Expect("taking the suggestion makes it the narrator style", frame.Style .. " " .. env.Addon:PlayerStyle(), "scroll scroll")
Spoken:SuggestNarrator("scroll")
Expect("...and it is never suggested again", #stub.popups, 1)
Expect("it is told the line to show", Last(), "q1")
Expect("...and none of Spoken's windows shows it", tostring(P:IsShowing()) .. " " .. tostring(M:IsEnabled()) .. " "
    .. tostring(P.frame:IsShown()), "false false false")

quests:Enqueue(Line("q2"))
local before = #told
quests:Enqueue(Line("q3"))
Expect("a line queued behind tells it nothing new", #told, before)
Spoken:Skip()
Expect("the next line is told as it comes up", Last(), "q2")
Spoken:StopAll()
Expect("nothing left: told to show nothing", Last(), "nothing")

failing = true
quests:Enqueue(Line("q4"))
Expect("a narrator that throws leaves the queue playing", tostring(Spoken:GetNowPlaying() and Spoken:GetNowPlaying().key), "q4")
failing = false

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
Expect("its own rows show while it is the style", Shown("Roll Up"), true)

---------------------------------------------------------------- switched away, previewed, gone
env.Addon:SetPlayerStyle("classic")
P:RefreshConfig()
main:Refresh()
Expect("another style chosen: told to show nothing, and Spoken's window back", Last() .. " " .. tostring(P.shown and P.shown.key),
    "nothing q4")
Expect("...and its rows hide", Shown("Roll Up"), false)
Spoken:StopAll()
env.Options:Preview("scroll")
Expect("previewed with nothing playing, it is told the sample line", Last(), "sample")
env.Options:Preview(nil)
Expect("...and to show nothing once the preview ends", Last(), "nothing")
frame.Style = "gone"
Expect("a narrator whose addon is gone falls back to the Small Window", env.Addon:PlayerStyle(), "minimal")

---------------------------------------------------------------- the status a narrator reads
quests:Enqueue(Line("q5"))
quests:Enqueue(Line("q6"))
Expect("Public status for a narrator of its own", Spoken:GetWaitingCount() .. " " .. tostring(Spoken:GetHeldReason(Spoken:GetNowPlaying()))
    .. " " .. tostring(Spoken:GetHeldReason(nil)) .. " " .. tostring(Spoken:CanPrevious()), "1 nil nil true")

---------------------------------------------------------------- Spoken's buttons and captions in a window of its own
do
    env.Addon:SetPlayerStyle("scroll")
    P:RefreshConfig()
    local window = CreateFrame("Frame", nil, UIParent)
    local stop, skip, back = Spoken:CreateControl(window, "stop"), Spoken:CreateControl(window, "skip"),
        Spoken:CreateControl(window, "previous")
    Expect("a control for a kind Spoken has not raises", not pcall(Spoken.CreateControl, Spoken, window, "teleport"), true)
    Expect("Stop reads Stop while a line speaks, and Skip can go on to the line waiting",
        stop.state .. " " .. skip:GetAlpha(), "stop 1")
    Spoken:Pause()
    Expect("...Replay once stopped, kept current by Spoken", stop.state, "replay")
    Spoken:Resume()
    Spoken:Skip()
    Expect("...and Skip greys out with no line waiting, while Back has the line skipped", skip:GetAlpha() .. " " .. back:GetAlpha(),
        "0.4 1")
    stop:GetScript("OnClick")(stop)
    Expect("Stop stops when clicked", Spoken:IsPaused(), true)
    Spoken:Resume()
    local height = Spoken:ShowCaptions(window, 300)
    Expect("the captions go in the window, as tall as the player's rows", tostring(env.Transcript.frame:GetParent() == window)
        .. " " .. tostring(height > 0) .. " " .. env.Transcript.frame:GetWidth(), "true true 300")
    Expect("ShowCaptions needs a frame and a width", not pcall(Spoken.ShowCaptions, Spoken, window), true)
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll narrator tests passed")

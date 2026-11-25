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
Spoken:RegisterNarrator("scroll", { addon = "ScrollAddon", title = "Scroll", description = "Words on a scroll.", picture = "Scroll", Update = Update,
    settings = function(layout)
        layout:Section("Scroll")
        layout:Checkbox("Roll Up", nil, function() return true end, function() end)
    end })
Spoken:RegisterNarrator("other", { addon = "OtherAddon", title = "Other", description = "Another one.", Update = function() end })
-- Two offers from two addons, made as they load: one window between them, once the world is up.
env.Addon.db.global.Welcomed = true
Spoken:SuggestNarrator("scroll")
Spoken:SuggestNarrator("other")
local Offer = env.NarratorOffer
local function Offered()
    local values = {}
    for _, row in ipairs(Offer.styles or {}) do table.insert(values, row.layoutTile.value) end
    return table.concat(values, ",")
end
env.Addon:Enable()
Expect("offers made as the addons load wait for the world", tostring(Offer.frame), "nil")
stub.Advance(2)
Expect("...then come in one window, under any style, with the style the player has to keep",
    tostring(Offer.frame:IsShown()) .. " " .. Offered(), "true classic,scroll,other")
Expect("...named \"Keep\" and its own name", Offer.styles[1].layoutTile.title, format(env.L.NARRATOR_OFFER_KEEP_FMT, env.L.OPT_STYLE_CLASSIC))
Expect("the window names the addons that offer them", env.NarratorOffer.Intro({ "scroll", "other" }),
    format(env.L.NARRATOR_OFFER_ADDONS_FMT, "ScrollAddon, OtherAddon"))
local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
local function Line(key)
    return H.Clip({ key = key, length = 30, present = { header = "Grull", label = "One", transcript = "Words here.",
        portrait = { kind = "none" } } })
end

---------------------------------------------------------------- registering
local function Raises(fn) return not pcall(fn) end
local function Info(fields)
    local info = { addon = "LateAddon", title = "X", description = "Y", Update = Update }
    for k, v in pairs(fields) do info[k] = v end
    return info
end
Expect("a narrator needs its addon, a title, a description and Update",
    tostring(Raises(function() Spoken:RegisterNarrator("x", Info({ addon = false })) end)) .. " "
    .. tostring(Raises(function() Spoken:RegisterNarrator("x", Info({ description = false })) end)) .. " "
    .. tostring(Raises(function() Spoken:RegisterNarrator("x", Info({ picture = 5 })) end)), "true true true")
Expect("...and cannot take one of Spoken's own styles' names", Raises(function() Spoken:RegisterNarrator("minimal", Info({})) end), true)
Expect("Supports names narrators", Spoken:Supports("narrators"), true)
Expect("each is a narrator style of its own, before Voice Only", table.concat(env.Options:Styles(), ","),
    "subtitle,minimal,classic,scroll,other,none")
local card = env.Options:StyleCard("scroll")
Expect("...its card in its own words, with its picture, naming the addon it comes from",
    card.title .. " / " .. card.text .. " " .. type(card.art),
    format(env.L.NARRATOR_CARD_FMT, "Scroll", "ScrollAddon") .. " / Words on a scroll. function")

---------------------------------------------------------------- chosen
quests:Enqueue(Line("q1"))
Expect("not chosen, it is never told anything", #told, 0)
Expect("...and the Large Window shows the line", P.shown and P.shown.key, "q1")

Offer.styles[2]:GetScript("OnClick")(Offer.styles[2])
Expect("choosing one in it makes it the narrator style", frame.Style .. " " .. env.Addon:PlayerStyle(), "scroll scroll")
Offer.frame:Hide()
local first = Offer.frame
Spoken:SuggestNarrator("scroll")
Spoken:SuggestNarrator("other")
stub.Advance(2)
Expect("...and neither is offered again", tostring(Offer.frame:IsShown()) .. " " .. tostring(Offer.frame == first), "false true")
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

---------------------------------------------------------------- offered later
do
    Spoken:RegisterNarrator("late-a", Info({ title = "Late A" }))
    Spoken:RegisterNarrator("late-b", Info({ title = "Late B" }))
    Spoken:SuggestNarrator("late-a")
    stub.Advance(0.5)
    Spoken:SuggestNarrator("late-b")
    stub.Advance(1)
    Expect("offers made after login, close together, share one window", tostring(Offer.frame:IsShown()) .. " "
        .. Offered():gsub("^[^,]*,", ""), "true late-a,late-b")
    Expect("...one addon's two styles said as its styles, one style as its style",
        env.NarratorOffer.Intro({ "late-a", "late-b" }) .. " | " .. env.NarratorOffer.Intro({ "late-a" }),
        format(env.L.NARRATOR_OFFER_STYLES_FMT, "LateAddon") .. " | " .. format(env.L.NARRATOR_OFFER_STYLE_FMT, "LateAddon"))
    Offer.frame:Hide()
    env.Addon.db.global.Welcomed = nil
    Spoken:RegisterNarrator("first-login", Info({ title = "First" }))
    Spoken:SuggestNarrator("first-login")
    stub.Advance(1)
    Expect("at a first login the welcome window, which lists every style, offers it instead",
        tostring(Offer.frame:IsShown()) .. " " .. tostring(env.Addon.db.global.SuggestedNarrators["first-login"]), "false true")
    env.Addon.db.global.Welcomed = true
end

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
    local pause = Spoken:CreateControl(window, "pause")
    Expect("Pause hides on a line kept whole", pause:IsShown(), false)
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
    quests:Enqueue(H.Clip({ key = "kept", pieces = "2 2 2", present = { transcript = "Kept as sentences. Two of them." } }))
    Spoken:Skip()
    Expect("...shows on one kept as sentences", pause:IsShown(), true)
    pause:GetScript("OnClick")(pause)
    Expect("...and pauses it there when clicked", env.SoundQueue:HaltedBy(), "pause")
    Spoken:Resume()
    local height = Spoken:ShowCaptions(window, 300)
    Expect("the captions go in the window, as tall as the player's rows", tostring(env.Transcript.frame:GetParent() == window)
        .. " " .. tostring(height > 0) .. " " .. env.Transcript.frame:GetWidth(), "true true 300")
    Expect("ShowCaptions needs a frame and a width", not pcall(Spoken.ShowCaptions, Spoken, window), true)

    local portrait = Spoken:CreatePortrait(window, 84)
    portrait:SetClip(H.Clip({ present = { bullet = "quest-accept", portrait = { kind = "none" } } }))
    Expect("the portrait shows the line's badge on its ring, as Spoken's windows do",
        tostring(portrait.badge:IsShown()) .. " " .. tostring(portrait.badge:GetTexture() == env.Face.BADGES["quest-accept"]), "true true")
    portrait:SetRingColor(.1, .2, .3)
    Expect("...its ring in the narrator's colour", table.concat(portrait.ring.vertexColor, " ", 1, 3), "0.1 0.2 0.3")
    portrait:SetClip(nil)
    Expect("...and no badge with no line", portrait.badge:IsShown(), false)

    local clicked
    local report = { id = "report", icon = "Bug", label = "Report", onClick = function(clip) clicked = clip.key end }
    local row = Spoken:CreateActions(window)
    local line = H.Clip({ key = "with-report", present = { actions = { report, { id = "stopGossip", anchor = "header",
        create = function(parent) return CreateFrame("Button", nil, parent) end } } } })
    row:SetClip(line)
    local function Shown()
        local names = {}
        for _, button in ipairs(row.actions.buttons) do
            if button:IsShown() then table.insert(names, button.action.id) end
        end
        return table.concat(names, ",")
    end
    Expect("the line's own buttons go in the row, a header's left out", Shown() .. " " .. tostring(row:GetWidth() > 1), "report true")
    row.actions.buttons[1]:GetScript("OnClick")(row.actions.buttons[1])
    Expect("...and act on the line", clicked, "with-report")
    frame.HiddenActions = { report = true }
    row:SetClip(line)
    Expect("...minus those the player hid", Shown(), "")
    frame.HiddenActions = {}
end

---------------------------------------------------------------- who speaks
do
    local source = env.Sources:Register("speaking", { title = "S", addon = "S", order = 98,
        speaker = function() return { creatureID = 7, sex = "female", body = "nightelf-female", race = "nightelf" } end })
    local clip = H.Clip({ source = source, present = { portrait = { kind = "model", creatureID = 9 } } })
    local known = Spoken:GetSpeaker(clip)
    Expect("GetSpeaker answers what the line's module knows",
        known.creatureID .. " " .. known.sex .. " " .. known.body .. " " .. known.race, "7 female nightelf-female nightelf")
    local plain = Spoken:GetSpeaker(H.Clip({ present = { portrait = { kind = "model", creatureID = 9 } } }))
    Expect("...a line whose module knows nothing, its portrait's creature", plain.creatureID .. " " .. tostring(plain.race), "9 nil")
    Expect("...and nothing for what is no line", Spoken:GetSpeaker(nil), nil)
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll narrator tests passed")

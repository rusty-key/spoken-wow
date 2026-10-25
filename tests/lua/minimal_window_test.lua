-- The small window ("minimal" narrator style): its header, words and progress line, its
-- background, and the bronze. How it looks is checked in game.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

local function Boot(client)
    stub.SetClient(client or "16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    _G.UISpecialFrames = _G.UISpecialFrames or {}
    local env = stub.LoadSpoken(SPOKEN)
    -- LoadSpoken picks the large window for the other suites.
    env.Addon.db.profile.Frame.Style = "minimal"
    env.Addon.db.profile.Transcript.SubtitleProgress = true
    env.Addon:Enable()
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
    return env, quests
end

local REPORT = { id = "report", icon = "Interface/HelpFrame/HelpIcon-Bug", anchor = "topright",
    label = "Report a problem" }
local function Line(label, header, actions)
    return H.Clip({ length = 30, present = { header = header or "Grull", label = label,
        transcript = "The kobolds dig deeper into the mine every night.", portrait = { kind = "none" },
        actions = actions } })
end

---------------------------------------------------------------- its header, as the DialogueUI window's
-- What `fn` reads, or the error reading it: a window without these parts fails each check.
local function Try(fn)
    local ok, value = pcall(fn)
    if ok then return value end
    return "error: " .. tostring(value)
end
local env, quests = Boot()
local M, T, L = env.MinimalPlayer, env.Transcript, env.L
quests:Enqueue(Line("One", "Grull", { REPORT }))
quests:Enqueue(Line("Two"))
Expect("the small window shows the line", M.wanted and M.clip ~= nil, true)
Expect("it has the DialogueUI window's round controls, Stop or Replay then Skip", Try(function()
    return M.controls ~= nil and M.play:GetParent() == M.controls and M.skip:GetParent() == M.controls
        and M.skip.bar ~= nil and M.row[1] == M.play and M.row[2] == M.skip end), true)
Expect("...in its header, at the right", Try(function() return M.controls.anchor.point == "RIGHT"
    and M.controls.anchor.relativeTo == M.content and M.controls.anchor.relativePoint == "TOPRIGHT" end), true)
Expect("...Report after Skip, in the header and as large", Try(function()
    local report = M.row[3]
    return report:GetParent() == M.controls and report:GetWidth() == M.play:GetWidth() end), true)
Expect("...the name and the title stopping short of them", Try(function() return M.controls ~= nil
    and M.name.anchor.relativeTo == M.controls and M.title.anchor.relativeTo == M.controls end), true)
Expect("no Stop on the face: the header's is the one", M.pause, nil)
Expect("no fold and no list of the lines waiting", tostring(M.fold) .. " " .. tostring(M.drawer) .. " " .. tostring(M.rows),
    "nil nil nil")
Expect("...nor a queue entry in its menu", M.menuQueue, nil)
Expect("the line's title is a name, nothing to click", M.title:GetObjectType(), "Frame")
Expect("the title counts the lines waiting, after it", Try(function() return M.title.text:GetText() .. "|"
    .. tostring(M.count:IsShown()) .. "|" .. M.count:GetText() end), "One|true|• +1")
Expect("...fading in as the line is added", Try(function() return M.count:GetAlpha() < 1 end), true)
M:Tick(0.3)
Expect("...all the way", Try(function() return M.count:GetAlpha() end), 1)
_G.GameTooltip.AddDoubleLine = function(self, left, right) self:AddLine(left .. "|" .. right) end
Expect("the count lists the lines waiting under the pointer, who says each beside it", Try(function()
    local hover = M.tail.hover
    hover.scripts.OnEnter(hover)
    return tostring(hover:IsShown()) .. " " .. table.concat(_G.GameTooltip.lines, ", ")
end), "true " .. L.WAITING_TITLE .. ", Two|Grull")
Expect("...and does nothing when clicked", Try(function()
    local scripts = M.tail.hover.scripts
    return tostring(scripts.OnMouseUp) .. " " .. tostring(scripts.OnMouseDown) .. " " .. tostring(scripts.OnClick)
end), "nil nil nil")

pcall(function() M.play.scripts.OnClick(M.play) end)
Expect("Stop stops the line, its glyph turning to Replay", Try(function() return tostring(env.SoundQueue:IsPaused())
    .. " " .. tostring(M.play.state) end), "true replay")
Expect("...and the title says it is stopped, after the line's name", Try(function()
    return tostring(M.stopped:IsShown()) .. "|" .. M.stopped:GetText() end), "true|• (" .. L.SUBTITLE_STOPPED .. ")")
Expect("...fading in", Try(function() return M.stopped:GetAlpha() < 1 end), true)
M:Tick(0.3)
Expect("...all the way", Try(function() return M.stopped:GetAlpha() end), 1)
pcall(function() M.play.scripts.OnClick(M.play) end)
M:Tick(0.4)
Expect("Replay plays it again, Stopped fading out", Try(function()
    return tostring(M.play.state) .. " " .. tostring(M.stopped:IsShown()) end), "stop false")

Expect("the words sit under the name and the title", Try(function() return T.frame:GetParent() == M.frame
    and T.frame.anchor.relativeTo == M.content and T.frame.anchor.y <= -(M.name:GetHeight() + M.title:GetHeight()) end), true)
Expect("the progress line is the subtitle's, along the foot of the words", Try(function()
    return M.progress.track:GetParent() == M.content and M.progress.track.anchor.y < T.frame.anchor.y - T.frame:GetHeight() end),
    true)
Expect("...as wide as they are", Try(function() return M.progress.track:GetWidth() end), T.frame:GetWidth())
do
    local tall = M.frame:GetHeight()
    env.Addon.db.profile.Transcript.SubtitleProgress = false
    env.PlayerFrame:RefreshConfig()
    Expect("Show Progress off, the line goes and the window closes up, as on the DialogueUI window", Try(function()
        return tostring(M.progress.track:IsShown()) .. " " .. tostring(M.frame:GetHeight() < tall) end), "false true")
    env.Addon.db.profile.Transcript.SubtitleProgress = true
    env.PlayerFrame:RefreshConfig()
end
do
    local tall = M.frame:GetHeight()
    env.Addon.db.profile.Transcript.ShowWords = false
    env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    Expect("Show Words off, the window stays with its name and controls and lists the queue in the words' place",
        Try(function()
            return tostring(M.frame:IsShown()) .. " " .. M.name:GetText() .. " " .. tostring(M.play:IsShown()) .. " "
                .. tostring(T.frame:IsShown()) .. " " .. T.labels[1]:GetText():gsub("^|c%x+", "") .. " "
                .. T.labels[2]:GetText() .. " " .. tostring(T.labels[3]:IsShown()) end), "true Grull true true One|r Two false")
    env.Addon.db.profile.Transcript.Lines = 1
    env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    Expect("...as many as Rows at Once", Try(function()
        return tostring(T.labels[2]:IsShown()) .. " " .. tostring(M.frame:GetHeight() < tall) end), "false true")
    env.Addon.db.profile.Transcript.Lines = 2
    env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    quests:Enqueue(Line("Three"))
    T:Update()
    Expect("...a line added waits past the rows", Try(function() return T.labels[2]:GetText() .. " "
        .. tostring(T.labels[3]:IsShown()) end), "Two false")
    env.SoundQueue:RemoveSoundFromQueue(env.SoundQueue:GetQueue()[2])
    T:Update()
    Expect("...and one taken out lets the next up", Try(function() return T.labels[2]:GetText() end), "Three")
    env.Addon.db.profile.Transcript.ShowWords = true
    env.PlayerFrame:RefreshConfig(); T:RefreshConfig()
    Expect("...and on again, the words are back", Try(function()
        return tostring(T.frame:IsShown()) .. " " .. tostring(M.frame:GetHeight() == tall) end), "true true")
end

local first = env.SoundQueue:GetCurrentSound()
pcall(function() M.skip.scripts.OnClick(M.skip) end)
Expect("Skip goes on to the next line", env.SoundQueue:GetCurrentSound() ~= nil and env.SoundQueue:GetCurrentSound() ~= first, true)
Expect("...the count gone with no line waiting", Try(function() return M.count:IsShown() end), false)
env.SoundQueue:RemoveAllSoundsFromQueue()
quests:Enqueue(Line("Grull", "Grull"))
Expect("a name the same as the line's is said once", M.name:GetText() .. "|" .. M.title.text:GetText(), "|Grull")
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- its background
-- What each part was last painted: the stub keeps no colours of its own.
local function Colour(r, g, b) return string.format("%.2f %.2f %.2f", r, g, b) end
local function Record(widget)
    widget.SetTextColor = function(self, r, g, b) self.colour = Colour(r, g, b) end
    widget.SetVertexColor = function(self, r, g, b) self.colour = Colour(r, g, b) end
    widget.SetAtlas = function(self, atlas) self.atlas, self.texture, self.colour = atlas, nil, nil end
    widget.SetTexture = function(self, texture) self.texture, self.atlas, self.colour = texture, nil, nil end
    widget.SetColorTexture = function(self, r, g, b) self.colour, self.atlas, self.texture = Colour(r, g, b), nil, nil end
    return widget
end
local INK, RED = "0.19 0.17 0.13", "|cff9c1a1a"
env, quests = Boot()
M, T, L = env.MinimalPlayer, env.Transcript, env.L
local frame = env.Addon.db.profile.Frame
Expect("the small window is on parchment unless the player chooses otherwise", frame.MinimalBackground, "parchment")
for _, part in ipairs({ M.paper, M.name, M.title.text, M.count, M.ring }) do Record(part) end
quests:Enqueue(Line("One", "Grull"))
env.PlayerFrame:RefreshConfig()
Expect("...Spoken's own parchment, which every client draws: the retail atlases are listed without their art",
    tostring(M.paper.atlas) .. " " .. tostring(M.paper.texture), [[nil Interface\AddOns\Spoken\Textures\MinimalParchment]])
Expect("...the name and the title in the DialogueUI window's parchment ink", tostring(M.name.colour) .. "|"
    .. tostring(M.title.text.colour), INK .. "|" .. INK)
Expect("...the words too, unshadowed, the word being read in its red", tostring(T.style and Colour(T.style.color[1], T.style.color[2],
    T.style.color[3])) .. " " .. tostring(T.style and T.style.shadow) .. " " .. tostring(T.style and T.style.highlight),
    INK .. " false " .. RED)
frame.MinimalBackground = "dark"
env.PlayerFrame:RefreshConfig()
Expect("Dark is the rock it always had", M.paper.texture, [[Interface\AddOns\Spoken\Textures\MinimalBackground]])
Expect("...with the gold name and the light words", tostring(M.name.colour) .. "|" .. tostring(M.title.text.colour) .. "|"
    .. tostring(T.style),
    "1.00 0.82 0.00|0.88 0.84 0.76|nil")
frame.MinimalBackground = "parchment"

env.PlayerFrame:RefreshConfig()
Expect("...back on its parchment from the rock, whole, not tiled", tostring(M.paper.texture) .. " " .. tostring(M.paper.horizTile),
    [[Interface\AddOns\Spoken\Textures\MinimalParchment nil]])
env.SoundQueue:RemoveAllSoundsFromQueue()

-- The setting, on Spoken's page, for the small window only.
env.Options:UpdateRows()
local main = _G.SpokenOptionsPanel.layout
local function Row(label)
    for _, entry in ipairs(main.entries) do if entry.label == label then return entry.frame end end
end
main:Refresh()
-- Theme, the row the DialogueUI window's Theme shares its name with: the first of the two.
local row = Row(L.OPT_DUI_THEME)
Expect("Theme is on Spoken's page with the small window chosen", row ~= nil and row:IsShown(), true)
Expect("...offering Parchment and Dark", row and row.layoutValues and table.concat(row.layoutValues, ","), "parchment,dark")
pcall(function() row.layoutChoose("dark") end)
Expect("...choosing Dark there draws the rock", tostring(frame.MinimalBackground) .. " " .. tostring(M.paper.texture),
    [[dark Interface\AddOns\Spoken\Textures\MinimalBackground]])
pcall(function() row.layoutChoose("parchment") end)
env.Addon:SetPlayerStyle("classic")
main:Refresh()
Expect("...and not with another style", row ~= nil and row:IsShown(), false)
env.Addon:SetPlayerStyle("minimal")
main:Refresh()
Expect("Show Progress is offered for the small window, which has the progress line",
    Row(L.OPT_SUBTITLE_PROGRESS) ~= nil and Row(L.OPT_SUBTITLE_PROGRESS):IsShown(), true)

---------------------------------------------------------------- held
-- A line held at the head says why after its title, or it looks like narration that failed.
env, quests = Boot()
M = env.MinimalPlayer
quests:AddGate(function() return "in combat" end)
quests:Enqueue(Line("One"))
Expect("a held line says why after its title", Try(function()
    return tostring(M.held:IsShown()) .. " " .. M.held:GetText()
end), "true • (in combat)")
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- bronze
-- Bronze Border on Forever: the small window's border, progress line and portrait ring.
local BRONZE, WHITE = "0.95 0.68 0.35", "1.00 1.00 1.00"
local function Tints()
    return Try(function()
        return Colour(unpack(M.panel.backdropBorderColor)) .. "|" .. Colour(unpack(M.progress.tint))
            .. "|" .. tostring(M.ring.colour)
    end)
end
env, quests = Boot("16001")
M = env.MinimalPlayer
frame = env.Addon.db.profile.Frame
Record(M.ring)
quests:Enqueue(Line("One"))
frame.BronzeTint = true
env.PlayerFrame:RefreshConfig()
Expect("on Forever, with Bronze Border on, the border, progress line and portrait ring are bronze", Tints(),
    BRONZE .. "|" .. BRONZE .. "|" .. BRONZE)
frame.BronzeTint = false
env.PlayerFrame:RefreshConfig()
Expect("...each its own colour with it off", Tints(), WHITE .. "|" .. WHITE .. "|" .. WHITE)
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- Ctrl and the wheel, as the DialogueUI window
env, quests = Boot()
M = env.MinimalPlayer
frame = env.Addon.db.profile.Frame
local words = env.Addon.db.profile.Transcript
quests:Enqueue(Line("One"))
env.PlayerFrame:RefreshConfig()
local ctrl, shift = false, false
local hadCtrl, hadShift = _G.IsControlKeyDown, _G.IsShiftKeyDown
_G.IsControlKeyDown = function() return ctrl end
_G.IsShiftKeyDown = function() return shift end
local T = env.Transcript
T.manualScroll = false
T.frame:GetScript("OnMouseWheel")(T.frame, -1)
Expect("the wheel alone scrolls the words", T.manualScroll, true)
Expect("...the size untouched", frame.FrameScale, 0.7)
ctrl = true
T.frame:GetScript("OnMouseWheel")(T.frame, 1)
Expect("Ctrl and the wheel over the words grow Window Size", math.abs(frame.FrameScale - 0.75) < 1e-9, true)
Expect("...drawing it larger", math.abs((M.frame.scale or 0) - 0.75) < 1e-9, true)
Expect("...and saying so", _G.GameTooltip.text, env.L.OPT_SCALE .. ": 75%")
M.frame:GetScript("OnMouseWheel")(M.frame, -1)
Expect("...over the window too, and back", math.abs(frame.FrameScale - 0.7) < 1e-9, true)
shift = true
M.frame:GetScript("OnMouseWheel")(M.frame, 1)
Expect("Ctrl, Shift and the wheel grow Text Size", words.FontSize, 17)
Expect("...saying so", _G.GameTooltip.text, env.L.TRANSCRIPT_SIZE .. ": 17")
words.FontSize = 16
shift = false
frame.LockFrame = true
env.PlayerFrame:RefreshConfig()
T.manualScroll = false
T.frame:GetScript("OnMouseWheel")(T.frame, 1)
Expect("locked, Ctrl and the wheel leave Window Size alone", math.abs(frame.FrameScale - 0.7) < 1e-9, true)
Expect("...and scroll the words instead", T.manualScroll, true)
frame.LockFrame = false
-- The window takes the wheel only while Ctrl is held over it, unlocked: the camera zooms otherwise.
do
    local wheelOn
    local window = M.frame
    window.IsMouseOver = function() return true end
    window.EnableMouseWheel = function(_, on) wheelOn = on end
    window.spokenWheelOn = nil
    local function Poll() window:GetScript("OnUpdate")(window, 0) end
    ctrl = false
    Poll()
    Expect("the small window leaves the wheel to the camera without Ctrl", wheelOn, nil)
    ctrl = true
    Poll()
    Expect("...takes it while Ctrl is held over it", wheelOn, true)
    frame.LockFrame = true
    Poll()
    Expect("...gives it back while locked", wheelOn, false)
    frame.LockFrame = false
    Poll()
    Expect("...takes it again unlocked", wheelOn, true)
    window:Hide()
    window:GetScript("OnHide")(window)
    Expect("...and gives it back once it hides, Ctrl still held", wheelOn, false)
    window:Show()
    ctrl = false
    window.IsMouseOver, window.EnableMouseWheel, window.spokenWheelOn = nil, nil, nil
end
ctrl = false
_G.IsControlKeyDown, _G.IsShiftKeyDown = hadCtrl, hadShift
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- Reset Positions
-- The settings' button: every window's saved place goes, whichever style is shown, and the
-- subtitles' with them.
env, quests = Boot()
local places = env.Addon:Layout()
for _, key in ipairs({ "Player", "Minimal", "DialogueUI", "Subtitle" }) do places[key] = { left = 10, top = 500, width = 400 } end
local reset
-- On the Contribute & Report page, in Fix a Problem.
for _, entry in ipairs(_G.SpokenContributeOptionsPanel.layout.entries) do
    if entry.label == env.L.OPT_RESET then reset = entry.frame end
end
reset:GetScript("OnClick")(reset)
Expect("Reset Positions forgets every saved place, not only the window in use",
    tostring(places.Player) .. " " .. tostring(places.Minimal) .. " " .. tostring(places.DialogueUI)
    .. " " .. tostring(places.Subtitle), "nil nil nil nil")
env.SoundQueue:RemoveAllSoundsFromQueue()

-- Classic Era: no bronze frames to match, so its own colours whatever the setting.
env, quests = Boot("11509")
M = env.MinimalPlayer
frame = env.Addon.db.profile.Frame
Record(M.ring)
quests:Enqueue(Line("One"))
frame.BronzeTint = true
env.PlayerFrame:RefreshConfig()
Expect("on Classic Era, its own colours with Bronze Border on", Tints(), WHITE .. "|" .. WHITE .. "|" .. WHITE)
env.SoundQueue:RemoveAllSoundsFromQueue()

if Failures() > 0 then stub.print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
stub.print("\nAll small window tests passed")

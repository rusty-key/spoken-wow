-- Spoken's windows in EllesmereUI's look: only while EllesmereUI is loaded and its own look
-- ("EllesmereUI Style") is the one the UI wears. How it looks is checked in game.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

-- EllesmereUI as its skinning API meets Spoken: RegisterSkin keeps the callback it would run at
-- login, RenderedLook says the look, and every call of the skin is kept. `look` "absent" leaves
-- EllesmereUI out.
local function Boot(look)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    _G.UISpecialFrames = _G.UISpecialFrames or {}
    local eui = { calls = {} }
    if look == "absent" then
        _G.EllesmereUI = nil
    else
        _G.EllesmereUI = {
            RegisterSkin = function(name, fn) eui.name, eui.callback = name, fn end,
            RenderedLook = function() return look end,
        }
    end
    eui.skin = { GetAccentColor = function() return 0.05, 0.82, 0.62 end,
        GetPanelColor = function() return 0.08, 0.08, 0.08, 0.92 end,
        GetFont = function() return [[Interface\AddOns\EllesmereUI\media\fonts\Expressway.ttf]], "" end }
    for _, kind in ipairs({ "Shell", "Panel", "CloseButton", "Button", "WhiteButtonLabel", "Tab", "Inset", "EditBox", "Font", "White" }) do
        eui.skin[kind] = function(frame, opts)
            local call = { kind = kind, frame = frame, opts = opts }
            -- EllesmereUI reads the keys it is told to keep when it is called, so what the frame has by
            -- then is what it keeps.
            if kind == "Button" and opts then
                call.kept = {}
                for _, key in ipairs(opts) do if frame[key] then table.insert(call.kept, key) end end
            end
            table.insert(eui.calls, call)
            if eui.fail then error("no backdrop") end
        end
    end
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon.db.profile.Frame.Style = "minimal"
    env.Addon:Enable()
    return env, eui
end

-- The first call of `kind` on `frame`, and how many there were.
local CreateFrame = _G.CreateFrame
local function Dressed(eui, kind, frame)
    local first, count = nil, 0
    for _, call in ipairs(eui.calls) do
        if call.kind == kind and call.frame == frame then first = first or call; count = count + 1 end
    end
    return first, count
end

-- Every other window of Spoken's: the welcome window, the contribution window and the small
-- window's menu.
local function OtherWindows(env)
    if not env.Welcome.frame then env.Welcome:Build() end
    env.Spoken:ShowContribution(env.Spoken.Contribute:Envelope("quests", { { "quest", "9123" } }, "Words."), "https://x")
    return env.Welcome.frame, _G.SpokenContributeBox, env.MinimalPlayer.menu
end

local function Colour(r, g, b) return string.format("%.2f %.2f %.2f", r, g, b) end
local function Record(widget)
    widget.SetTextColor = function(self, r, g, b) self.colour = Colour(r, g, b) end
    widget.SetFont = function(self, face) self.face = face end
    return widget
end
local INK, WHITE = "0.19 0.17 0.13", "1.00 1.00 1.00"
local EUI_FONT = [[Interface\AddOns\EllesmereUI\media\fonts\Expressway.ttf]]

---------------------------------------------------------------- EllesmereUI absent
local env, eui = Boot("absent")
OtherWindows(env)
Expect("without EllesmereUI nothing registers and every window keeps Spoken's art",
    tostring(env.Ellesmere:On()) .. " " .. tostring(eui.callback) .. " " .. #eui.calls, "false nil 0")
Expect("...the detection says no look of its own", env.Ellesmere.OwnLook(nil), false)

---------------------------------------------------------------- a stock look, a mix
for _, look in ipairs({ "blizzard", "classic", "forever", false }) do
    env, eui = Boot(look)
    Expect("Spoken registers with EllesmereUI's skinning API under its own name (" .. tostring(look) .. ")",
        eui.name, "Spoken")
    Record(env.MinimalPlayer.name)
    eui.callback(eui.skin)
    env.PlayerFrame:RefreshConfig()
    OtherWindows(env)
    Expect("...under " .. tostring(look) .. " every window keeps Spoken's art, though EllesmereUI hands its skin",
        tostring(env.Ellesmere:On()) .. " " .. #eui.calls, "false 0")
    Expect("...the small window keeps its parchment ink", env.MinimalPlayer.name.colour, INK)
    local left
    local panel = env.MinimalPlayer.panel
    local setPoint = panel.SetPoint
    panel.SetPoint = function(self, point, rel, relPoint, x, ...)
        if point == "TOPLEFT" then left = x end
        return setPoint(self, point, rel, relPoint, x, ...)
    end
    env.MinimalPlayer:Layout()
    panel.SetPoint = setPoint
    Expect("...its panel starting behind the portrait's middle", left, 44)
    Expect("...and its round portrait and buttons", tostring(env.MinimalPlayer.portrait.squared) .. " "
        .. tostring(env.MinimalPlayer.play.squared), "nil nil")
    Expect("...and the welcome window its own scroll bar", tostring(env.Welcome.scroller.flatThumb), "nil")
end
Expect("a look EllesmereUI cannot tell counts as none of its own",
    env.Ellesmere.OwnLook({ RenderedLook = function() error("not ready") end }), false)

---------------------------------------------------------------- its skinning off for Spoken
env, eui = Boot("eui")
env.PlayerFrame:RefreshConfig()
OtherWindows(env)
Expect("with EllesmereUI's skinning of Spoken off, its callback never runs and nothing changes",
    tostring(env.Ellesmere:On()) .. " " .. #eui.calls, "false 0")
Expect("...what is built before the world is shown waits for it", #(env.Ellesmere.waiting or {}) > 0, true)
stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(0.1)
env.Ellesmere:Refont(env.MinimalPlayer.name)
Expect("...and once the world is shown without it, nothing waits any more", env.Ellesmere.waiting, nil)

---------------------------------------------------------------- EllesmereUI's own look
env, eui = Boot("eui")
local M, P = env.MinimalPlayer, env.PlayerFrame
Expect("the small window is built before the callback runs", M.panel ~= nil, true)
Record(M.name); Record(M.title.text)
local raised
M.portrait.SetFrameLevel = function(_, level) raised = level end
eui.callback(eui.skin)
Expect("under EllesmereUI's own look the small window's panel takes its window shell",
    Dressed(eui, "Shell", M.panel) ~= nil, true)
Expect("...without the title strip", Dressed(eui, "Shell", M.panel).opts.noTopBar, true)
Expect("...and its name white and its title light, as on EllesmereUI's windows, Parchment chosen or not",
    tostring(env.Addon.db.profile.Frame.MinimalBackground) .. " " .. tostring(M.name.colour) .. "|"
    .. tostring(M.title.text.colour), "parchment " .. WHITE .. "|0.85 0.85 0.85")
Expect("...its name and title in EllesmereUI's font", tostring(M.name.face) .. "|" .. tostring(M.title.text.face),
    EUI_FONT .. "|" .. EUI_FONT)
local look = env.Sources:Register("look", { title = "Look", addon = "Spoken_Quests", order = 9 })
look:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "One", transcript = "Words.",
    portrait = { kind = "none" } } }))
env.Transcript:ApplyFont()
Expect("...and its words, the player's Text Size kept", tostring(env.Transcript.face) .. " "
    .. tostring(env.Transcript.faceSize), EUI_FONT .. " " .. tostring(env.Addon:Profile("Transcript").FontSize or 16))
-- The DialogueUI window keeps DialogueUI's look: its words in the font the skin gives them.
env.Addon.previewStyle = "dialogueui"
env.Transcript:ApplyFont()
local dialogueUIFace = env.Transcript.face
env.Addon.previewStyle = nil
env.Transcript:ApplyFont()
Expect("...but not on the DialogueUI window, whose words keep their own font",
    tostring(dialogueUIFace ~= EUI_FONT) .. " " .. tostring(env.Transcript.face == EUI_FONT), "true true")
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("...its Stop and Skip square EllesmereUI buttons, their glyphs kept",
    tostring(M.play.squared) .. " " .. tostring(M.skip.squared) .. " "
    .. table.concat(Dressed(eui, "Button", M.skip).kept, ","), "true true glyph,bar")
-- Round buttons on the DialogueUI window stay round; the same button elsewhere squares.
env.DialogueUIPlayer:Initialize()
local onDialogueUI = env.Actions.RoundButton(env.DialogueUIPlayer.frame, 12)
local elsewhere = env.Actions.RoundButton(UIParent, 12)
Expect("...a round button on the DialogueUI window keeps its ring, one elsewhere squares",
    tostring(onDialogueUI.squared) .. " " .. tostring(elsewhere.squared), "nil true")
-- A Skip button built after the callback ran, as the windows' others are, squares with its bar kept.
local later = env.Actions.SkipButton(UIParent)
Expect("...and a Skip button made after login keeps its bar too",
    table.concat(Dressed(eui, "Button", later).kept, ","), "glyph,bar")
Expect("...its portrait flat: no gold ring, no art behind it, cut round in a 1 px edge",
    tostring(M.portrait.squared) .. " " .. M.ring:GetAlpha() .. " " .. M.portrait.background:GetAlpha() .. " "
    .. tostring(M.portrait.round) .. " " .. tostring(M.viewport.squareMask), "true 0 0 true false")
env.Face.SetBadge(M.portrait, "quest-accept")
Expect("...no badge at its corner, its glyphs being round, nor the socket for one",
    tostring(M.badge:IsShown()) .. " " .. tostring(M.badgeBackground:IsShown()), "false false")
-- As EllesmereUI's square button sets an icon in its border: a 2 px dark collar, then the 1 px edge.
Expect("...its square box's edge outside the face past a dark collar, not over it",
    M.viewport.spokenBox.edges[1].anchor.y .. " " .. M.viewport.spokenBox.backing.anchor.x, "3 2")
Expect("...its round one too: the dark disc a collar wider than the face, the grey edge a pixel past it",
    M.portrait.disc.backing.anchor.x .. " " .. M.portrait.disc.edge.anchor.x, "2 3")
do
    local left
    local setPoint = M.panel.SetPoint
    M.panel.SetPoint = function(self, point, rel, relPoint, x, ...)
        if point == "TOPLEFT" then left = x end
        return setPoint(self, point, rel, relPoint, x, ...)
    end
    M:Layout()
    M.panel.SetPoint = setPoint
    Expect("...its panel the whole window, so the shell's edge does not run down the portrait", left, 0)
    Expect("...its portrait over the shell's edge, which EllesmereUI draws 6 levels over the panel",
        tostring(raised and raised > M.panel:GetFrameLevel() + 6), "true")
end
do
    local stockBorder, cleared = 0, 0
    M.panel.SetBackdropBorderColor = function() stockBorder = stockBorder + 1 end
    M.panel.SetBackdrop = function(_, backdrop) if backdrop == nil then cleared = cleared + 1 end end
    M.paper:SetAlpha(1)
    env.Addon:SetPlayerStyle("subtitle")
    P:RefreshConfig()
    env.Addon:SetPlayerStyle("minimal")
    P:RefreshConfig()
    Expect("switched to the subtitles and back, the small window keeps EllesmereUI's look: no stock border or paper",
        stockBorder .. " " .. tostring(cleared > 0) .. " " .. M.paper:GetAlpha(), "0 true 0")
end
Expect("...its menu, built before as well, EllesmereUI's panel", Dressed(eui, "Panel", M.menu) ~= nil, true)
P:RefreshConfig(); P:RefreshConfig()
Expect("...the shell once, however often the window is refreshed", select(2, Dressed(eui, "Shell", M.panel)), 1)
env.Addon:SetPlayerStyle("classic")
P:RefreshConfig()
Expect("the large window's round edge on its portrait, so Hide Portrait hides it with it",
    P.frame.portrait.disc and P.frame.portrait.disc.edge.parent == P.frame.portrait, true)
do
    -- A speaker whose face the client has not captured: the 3D model as in the stock look, not the book.
    local static, model = 0, 0
    local configure, staticConfigure = env.Portrait.Configure, env.StaticPortrait.Configure
    env.Portrait.Configure = function(self, viewport, clip, ...)
        if viewport == P.frame.portrait then model = model + 1 end
        return configure(self, viewport, clip, ...)
    end
    env.StaticPortrait.Configure = function(...) static = static + 1; return staticConfigure(...) end
    -- The face of the speaker before is still on the portrait.
    local before = P.frame.portrait:CreateTexture()
    before:Show()
    P.frame.portrait.active, P.frame.portrait.activeFrame = "static", before
    local speaker = env.Sources:Register("speaker", { title = "Speaker", addon = "Spoken_Quests", order = 8 })
    speaker:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Two", transcript = "Words.",
        portrait = { kind = "model", creatureID = 3188 } } }))
    P:Update()
    Expect("...a speaker with no captured face shown by the 3D model, not the book", static .. " " .. tostring(model > 0), "0 true")
    Expect("...the face of the speaker before let go, not shown under it",
        tostring(before:IsShown()) .. " " .. tostring(P.frame.portrait.active), "false model")
    env.Portrait.Configure, env.StaticPortrait.Configure = configure, staticConfigure
    env.SoundQueue:RemoveAllSoundsFromQueue()
end
Expect("the large window, chosen after, takes the shell as well, the whole frame",
    Dressed(eui, "Shell", P.frame) ~= nil, true)
P.frame.portrait.active = "static"
P:FitPortrait()
Expect("...its portrait round while it shows the speaker's captured face",
    tostring(P.frame.portrait.disc.edge:IsShown()) .. " " .. tostring(P.frame.portrait.box.backing:IsShown()), "true false")
P.frame.portrait.active = "texture"
P:FitPortrait()
Expect("...round too while it shows a picture", tostring(P.frame.portrait.disc.edge:IsShown()), "true")
P.frame.portrait.active = "model"
P:FitPortrait()
Expect("...square while it shows a 3D model", tostring(P.frame.portrait.disc.edge:IsShown()), "false")
Expect("...without Spoken's box behind its words", P.frame.background:GetAlpha(), 0)
Expect("...its portrait a flat box, without the ornate frame or the art behind it",
    tostring(P.frame.portrait.spokenBox ~= nil) .. " " .. P.frame.portrait.border.texture:GetAlpha() .. " "
    .. P.frame.portrait.background:GetAlpha(), "true 0 0")

-- A creature's face round, anything else square.
do
    local face = M.portrait
    Expect("the small window's face showing an icon is round too, in its 1 px edge, no square box",
        tostring(face.round) .. " " .. tostring(face.box.backing:IsShown()) .. " " .. tostring(face.disc.edge:IsShown()),
        "true false true")
    face.viewport.active, face.viewport.activeFrame = "static", face.viewport:CreateTexture()
    env.Face.Fit(face)
    Expect("...showing a creature's captured face, round in a 1 px grey edge, no square box",
        tostring(face.round) .. " " .. tostring(face.box.backing:IsShown()) .. " " .. tostring(face.disc.edge:IsShown())
        .. " " .. tostring(face.viewport.squareMask), "true false true false")
    face.viewport.active = "model"
    env.Face.Fit(face)
    Expect("...a 3D model, which cannot be cut round, square", tostring(face.round), "false")
    face.viewport.active, face.viewport.activeFrame = nil, nil
    env.Face.Fit(face)

    _G.SetPortraitTextureFromCreatureDisplayID = function() end
    local speaker = env.Spoken:CreateSpeakerFace(CreateFrame("Frame", nil, UIParent), 50)
    speaker:SetSpeaker({ creatureID = 3188, displayID = 4065 })
    Expect("a page's speaker, a creature, round", tostring(speaker.round), "true")
    speaker:SetSpeaker({ objectOrItem = true, icon = 134400 })
    Expect("...an object or item round too", tostring(speaker.round), "true")
    _G.SetPortraitTextureFromCreatureDisplayID = nil
end

-- A captured face after a 3D model: cut round again, not left square over the round disc.
do
    local face = M.portrait
    local function Maskable()
        local texture = face.viewport:CreateTexture()
        texture.masks = {}
        function texture:AddMaskTexture(mask) self.masks[mask] = true end
        function texture:RemoveMaskTexture(mask) self.masks[mask] = nil end
        return texture
    end
    face.viewport.active, face.viewport.activeFrame = "model", nil
    env.Face.Fit(face)
    local captured = Maskable()
    face.viewport.active, face.viewport.activeFrame = "static", captured
    env.Face.Fit(face)
    Expect("the small window's captured face after a 3D model is cut round again",
        tostring(face.round) .. " " .. tostring(next(captured.masks) ~= nil), "true true")
    face.viewport.active, face.viewport.activeFrame = nil, nil
    env.Face.Fit(face)
end

-- Round buttons a feature addon asks for: square, but not on DialogueUI's windows.
do
    local plain = CreateFrame("Frame", nil, UIParent)
    local dialog = CreateFrame("Frame", "DUIQuestFrame", UIParent)
    _G.DUIQuestFrame = dialog
    local play, kept = env.Spoken:CreateRoundButton(plain, "play"), env.Spoken:CreateRoundButton(dialog, "play")
    local icon = env.Spoken:CreateRoundButton(plain, "icon", nil, 5341597)
    Expect("a feature addon's round button is square on its own frame, round on DialogueUI's",
        tostring(play.squared) .. " " .. tostring(kept.squared), "true nil")
    Expect("...a picture in one square too, not masked round or vignetted",
        tostring(icon.squared) .. " " .. tostring(icon.mask) .. " " .. tostring(icon.vignette), "true nil nil")
    _G.DUIQuestFrame = nil
end

-- The subtitles' face and buttons, built now.
if env.Subtitle.Build and not env.Subtitle.frame then env.Subtitle:Build() end
if env.Subtitle.picture then
    Expect("the subtitles' face is a flat box too", env.Subtitle.picture.squared, true)
end

local welcome, box = OtherWindows(env)
Expect("the welcome window's scroll bar is EllesmereUI's thin strip", env.Welcome.scroller.flatThumb
    and env.Welcome.scroller.flatThumb:GetWidth(), 4)
Expect("the welcome window, built after, takes the shell", Dressed(eui, "Shell", welcome) ~= nil, true)
local boxShell = Dressed(eui, "Shell", box)
local buttons = 0
for _, call in ipairs(eui.calls) do
    if call.kind == "Button" and call.frame:GetParent() == box then buttons = buttons + 1 end
end
Expect("the contribution window takes the shell, without the title strip, and its two buttons EllesmereUI's",
    tostring(boxShell ~= nil) .. " " .. tostring(boxShell and boxShell.opts.noTopBar) .. " " .. buttons, "true true 2")
local whites = 0
for _, call in ipairs(eui.calls) do
    if call.kind == "WhiteButtonLabel" and call.frame:GetParent() == box then whites = whites + 1 end
end
Expect("...their labels white, not the game's gold", whites, 2)

-- Parchment or Dark does nothing on the shell, so the row goes.
env.Addon:SetPlayerStyle("minimal")
P:RefreshConfig()
env.Options:UpdateRows()
local main = _G.SpokenOptionsPanel.layout
main:Refresh()
local row
for _, entry in ipairs(main.entries) do
    if entry.label == env.L.OPT_DUI_THEME then row = entry.frame; break end
end
Expect("Spoken's page has no Parchment or Dark for the small window in EllesmereUI's look",
    row ~= nil and row:IsShown(), false)

---------------------------------------------------------------- a client EllesmereUI's font does not write
do
    local getLocale = _G.GetLocale
    _G.GetLocale = function() return "ruRU" end
    env, eui = Boot("eui")
    Record(env.MinimalPlayer.name)
    eui.callback(eui.skin)
    Expect("on a Russian client the windows take EllesmereUI's look but keep the game's font",
        tostring(env.Ellesmere:Font()) .. " " .. tostring(env.MinimalPlayer.name.face) .. " "
        .. tostring(env.MinimalPlayer.portrait.squared), "nil nil true")
    _G.GetLocale = getLocale
end

---------------------------------------------------------------- a shell that fails
env, eui = Boot("eui")
eui.fail = true
local said = {}
local print = _G.print
_G.print = function(text) table.insert(said, tostring(text)) end
local cleared = false
env.MinimalPlayer.panel.SetBackdrop = function(_, backdrop) if backdrop == nil then cleared = true end end
env.MinimalPlayer.paper:SetAlpha(1)
Record(env.MinimalPlayer.name)
local ok = pcall(eui.callback, eui.skin)
_G.print = print
Expect("a shell that fails is said in chat and the window carries on",
    tostring(ok) .. " " .. tostring(said[1] and said[1]:find("EllesmereUI", 1, true) ~= nil), "true true")
Expect("...keeping Spoken's own backdrop, paper and ink: no window left with no background",
    tostring(env.MinimalPlayer.panel.spokenEllesmere) .. " " .. tostring(cleared) .. " " .. env.MinimalPlayer.paper:GetAlpha()
    .. " " .. tostring(env.MinimalPlayer.name.colour), "false false 1 " .. INK)
do
    -- Its own art kept, the panel keeps its place behind the portrait's middle too.
    local left
    local panel = env.MinimalPlayer.panel
    local setPoint = panel.SetPoint
    panel.SetPoint = function(self, point, rel, relPoint, x, ...)
        if point == "TOPLEFT" then left = x end
        return setPoint(self, point, rel, relPoint, x, ...)
    end
    env.MinimalPlayer:Layout()
    panel.SetPoint = setPoint
    Expect("...and starts behind the portrait's middle, not at the frame's edge", left, 44)
end

---------------------------------------------------------------- EllesmereUI not loaded
env, eui = Boot("absent")
Expect("with EllesmereUI not loaded nothing waits for its look", env.Ellesmere.waiting, nil)
env, eui = Boot("blizzard")
local queued = #(env.Ellesmere.waiting or {})
eui.callback(eui.skin)
env.Ellesmere:When(function() end)
Expect("under another look the windows waiting for EllesmereUI's are let go, and none wait after",
    tostring(queued > 0) .. " " .. tostring(env.Ellesmere.waiting), "true nil")

_G.EllesmereUI = nil
if Failures() > 0 then stub.print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
stub.print("\nAll EllesmereUI look tests passed")

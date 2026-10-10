-- The DialogueUI narrator style (UI/DialogueUITheme.lua, UI/DialogueUIPlayer.lua), with and
-- without a fake DialogueUI. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local GOLD, RED = "|cffffd100", "|cff9c1a1a"
local BROWN, DARK = "Interface/AddOns/DialogueUI/Art/Theme_Brown/", "Interface/AddOns/DialogueUI/Art/Theme_Dark/"

---------------------------------------------------------------- a fake DialogueUI
local loaded = false
_G.IsAddOnLoaded = function(name) return name == "DialogueUI" and loaded end
local function FakeDialogueUI()
    _G.DialogueUI_DB = { Theme = 1, FrameSize = 2 }
    local frame = stub.Widget("Frame")
    -- DialogueUI's window at its default size on a 1080p screen, drawn at 0.8 scale.
    frame.frameWidth, frame.frameHeight = 624, 734
    frame.GetEffectiveScale = function() return 0.8 end
    local cap = stub.Widget("Texture")
    function cap:GetSize() return 601, 150 end
    frame.Parchments = { cap }
    function frame:LoadTheme() end
    function frame:UpdateFrameSize() end
    -- Showing a page: Spoken hooks it to hear another page shown in a window still open.
    function frame:ShowUI() end
    -- Closed until a dialog opens.
    frame:Hide()
    _G.DUIQuestFrame = frame
    local font = stub.Widget("Font")
    function font:GetFont() return "Interface/AddOns/DialogueUI/Fonts/frizqt__.ttf", 14 end
    _G.DUIFont_Quest_Paragraph = font
    -- Its book view: no parent either, drawn at 0.8, its paper the frame, 409.6 by 477.87 with
    -- its bottom left at 200, 100. Closed until a book opens.
    local book = stub.Widget("Frame")
    book.GetEffectiveScale = function() return 0.8 end
    book.GetRect = function() return 200, 100, 409.6, 477.87 end
    book:Hide()
    _G.DUIBookFrame = book
    local bookTitle = stub.Widget("Font")
    function bookTitle:GetFont() return "Interface/AddOns/DialogueUI/Fonts/TrajanPro3SemiBold.ttf", 18 end
    _G.DUIFont_Book_Title = bookTitle
    return frame
end

local function Boot(client)
    stub.SetClient(client or "16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    _G.UISpecialFrames = _G.UISpecialFrames or {}
    -- A screen, for the window to take DialogueUI's share of; the stub's is a thumbnail.
    _G.UIParent:SetSize(1920, 1080)
    local env = stub.LoadSpoken(SPOKEN)
    -- LoadSpoken picks the large window for the other suites; these start from the small one.
    env.Addon.db.profile.Frame.Style = "minimal"
    env.Addon:Enable()
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
    return env, quests
end

-- By label and tooltip: the DialogueUI window's Window Size and Text Size share their labels
-- with the other windows' rows they stand in for.
local function Row(layout, label, tooltip)
    for _, entry in ipairs(layout.entries) do
        if entry.label == label and (not tooltip or entry.tooltip == tooltip) then return entry.frame end
    end
end

---------------------------------------------------------------- without DialogueUI
local env = Boot()
local Spoken = _G.Spoken
Expect("the small window is the default window", Spoken:GetPlayerStyle(), "minimal")
Expect("no DialogueUI tile without DialogueUI", table.concat(env.Options:Styles(), ","), "subtitle,minimal,classic,none")
SlashCmdList.SPOKEN("player dialogueui")
Expect("the slash command says why it cannot switch", env.Addon.db.profile.Frame.Style, "minimal")
env.Addon.db.profile.Frame.Style = "dialogueui"
env.PlayerFrame:RefreshConfig()
Expect("a DialogueUI window chosen falls back to the small one", Spoken:GetPlayerStyle(), "minimal")
Expect("...the choice is kept, for DialogueUI coming back", env.Addon.db.profile.Frame.Style, "dialogueui")
Expect("...and the player frame is the small one", Spoken:GetPlayerFrame(), env.MinimalPlayer.frame)
Expect("...with the reason to hand", env.DialogueUITheme:Problem(), env.L.OPT_STYLE_DUI_MISSING)
Expect("no DialogueUI window is built for it", env.DialogueUIPlayer.frame, nil)

env = Boot("1.12")
Expect("the legacy client has the large window and nothing else", Spoken:GetPlayerStyle(), "classic")
Expect("...and no DialogueUI reading", env.DialogueUITheme:Available(), false)

---------------------------------------------------------------- the window, with DialogueUI
loaded = true
local DUI = FakeDialogueUI()
local quests
env, quests = Boot()
Spoken = _G.Spoken
Expect("with DialogueUI it is a fifth tile, after the large window",
    table.concat(env.Options:Styles(), ","), "subtitle,minimal,classic,dialogueui,none")
Expect("...named, described and drawn", env.Options.STYLE_LABELS.dialogueui ~= nil and env.Options.STYLE_TEXTS.dialogueui ~= nil
    and env.Options.STYLE_TIPS.dialogueui ~= nil and env.Options.SKETCHES.dialogueui ~= nil, true)
SlashCmdList.SPOKEN("player dialogueui")
local Skin, T = env.DialogueUIPlayer, env.Transcript
Expect("/spoken player dialogueui draws it", Spoken:GetPlayerStyle(), "dialogueui")
Expect("...remembered as the style chosen", env.Addon.db.profile.Frame.Style, "dialogueui")
Expect("...on its own frame", Spoken:GetPlayerFrame(), _G.SpokenDialogueUIPlayerFrame)
Expect("it shows Lines Shown of the words", Skin.lines, 2)
Expect("the window is as wide as DialogueUI's", Skin.frame:GetWidth(), 624)
Expect("...and only as tall as its lines need", Skin.frame:GetHeight() < 734, true)
-- DialogueUI's window has no parent and is drawn at 0.8 here; UIParent at 1. At the default
-- Window Size the window is 0.65 of that, 0.52: the whole window scaled.
Expect("...and its size scales the whole of it", math.abs(Skin.frame.scale - 0.52) < 1e-6, true)
Expect("the parchment is DialogueUI's own", Skin.parchments[2].texture, BROWN .. "Parchment.png")
Expect("...its top cap at the top of the image", table.concat(Skin.parchments[1].texCoord, ","), "0,1,0,0.125")
Expect("...its bottom cap where DialogueUI cuts it", table.concat(Skin.parchments[3].texCoord, ","), "0,1,0.4375,0.5625")
Expect("...sized as DialogueUI's", Skin.parchments[1].width, 601)
Expect("the words are DialogueUI's text size", T.style.size, 14)
Expect("...with its line spacing", T.style.lineGap, 5)
Expect("...and its paragraphs set apart", T.style.paragraphs, true)
T:SetClip({ text = "First paragraph.\nSecond one." })
Expect("an empty line separates two paragraphs", #T.lines == 3 and #T.lines[2] == 0, true)
T:SetClip(nil)
Expect("the words are docked in the window, over the paper with the rest of its contents",
    T.frame:GetParent(), Skin.content)
Expect("...with labels enough for them and the line sliding in", #T.labels >= Skin.lines + 1, true)
Expect("...in DialogueUI's font", T.style.font, "Interface/AddOns/DialogueUI/Fonts/frizqt__.ttf")
Expect("...and the parchment's red highlight", T.style.highlight, RED)
Expect("the expand button has no place on a fixed page", T.expand:IsShown(), false)

env.Options:UpdateRows()
local main, Page = _G.SpokenOptionsPanel.layout, env.DialogueUIOptions
main:Refresh()
local function Shown(layout, label, tooltip) local row = Row(layout, label, tooltip); return row ~= nil and row:IsShown() end
Expect("Spoken's page points to the DialogueUI page", Shown(main, env.L.OPT_DUI_OPEN_PAGE), true)
Expect("the DialogueUI page waits for the world to be up", Page.page, nil)
stub.FireEvent("PLAYER_ENTERING_WORLD"); stub.Advance(0.1)
Expect("...then is listed after every part's page", Page.page and Page.page.order, 1000)
Expect("...under DialogueUI's name", Page.page and Page.page.name, env.L.OPT_STYLE_DIALOGUEUI)
Expect("the window's size is the player's Window Size", Shown(main, env.L.OPT_SCALE, env.L.OPT_SCALE_TIP), true)
Expect("...its words' size and lines theirs", Shown(main, env.L.TRANSCRIPT_SIZE, env.L.TRANSCRIPT_SIZE_TIP)
    and Shown(main, env.L.TRANSCRIPT_LINES), true)
Expect("...and how the words scroll too", Shown(main, env.L.TRANSCRIPT_SCROLL), true)
Expect("Hide Portrait is not offered: DialogueUI's window always shows its face",
    Shown(main, env.L.OPT_HIDE_PORTRAIT), false)
local page = Page.layout
page:Refresh()
local function Live(label, tooltip) local row = Row(page, label, tooltip); return row ~= nil and row.layoutReason == nil end
Expect("the page has the window's theme", Live(env.L.OPT_DUI_FOLLOW_THEME), true)
Expect("...and Fit to the Words", Live(env.L.OPT_DUI_FIT_TEXT), true)
Expect("...but nothing Spoken's page has already", Row(page, env.L.OPT_SCALE) == nil
    and Row(page, env.L.TRANSCRIPT_SIZE) == nil and Row(page, env.L.TRANSCRIPT_LINES) == nil, true)
Expect("the theme waits on not following DialogueUI's", Row(page, env.L.OPT_DUI_THEME).layoutReason, env.L.REASON_DUI_FOLLOW)
env.Addon:SetPlayerStyle("minimal")
main:Refresh()
Expect("...as the other windows' is", Shown(main, env.L.OPT_HIDE_PORTRAIT), true)
page:Refresh()
Expect("with another style chosen they wait on this one, saying where to choose it",
    Row(page, env.L.OPT_DUI_FIT_TEXT).layoutReason, env.L.REASON_DUI_STYLE)
env.Addon:SetPlayerStyle("dialogueui")
env.Addon.db.profile.Frame.DialogueUI.FitText = false
Page:Reset()
Expect("the page's Defaults puts the window's settings back", env.Addon.db.profile.Frame.DialogueUI.FitText, true)

---------------------------------------------------------------- only the line playing
-- No fold: the other windows' words opened, this one still shows Lines Shown of the line playing.
local saved = env.Addon:Layout()
saved.CaptionsExpanded = true
env.PlayerFrame:RefreshConfig()
Expect("the other windows' words opened, it still shows Lines Shown", Skin.lines, 2)
Expect("...with no fold, no rows for the lines waiting and no resize handle",
    tostring(Skin.SetExpanded) .. " " .. tostring(Skin.drawer) .. " " .. tostring(Skin.resizer), "nil nil nil")
T:ToggleExpanded(); env.PlayerFrame:RefreshConfig()
Expect("...and the other windows' expand button leaves it so", Skin.lines, 2)
saved.CaptionsExpanded = nil
env.PlayerFrame:RefreshConfig()

---------------------------------------------------------------- where it opens
local function Near(a, b) return a ~= nil and b ~= nil and math.abs(a - b) < 1 end
-- The screen's top left, 16 from the paper's visible edge: the caps reach past the frame's top
-- and sides, the paper inside their transparent margin (122 of the cap's 256 rows, 125 of 1024
-- columns; a book's stone 123 and 112).
local function AtTopLeft(top, left)
    local anchor, base, cap = Skin.frame.anchor, Skin.frame.spokenBaseScale, Skin.parchments[1]
    local x = 16 / base + math.max(0, (cap.width - Skin.frame:GetWidth()) / 2 - (left or 125) / 1024 * cap.width)
    local y = 16 / base + math.max(0, cap.height * (0.5 - (top or 122) / 256))
    return anchor ~= nil and anchor.point == "TOPLEFT" and anchor.relativePoint == "TOPLEFT"
        and Near(anchor.x, x) and Near(anchor.y, -y)
end
saved.DialogueUI = nil
DUI.frameOffsetX = 480
env.PlayerFrame:RefreshConfig()
Expect("never dragged, it opens at the screen's top left, out of the next dialog's way", AtTopLeft(), true)
DUI.frameOffsetX = -480
env.PlayerFrame:RefreshConfig()
Expect("...wherever DialogueUI puts its own window", AtTopLeft(), true)
local hadCtrl = _G.IsControlKeyDown
_G.IsControlKeyDown = function() return true end
Skin:Wheel(1)
_G.IsControlKeyDown = hadCtrl
Expect("...still there at another size", env.Addon.db.profile.Frame.FrameScale > 0.7
    and AtTopLeft(), true)
Expect("...the size not taken for a move", saved.DialogueUI, nil)
env.Addon.db.profile.Frame.FrameScale = 0.7
env.PlayerFrame:RefreshConfig()
Skin:StopDrag()
Expect("dragged, its place is kept", saved.DialogueUI ~= nil, true)
local dragged = Skin.frame.anchor
DUI.frameOffsetX = 480
env.PlayerFrame:RefreshConfig()
Expect("...and no longer follows DialogueUI's", Skin.frame.anchor, dragged)
env.PlayerFrame:Reset()
Expect("reset, it goes back to the screen's top left", saved.DialogueUI == nil and AtTopLeft(), true)

---------------------------------------------------------------- as tall as the words need
local panel, transcript = env.Addon.db.profile.Frame.DialogueUI, env.Addon.db.profile.Transcript
Expect("Fit to the Words is on by default", panel.FitText, true)
local function Play(text)
    Spoken:StopAll()
    quests:Enqueue(H.Clip({ length = 30, present = { header = "Marshal McBride", label = "Kobold Camp Cleanup",
        transcript = text, portrait = { kind = "none" } } }))
    env.PlayerFrame:RefreshConfig()
end
local long = string.rep("The kobolds dig deeper into the mine every night. ", 60)
Play(long)
Expect("the window shows the line the captions hold", T.clip ~= nil and T.clip == Skin.clip, true)
Expect("a long line gets Lines Shown of it", Skin.lines, 2)
local tall = Skin.frame:GetHeight()
transcript.Lines = 1
env.PlayerFrame:RefreshConfig()
Expect("...or one, as the player's Lines Shown says", Skin.lines, 1)
transcript.Lines = 2
Play("Go north.")
Expect("a short one takes only the lines it needs", Skin.lines, 1)
Expect("...the window shorter for it", Skin.frame:GetHeight() < tall, true)
panel.FitText = false
env.PlayerFrame:RefreshConfig()
Expect("with Fit to the Words off, it keeps Lines Shown", Skin.lines, 2)
Page:Reset()
Expect("the page's Defaults puts Fit to the Words back", panel.FitText, true)
local noted = false
local function Look(row)
    for _, region in ipairs(row.regions or {}) do
        if region.text == env.L.DUI_WHEEL_HINT then noted = true end
    end
end
for _, item in ipairs(page.items or {}) do
    Look(item)
    for _, row in ipairs(item.rows or {}) do Look(row) end
end
Expect("the DialogueUI page names the wheel's shortcuts", noted, true)
Spoken:StopAll()
env.PlayerFrame:RefreshConfig()

---------------------------------------------------------------- what it shows
env.Options:Preview("dialogueui")
Expect("previewing the tile shows the window with a sample line", Skin.wanted, true)
Expect("...its speaker", Skin.name:GetText(), env.L.SAMPLE_SPEAKER)
Expect("...and words, as the subtitle's sample has", T.text, env.L.SUBTITLE_SAMPLE_TEXT)
env.Options:Preview(nil)
Expect("...and puts it away", Skin.wanted, false)

local clip = H.Clip({ present = { header = "Eagan Peltskinner", label = "Wolves Across the Border",
    bullet = "quest-accept", portrait = { kind = "none" } } })
quests:Enqueue(clip)
Expect("a queued line shows the window", Skin.wanted, true)
Expect("...naming the speaker", Skin.name:GetText(), "Eagan Peltskinner")
Expect("...and the line", Skin.title.text:GetText(), "Wolves Across the Border")
quests:Enqueue(H.Clip({ present = { header = "Eagan", label = "Second", portrait = { kind = "none" } } }))
Expect("a waiting line gets no row, the title counts it", tostring(Skin.rows) .. " " .. Skin.count:GetText(), "nil • +1")
Spoken:StopAll()

-- A book page and a zone's lore, queued as Spoken_Books and Spoken_Zones queue them.
local books = env.Sources:Register("books", { title = "Books", addon = "Spoken_Books", order = 3 })
books:Enqueue({ key = "b:1", path = "b1.mp3", length = 6, present = { header = "A Letter Home", transcript = "Dear mother, the war goes well.",
    bullet = "book", portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } })
Expect("a book page shows the window", Skin.wanted, true)
Expect("...titled by the book", Skin.name:GetText(), "A Letter Home")
Expect("...and named by its key when it has no page label", Skin.title.text:GetText(), "b:1")
Expect("...the book for a face", Skin.viewport.active, "texture")
Expect("...badged as a book, as the subtitle badges it", tostring(Skin.badge:IsShown()) .. " " .. tostring(Skin.badge.texture),
    "true " .. tostring(env.MinimalPlayer.BADGES.book))
Expect("...with its words in the window", T.text, "Dear mother, the war goes well.")
Spoken:StopAll()
local zones = env.Sources:Register("zones", { title = "Zones", addon = "Spoken_Zones", order = 2 })
zones:Enqueue({ key = "z:12", path = "z12.ogg", length = 20, present = { header = "Elwynn Forest", label = "Goldshire",
    bullet = "zone", portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } })
Expect("a zone's lore shows it too", Skin.name:GetText() .. "/" .. Skin.title.text:GetText(), "Elwynn Forest/Goldshire")
Expect("...even with no words to show", T.frame:IsShown(), false)
Spoken:StopAll()

---------------------------------------------------------------- DialogueUI's theme and size
_G.DialogueUI_DB.Theme = 2
DUI:LoadTheme()
Expect("DialogueUI switching to dark switches the window", Skin.parchments[2].texture, DARK .. "Parchment.png")
Expect("...and the highlight to gold", T.style.highlight, GOLD)
_G.DialogueUI_DB.Theme = 1
DUI:LoadTheme()
local dui = env.Addon.db.profile.Frame.DialogueUI
dui.FollowTheme, dui.Theme = false, 2
env.PlayerFrame:RefreshConfig()
Expect("not following, the chosen theme wins over DialogueUI's", Skin.parchments[2].texture, DARK .. "Parchment.png")
dui.FollowTheme = true

DUI.frameWidth, DUI.frameHeight = 600, 700
DUI:UpdateFrameSize()
Expect("DialogueUI resizing resizes the window", Skin.frame:GetWidth(), 600)
local frameCfg, words = env.Addon.db.profile.Frame, env.Addon.db.profile.Transcript
frameCfg.FrameScale = 0.35
env.PlayerFrame:RefreshConfig()
Expect("half the Window Size scales it down by half", math.abs(Skin.frame.scale - 0.65 * 0.5 * 0.8) < 1e-6, true)
Expect("...keeping DialogueUI's layout inside", Skin.frame:GetWidth(), 600)
frameCfg.FrameScale = 0.7
env.PlayerFrame:RefreshConfig()
words.FontSize = 26
env.PlayerFrame:RefreshConfig()
-- DialogueUI's 14 at the default Text Size of 16; at 26, 14 * 26 / 16.
Expect("Text Size sets the words against DialogueUI's", T.style.size, 23)
Expect("...their spacing following", T.style.lineGap, 8)
Expect("...the window keeping its scale", math.abs(Skin.frame.scale - 0.52) < 1e-6, true)
words.FontSize = 16
env.PlayerFrame:RefreshConfig()
Expect("at the default Text Size the words are DialogueUI's size", T.style.size, 14)

local ctrl, shift = false, false
_G.IsControlKeyDown = function() return ctrl end
_G.IsShiftKeyDown = function() return shift end
T.top = 1
T.frame:GetScript("OnMouseWheel")(T.frame, -1)
Expect("the wheel alone still scrolls the words", T.manualScroll, true)
Expect("...the size untouched", frameCfg.FrameScale, 0.7)
-- Dragged first, so the corner stays where the player left it rather than following DialogueUI.
Skin:StopDrag()
ctrl = true
T.frame:GetScript("OnMouseWheel")(T.frame, 1)
Expect("Ctrl and the wheel over the words grow Window Size", math.abs(frameCfg.FrameScale - 0.75) < 1e-9, true)
local grown = 0.65 * 0.75 / 0.7 * 0.8
Expect("...drawing it larger", math.abs(Skin.frame.scale - grown) < 1e-6, true)
Expect("...its corner kept where it was", math.abs(Skin.frame.anchor.y - 100 * 0.52 / grown) < 1e-6, true)
Expect("...and saying so", _G.GameTooltip.text, env.L.OPT_SCALE .. ": 75%")
frameCfg.FrameScale = 2
Skin.frame:GetScript("OnMouseWheel")(Skin.frame, 1)
Expect("...no further than the slider goes", frameCfg.FrameScale, 2)
frameCfg.FrameScale = 0.7
env.PlayerFrame:RefreshConfig()
shift = true
Skin.frame:GetScript("OnMouseWheel")(Skin.frame, 1)
Expect("Ctrl, Shift and the wheel grow Text Size", words.FontSize, 17)
Expect("...the window left alone", frameCfg.FrameScale, 0.7)
Expect("...and the words set larger", T.style.size, 15)
Expect("...saying so", _G.GameTooltip.text, env.L.TRANSCRIPT_SIZE .. ": 17")
ctrl, shift = false, false
words.FontSize = 16
env.PlayerFrame:RefreshConfig()

---------------------------------------------------------------- over DialogueUI's window
Spoken:SetPlayerHost(DUI)
Expect("hosted over DialogueUI the window moves onto it", Skin.frame:GetParent(), DUI)
Expect("...at its share of the window it sits on", math.abs(Skin.frame.scale - 0.65) < 1e-6, true)
local moving = false
Skin.frame.StartMoving = function() moving = true end
Skin:StartDrag()
Expect("...and can still be dragged there", moving, true)
Skin.frame.StartMoving = nil
Skin:StopDrag()
local placed = env.Addon:Layout().DialogueUI
Expect("...its place saved", placed ~= nil, true)
Spoken:SetPlayerHost(nil)
Expect("...and comes back", Skin.frame:GetParent(), _G.UIParent)
env.PlayerFrame:RefreshConfig()
Expect("...to the place saved over the window", placed ~= nil and math.abs(Skin.frame:GetLeft() - placed.left) < 1e-6
    and math.abs(Skin.frame:GetTop() - placed.top) < 1e-6, true)
Expect("...at its own scale", math.abs(Skin.frame.scale - 0.52) < 1e-6, true)

---------------------------------------------------------------- its controls, the subtitle's
Spoken:StopAll()
-- Offering Report in the corner, as Quests' lines do.
local REPORT = { id = "report", icon = "Interface/HelpFrame/HelpIcon-Bug", text = "R", anchor = "topright" }
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "One", portrait = { kind = "none" },
    actions = { REPORT } } }))
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Two", portrait = { kind = "none" } } }))
Expect("it has the subtitle's round controls, Stop or Replay then Skip, and no Stop All",
    #Skin.buttons == 2 and Skin.buttons[1] == Skin.play and Skin.buttons[2] == Skin.skip and Skin.stop == nil, true)
Expect("...Skip in the subtitle's art", Skin.skip.bar ~= nil, true)
Expect("...in the header at the right, beside the speaker and the line",
    Skin.controls.anchor.point == "RIGHT" and Skin.controls.anchor.relativeTo == Skin.content
    and Skin.controls.anchor.relativePoint == "TOPRIGHT" and Skin.controls.anchor.y < 0, true)
Expect("...the line's title stopping short of them by a button's width, its count or Stopped clear of them",
    Skin.title.anchor.relativeTo == Skin.controls
    and math.abs(Skin.title.anchor.x + 24 * Skin.controls:GetScale()) <= 0.5, true)
Expect("...as large on screen as Place Lore's, 24 at UIParent's scale, at the default Window Size",
    math.abs(Skin.play:GetWidth() * Skin.controls:GetScale() * Skin.frame.spokenBaseScale - 24) < 0.01, true)
do
    -- Halfway through the slide out of the dialog, the window at a larger scale than it settles at.
    local to = Skin.frame.spokenBaseScale
    Skin.settling = { time = 0, from = to * 2, to = to, left = 0, toLeft = 0, top = 0, toTop = 0, height = 100 }
    Skin:SettleStep(0.2)
    Expect("...and as large while the window slides and shrinks out of the dialog, not at its scale",
        math.abs(Skin.play:GetWidth() * Skin.controls:GetScale() * Skin.frame:GetScale() - 24) < 0.01, true)
    Skin:Layout()
    Expect("...a layout during the slide keeping them so, not setting them back for a frame",
        math.abs(Skin.play:GetWidth() * Skin.controls:GetScale() * Skin.frame:GetScale() - 24) < 0.01, true)
    Skin.settling = nil
    Skin.frame:SetScale(to)
    Skin:Layout()
end
local report = Skin.row[3]
Expect("...Report after Skip, as large and as strong, as the subtitle shows it", report ~= nil and report:GetParent() == Skin.controls
    and report:GetWidth() == Skin.play:GetWidth() and report:GetAlpha() == 1, true)
Expect("...and no fold or close button", Skin.fold == nil and Skin.close == nil, true)
Expect("...nor a second Stop on the face: the header's is the one, as the subtitle has one", Skin.pause, nil)
Expect("the line's title is a name, nothing to click: Skip takes a line away",
    Skin.title:GetObjectType() .. " " .. tostring(Skin.title.scripts.OnClick) .. " " .. tostring(Skin.title.scripts.OnEnter),
    "Frame nil nil")
env.Addon.db.profile.Frame.HidePortrait = true
Skin:ConfigurePortrait()
Expect("Hide Portrait leaves its face: the header's socket would stand empty", Skin.portrait:IsShown(), true)
env.Addon.db.profile.Frame.HidePortrait = false
Expect("the title counts the lines waiting, after it, as the subtitle does",
    Skin.title.text:GetText() .. "|" .. tostring(Skin.count:IsShown()) .. "|" .. Skin.count:GetText(), "One|true|• +1")
Expect("...fading in as the line is added", Skin.count:GetAlpha() < 1, true)
Skin:Tick(0.3)
Expect("...all the way", Skin.count:GetAlpha(), 1)
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Three", portrait = { kind = "none" } } }))
Skin:Update()
Expect("...and again with one more", Skin.count:GetText() .. " " .. tostring(Skin.count:GetAlpha() < 1), "• +2 true")
Skin:Tick(0.3)
env.SoundQueue:RemoveSoundFromQueue(env.SoundQueue.sounds[3])
Skin:Update()
Expect("its progress line is the subtitle's, with no strip under it",
    Skin.progress ~= nil and Skin.progress.track:GetParent() == Skin.content and Skin.footerDivider == nil, true)
do
    local tall = Skin.frame:GetHeight()
    env.Addon.db.profile.Transcript.SubtitleProgress = false
    env.PlayerFrame:RefreshConfig()
    Expect("Show Progress off, the bar goes and the window closes up, as the subtitle does",
        tostring(Skin.progress.track:IsShown()) .. " " .. tostring(Skin.frame:GetHeight() < tall), "false true")
    env.Addon.db.profile.Transcript.SubtitleProgress = true
    env.PlayerFrame:RefreshConfig()
end
Skin.play.scripts.OnClick(Skin.play)
Expect("Stop stops the line, its glyph turning to Replay", tostring(env.SoundQueue:IsPaused()) .. " " .. tostring(Skin.play.state),
    "true replay")
Expect("...and the title says it is stopped, after the line's name and a dot, as the count is",
    Skin.title.text:GetText() .. "|" .. tostring(Skin.stopped:IsShown()) .. "|" .. Skin.stopped:GetText(),
    "One|true|• (" .. env.L.SUBTITLE_STOPPED .. ")")
Expect("...fading in", Skin.stopped:GetAlpha() < 1, true)
Expect("...the count after it", Skin.count.anchor.x > Skin.stopped.anchor.x, true)
Skin:Tick(0.3)
Expect("...all the way", Skin.stopped:GetAlpha(), 1)
Skin.play.scripts.OnClick(Skin.play)
Expect("...and Replay plays it again", Skin.play.state, "stop")
Skin:Tick(0.1)
Expect("...Stopped fading out, keeping its room meanwhile", tostring(Skin.stopped:IsShown()) .. " "
    .. tostring(Skin.stopped:GetAlpha() < 1 and Skin.stopped:GetAlpha() > 0), "true true")
Skin:Tick(0.3)
Expect("...then gone, the count back where it stood, after the name", tostring(Skin.stopped:IsShown()) .. " "
    .. tostring(Skin.count.anchor.x == Skin.stopped.anchor.x), "false true")
local first = Spoken:GetCurrent()
Skin.skip.scripts.OnClick(Skin.skip)
Expect("Skip goes on to the next line", Spoken:GetCurrent() ~= nil and Spoken:GetCurrent() ~= first, true)
Expect("...the window fading out whole first, as when the queue ends", tostring(Skin.turning) .. " "
    .. tostring(Skin.wanted) .. " " .. tostring(Skin.frame:IsShown()), "true false true")
Expect("...with the words it showed, not the next line's", T.clip == first, true)
Skin:Tick(1)
Expect("...then the next line laid out unseen, to fade in, its words in the captions", tostring(Skin.turning) .. " "
    .. tostring(Skin.wanted) .. " " .. tostring(Skin.clip == Spoken:GetCurrent()) .. " " .. tostring(T.clip == Spoken:GetCurrent()),
    "nil true true true")
Skin:Tick(1)
Expect("...and faded in, whole", Skin.level .. " " .. Skin.content:GetAlpha(), "1 1")
do
    local height = Skin.frame:GetHeight()
    Skin.heightWant = height + 60
    Skin:Tick(0.05)
    Expect("a new height is eased to, not jumped to", Skin.frame:GetHeight() > height and Skin.frame:GetHeight() < height + 60, true)
    Skin:Tick(1)
    Expect("...and reached", tostring(Skin.frame:GetHeight()) .. " " .. tostring(Skin.heightWant), (height + 60) .. " nil")
    Skin:Layout()
end
Expect("...the count gone with no line waiting", Skin.count:IsShown(), false)
-- Every fade is of the window as one image (a frame buffer, as the world map is), and nothing in
-- it changes while it is one: the client crashed on that.
Expect("shown, it is not one image: things change in it", Skin.frame:IsFrameBuffer(), false)
Skin:Tick(1) -- shown, and still a while
Skin.skip:EnableMouse(true) -- as a button is in the client; the stub's start without
Skin:SetVisible(false)
Expect("fading out, it first goes deaf to the pointer, so a click's pressed and lit states settle",
    tostring(Skin.skip:IsMouseEnabled()) .. " " .. tostring(Skin.frame:IsMouseEnabled()) .. " " .. tostring(Skin.frame:IsFrameBuffer()),
    "false false false")
local hidden = {}
local SetIsFrameBuffer = Skin.frame.SetIsFrameBuffer
Skin.frame.SetIsFrameBuffer = function(f, on) table.insert(hidden, tostring(on) .. ":" .. tostring(f:IsShown())); return SetIsFrameBuffer(f, on) end
Skin:Tick(0.02); Skin:Tick(0.02)
Expect("...then is drawn as one image", Skin.frame:IsFrameBuffer(), true)
Expect("...switched into it while hidden, shown again at once: switched on screen and faded, it crashed",
    table.concat(hidden, ",") .. " " .. tostring(Skin.frame:IsShown()), "true:false true")
Expect("...its parts ignoring its alpha, so only the image fades",
    Skin.content:IsIgnoringParentAlpha() and Skin.parchments[2]:IsIgnoringParentAlpha(), true)
Skin:Tick(0.16)
Expect("...and fades as one", Skin.content:GetAlpha() == 1 and Skin.frame:GetAlpha() > 0 and Skin.frame:GetAlpha() < 1, true)
Skin:Tick(0.3)
Expect("...and out of it while hidden too", hidden[2], "false:false")
Skin.frame.SetIsFrameBuffer = SetIsFrameBuffer
Expect("...gone, it is itself again", tostring(Skin.frame:IsShown()) .. " " .. tostring(Skin.frame:IsFrameBuffer())
    .. " " .. tostring(Skin.content:IsIgnoringParentAlpha()) .. " " .. tostring(Skin.skip:IsMouseEnabled()), "false false false true")
Skin:SetVisible(true)
Expect("fading in, it is laid out unseen first", tostring(Skin.frame:IsShown()) .. " " .. Skin.frame:GetAlpha() .. " "
    .. tostring(Skin.frame:IsFrameBuffer()), "true 0 false")
Skin:Tick(0.05)
Expect("...then fades in as one image", tostring(Skin.frame:IsFrameBuffer()) .. " " .. Skin.content:GetAlpha(), "true 1")
Skin:Tick(0.4)
Expect("...itself again once in", tostring(Skin.frame:IsFrameBuffer()) .. " " .. Skin.frame:GetAlpha(), "false 1")
do
    -- A client with no frame buffers: the paper and what is on it fade in turn.
    local SetIsFrameBuffer = Skin.frame.SetIsFrameBuffer
    Skin.frame.SetIsFrameBuffer = false
    Skin:Tick(1); Skin:SetVisible(false)
    for _ = 1, 40 do Skin:Tick(0.05) end
    local out = tostring(Skin.frame:IsShown()) .. " " .. tostring(T.held)
    Skin:SetVisible(true)
    for _ = 1, 40 do Skin:Tick(0.05) end
    Skin.frame.SetIsFrameBuffer = SetIsFrameBuffer
    Expect("with no frame buffer, a finished fade-out lets the captions go, so the next line's words show",
        out .. " " .. tostring(Skin.frame:IsShown()) .. " " .. Skin.frame:GetAlpha() .. " " .. tostring(T.held),
        "false nil true 1 nil")
end

-- A line ending: nothing in the image changes while it fades out.
Skin:Tick(1)
local words = T.text
Spoken:StopAll()
Skin:Tick(0.02); Skin:Tick(0.02)
Expect("a line ending fades the window out as one image", tostring(Skin.wanted) .. " " .. tostring(Skin.frame:IsFrameBuffer()), "false true")
Expect("...its words kept, fading with it: the captions held", tostring(T.held) .. " " .. tostring(T.text == words)
    .. " " .. tostring(T.clip ~= nil), "true true true")
Expect("...the portrait cache not painting its face meanwhile", Skin:Frozen(), true)
env.Addon:ApplyHost(Skin.frame)
Expect("...nor moved onto or off DialogueUI's window till it is done", tostring(Skin.frame.spokenHostPending), "true")
Skin:Update()
Expect("...another change of the queue with nothing to show leaves the fade alone", Skin.frame:IsFrameBuffer(), true)
Skin:Tick(0.4)
Expect("...gone, the window is itself again and the captions catch up", tostring(Skin.frame:IsFrameBuffer()) .. " "
    .. tostring(T.held) .. " " .. tostring(T.clip) .. " " .. tostring(Skin.frame.spokenHostPending), "false nil nil nil")

-- A line coming: laid out unseen, its face and picture drawn, then faded in as one image.
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Again", portrait = { kind = "none" } } }))
Skin:Tick(0.05)
Expect("a new line waits, unseen, to be still before it fades in", tostring(Skin.frame:IsFrameBuffer()) .. " "
    .. Skin.frame:GetAlpha(), "false 0")
Skin:Tick(0.06)
Expect("...then fades in as one image", Skin.frame:IsFrameBuffer(), true)
Skin:Tick(0.4)

-- Skipped: deaf to the pointer, then one image, the pressed Skip settled.
Skin:Tick(1)
Skin.skip:EnableMouse(true)
Skin.skip.scripts.OnClick(Skin.skip)
Expect("skipped, it goes deaf to the pointer before it is one image", tostring(Skin.skip:IsMouseEnabled()) .. " "
    .. tostring(Skin.frame:IsFrameBuffer()), "false false")
Skin:Tick(0.02); Skin:Tick(0.02)
Expect("...then fades out as one image", Skin.frame:IsFrameBuffer(), true)
-- A new line while it fades out: it finishes, then shows the new one as it shows any.
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Next", portrait = { kind = "none" } } }))
Expect("a new line mid-fade waits: the image fading out is not changed", tostring(Skin.frame:IsFrameBuffer()) .. " "
    .. tostring(T.held) .. " " .. tostring(Skin.pending), "true true update")
Skin:Tick(0.4)
Expect("...faded out, the new line is laid out unseen", tostring(Skin.frame:IsFrameBuffer()) .. " "
    .. tostring(Skin.frame:IsShown()) .. " " .. Skin.frame:GetAlpha() .. " " .. tostring(T.clip and T.clip.present.label), "false true 0 Next")
Skin:Tick(0.12)
Expect("...and fades in as one image", Skin.frame:IsFrameBuffer(), true)
Skin:Tick(0.5)
Expect("...shown in full, itself", tostring(Skin.frame:IsFrameBuffer()) .. " " .. Skin.frame:GetAlpha(), "false 1")
Spoken:StopAll()
Skin:Tick(1)

---------------------------------------------------------------- locked
Skin.frame.SetMouseClickEnabled = function(f, v) f.clicks = v end
Skin.frame.SetMouseMotionEnabled = function(f, v) f.motion = v end
env.Addon.db.profile.Frame.LockFrame = true
env.PlayerFrame:RefreshConfig()
Expect("locked, clicks on the window pass through to the game, as on the subtitle; the pointer still counts",
    tostring(Skin.frame.clicks) .. " " .. tostring(Skin.frame.motion), "false true")
env.Addon.db.profile.Frame.LockFrame = false
env.PlayerFrame:RefreshConfig()
Expect("...unlocked, they are the window's again", Skin.frame.clicks, true)

---------------------------------------------------------------- a place's picture
-- Where the first line stands: the captions' frame holds the fade's room over it.
local function WordsTop() return T.frame.anchor.y - Skin.lineRoom end
quests:Enqueue(H.Clip({ length = 30, present = { header = "Kalimdor", label = "Mulgore", portrait = { kind = "none" } } }))
Skin:Update()
local plainTop = WordsTop()
Expect("a line with no picture shows none", Skin.picture:IsShown(), false)
Expect("a name over it unlike the line's own is shown", Skin.name:GetText(), "Kalimdor")
Spoken:StopAll()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Kalimdor", label = "Mulgore", portrait = { kind = "none" },
    picture = { file = "Interface/Pictures/1412-mulgore", mask = "Interface/Pictures/Mask7" } } }))
Skin:Update()
Expect("a place's picture shows over its words, as Place Lore shows it", Skin.picture:IsShown()
    and Skin.picture.texture == "Interface/Pictures/1412-mulgore", true)
Expect("...2:1, as wide as the words", Skin.picture:GetWidth() .. "x" .. Skin.picture:GetHeight(),
    T.frame:GetWidth() .. "x" .. math.floor(T.frame:GetWidth() / 2 + 0.5))
local column = Skin.headerSocket:GetWidth() + Skin.headerDivider:GetWidth()
Expect("...the words narrower than DialogueUI's column, centred in it",
    T.frame:GetWidth() < column and math.abs(T.frame.anchor.x * 2 + T.frame:GetWidth() - column) <= 1, true)
Expect("...the progress line as wide as they are, under them",
    Skin.progress.track:GetWidth() .. " " .. Skin.progress.track.anchor.x, T.frame:GetWidth() .. " " .. T.frame.anchor.x)
Expect("...as far over where the paper's light ends as the last line is over it",
    Skin.progressGaps and math.abs(Skin.progressGaps.below - Skin.progressGaps.above) <= 0.5, true)
Expect("...and no scrollbar beside them: the wheel scrolls them", Skin.scrollbar, nil)
local pictureTop = -Skin.picture.anchor.y
local lineBottom = Skin.headerDivider:GetHeight() * 0.8
Expect("...as far under the divider's line as the words are under it",
    math.abs((pictureTop - lineBottom) - (-WordsTop() - (pictureTop + Skin.picture:GetHeight()))) < 1, true)
Spoken:StopAll()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Mulgore", label = "Mulgore", portrait = { kind = "none" } } }))
Skin:Update()
Expect("a name the same as the line's own is said once, in the title", Skin.name:GetText() .. "|" .. Skin.title.text:GetText(), "|Mulgore")
Spoken:StopAll()

---------------------------------------------------------------- the words' edges
-- A line's room over and under the words, which a line gliding out or in fades through: at
-- nothing by the time it reaches the edge, so no line is seen cut there.
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Fade", portrait = { kind = "none" } } }))
Skin:Update()
local room = Skin.lineRoom
local lineHeight = T.style.size + T.style.lineGap
Expect("the words have room over them in the captions, up to the divider's line, a line's at most",
    room > 0 and room <= lineHeight and T.labels[1].anchor.y == -room, true)
Expect("...and a line's room under them", T.frame:GetHeight(), Skin.lines * lineHeight + room + lineHeight)
Expect("...reaching over the header's gap, not adding to it: the words where they were",
    -(T.frame.anchor.y - room) - Skin.headerDivider:GetHeight() < room + T.style.size, true)
Expect("...no parchment strips drawn over them", Skin.strips, nil)
T.top = 1.75; T.placedKey = nil; T:Place()
Expect("a line gliding out is at a quarter, three quarters into the room", math.abs(T.labels[1]:GetAlpha() - .25) < 1e-6, true)
T.top = 1; T.placedKey = nil; T:Place()
Spoken:StopAll()

---------------------------------------------------------------- a line held back
-- Game Greeting First holds a gossip line until the NPC's own greeting ends.
local holding = true
env.SoundQueue:AddGate(function(clip)
    if holding and clip.present and clip.present.label == "Gossip" then return "Waiting for the NPC to finish speaking." end
end)
quests:Enqueue(H.Clip({ length = 30, present = { header = "Vartha Rockmane", label = "Gossip", portrait = { kind = "none" } } }))
Skin:UpdateControls()
Expect("a line held back is named alone, as the subtitle names it, not why it waits", Skin.title.text:GetText(), "Gossip")
holding = false
Spoken:StopAll()

---------------------------------------------------------------- under DialogueUI's open window
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Three", portrait = { kind = "none" } } }))
Skin:Tick(1)
DUI:Show()
local questWatch = Skin.dialogWatches and Skin.dialogWatches[DUI]
if questWatch then questWatch.scripts.OnShow(questWatch) end
Expect("DialogueUI's window opening hides this one at once, the dialog showing the line",
    tostring(Skin.wanted) .. " " .. tostring(Skin.frame:IsShown()), "false false")
env.PlayerFrame:RefreshConfig()
Expect("...and it stays hidden while the dialog is open", Skin.frame:IsShown(), false)
Spoken:SetPlayerHost(DUI)
env.PlayerFrame:RefreshConfig()
Expect("...unless it sits on the dialog", Skin.wanted, true)
Spoken:SetPlayerHost(nil)
DUI:Hide()
Skin:CloseStep(1)
Spoken:StopAll()

---------------------------------------------------------------- from the dialog to the top left
-- DialogueUI's window closes on a line that plays on: the window starts where the dialog was, as
-- large and as tall, at once and without a fade, then shrinks to its own size and height on its
-- way to the top left.
-- DialogueUI sets its window's OnHide with SetScript, dropping any hook: only the window's
-- children hear it close.
local function CloseDialog()
    DUI.hooks = {}
    DUI:SetScript("OnHide", function() end)
    DUI:Hide()
    -- Closing on its own line, its words fade first; then it hides.
    Skin:CloseStep(1)
    local watch = Skin.dialogWatches and Skin.dialogWatches[DUI]
    if watch and watch:GetParent() == DUI then watch.scripts.OnHide(watch) end
end
-- Opening: the lines queued while it is open, or just before (Spoken and DialogueUI hear the same
-- event), are its own.
local function OpenDialog()
    DUI:Show()
    local watch = Skin.dialogWatches and Skin.dialogWatches[DUI]
    if watch and watch:GetParent() == DUI then watch.scripts.OnShow(watch) end
end
saved.DialogueUI = nil
env.PlayerFrame:RefreshConfig()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
local own = Skin.frame:GetHeight()
-- DialogueUI hides the interface, so nothing has a place on screen to read: the dialog's comes
-- from where DialogueUI puts it, centred frameOffsetX from the screen's centre, drawn at 0.8.
local frameLeft, frameTop = Skin.frame.GetLeft, Skin.frame.GetTop
Skin.frame.GetLeft, Skin.frame.GetTop = function() return nil end, function() return nil end
local dialogLeft = 960 + DUI.frameOffsetX * 0.8 - DUI.frameWidth * 0.8 / 2
local dialogTop = 540 + DUI.frameHeight * 0.8 / 2
OpenDialog()
-- Its words, which fade on DialogueUI's window as it closes; its paper, which stays.
local words = CreateFrame("Frame", nil, DUI)
DUI.BackgroundFrame = CreateFrame("Frame", nil, DUI)
DUI.hooks = {}
-- DialogueUI hides it again from its own OnHide.
DUI:SetScript("OnHide", function(self) self:Hide() end)
DUI:Hide()
Skin:CloseStep(0.07)
Expect("the dialog closing on its line fades its words on DialogueUI's window first, its paper staying",
    DUI:IsShown() and words.alpha > 0 and words.alpha < 1 and (DUI.BackgroundFrame.alpha or 1) == 1, true)
Skin:CloseStep(0.1)
if DUI.scripts and DUI.scripts.OnHide then DUI.scripts.OnHide(DUI) end
Expect("...then closes, its words given back unseen, and still there when DialogueUI hides it again",
    tostring(DUI:IsShown()) .. " " .. words.alpha .. " " .. tostring(Skin.closing), "false 1 nil")
DUI:SetScript("OnHide", function() end)
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
DUI.BackgroundFrame = nil
-- A quest page closing where DialogueUI may show another page (it does not say otherwise): the
-- page stays as it is, words and all, until DialogueUI closes it; fading them first left bare
-- paper standing for up to a second.
OpenDialog()
Skin.questEvents.scripts.OnEvent(Skin.questEvents, "QUEST_FINISHED")
for _ = 1, 30 do Skin:CloseStep(0.05) end
Expect("a quest page closing that another page may follow keeps its words, for DialogueUI to close",
    tostring(DUI:IsShown()) .. " " .. words.alpha .. " " .. tostring(Skin.closing), "true 1 nil")
DUI:Hide()
Skin:CloseStep(0.06)
Expect("...its own Hide then fading the words first", tostring(DUI:IsShown()) .. " " .. tostring(words.alpha < 1), "true true")
Skin:CloseStep(0.06)
Expect("...and closing it, the words given back unseen",
    tostring(DUI:IsShown()) .. " " .. words.alpha .. " " .. tostring(Skin.closing), "false 1 nil")
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
Spoken:StopAll()
for _ = 1, 40 do Skin:Tick(0.05) end
-- The NPC having no other quest, DialogueUI expects no page to follow (GetQuestFinishedDelay under
-- 0.5): the window closes at once, through DialogueUI's own Hide, or as soon as the game says the
-- conversation is over. With another quest to offer, it is left to DialogueUI.
local talking = false
_G.C_PlayerInteractionManager = { IsInteractingWithNpcOfType = function() return talking end }
local followDelay = 0.03
DUI.GetQuestFinishedDelay = function() return followDelay end
OpenDialog()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
Skin.questEvents.scripts.OnEvent(Skin.questEvents, "QUEST_FINISHED")
Skin:CloseStep(0.06)
Expect("a quest page with nothing to follow fades its words at once", tostring(DUI:IsShown()) .. " " .. tostring(words.alpha < 1), "true true")
Skin:CloseStep(0.06)
Expect("...and closes, well before DialogueUI's own wait",
    tostring(DUI:IsShown()) .. " " .. words.alpha .. " " .. tostring(Skin.closing), "false 1 nil")
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
Expect("...the window flying out of it as when DialogueUI closes it", Skin.settling ~= nil, true)
Spoken:StopAll()
for _ = 1, 40 do Skin:Tick(0.05) end
OpenDialog()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
talking = true
Skin.questEvents.scripts.OnEvent(Skin.questEvents, "QUEST_FINISHED")
for _ = 1, 4 do Skin:CloseStep(0.05) end
Expect("...but while the game still has the NPC talking, it stays as it is, words and all",
    tostring(DUI:IsShown()) .. " " .. words.alpha, "true 1")
talking = false
Skin:CloseStep(0.02); Skin:CloseStep(0.06); Skin:CloseStep(0.06)
Expect("...closing once the conversation is over", tostring(DUI:IsShown()) .. " " .. words.alpha, "false 1")
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
Spoken:StopAll()
for _ = 1, 40 do Skin:Tick(0.05) end
followDelay = 0.5
OpenDialog()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
Skin.questEvents.scripts.OnEvent(Skin.questEvents, "QUEST_FINISHED")
for _ = 1, 8 do Skin:CloseStep(0.05) end
Expect("with another quest to offer, a page may follow: it stays as it is, for DialogueUI to close",
    tostring(DUI:IsShown()) .. " " .. words.alpha, "true 1")
DUI:Hide()
Skin:CloseStep(0.12)
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
_G.C_PlayerInteractionManager, DUI.GetQuestFinishedDelay = nil, nil
Spoken:StopAll()
for _ = 1, 40 do Skin:Tick(0.05) end
OpenDialog()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
Skin.questEvents.scripts.OnEvent(Skin.questEvents, "QUEST_FINISHED")
DUI:Hide()
Skin:CloseStep(0.12)
Skin.dialogWatches[DUI].scripts.OnHide(Skin.dialogWatches[DUI])
Expect("the dialog closing on a line starts the window where the dialog was, as large",
    Near(Skin.frame.scale, 0.8) and Near(Skin.frame.anchor.x * 0.8, dialogLeft) and Near(Skin.frame.anchor.y * 0.8, dialogTop)
    and Skin.frame.anchor.relativePoint == "BOTTOMLEFT", true)
Expect("...as tall as the dialog", Near(Skin.frame:GetHeight() * Skin.frame.scale, DUI.frameHeight * 0.8), true)
Expect("...in full at once, not fading in, its paper alone", Skin.frame:GetAlpha() .. " " .. tostring(Skin.fadeTime)
    .. " " .. Skin.content.alpha, "1 nil 0")
Skin:Tick(0.1)
Expect("...lifted off it first, up a touch and a touch larger, its shadow thrown, as the tuck's page is",
    Skin.frame.scale > 0.82 and Skin.frame.anchor.y * Skin.frame.scale > dialogTop and Skin.shadow:IsShown(), true)
Skin:Tick(0.14)
Expect("...halfway, shrinking", Skin.frame.scale < 0.8 and Skin.frame.scale > 0.52
    and Skin.frame:GetHeight() * Skin.frame.scale < DUI.frameHeight * 0.8
    and Skin.frame:GetHeight() * Skin.frame.scale > own * 0.52, true)
Expect("...on a curve, not straight at the corner", (function()
    local s = Skin.settling
    local u = (s.time - 0.1) / 0.42
    local straightX = s.left + (s.toLeft - s.left) * (u < 0.5 and 4 * u * u * u or 1 - (2 - 2 * u) ^ 3 / 2)
    return math.abs(Skin.frame.anchor.x * Skin.frame.scale - straightX) > 1
end)(), true)
Expect("...its paper alone as it flies, and never one image while it does", Skin.content.alpha .. " " .. tostring(Skin.buffered), "0 nil")
Skin:Tick(0.2)
Expect("...still on its way at 0.44 seconds", Skin.settling ~= nil, true)
Skin:Tick(0.1)
Expect("...and settled at the top left by 0.52, at its own size and height", AtTopLeft() and Near(Skin.frame:GetHeight(), own)
    and math.abs(Skin.frame.scale - 0.52) < 1e-6 and Skin.settling == nil, true)
Skin:Tick(0.05)
Expect("...landing with a little jump, up first, as the tuck's window gives, its words fading in on its paper",
    Skin.landing ~= nil and Skin.landing.rest ~= nil and Skin.frame.anchor.y > Skin.landing.rest[5]
    and Skin.content.alpha > 0 and Skin.content.alpha < 1, true)
Skin:Tick(1)
Expect("...then at rest, its shadow gone, its words all there", tostring(Skin.landing) .. " " .. tostring(AtTopLeft()) .. " "
    .. tostring(Skin.shadow:IsShown()) .. " " .. Skin.content.alpha, "nil true false 1")
-- Nowhere known to start from: it is simply put where it rests.
local WindowPlace = env.DialogueUITheme.WindowPlace
env.DialogueUITheme.WindowPlace = function() return nil end
Skin.frame:SetScale(0.9)
CloseDialog()
Expect("with no place for the dialog, the window goes straight to the top left at its own size",
    AtTopLeft() and math.abs(Skin.frame.scale - 0.52) < 1e-6 and Skin.settling == nil, true)
env.DialogueUITheme.WindowPlace = WindowPlace
Skin.frame.GetLeft, Skin.frame.GetTop = frameLeft, frameTop
Spoken:StopAll()
CloseDialog()
Expect("with no line playing on, the dialog closing moves nothing", Skin.settling, nil)
do
    -- A dialog closing while another's close still runs (the book view closed as the quest window
    -- closes): that one gets its words back and is hidden first.
    local hid = {}
    local first, second = CreateFrame("Frame"), CreateFrame("Frame")
    local firstWords = CreateFrame("Frame", nil, first)
    first:Show(); second:Show()
    Skin:FadeDialogOut(first, function(dialog) table.insert(hid, "first"); dialog:Hide() end)
    Skin:CloseStep(0.05)
    Skin:FadeDialogOut(second, function(dialog) table.insert(hid, "second"); dialog:Hide() end)
    Expect("a close started while another runs hides that one first, its words given back",
        table.concat(hid, ",") .. " " .. tostring(firstWords.alpha) .. " " .. tostring(first:IsShown()) .. " "
        .. tostring(Skin.closing ~= nil and Skin.closing.dialog == second), "first 1 false true")
    Skin:CloseStep(1)
    Expect("...then closes the second", table.concat(hid, ","), "first,second")
end

---------------------------------------------------------------- books and stones
-- Spoken Books' pages, in the art DialogueUI's book view draws them in: its paper for books and
-- letters, its stone for the materials it draws in stone. Every other line keeps the quest
-- window's parchment.
local BOOK = "Interface/AddOns/DialogueUI/Art/Book/TextureKit-"
local function Page(material)
    return H.Clip({ length = 30, present = { header = "Beyond the Dark Portal", label = "Page 1 of 4", bullet = "book",
        material = material, transcript = "Only a few months after Nethergarde's completion.",
        portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } })
end
local function Rows(texture) return texture.texCoord and (texture.texCoord[3] * 2048) .. "-" .. (texture.texCoord[4] * 2048) end
books:Enqueue(Page(nil))
Expect("a book's page is drawn in the book view's paper", Skin.parchments[1].texture .. " " .. Skin.parchments[3].texture,
    BOOK .. "Parchment.png " .. BOOK .. "Parchment.png")
Expect("...its top cap, the middle and its torn foot", Rows(Skin.parchments[1]) .. " " .. Rows(Skin.parchments[2]) .. " "
    .. Rows(Skin.parchments[3]), "0-256 256-896 1152-1408")
Expect("...the paper as wide as the window, as the book view's is its frame",
    Near(Skin.parchments[1]:GetWidth() * 768 / 1024, Skin.frame:GetWidth()), true)
Expect("...the middle running on under the foot, which fades in over it",
    Skin.parchments[2].anchor and Skin.parchments[2].anchor.y < 0, true)
Expect("...the face in the book's ring, the title over the book's line",
    Rows(Skin.headerSocket) .. " " .. Rows(Skin.headerDivider), "1616-1712 1520-1552")
Expect("...in the book view's title font", Skin.fonts.title, "Interface/AddOns/DialogueUI/Fonts/TrajanPro3SemiBold.ttf")
Expect("...in dark ink", table.concat(Skin.colors.title, ","), "0.19,0.17,0.13")
Spoken:StopAll()
local shadowAlpha
Skin.title.text.SetShadowColor = function(_, r, g, b, a) shadowAlpha = a end
books:Enqueue(Page("Stone"))
Expect("a tombstone's or plaque's in its stone", Skin.parchments[1].texture, BOOK .. "Metal.png")
Expect("...in pale letters with a shadow under them, as the book view's", table.concat(Skin.colors.title, ",") .. " "
    .. tostring(shadowAlpha), "0.9,0.9,0.9 1")
Spoken:StopAll()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
Expect("a quest's line is back in the quest window's parchment", Skin.parchments[1].texture
    .. " " .. Rows(Skin.parchments[3]), "Interface/AddOns/DialogueUI/Art/Theme_Brown/Parchment.png 896-1152")
Spoken:StopAll()
-- Another line following on screen in another art: another page, at its own height at once, its
-- words fading in as any next line's do.
books:Enqueue(Page("Stone"))
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
Skin:Tick(1)
Expect("(the stone's page on screen)", tostring(Skin.frame:IsShown()) .. " " .. Skin.parchments[1].texture, "true " .. BOOK .. "Metal.png")
Spoken:Skip()
Skin:Update()
Expect("a quest's line following a stone's on screen: the stone fades out whole first, still in stone",
    tostring(Skin.turning) .. " " .. Skin.parchments[1].texture, "true " .. BOOK .. "Metal.png")
Skin:Tick(1)
Expect("...then the quest's comes in on its own paper, at its own height, never easing from the stone's",
    Skin.parchments[1].texture .. " " .. tostring(Skin.heightWant) .. " " .. tostring(Skin.frame:GetHeight() == Skin.settledHeight),
    BROWN .. "Parchment.png nil true")
Spoken:StopAll()

-- The book view open: this window steps aside; closed on a page that reads on, the window takes
-- the book's place and size and goes to the top left, as from the quest window.
local BookView = _G.DUIBookFrame
local bookWatch = Skin.dialogWatches and Skin.dialogWatches[BookView]
Expect("the book view is watched, as the quest window is", bookWatch ~= nil, true)
if bookWatch then
    books:Enqueue(Page("Stone"))
    Skin:Tick(1)
    BookView:Show()
    bookWatch.scripts.OnShow(bookWatch)
    Expect("the book view opening hides this window, the book showing the page", Skin.frame:IsShown(), false)
    Skin.frame.GetLeft, Skin.frame.GetTop = function() return nil end, function() return nil end
    BookView:Hide()
    Skin:CloseStep(1)
    bookWatch.scripts.OnHide(bookWatch)
    local scale = Skin.frame.scale
    Expect("closed on a page reading on, the window starts where the book was, as wide, in stone",
        Near(Skin.frame.anchor.x * scale, 200 * 0.8) and Near(Skin.frame.anchor.y * scale, (100 + 477.87) * 0.8)
        and Near(Skin.frame:GetWidth() * scale, 409.6 * 0.8) and Skin.parchments[1].texture == BOOK .. "Metal.png", true)
    Expect("...as tall as the book", Near(Skin.frame:GetHeight() * scale, 477.87 * 0.8), true)
    Skin:Tick(0.7)
    Skin:Tick(1)
    Expect("...and settles at the top left, the stone's edge 16 from the screen's", AtTopLeft(123, 112) and Skin.settling == nil, true)
    Skin.frame.GetLeft, Skin.frame.GetTop = frameLeft, frameTop
    Spoken:StopAll()
end

---------------------------------------------------------------- a dialog's line joining the queue
-- A quest's line playing on, and a gravestone read meanwhile: closing the stone does not hand
-- this window its place (it turned from stone to parchment on its way); this window comes back as
-- it is, and the stone's page goes behind it: lifted off where the stone was, flown over, slid
-- under.
quests:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "The Hunt Begins", portrait = { kind = "none" } } }))
OpenDialog()
CloseDialog()
Skin:Tick(1)
stub.Advance(2)
BookView:Show()
bookWatch.scripts.OnShow(bookWatch)
books:Enqueue(Page("Stone"))
Skin.frame.GetLeft, Skin.frame.GetTop = function() return nil end, function() return nil end
BookView:Hide()
Expect("a stone closed while a quest's line plays, its line queued, fades its words on the stone first",
    tostring(BookView:IsShown()) .. " " .. tostring(Skin.closing ~= nil), "true true")
Skin:CloseStep(1)
bookWatch.scripts.OnHide(bookWatch)
local ui = UIParent:GetEffectiveScale()
local card = Skin.card
Expect("a stone closed while a quest's line plays does not take this window's place", Skin.settling, nil)
Expect("...this window comes back as it was, in the quest's parchment", tostring(Skin.wanted) .. " "
    .. Skin.parchments[1].texture, "true " .. BROWN .. "Parchment.png")
Expect("...and the stone's page is lifted off where the stone was, as large, in stone",
    Skin.tuck ~= nil and card:IsShown() and card.strips[1].texture == BOOK .. "Metal.png"
    and Near(card.anchor.x * card.scale, (200 + 409.6 / 2) * 0.8 / ui)
    and Near(card.anchor.y * card.scale, (100 + 477.87 / 2) * 0.8 / ui)
    and Near(card:GetWidth() * card.scale, 409.6 * 0.8 / ui), true)
Expect("...its paper alone, no words drawn on it", card.title == nil and card.body == nil, true)
Skin:TuckStep(0.5)
Expect("...flying over, smaller", card.scale < 1, true)
Skin:TuckStep(0.15)
Expect("...this window giving as the page goes under it", Skin.tuck ~= nil and Skin.tuck.rest ~= nil, true)
Skin:TuckStep(1)
Expect("...then gone behind it, the window where it rests",
    tostring(Skin.tuck) .. " " .. tostring(card:IsShown()) .. " " .. tostring(AtTopLeft()), "nil false true")
-- Nothing queued by it (a book with no recording): this window simply comes back.
stub.Advance(1)
BookView:Show()
bookWatch.scripts.OnShow(bookWatch)
BookView:Hide()
Skin:CloseStep(1)
bookWatch.scripts.OnHide(bookWatch)
Expect("a dialog closed on another's line, having queued nothing, brings this window back and nothing more",
    tostring(Skin.tuck) .. " " .. tostring(Skin.settling) .. " " .. tostring(Skin.wanted), "nil nil true")
-- A dialog opening while a page flies: cut short.
stub.Advance(2)
BookView:Show()
bookWatch.scripts.OnShow(bookWatch)
books:Enqueue(Page(nil))
BookView:Hide()
Skin:CloseStep(1)
bookWatch.scripts.OnHide(bookWatch)
Expect("a book's page goes behind in the book view's paper", card.strips[1].texture, BOOK .. "Parchment.png")
Skin:TuckStep(0.3)
stub.Advance(1)
OpenDialog()
Expect("...a dialog opening cuts its flight short", tostring(Skin.tuck) .. " " .. tostring(card:IsShown()), "nil false")
CloseDialog()
Expect("...and closing, having queued nothing, sends nothing after it", tostring(Skin.tuck) .. " "
    .. tostring(Skin.settling), "nil nil")
-- One quest giver's two quests taken one after the other: accepting the first brings its gossip
-- back in the same window, another page, while the first quest's line plays on. Accepting the
-- second closes the window on that line, the second's queued behind it: its page goes behind.
Spoken:StopAll()
stub.Advance(2)
OpenDialog()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Baine Bloodhoof", label = "First", portrait = { kind = "none" } } }))
stub.Advance(2)
DUI:ShowUI()
quests:Enqueue(H.Clip({ length = 30, present = { header = "Baine Bloodhoof", label = "Second", portrait = { kind = "none" } } }))
CloseDialog()
Expect("a giver's second quest accepted while the first's line plays sends its page behind this window",
    tostring(Skin.settling) .. " " .. tostring(Skin.tuck ~= nil) .. " " .. tostring(card:IsShown()), "nil true true")
Skin:TuckStep(1)
Expect("...this window showing the first quest's line as it was", Skin.title.text:GetText(), "First")
-- A quest accepted at once (the space bar): the window closes before its line is read, and the
-- line joins the queue just after. It is still the dialog's: it settles out of where the dialog
-- was, or, behind another line, its page goes behind this window.
Skin:TuckStep(1)
Spoken:StopAll()
for _ = 1, 40 do Skin:Tick(0.05) end
stub.Advance(2)
OpenDialog()
CloseDialog()
stub.Advance(0.4)
quests:Enqueue(H.Clip({ length = 30, present = { header = "Baine Bloodhoof", label = "Quick", portrait = { kind = "none" } } }))
Expect("a quest's line queued just after its window closed settles out of where the window was",
    Skin.settling ~= nil and Near(Skin.frame.scale, 0.8), true)
Skin:Tick(1); Skin:Tick(1)
stub.Advance(2)
OpenDialog()
CloseDialog()
stub.Advance(0.4)
quests:Enqueue(H.Clip({ length = 30, present = { header = "Baine Bloodhoof", label = "Quick Second", portrait = { kind = "none" } } }))
Expect("...and, another line playing, its page goes behind this window", tostring(Skin.settling) .. " " .. tostring(Skin.tuck ~= nil), "nil true")
Skin:TuckStep(1)
stub.Advance(2)
OpenDialog()
CloseDialog()
stub.Advance(0.4)
zones:Enqueue({ key = "z:99", path = "z99.ogg", length = 20, present = { header = "Durotar", label = "Razor Hill", transcript = "Lore." } })
Expect("a zone's line queued just after a quest window closed is not the window's",
    tostring(Skin.settling) .. " " .. tostring(Skin.tuck), "nil nil")
stub.Advance(2)
OpenDialog()
CloseDialog()
stub.Advance(1.5)
quests:Enqueue(H.Clip({ length = 30, present = { header = "Baine Bloodhoof", label = "Late", portrait = { kind = "none" } } }))
Expect("...nor a quest's line queued long after", tostring(Skin.settling) .. " " .. tostring(Skin.tuck), "nil nil")
Skin.frame.GetLeft, Skin.frame.GetTop = frameLeft, frameTop
Spoken:StopAll()

Expect("diagnostics name the style", string.find(Skin:Describe(), "enabled=true", 1, true) ~= nil, true)
Expect("...and the theme reading", string.find(env.DialogueUITheme:Describe(), "theme=1", 1, true) ~= nil, true)

SlashCmdList.SPOKEN("player minimal")
quests:Enqueue(H.Clip({ present = { header = "Eagan", label = "Back", portrait = { kind = "none" } } }))
Expect("switching back hides the DialogueUI window", Skin.frame:IsShown(), false)
Expect("...shows the small one", env.MinimalPlayer.frame:IsShown(), true)
Expect("...and moves the words with it", T.frame:GetParent(), env.MinimalPlayer.frame)
Expect("...in their own look again", T.style, nil)
Spoken:StopAll()

loaded = false
env.Addon.db.profile.Frame.Style = "dialogueui"
env.PlayerFrame:RefreshConfig()
Expect("DialogueUI gone, the window stands down", Skin.frame:IsShown(), false)
Expect("...for the small one", Spoken:GetPlayerStyle(), "minimal")

if Failures() > 0 then
    print(string.format("\n%d DialogueUI style test(s) failed", Failures()))
    os.exit(1)
end
print("\nAll DialogueUI style tests passed")

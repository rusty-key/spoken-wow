-- How the settings explain themselves: a greyed-out row says why, search reaches every Spoken
-- page and lands on the row, the welcome window applies each choice as it is made, and Reset
-- asks first. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

_G.UISpecialFrames = _G.UISpecialFrames or {}
local opened = {}
stub.modernSettings.OpenToCategory = function(category) table.insert(opened, category); return true end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
env.Addon:Enable()
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
local L, Options = env.L, env.Options
local home = _G.SpokenOptionsPanel.layout

local function Row(layout, label)
    for _, entry in ipairs(layout.entries) do
        if entry.label == label then return entry.frame end
    end
end
local function Tooltip(row)
    _G.GameTooltip.lines = {}
    row.scripts.OnEnter(row)
    return table.concat(_G.GameTooltip.lines, "|")
end

---------------------------------------------------------------- hidden when another way is chosen
-- A setting for another way of showing lines is hidden, and the page closes up round it.
local function Shown(control) return control.layoutRow.shown end
local function Box(text)
    for _, box in ipairs(home.boxes) do if box.section.text == text then return box end end
end
env.Addon:SetPlayerStyle("subtitle"); Options:UpdateRows()
local size = Row(home, "Window Size")
local typing = Row(home, "Subtitle Size")
Expect("a window setting is hidden once subtitles replace the window", Shown(size), false)
Expect("...and so is its section, with nothing left in it", Box(L.OPT_WINDOW_TITLE).shown, false)
Expect("the subtitle settings appear with subtitles chosen", Shown(typing), true)
local subtitlesTop = typing.layoutY
env.Addon:SetPlayerStyle("minimal"); Options:UpdateRows()
Expect("choosing the window brings its settings back", Shown(size), true)
Expect("...and hides the subtitles'", Shown(typing), false)
Expect("the rows below move up into the space", Row(home, "Volume Follows").layoutY > -100000, true)
env.Addon:SetPlayerStyle("subtitle"); Options:UpdateRows()
Expect("...and back down when subtitles return", typing.layoutY, subtitlesTop)

---------------------------------------------------------------- greyed out, and why
-- A setting waiting on a switch beside it stays, greyed, saying which switch.
env.Addon.db.profile.Transcript.Enabled = false; Options:UpdateRows()
Expect("a row waiting on a switch is greyed rather than hidden", Shown(typing), true)
Expect("...says which switch", typing.layoutReason, L.REASON_WORDS)
Expect("...faded, so it reads as asleep rather than broken", typing:GetAlpha() < 1, true)
Expect("...and its tooltip says so", Tooltip(typing):find(L.REASON_WORDS, 1, true) ~= nil, true)
env.Addon.db.profile.Transcript.Enabled = true; Options:UpdateRows()
Expect("turning the switch on wakes it", typing.layoutReason, nil)
Expect("...at full strength", typing:GetAlpha(), 1)
env.Addon:SetPlayerStyle("minimal"); Options:UpdateRows()

local music = Row(home, "Music")
env.Addon.db.profile.Audio.LowerOthers.Enabled = false; Options:UpdateRows()
Expect("the music level waits for its switch", music.layoutReason, L.REASON_LOWER)
env.Addon.db.profile.Audio.LowerOthers.Enabled = true
env.Addon.db.profile.Audio.SoundChannel = "Music"; Options:UpdateRows()
Expect("...and is never offered while the voices play through music", music.layoutReason, L.REASON_VOICE_CHANNEL)
env.Addon.db.profile.Audio.SoundChannel = "Master"; Options:UpdateRows()
Expect("...but is with them on Master", music.layoutReason, nil)

-- Any channel may be chosen; on Dialog a warning under it says what stops working.
local function WarningShown()
    for _, item in ipairs(home.items) do
        for _, row in ipairs(item.rows or {}) do
            if row.control.GetText and row.control:GetText() == L.OPT_CHANNEL_DIALOG_WARN then return row.shown == true end
        end
    end
    return false
end
Expect("no warning on Master", WarningShown(), false)
env.Addon.db.profile.Audio.SoundChannel = "Dialog"; Options:UpdateRows()
Expect("Dialog can be chosen, with a warning under it", WarningShown(), true)
env.Addon.db.profile.Audio.SoundChannel = "Master"; Options:UpdateRows()
Expect("...which goes with Master again", WarningShown(), false)

-- On Dialog, Silence NPC Voices would silence Spoken's voices too, so the queue never mutes it.
local silence = Row(home, "Silence NPC Voices")
Expect("Silence NPC Voices is offered on Master", silence.layoutReason, nil)
env.Addon.db.profile.Audio.SoundChannel = "Dialog"; Options:UpdateRows()
Expect("...and greyed on Dialog, saying why", silence.layoutReason, L.REASON_DIALOG_CHANNEL)
env.Addon.db.profile.Audio.SoundChannel = "Master"; Options:UpdateRows()
Expect("...and offered again on Master", silence.layoutReason, nil)

---------------------------------------------------------------- voice only
-- Nothing on screen is a way of showing lines like the other three, not a switch apart.
env.Addon:SetPlayerStyle("minimal")
env.Addon:SetPlayerStyle("none"); Options:UpdateRows()
Expect("voice only is a way of showing lines", env.Addon:PlayerStyle(), "none")
Expect("...hides the window's settings", Shown(size), false)
Expect("...and does not count as subtitles", Shown(Row(home, "Subtitle Size")), false)
Expect("...nor shows words to type out", Shown(Row(home, "Type Words Out")), false)
Expect("...nor leaves anything to lock in place", Shown(Row(home, "Lock Position")), false)
env.Addon:SetPlayerStyle("minimal"); Options:UpdateRows()
Expect("choosing a window shows it again", env.Addon:PlayerStyle(), "minimal")

---------------------------------------------------------------- keys
local bindings = assert(io.open(SPOKEN .. "Bindings.xml")):read("*a")
for _, name in ipairs({ "SPOKEN_PLAYPAUSE", "SPOKEN_SKIP", "SPOKEN_STOP" }) do
    Expect(name .. " is a key binding", bindings:find('name="' .. name .. '"', 1, true) ~= nil, true)
    Expect("...named in the game's key bindings list", type(_G["BINDING_NAME_" .. name]), "string")
end
Expect("...under a Spoken heading", _G.BINDING_HEADER_SPOKEN, "Spoken")

---------------------------------------------------------------- collected lines
local collected
for _, row in ipairs(_G.SpokenOptionsPanel.content.children) do
    local line = row.layoutStatusLine
    if line and (line.message == L.GATHER_NONE or line.message == L.GATHER_OFF) then collected = line end
end
Expect("contributions say how many lines are collected", collected ~= nil, true)
env.Gather:SetEnabled(true)
env.Gather:Add("q:1:accept", "x"); env.Gather:Add("q:2:accept", "y")
Options:UpdateRows()
Expect("...counting them as they come", collected and collected.message, format(L.GATHER_BADGE_FMT, env.Gather:Count()))

---------------------------------------------------------------- a part's page
local quests = QuestsPanel.panel.layout
local function Group(layout, text)
    for _, item in ipairs(layout.items) do
        if item.kind == "section" and item.text == text then return item end
    end
end
Expect("the Quests page has its module's switch, said plainly", Row(quests, VO.L.OPT_PART_SWITCH) ~= nil
    and VO.L.OPT_PART_SWITCH, "Enable Module")
Expect("...and is headed by its name", quests.intro ~= nil and quests.intro.name.text, VO.L.OPT_PAGE_TITLE)
Expect("...and no paragraph under it, as the game's own pages have none", quests.intro.text, nil)
do
    -- Every pack listed, by a name that says what it is: installed ones by version, the rest
    -- with a button to get them.
    local horde = Row(quests, "Voice Pack (Horde Quests)")
    local all = Row(quests, "Voice Pack (All Quests)")
    Expect("the Quests page lists every voice pack, named for what it holds", horde ~= nil and all ~= nil, true)
    Expect("...one not installed has a Download button in place of its version",
        horde.layoutGet and horde.layoutButton.text, "Download")
end
-- Switched from Spoken's page while the Quests page is hidden: the page is drawn again for it.
_G.Spoken:SetPartOn("quests", false)
local autoplay = Row(quests, VO.L.OPT_PANEL_AUTOPLAY)
Expect("switching Quests off from Spoken's page greys out its page at once", autoplay.layoutReason, VO.L.REASON_PART_OFF)
Expect("...a checkbox's label in the game's grey with its box", autoplay.alpha < 1 and autoplay.text.layoutGreyed, true)
Expect("...the titles of its groups with it", Group(quests, VO.L.OPT_SECTION_DIALOGUE).greyed, true)
Expect("...and everything else on it: fixing a problem", Row(quests, VO.L.OPT_PRINT_DIAG).layoutReason, VO.L.REASON_PART_OFF)
Expect("...every title", Group(quests, VO.L.OPT_SECTION_TROUBLE).greyed, true)
do
    local pack = Row(quests, "Voice Pack (Horde Quests)")
    Expect("...and a voice pack's Download button, which cannot be clicked", pack.layoutButton.enabled, false)
end
Expect("...but not its own switch", Row(quests, VO.L.OPT_PART_SWITCH).layoutReason, nil)
_G.Spoken:SetPartOn("quests", true); Options:UpdateRows(); quests:Refresh()
Expect("switching it back on wakes the page", autoplay.layoutReason, nil)
Expect("...and its titles", Group(quests, VO.L.OPT_SECTION_DIALOGUE).greyed, false)

---------------------------------------------------------------- under the page's divider
-- The first row on a page stands as far under the divider as the section's title after it stands
-- under it: 25, on Spoken's page (the search box) and on a module's (its Enable Module). The rows
-- start 2 under the divider.
do
    local search, modules
    for _, item in ipairs(home.items) do
        if item.kind == "row" and not search then search = item.control end
        if item.kind ~= "row" and item.kind ~= "intro" and item.heading and not modules then modules = item.heading end
    end
    local above = 2 - search.layoutY
    local below = (search.layoutY - search.layoutHeight) - (modules.layoutY - 16)
    Expect("the search box is as far under the divider as Modules' title is under it", above .. " " .. below, "25 25")
    Expect("...and a module's Enable switch as far", 2 - Row(quests, VO.L.OPT_PART_SWITCH).layoutY, 25)
end

---------------------------------------------------------------- a page already showing follows its settings
-- The client fires no OnShow for a page already on screen, so a setting changed under it -- the
-- page's Defaults, a profile switched or copied -- is read again by Refresh.
do
    local lock = Row(home, L.OPT_LOCK_FRAME)
    env.Addon.db.profile.Frame.LockFrame = true; home:Refresh()
    Expect("Refresh shows a checkbox's setting as it is now", lock.checked, true)
    env.Addon.db.profile.Frame.LockFrame = false; home:Refresh()
    Expect("...either way", lock.checked, false)
    local scale = Row(home, L.OPT_SCALE)
    local before = env.Addon.db.profile.Frame.FrameScale
    env.Addon.db.profile.Frame.FrameScale = 1.25; home:Refresh()
    Expect("...and a slider's", scale.layoutValue and scale.layoutValue.text, "125%")
    env.Addon.db.profile.Frame.FrameScale = before; home:Refresh()
end

---------------------------------------------------------------- a module's row leads to its page
do
    local card = Row(home, L.OPT_PART_QUESTS)
    _G.Spoken:SetPartOn("quests", false); Options:UpdateRows()
    Expect("a module switched off still opens its page from its row: the page has its own switch",
        card.button and card.button.enabled, true)
    _G.Spoken:SetPartOn("quests", true); Options:UpdateRows()
end

---------------------------------------------------------------- search
local Search = env.Search
-- A row the current choices hide has no place on its page to land on: with a window chosen,
-- the subtitles' own rows are not offered.
local function Labels(results)
    local labels = {}
    for _, result in ipairs(results) do labels[result.entry.label] = true end
    return labels
end
Expect("search passes by a row the current choices hide", Labels(Search:Find("subtitle size"))["Subtitle Size"], nil)
env.Addon:SetPlayerStyle("subtitle"); Options:UpdateRows()
local found = Search:Find("subtitle size")
Expect("search finds a setting by its name", found[1] and found[1].entry.label, "Subtitle Size")
Expect("...on the page it is on", found[1] and found[1].page.name, L.OPT_HOME_TITLE)
found = Search:Find("greetings")
Expect("search reaches the pages under Spoken too", found[1] and found[1].page.name, "Quests")
Expect("a word from a tooltip is enough", Search:Find("footsteps")[1] and Search:Find("footsteps")[1].entry.label, "Effects")
Expect("every word must match", #Search:Find("subtitle footsteps"), 0)
Expect("case and spacing do not matter", Search:Find("  SUBTITLE   size ")[1].entry.label, "Subtitle Size")
local function Hit(query)
    for _, result in ipairs(Search:Find(query)) do
        if result.entry.label == query then return result.entry.frame end
    end
end
-- A module or a style is found on its own row of its list, not at the list's top: Books, after
-- Quests, and Voice Only, the last style.
for _, query in ipairs({ L.OPT_PART_BOOKS, L.OPT_STYLE_NONE }) do
    local hit = Hit(query)
    local list = hit and hit.layoutRow and hit.layoutRow.control
    local index
    for i, row in ipairs(list and list.layoutRows or {}) do if row == hit then index = i end end
    Expect("search lands on " .. query .. " on its own row of its list",
        index ~= nil and index > 1 and hit.layoutY == list.layoutY - 4 - (index - 1) * hit.height, true)
end
env.Addon:SetPlayerStyle("minimal"); Options:UpdateRows()

Search.box:SetText("greetings"); Search.box.handlers.OnTextChanged(Search.box)
Expect("typing lists the results", Search.results:IsShown(), true)
Search.box:SetText("zzzz"); Search.box.handlers.OnTextChanged(Search.box)
Expect("...and says so when nothing matches", Search.rows[1].text.text:find(L.SEARCH_NONE, 1, true) ~= nil, true)
Search.box:SetText("greetings"); Search.box.handlers.OnTextChanged(Search.box)
Search.box.handlers.OnEnterPressed(Search.box)
local last = opened[#opened]
Expect("Enter opens the first result's own page", type(last) == "table" and last.name or last, "Quests")
stub.Advance(0.1)
Expect("...and lights up the row it found", quests.glow ~= nil and quests.glow:IsShown(), true)
-- The client runs OnUpdate every frame; the stub does not, so the fade is driven here.
quests.glow.scripts.OnUpdate(quests.glow, 3)
Expect("...for a moment", quests.glow:IsShown(), false)

---------------------------------------------------------------- not in combat
-- The client will not open the settings window for an addon in combat, so the minimap
-- button's click would seem to do nothing. It says why instead.
local errors = {}
_G.UIErrorsFrame = { AddMessage = function(_, text) table.insert(errors, text) end }
_G.ERR_NOT_IN_COMBAT = "You can't do that while in combat"
_G.InCombatLockdown = function() return true end
local openedBefore = #opened
Options:Open()
Expect("in combat the settings are not opened", #opened, openedBefore)
Expect("...and the player is told why", errors[1], L.OPT_OPEN_COMBAT)
Options:OpenPage(1)
Expect("a feature's page says the same", errors[2], L.OPT_OPEN_COMBAT)
Expect("an opener with no words of its own gets the client's",
    _G.SpokenLayout.OpenCategory({}) and errors[3], _G.ERR_NOT_IN_COMBAT)
_G.InCombatLockdown = function() return false end
Options:Open()
Expect("out of combat they open", #opened, openedBefore + 1)
_G.InCombatLockdown, _G.UIErrorsFrame, _G.ERR_NOT_IN_COMBAT = nil, nil, nil

---------------------------------------------------------------- reset asks first
-- The header's Defaults button, as the game's own pages have it.
local reset = home.defaults
local reloads = stub.reloads
env.Addon.db.profile.Frame.FrameScale = 1.5
reset.scripts.OnClick(reset)
local popup = stub.popups[#stub.popups]
Expect("reset asks before it does anything", popup and popup.key, "SPOKEN_LAYOUT_CONFIRM")
Expect("...naming what will happen", popup and popup.args[1], L.OPT_RESET_ALL_CONFIRM)
Expect("...and changes nothing until answered", env.Addon.db.profile.Frame.FrameScale, 1.5)
popup.dialog.OnCancel()
popup.dialog.OnAccept()
Expect("cancelling forgets the reset", stub.reloads, reloads)
reset.scripts.OnClick(reset)
stub.popups[#stub.popups].dialog.OnAccept()
Expect("accepting resets", env.Addon.db.profile.Frame.FrameScale, 0.7)
Expect("...and reloads to finish", stub.reloads, reloads + 1)

---------------------------------------------------------------- welcome
local Welcome = env.Welcome
-- Drawing a subtitle needs font metrics this stub does not have; tests/captions covers that.
-- Here it is enough to know the welcome asked for one.
local sample = false
env.Subtitle.ShowSample = function(_, on) sample = on and true or false end
env.Subtitle.IsShowingSample = function() return sample end
env.Addon.db.global.Welcomed = nil
stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(2.1)
Expect("the welcome opens at the first login after it ships", Welcome.frame and Welcome.frame:IsShown(), true)
Expect("it offers the parts as a list, as Home does", #Welcome.modules, 3)
Expect("...under its header, the paragraph saying what the window is for",
    Welcome.layout.intro.text ~= nil and Welcome.layout.intro.text.text, L.WELCOME_INTRO)
Expect("...which the settings pages, like the game's own, do without", home.intro.text, nil)
Expect("...and the ways of showing lines as a list, as Spoken's settings page has them", #Welcome.styles >= 3, true)
local subtitles
for _, row in ipairs(Welcome.styles) do if row.layoutTile.value == "subtitle" then subtitles = row end end
subtitles.scripts.OnClick(subtitles)
Expect("a choice applies at once", env.Addon:PlayerStyle(), "subtitle")
Expect("...and only one way of showing lines is picked", (function()
    local picked = 0
    for _, row in ipairs(Welcome.styles) do if row.layoutSelected then picked = picked + 1 end end
    return picked
end)(), 1)
local quests = Welcome.modules[1]
quests.scripts.OnClick(quests)
Expect("a click on its row turns its part off", env.Sources:IsTurnedOff(env.Sources:Get("quests") or { key = "quests" }), true)
quests.scripts.OnClick(quests)
Expect("...and on again", env.Sources:IsTurnedOff(env.Sources:Get("quests") or { key = "quests" }), false)
Expect("choosing subtitles only chooses them", env.Subtitle:IsShowingSample(), false)
Welcome.preview.scripts.OnClick(Welcome.preview)
Expect("...and the Preview button shows one to place", env.Subtitle:IsShowingSample(), true)
Welcome.frame:Hide()
-- The client fires OnHide whichever way a window closes; the stub leaves that to the test.
Welcome.frame.scripts.OnHide(Welcome.frame)
Expect("closing it, however it closes, means it has been seen", env.Addon.db.global.Welcomed, true)
Expect("...and the sample goes with it", env.Subtitle:IsShowingSample(), false)
Welcome.frame.shown = false
stub.FireEvent("PLAYER_ENTERING_WORLD"); stub.Advance(2.1)
Expect("it does not come back by itself", Welcome.frame:IsShown(), false)
Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

---------------------------------------------------------------- keys, set right there
-- The game's bindings, enough of them: a key to an action, and the moves already bound.
local bound, saved = { W = "MOVEFORWARD" }, 0
_G.BINDING_NAME_MOVEFORWARD = "Move Forward"
function _G.GetBindingKey(action)
    local keys = {}
    for key, name in pairs(bound) do if name == action then table.insert(keys, key) end end
    table.sort(keys)
    return unpack(keys)
end
function _G.GetBindingAction(key) return bound[key] or "" end
function _G.SetBinding(key, action) bound[key] = action end
function _G.SaveBindings() saved = saved + 1 end
function _G.GetBindingText(key) return key end
local ctrl = false
function _G.IsControlKeyDown() return ctrl end
Options:UpdateRows()
local play = Row(home, L.BIND_PLAYPAUSE)
Expect("a key not set says so", play.message, L.OPT_KEY_NONE)
Expect("...and its field takes no keys until clicked: one with a key script gets them all",
    play.scripts.OnKeyDown, nil)
play.scripts.OnClick(play, "LeftButton")
Expect("a click on it listens for a key, and says so", play.message, L.OPT_KEY_PRESS)
play.scripts.OnKeyDown(play, "LCTRL")
Expect("...waiting past a modifier on its own", play.listening, true)
ctrl = true
play.scripts.OnKeyDown(play, "P")
ctrl = false
Expect("...and binds the key pressed, with its modifiers", bound["CTRL-P"], "SPOKEN_PLAYPAUSE")
Expect("...saved for next time", saved, 1)
Expect("...shown in its field", play.message, "CTRL-P")
play.scripts.OnClick(play, "LeftButton")
play.scripts.OnKeyDown(play, "ESCAPE")
Expect("Escape stops listening and changes nothing", not play.listening and bound["CTRL-P"], "SPOKEN_PLAYPAUSE")
Expect("...and gives the keys back to the game", play.scripts.OnKeyDown, nil)
local popups = #stub.popups
play.scripts.OnClick(play, "LeftButton")
play.scripts.OnKeyDown(play, "W")
Expect("a key used for something else is asked about first", #stub.popups, popups + 1)
Expect("...not taken", bound.W, "MOVEFORWARD")
stub.popups[#stub.popups].dialog.OnAccept()
Expect("...and taken once the player says so", bound.W, "SPOKEN_PLAYPAUSE")
Expect("...the action's old key let go", bound["CTRL-P"], nil)
play.scripts.OnClick(play, "RightButton")
Expect("a right click clears it", bound.W, nil)
Expect("...and the field says so", play.message, L.OPT_KEY_NONE)

---------------------------------------------------------------- another profile applies at once
-- Switched, copied over or reset, from Spoken's page or anywhere else: the player's settings
-- take effect then, not at the next reload. The stub's AceDB fires no callbacks, so the ones
-- the player registers are kept here and fired by hand.
do
    local AceDB = _G.LibStub("AceDB-3.0")
    local realNew, registered = AceDB.New, {}
    AceDB.New = function(lib, name, defaults)
        local made = realNew(lib, name, defaults)
        made.RegisterCallback = function(_, event, fn) registered[event] = fn end
        return made
    end
    local keep = env.Addon.db
    env.Addon.db = nil
    env.Addon:InitDB()
    AceDB.New = realNew
    Expect("the player listens for a profile switched, copied or reset",
        registered.OnProfileChanged ~= nil and registered.OnProfileCopied ~= nil and registered.OnProfileReset ~= nil, true)
    local applied = {}
    local function Count(object, method)
        local real = object[method]
        object[method] = function(...) applied[method] = (applied[method] or 0) + 1; return real(...) end
        return function() object[method] = real end
    end
    local undo = { Count(env.PlayerFrame, "RefreshConfig"), Count(env.Transcript, "RefreshConfig"),
        Count(env.Minimap, "Refresh"), Count(Options, "UpdateRows") }
    local lock = Row(home, L.OPT_LOCK_FRAME)
    env.Addon.db.profile.Frame.LockFrame = true
    registered.OnProfileChanged("OnProfileChanged", env.Addon.db, "Other")
    Expect("...and puts the window, the captions and the minimap button in step",
        (applied.RefreshConfig or 0) >= 2 and applied.Refresh == 1, true)
    Expect("...and the page with them", lock.checked, true)
    -- Which modules are on is the profile's too, so each is told to put its buttons in step.
    local told = {}
    _G.Spoken:RegisterCallback("PART_SWITCHED", function(key, on) told[key] = on end)
    local quests = env.Sources.byKey.quests and "quests" or next(env.Sources.byKey)
    env.Addon.db.profile.Parts[quests] = false
    registered.OnProfileChanged("OnProfileChanged", env.Addon.db, "Other")
    Expect("...and every module, a module the profile has off told it is off", told[quests], false)
    env.Addon.db.profile.Parts[quests] = nil
    for _, restore in ipairs(undo) do restore() end
    env.Addon.db = keep
    Options:UpdateRows()
end

---------------------------------------------------------------- preview on the styles' title line
-- On Spoken's page the Preview button is the Narrator Style section's: at the end of its title's
-- line, level with it, and as wide as its words.
do
    local section
    for _, item in ipairs(home.items) do
        if item.kind == "section" and item.text == env.L.OPT_PLAYER_STYLE then section = item end
    end
    local button = section and section.button
    Expect("Narrator Style has the Preview button", button ~= nil, true)
    if button then
        section.place(-100)
        Expect("...on its title's line", button.anchor.y > -100 - 45 and button.anchor.y < -100, true)
        Expect("...at the line's end", button.anchor.point, "TOPRIGHT")
        Expect("...as wide as its words", button.width, button:GetTextWidth() + 24)
    end
end

---------------------------------------------------------------- links out of the game
-- GitHub, Discord, CurseForge, Wago and Rusty's Buy Me a Coffee page, a row each: the icon in a module card's icon frame where a row's
-- label starts, then a box holding the address. The game cannot open a page, so the address is
-- there to copy: a click selects it, and nothing typed over it stays.
do
    local links = env.Options.links
    Expect("Spoken's page has its links", links ~= nil and #links, 5)
    if links then
        local names = {}
        for _, frame in ipairs(links) do table.insert(names, frame.layoutLink.title) end
        Expect("...GitHub, Discord, CurseForge, Wago and Buy Me a Coffee", table.concat(names, ", "),
            "GitHub, Discord, CurseForge, Wago, Buy Me a Coffee")
        -- A row outside the narrator style's box, which moves its own rows in by its padding.
        local boxed = {}
        for _, item in ipairs(home.items) do
            if item.kind == "group" then
                for _, section in ipairs(item.sections) do boxed[section] = true end
            end
        end
        local caption
        for _, item in ipairs(home.items) do
            for _, row in ipairs(not boxed[item] and item.rows or {}) do
                -- A row shown: one hidden (the Compendium's, with no part's tab here) has no place.
                if not caption and row.control.layoutLabel and row.control.layoutLabel.anchor then
                    caption = row.control.layoutLabel
                end
            end
        end
        Expect("...starting where the rows' names do", caption and links[1].anchor.x, caption and caption.anchor.x)
        Expect("...each on a row of its own", links[1].anchor.x == links[2].anchor.x
            and links[2].anchor.y < links[1].anchor.y and links[3].anchor.y < links[2].anchor.y, true)
        local box = links[2].box
        Expect("...with its address in a box after the icon", box and box:GetText(), "https://discord.gg/HEGUgn6Yf")
        Expect("...on the icon's row", box and box.anchor.x > links[2].anchor.x
            and box.anchor.y < links[2].anchor.y and box.anchor.y > links[2].anchor.y - 32, true)
        local ends = {}
        for _, frame in ipairs(links) do table.insert(ends, frame.box.anchor.x + frame.box.width) end
        Expect("...the boxes ending together", ends[1] == ends[2] and ends[2] == ends[3], true)
        box.text = ""
        box.handlers.OnShow(box)
        Expect("...given again when it shows, as the game drops text set before then", box:GetText(),
            "https://discord.gg/HEGUgn6Yf")
        box.focused, box.highlighted = false, false
        links[2].scripts.OnMouseUp(links[2])
        Expect("a click on the icon selects the address", box.focused and box.highlighted, true)
        box:SetText("typed over")
        box.handlers.OnTextChanged(box)
        Expect("...which cannot be typed over", box:GetText(), "https://discord.gg/HEGUgn6Yf")
    end
end

os.exit(Failures() == 0 and 0 or 1)

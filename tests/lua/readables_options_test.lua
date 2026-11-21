-- The Readables addon's settings page: its switches and the button that undoes the reading record,
-- laid out by Spoken's UI/Layout.lua and nested under Spoken's entry. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenReadablesSettings = nil
_G.SpokenReadablesCharacter = nil
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()

local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Options", "Events", "Commands" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
B:SetupOptions()

---------------------------------------------------------------- registration
Expect("the page is Spoken's, nested under its entry", B.optionsPage ~= nil and B.optionsPage.name, B.L.OPT_PAGE_TITLE)

---------------------------------------------------------------- what is on it
-- The rows live in the scroller's content frame, not on the panel: the settings canvas
-- neither scrolls nor clips, so a panel with more rows than fit draws over the world.
local content = B.optionsPanel.content
local headings, checkboxes, buttons = {}, {}, {}
for _, child in ipairs(content.children) do
    if child.layoutHeading then
        table.insert(headings, child.text)
    elseif child.layoutStatusLine then
        -- A voice pack's version, on the dropdown's face: neither a switch nor a button.
    elseif type(child.text) == "table" then
        -- A checkbox carries its label as a fontstring beside it; a button carries its own.
        table.insert(checkboxes, child)
    -- A row's hover band is clickable too, but carries no words of its own.
    elseif type(child.text) == "string" and child.text ~= "" and child.scripts and child.scripts.OnClick then
        -- Clickable, which is what separates a button from the explanatory note above the
        -- first section: both are rows carrying a string.
        table.insert(buttons, child)
    end
end

Expect("every section is there", table.concat(headings, "|"),
    "When to Read|Voice Packs|Reading History")
local W = _G.Spoken:Words()
Expect("every switch has a row, the module's own first", table.getn(checkboxes) .. " " .. checkboxes[1].text.text,
    "7 " .. W.MODULE_SWITCH)
local function Button(text)
    for _, button in ipairs(buttons) do if button.text == text then return button end end
end
Expect("the voice pack has its Download button", Button("Download") ~= nil, true)
-- Diagnostics and Report a Problem are on Spoken's page, for every module at once.
Expect("the voice packs end with Play a Test Line, as on every module's page",
    tostring(Button("Play a Test Line") ~= nil) .. " " .. tostring(Button("Show Diagnostics") ~= nil), "true false")

local function Labelled(text)
    for _, box in ipairs(checkboxes) do
        if box.text and box.text.text == text then return box end
    end
end

---------------------------------------------------------------- the switches write through
local once = Labelled("Read Only Once")
Expect("the read-once switch is on the panel", once ~= nil, true)
Expect("...reading the default off", once.checked, false)

-- What the client does on a click: flip the box, then run the handler.
once:SetChecked(true)
once.scripts.OnClick(once)
Expect("ticking it turns the setting on", SpokenReadablesSettings.readOnce, true)

once:SetChecked(false)
once.scripts.OnClick(once)
Expect("...and clearing it turns the setting off", SpokenReadablesSettings.readOnce, false)

local autoplay = Labelled("Read Automatically")
Expect("autoplay is on the panel too, defaulting on", autoplay and autoplay.checked, true)
autoplay:SetChecked(false)
autoplay.scripts.OnClick(autoplay)
Expect("...and unticking it is the same as /spw autoplay", SpokenReadablesSettings.autoplay, false)
-- Only automatic reading skips a book already heard (Events.lua): the switch sits under
-- autoplay and greys out without it.
Expect("...greying out Read Only Once, which only automatic reading heeds", once.enabled, false)
Expect("...which is indented under it", once.text.anchor.x > autoplay.text.anchor.x, true)
autoplay:SetChecked(true)
autoplay.scripts.OnClick(autoplay)
Expect("ticking it again brings Read Only Once back", once.enabled, true)

local oneLine = Labelled("Read Book as One Line")
Expect("Read Book as One Line is on the panel, defaulting on", oneLine ~= nil and oneLine.checked, true)
if oneLine then
    oneLine:SetChecked(false)
    oneLine.scripts.OnClick(oneLine)
    Expect("...and unticking it is the same as /spw oneline", SpokenReadablesSettings.bookAsOneLine, false)
    oneLine:SetChecked(true)
    oneLine.scripts.OnClick(oneLine)
    -- One line for the whole book is a choice only where the whole book is read.
    local whole = Labelled("Read Whole Book")
    whole:SetChecked(false)
    whole.scripts.OnClick(whole)
    Expect("...under Read Whole Book, greyed while it is off, saying why", tostring(oneLine.text.anchor.x > whole.text.anchor.x)
        .. " " .. tostring(oneLine.layoutReason), "true " .. B.L.REASON_WHOLE_BOOK)
    whole:SetChecked(true)
    whole.scripts.OnClick(whole)
end

local close = Labelled("Close Book When Done Reading")
Expect("Close Book When Done Reading is on the panel, defaulting off", close and close.checked, false)
close:SetChecked(true)
close.scripts.OnClick(close)
Expect("...and ticking it is the same as /spw close", SpokenReadablesSettings.closeWhenRead, true)
close:SetChecked(false)
close.scripts.OnClick(close)

---------------------------------------------------------------- the gather switch stays in the player's settings
-- The switch is the player's alone: quests and readables both feed the one store, so a
-- mirror here could only ever repeat it -- a reader cannot have pages off and lines on.
-- Its command is Spoken's too (/sp collect): /spw gather no longer reaches it.
local gathering = _G.Spoken.Gather:IsEnabled()
SlashCmdList["SPOKENREADABLES"]("gather")
Expect("/spw gather leaves the player's switch alone", _G.Spoken.Gather:IsEnabled(), gathering)

---------------------------------------------------------------- forgetting what was read
SpokenReadablesCharacter.read = { ["Hillsbrad Town Registry"] = true, ["Jitters' Journal"] = true }
local forget = Button("Forget Readables Heard")
Expect("the button says what it does", forget ~= nil, true)
-- It only matters while a writing is read once.
B.optionsPage.layout:Refresh()
Expect("...greyed while Read Only Once is off, saying why", forget.layoutReason, B.L.REASON_READ_ONCE)
SpokenReadablesSettings.readOnce = true
B.optionsPage.layout:Refresh()
Expect("...and live with it on", forget.layoutReason, nil)
forget.scripts.OnClick(forget)
SpokenReadablesSettings.readOnce = false

local left = 0
for _ in pairs(SpokenReadablesCharacter.read) do left = left + 1 end
Expect("pressing it clears this character's record", left, 0)

-- Derived from the layout rather than written down, so adding a row cannot leave a section
-- below the reach of the scrollbar.
Expect("the scroller is told how tall the content grew", content.height > 0, true)

---------------------------------------------------------------- closing a book, and saying why
do
    local stopped = false
    local stopReading, placeOf = B.StopReading, B.PlaceOf
    B.StopReading = function(_, book) stopped = book end
    B.PlaceOf = function(_, pageId) return pageId and 261 end
    SpokenReadablesSettings.stopOnClose = false
    B.lastPage = 262
    B:OnTextClosed()
    Expect("a closed book reads on by default", stopped, false)
    SpokenReadablesSettings.stopOnClose = true
    B.lastPage = 262
    B:OnTextClosed()
    Expect("...and with Stop When Book Closes on, that book stops, not the readables waiting after it",
        stopped, 261)
    B.StopReading, B.PlaceOf = stopReading, placeOf
    SpokenReadablesSettings.stopOnClose = false

    local said = {}
    local print_ = B.Print
    B.Print = function(_, message, ...) table.insert(said, select("#", ...) > 0 and format(message, ...) or message) end
    local onScreen = B.PageOnScreen
    B.PageOnScreen = function() return nil end
    B.source = B.source or {}
    SpokenReadablesSettings.debug = false
    B:OnTextReady()
    Expect("nothing is said in chat unasked", #said, 0)
    SpokenReadablesSettings.debug = true
    B:OnTextReady()
    Expect("...and with /spb debug on, why a page was not read", said[1] ~= nil and said[1]:find("not read", 1, true) ~= nil, true)
    SpokenReadablesSettings.debug = false
    B.PageOnScreen, B.Print = onScreen, print_
end

---------------------------------------------------------------- starting over
-- Found Only, Voiced Only and By Zone go back with the rest, and an open Readables tab is drawn again.
do
    local redrawn = 0
    B.RefreshReadables = function() redrawn = redrawn + 1 end
    SpokenReadablesSettings.compendiumFoundOnly = false
    -- The page's Defaults button, in its header as on the game's own pages.
    local reset = B.optionsPage.layout.defaults
    reset.scripts.OnClick(reset)
    stub.popups[#stub.popups].dialog.OnAccept()
    Expect("resetting the page puts Found Only back to its default, on, and draws the Readables tab again",
        tostring(SpokenReadablesSettings.compendiumFoundOnly) .. " " .. redrawn, "true 1")
    B.RefreshReadables = nil
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll readables options tests passed")

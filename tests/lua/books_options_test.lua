-- The books addon's settings panel: three switches, the language choices and the button that
-- undoes the third, laid out by the same UI/Layout.lua every Spoken addon carries. The panel is
-- this addon's own canvas rather than a section of the player's, because its settings are about
-- books and must be reachable with the player absent. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenBooksDB = nil
_G.SpokenBooksCharDB = nil

local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Layout", "UI/Options", "Events", "Commands" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("SpokenBooks", B)
end
B:InitDB()
-- The player the gather switch belongs to: faked, since this suite boots Books alone.
-- The /spb gather shortcut and the status line read it.
_G.Spoken = { Gather = { _on = nil,
    IsEnabled = function(self) if self._on == nil then return true end return self._on end,
    SetEnabled = function(self, v) self._on = v and true or false end } }
B:SetupOptions()

---------------------------------------------------------------- registration
Expect("the panel is registered as a settings category", stub.settingsCategories[1] ~= nil, true)
Expect("...under its own name", stub.settingsCategories[1] and stub.settingsCategories[1].name,
    "Spoken Books")

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
    "When to Read|Language|Reading History|Voice Packs|Fix a Problem|Start Over")
Expect("every switch has a row", table.getn(checkboxes), 4)
local function Button(text)
    for _, button in ipairs(buttons) do if button.text == text then return button end end
end
Expect("the voice pack has its Download button", Button("Download") ~= nil, true)
Expect("Fix a Problem has the same buttons as every module's page",
    Button("Play a Test Line") ~= nil and Button("Show Diagnostics") ~= nil and Button("Report a Problem") ~= nil, true)

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
Expect("ticking it turns the setting on", SpokenBooksDB.readOnce, true)

once:SetChecked(false)
once.scripts.OnClick(once)
Expect("...and clearing it turns the setting off", SpokenBooksDB.readOnce, false)

local autoplay = Labelled("Read Automatically")
Expect("autoplay is on the panel too, defaulting on", autoplay and autoplay.checked, true)
autoplay:SetChecked(false)
autoplay.scripts.OnClick(autoplay)
Expect("...and unticking it is the same as /spb autoplay", SpokenBooksDB.autoplay, false)
-- Only automatic reading skips a book already heard (Events.lua): the switch sits under
-- autoplay and greys out without it.
Expect("...greying out Read Only Once, which only automatic reading heeds", once.enabled, false)
Expect("...which is indented under it", once.text.anchor.x > autoplay.text.anchor.x, true)
autoplay:SetChecked(true)
autoplay.scripts.OnClick(autoplay)
Expect("ticking it again brings Read Only Once back", once.enabled, true)

---------------------------------------------------------------- the gather switch stays in the player's settings
-- The switch is the player's alone: quests and books both feed the one store, so a
-- mirror here could only ever repeat it -- a reader cannot have pages off and lines on.
-- Only the /spb gather shortcut still reaches the player's switch from here.
SlashCmdList["SPOKENBOOKS"]("gather")
Expect("/spb gather turns gathering off", _G.Spoken.Gather._on, false)
SlashCmdList["SPOKENBOOKS"]("gather")
Expect("...and toggles it back on", _G.Spoken.Gather._on, true)

---------------------------------------------------------------- forgetting what was read
SpokenBooksCharDB.read = { ["Hillsbrad Town Registry"] = true, ["Jitters' Journal"] = true }
local forget = Button("Forget What Was Read")
Expect("the button says what it does", forget ~= nil, true)
forget.scripts.OnClick(forget)

local left = 0
for _ in pairs(SpokenBooksCharDB.read) do left = left + 1 end
Expect("pressing it clears this character's record", left, 0)

-- Derived from the layout rather than written down, so adding a row cannot leave a section
-- below the reach of the scrollbar.
Expect("the scroller is told how tall the content grew", content.height > 0, true)

---------------------------------------------------------------- closing a book, and saying why
do
    local stopped = false
    local stopReading = B.StopReading
    B.StopReading = function() stopped = true end
    SpokenBooksDB.stopOnClose = false
    B:OnTextClosed()
    Expect("a closed book reads on by default", stopped, false)
    SpokenBooksDB.stopOnClose = true
    B:OnTextClosed()
    Expect("...and stops when Stop When Book Closes is on", stopped, true)
    B.StopReading = stopReading
    SpokenBooksDB.stopOnClose = false

    local said = {}
    local print_ = B.Print
    B.Print = function(_, message, ...) table.insert(said, select("#", ...) > 0 and format(message, ...) or message) end
    local onScreen = B.PageOnScreen
    B.PageOnScreen = function() return nil end
    B.source = B.source or {}
    SpokenBooksDB.debug = false
    B:OnTextReady()
    Expect("nothing is said in chat unasked", #said, 0)
    SpokenBooksDB.debug = true
    B:OnTextReady()
    Expect("...and with Explain in Chat on, why a page was not read", said[1] ~= nil and said[1]:find("not read", 1, true) ~= nil, true)
    SpokenBooksDB.debug = false
    B.PageOnScreen, B.Print = onScreen, print_
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll books options tests passed")

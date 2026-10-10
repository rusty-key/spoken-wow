-- The Spoken_Developer module: its debug log (on once installed, then Spoken's queue line by
-- line, each with its time, kept to 2000 lines, merged with logs handed in), the diagnostics
-- written into it, the copy, Write for an AI agent (a snapshot, then a reload), the log's size,
-- the Report buttons' menu, `/spoken log`, and the Developer page. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local DEVELOPER = here .. "/../../addons/Spoken_Developer/"
local Expect, Failures = H.Expecter(print)

_G.UISpecialFrames = _G.UISpecialFrames or {}
local env, quests = H.Fresh(stub, SPOKEN)
env.Addon:Enable()
local Spoken = _G.Spoken
local Dev = stub.LoadDeveloper(DEVELOPER)
stub.FireEvent("PLAYER_ENTERING_WORLD")

local function Has(text, list)
    for _, line in ipairs(list or Spoken:LogLines()) do
        if line:find(text, 1, true) then return true end
    end
    return false
end
local function Last()
    local lines = Spoken:LogLines()
    return lines[#lines] or ""
end

---------------------------------------------------------------- registered, on once installed
Expect("the module registers with Spoken", Spoken:HasLog(), true)
Expect("the log is on at first: the module is installed on purpose", Spoken:IsLogOn(), true)
Expect("...starting with a session line at login", Has("session start: "), true)
Spoken:SetLogOn(false)
_G.SpokenDeveloperDB.lines = {}
quests:Enqueue(H.Clip())
Spoken:Log("test", "written while off")
stub.Advance(4)
Expect("...and keeps nothing while off, the login snapshot included", #Spoken:LogLines(), 0)

---------------------------------------------------------------- on: sessions, diagnostics, the queue
Spoken:SetLogOn(true)
Expect("turned on, it starts with a session line", Spoken:LogLines()[1]:find("session log on: ", 1, true) ~= nil, true)
Expect("...naming Spoken's version and the module's", Has("Spoken " .. Spoken.ADDON_VERSION .. ", Spoken Developer "), true)
Expect("...the wall clock beside GetTime", Has("session wall clock "), true)
Expect("...the modules Spoken plays for", Has("modules: quests (Spoken_Quests)"), true)
Expect("...and the diagnostics, written into the log", Has("diag log on:"), true)
Expect("...as /spoken diagnostics says them", Has("diag   Spoken " .. Spoken.ADDON_VERSION), true)

local clip = H.Clip({ title = "Kobold Camp Cleanup" })
quests:Enqueue(clip)
Expect("a line queued, with its title", Has("player queued " .. clip.key .. " [quests], 1 in queue, Kobold Camp Cleanup"), true)
Expect("...and started, with its length", Has("player started " .. clip.key .. " [quests], length 1"), true)
Expect("each line starts with the time", Last():match("^%d+%.%d%d%d player ") ~= nil, true)
quests:Enqueue(clip)
Expect("a duplicate refused says so", Has("player queue refused " .. clip.key .. " [quests]: duplicate"), true)
Spoken:Pause()
Expect("a stop", Has("player queue stopped"), true)
Spoken:Resume()
Expect("...and the queue playing again", Has("player queue playing again"), true)
stub.Advance(2)
Expect("a line spoken to its end", Has("player finished " .. clip.key .. " [quests]"), true)

---------------------------------------------------------------- a feature addon's lines
Spoken:Log("sync", "drive %s: told %d member(s)", "101-accept", 2)
Expect("a feature addon writes its own, formatted", Has("sync drive 101-accept: told 2 member(s)"), true)
Spoken:Log("sync", "100% as written")
Expect("...and a line with nothing to format is kept as written", Has("sync 100% as written"), true)
Expect("the last lines, when asked for a few", #Spoken:LogLines(2), 2)

---------------------------------------------------------------- kept to 2000 lines
for i = 1, 2300 do Spoken:Log("fill", "line %d", i) end
local lines = Spoken:LogLines()
Expect("kept to 2000 lines and a batch before trimming", #lines <= 2200 and #lines >= 2000, true)
Expect("...the newest kept", lines[#lines]:find("fill line 2300", 1, true) ~= nil, true)
Expect("...the oldest gone", Has("session log on: "), false)

---------------------------------------------------------------- other logs, one timeline
local cleared = false
Spoken:AddLogSource(function()
    return { { name = "Lala Throwaway", offset = -100, lines = {
        "0.000 sync hers, from before",
        string.format("%.3f sync hers, at the same time", GetTime() + 100),
    } } }
end, function() cleared = true end)
Spoken:Log("sync", "mine, at the same time")
local merged = Dev.Log:Merged()
Expect("another log's lines are merged, on this clock", merged[1]:find("Lala Throwaway", 1, true) ~= nil
    and merged[1]:find("hers, from before", 1, true) ~= nil, true)
Expect("...lines at the same time this log's first",
    merged[#merged - 1]:find("mine, at the same time", 1, true) ~= nil
    and merged[#merged]:find("hers, at the same time", 1, true) ~= nil, true)
Expect("the box shows them all", Spoken:ShowLog(), #merged)
Expect("...or the newest", Spoken:ShowLog(10), 10)

---------------------------------------------------------------- the copies
Spoken:AddDiagnostics("Spoken Quests", function(detailed)
    return { "Data modules: 1 detected, 1 loaded", detailed and "open: QUEST_DETAIL 101 Kobold Camp Cleanup" or nil }
end)
local text, count = Dev.Copy:Text(false)
Expect("the copy for a person starts with the diagnostics", text:find("^=== Spoken diagnostics, ") ~= nil, true)
Expect("...a module's included", text:find("  Data modules: 1 detected, 1 loaded", 1, true) ~= nil, true)
Expect("...then the whole log", count, #Dev.Log:Merged())
Expect("...whose lines are in it", text:find("mine, at the same time", 1, true) ~= nil, true)
local before = #Spoken:LogLines()
Expect("a copy shows in the box", Dev.Copy:Show() > 0, true)
Expect("...and writes the diagnostics into the log first", Has("diag copied:"), true)
Expect("...the detailed ones, the context of the moment", Has("narrator style "), true)
Expect("...and a module's detail", Has("open: QUEST_DETAIL 101 Kobold Camp Cleanup"), true)
Expect("...so the log grew", #Spoken:LogLines() > before, true)

---------------------------------------------------------------- its size
-- As the game writes it: each line quoted and escaped as %q does, then a comma and the Windows
-- line end. (No line here holds a line break, which %q writes differently.)
local function Serialized(lines)
    local bytes = 0
    for _, line in ipairs(lines) do bytes = bytes + #string.format("%q", line) + 3 end
    return bytes
end
Spoken:Log("test", 'a "quoted" word and a back\\slash')
local lines = _G.SpokenDeveloperDB.lines
Expect("the size counts each line as the file holds it, escapes included",
    Dev.Log:Bytes() - 64, Serialized(lines))
Expect("bytes read as a person reads them", Dev.FormatBytes(512) .. " " .. Dev.FormatBytes(9830)
    .. " " .. Dev.FormatBytes(98304) .. " " .. Dev.FormatBytes(1258291), "512 B 9.6 KB 96 KB 1.2 MB")
Expect("the size says how much of the log is used", Dev:SizeText():find(
    string.format("%d of 2000 lines, ", #lines), 1, true) == 1, true)
Expect("...and the other players' logs handed in", Dev:SizeText():find("other players' logs: 1", 1, true) ~= nil, true)

---------------------------------------------------------------- written for an AI agent
-- Forever refuses an addon's reload: Write never asks for one. It covers its buttons with a secure
-- button that runs the macro /reload, and types /reload in the chat box where it cannot.
local reloadAsked = false
_G.C_UI = { Reload = function() reloadAsked = true end }
_G.ReloadUI = _G.C_UI.Reload
local opened
_G.ChatFrame_OpenChat = function(text) opened = text end
local function Count(text)
    local n = 0
    for _, line in ipairs(Spoken:LogLines()) do if line:find(text, 1, true) then n = n + 1 end end
    return n
end
Expect("Write writes the log for an agent", Dev.Write:Now(), true)
Expect("...with the detailed diagnostics of the moment", Has("diag written for an AI agent:"), true)
Expect("...the context included", Has("narrator style "), true)
Expect("...a line saying when", Last():find("session written for an AI agent at ", 1, true) ~= nil, true)
Expect("...marked, for after the reload", type(_G.SpokenDeveloperDB.written), "table")
Expect(".../reload not typed yet: from /spoken log write, the chat box is still sending that",
    opened, nil)
stub.Advance(0.05)
Expect("...then typed in the chat box a frame later, for the player's Enter", opened, "/reload")
Expect("...never the addon's own reload, which Forever refuses", reloadAsked, false)
local snapshots = Count("diag written for an AI agent:")
Dev.Write:Prepare()
Expect("a secure button's press and release take one snapshot", Count("diag written for an AI agent:"), snapshots)
stub.Advance(1)
local said
local Print = Dev.Print
Dev.Print = function(_, message, ...) said = string.format(message, ...) end
Dev.Write:Announce()
Dev.Print = Print
Expect("after the reload it says the log is written", said and said:find("debug log written at ", 1, true) ~= nil, true)
Expect("...once", _G.SpokenDeveloperDB.written, nil)
_G.InCombatLockdown = function() return true end
opened = nil
Expect("in combat it does not write", Dev.Write:Now(), false)
Expect("...nor offer /reload", opened, nil)
_G.InCombatLockdown = nil

---------------------------------------------------------------- a book open
-- Spoken Books is not loaded here: a book opened says what it is, and that nothing reads it.
stub.ShowPage({ title = "The Fall of Ameth'Aran", text = "Long ago, the night elves of Ameth'Aran\nkept vigil.", number = 2 })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a book opened is in the log, with its title and page",
    Has([[screen reading window: a book "The Fall of Ameth'Aran", page 2, starting "Long ago, the night elves]]), true)
Expect("...and that nothing of Spoken reads it", Has("nothing of Spoken reads it: Spoken_Books is not installed"), true)
local count = #Spoken:LogLines()
stub.FireEvent("ITEM_TEXT_READY")
Expect("...once per page", #Spoken:LogLines(), count)
local diagnostics = Spoken:Diagnostics(true)
Expect("the snapshot has the reading window open", Has([[reading window: open, a book "The Fall of Ameth'Aran", page 2]], diagnostics), true)
Expect("...and which Spoken modules are installed", Has("Spoken_Books (books, plaques, signs and letters): not installed", diagnostics), true)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
Expect("its closing is in the log", Last():find("screen reading window closed", 1, true) ~= nil, true)
Expect("...and the snapshot says it is closed", Has("reading window: closed", Spoken:Diagnostics(true)), true)
stub.ShowPage({ title = "A letter for you", text = "Dear Tata,", creator = "Williams" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("a letter a player wrote is told from a book", Has('screen reading window: a letter "A letter for you", page 1, from Williams'), true)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")

---------------------------------------------------------------- the Report buttons' menu
local report = Spoken:CreateRoundButton(UIParent, "report")
local function RightClick(button)
    for _, fn in ipairs(button.hooks.OnMouseUp) do fn(button, "RightButton") end
end
RightClick(report)
local menu = _G.SpokenDeveloperMenu
Expect("a Report button's right-click opens the menu", menu ~= nil and menu:IsShown(), true)
local items = Dev.Menu:Items(report)
Expect("...offering, while the log is on, three rows", #items, 3)
Expect("...the size first, to read", items[1].label and items[1].text, Dev:SizeText())
Expect("...then the copy", items[2].text, Dev.L.MENU_COPY)
Expect("...and Write for an AI agent", items[3].text, Dev.L.MENU_WRITE)
Expect("the tooltip line says so", Spoken:LogMenuHint(), Dev.L.MENU_HINT)
local writeRow
for _, row in ipairs({ menu:GetChildren() }) do
    if row.text and row.text.text == Dev.L.MENU_WRITE then writeRow = row end
end
Expect("the menu's Write row is a Write button", writeRow ~= nil and writeRow.writes, true)
for _, fn in ipairs(writeRow and writeRow.hooks and writeRow.hooks.OnEnter or {}) do fn(writeRow) end
local secure = _G.SpokenDeveloperWriteButton
Expect("...covered, under the pointer, by the secure button", secure ~= nil and secure:IsShown(), true)
-- Never anchored to the row: the game refuses a protected frame anchored to a frame whose anchors
-- lead to a text, as the subtitle's buttons' do ("Cannot anchor protected frames to regions").
local _, relativeTo = secure:GetPoint()
Expect("...placed on the screen against UIParent, not anchored to the row", relativeTo, UIParent)
Expect("...which runs the game's /reload as a macro", secure and secure:GetAttribute("type") == "macro"
    and secure:GetAttribute("macrotext"), "/reload")
local before = Count("diag written for an AI agent:")
secure:GetScript("PreClick")(secure, "LeftButton", true)
Expect("...after taking the snapshot", Count("diag written for an AI agent:"), before + 1)
secure:GetScript("OnLeave")(secure)
Expect("...and uncovered when the pointer leaves", secure:IsShown(), false)
for _, fn in ipairs(writeRow.hooks.OnEnter) do fn(writeRow) end
menu:Hide()
menu:GetScript("OnHide")(menu)   -- the client runs it; the stub's Hide does not
Expect("Escape closing the menu uncovers the Write row too", secure:IsShown(), false)

local MouseDown = menu:GetScript("OnEvent")
RightClick(report)
report.IsMouseOver = function() return true end
MouseDown(menu, "GLOBAL_MOUSE_DOWN", "RightButton")
Expect("right-clicking its button again leaves the press alone", menu:IsShown(), true)
RightClick(report)
Expect("...and the release closes the menu, not opening it again", menu:IsShown(), false)
RightClick(report)
MouseDown(menu, "GLOBAL_MOUSE_DOWN", "LeftButton")
Expect("a left-click on its button closes it", menu:IsShown(), false)
report.IsMouseOver = nil

---------------------------------------------------------------- cleared, then off
Spoken:ClearLog()
Expect("clearing empties it, and starts again with a session line",
    Spoken:LogLines()[1]:find("session cleared: ", 1, true) ~= nil, true)
Expect("...with nothing from before", Has("fill line"), false)
Expect("...and clears the logs handed in", cleared, true)

Spoken:SetLogOn(false)
Expect("turned off", Spoken:IsLogOn(), false)
opened = nil
Expect("Write does nothing while the log is off", Dev.Write:Now(), false)
Expect("...and offers no /reload", opened, nil)
Expect("...it says so last", Last():find("session log off", 1, true) ~= nil, true)
local kept = #Spoken:LogLines()
Spoken:Log("sync", "after")
Expect("...keeps nothing more", #Spoken:LogLines(), kept)
Expect("...and what it kept stays to read", kept > 0, true)
items = Dev.Menu:Items(report)
Expect("off, the menu offers to turn it on instead", #items == 1 and items[1].text, Dev.L.OPT_LOG_KEEP)
items[1].onClick()
Expect("...which does", Spoken:IsLogOn(), true)
Expect("the tooltip line follows", Spoken:LogMenuHint(), Dev.L.MENU_HINT)

---------------------------------------------------------------- the commands
SlashCmdList.SPOKEN("log off")
Expect("/spoken log off", Spoken:IsLogOn(), false)
SlashCmdList.SPOKEN("log on")
Expect("/spoken log on", Spoken:IsLogOn(), true)
SlashCmdList.SPOKEN("log clear")
Expect("/spoken log clear", Spoken:LogLines()[1]:find("session cleared: ", 1, true) ~= nil, true)
SlashCmdList.SPOKEN("log diag")
Expect("/spoken log diag writes the diagnostics", Has("diag asked:"), true)
for _, command in ipairs({ "log", "log 20", "log copy", "log nonsense", "diagnostics" }) do
    local ok, err = pcall(SlashCmdList.SPOKEN, command)
    Expect("/spoken " .. command .. " runs", ok and true or tostring(err), true)
end
Expect("/spoken diagnostics says how the log stands, and its size", Has("debug log on, ", Spoken:Diagnostics())
    and Has(" KB (Spoken Developer ", Spoken:Diagnostics()), true)
opened = nil
SlashCmdList.SPOKEN("log write")
Expect("/spoken log write types nothing while its own Enter is still being sent", opened, nil)
stub.Advance(0.05)
Expect("...then takes the snapshot and types /reload in", opened, "/reload")

---------------------------------------------------------------- the Developer page
Expect("the module builds the Developer page", Dev.optionsPanel ~= nil, true)
local page
for _, entry in ipairs(env.Options.pages or {}) do
    if entry.name == Dev.L.OPT_DEVELOPER then page = entry end
end
Expect("...nested under Spoken's, last", page and page.order, 5)
local function Row(label)
    for _, item in ipairs(Dev.optionsPanel.layout.items) do
        if item.kind == "section" then
            for _, row in ipairs(item.rows) do
                local control = row.control
                local text = control and control.layoutLabel and control.layoutLabel.text or control and control.text
                if text == label then return row end
            end
        end
    end
end
Expect("...with the log's switch", Row(Dev.L.OPT_LOG_KEEP) ~= nil, true)
Expect("...its size", Row(Dev.L.OPT_LOG_SIZE) ~= nil, true)
local sizeBadge = Row(Dev.L.OPT_LOG_SIZE).control
for i = 1, 50 do Spoken:Log("test", "a line to clear, %d", i) end
Dev.optionsPanel.layout:Refresh()
local before = sizeBadge.message
Spoken:ClearLog()
Expect("clearing the log updates the size the page shows", sizeBadge.message ~= before
    and sizeBadge.message == Dev:SizeText(), true)
Dev.Copy:Snapshot("asked")
Expect("...as does a snapshot written into it", sizeBadge.message, Dev:SizeText())
Expect("...and Write for an AI agent", Row(Dev.L.OPT_LOG_WRITE) ~= nil, true)
local added
Spoken:AddDeveloperSettings(function(layout)
    added = layout:Checkbox("Mock Something", "tip", function() return false end, function() end)
    return function() added = "reset" end
end)
Expect("a section handed in after the page is built is added to it", added ~= nil, true)

Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Spoken Developer tests passed")

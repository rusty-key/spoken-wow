-- The play button beside a quest in the quest log, on the client whose quest log is the
-- modern map-attached one: the Forever client (1.60.1, interface 16001) reports itself as
-- mainline and has no QuestLogFrame, no QuestLog_Update and no GetQuestLogTitle at all, so
-- the overlay had nothing to walk and no hook to run from, and the button was missing.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

-- Two quests in the log: one the sound pack has a line for, one it does not.
stub.SetModernQuestLog({
    { questID = 748, title = "Poison Water", level = 8 },
    { questID = 96130, title = "Chakuyak", level = 9, tag = "(Elite)",
        description = "Bring me the tusks, and be quick about it." },
})

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Spoken = _G.Spoken
local failures = 0

local played = {}
Spoken:RegisterCallback("CLIP_STARTED", function(clip)
    table.insert(played, clip.fileName)
end)

local function Expect(what, actual, expected)
    if actual == expected then
        print(string.format("ok   %s\n     %s", what, tostring(actual)))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", what, tostring(expected),
            tostring(actual)))
    end
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1, ["176-accept"] = 1 },
    -- The quest log has no NPC to ask who gave the quest; the pack says, in English.
    NPCIDLookupByQuestID = { [748] = 2948 },
    NPCNameLookupByNPCID = { [2948] = "Mull Thunderhorn" },
    ObjectIDLookupByQuestID = { [176] = 5555 },
    ObjectNameLookupByObjectID = { [5555] = "Wanted Poster" },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
-- Wait out the deferred data module load that OnInitialize schedules.
stub.Advance(2)

-- Contribute buttons hidden in the Spoken settings: a quest with no line is exactly the
-- greyed-out Play it always was. The Contribute half is checked further down.
local SpokenEnv = _G.SpokenEnv
SpokenEnv.Addon.db.profile.Contribute.HideButtons = true

-- The Forever client's gamepad navigation hooks CreateFrame and, when the parent sits inside an
-- open panel, rebuilds that panel's button groups inside the caller. Called from an addon while
-- the quest log is open, that taints them, and a gamepad close of the map is then blocked from
-- HideUIPanel. So nothing this addon builds while the log is open may name a parent at creation.
local parentedInLog = {}
local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, ...)
    -- The stub's own stand-ins for the client's frames are not the addon's to answer for.
    local frame = debug.traceback():find("/addons/", 1, true) and parent
    while frame do
        if frame == _G.QuestScrollFrame or frame == _G.QuestMapFrame then
            table.insert(parentedInLog, kind)
            break
        end
        frame = frame.GetParent and frame:GetParent()
    end
    return createFrame(kind, name, parent, ...)
end

-- What the client does when it draws the list.
-- Only the minimal player draws a face from the giver's appearance, so only it is primed for.
SpokenEnv.Addon.db.profile.Frame.Style = "minimal"
local setCreatures = stub.SetCreatureCount()
QuestLogQuests_Update()
-- Asked while the list is read, so the portrait has the giver's appearance by the click.
Expect("drawing the log asks the client about the giver", stub.SetCreatureCount() - setCreatures, 1)

local buttons = VO.QuestOverlayUI.questPlayButtons
Expect("a quest with a line has a button", buttons[748] ~= nil, true)
Expect("...shown", buttons[748] and buttons[748]:IsShown(), true)
Expect("...and enabled", buttons[748] and buttons[748]:IsEnabled(), true)
Expect("a quest with no line has one too", buttons[96130] ~= nil, true)
Expect("...greyed out rather than absent", buttons[96130] and buttons[96130]:IsEnabled(), false)

-- Nothing below can say anything useful without a button, and a hard error there reads as a
-- broken test rather than as the missing play button it is.
if not (buttons[748] and buttons[96130]) then
    print("\nno play button was created at all; the remaining checks cannot run")
    os.exit(1)
end

-- The button marks the row, not the quest log: the rows have no names to anchor to.
local row = stub.questLogRows[1]
local anchor = buttons[748] and buttons[748].anchor
Expect("the button sits on its own row", anchor and anchor.relativeTo == row, true)
Expect("...left of the title", anchor and anchor.point, "TOPLEFT")

-- The title runs to where the client ends it, 4 pixels short of the checkbox's corner.
local function TitleEnd(r)
    local a = r.Text.anchor
    return a and a.point == "RIGHT" and a.relativeTo, a and a.x
end
local titleEndsAt, titleOffset = TitleEnd(row)
Expect("with the button beside the title, the title keeps its own end",
    titleEndsAt == row.StorylineTexture and titleOffset, -4)

-- What the client lays out from the two anchors: both are measured from the same edge of the same
-- region, the title ends before the 20-pixel button begins, and the button does not reach past that edge.
local function Fit(r, button)
    local t, b = r.Text.anchor, button.anchor
    if not (t and b) or t.relativeTo ~= b.relativeTo or t.relativePoint ~= b.relativePoint or t.y ~= b.y then
        return "not against the same edge"
    end
    if t.x > b.x - 20 then return "the title runs under the button" end
    if b.x > 0 then return "the button covers what the title ends against" end
    return "fits"
end

-- The objective icon takes exactly that spot, so the button moves to the other end of the row,
-- where the title ends, and the title is made to end short of it before the client measures it.
stub.SetQuestLogPOIIcons(true)
QuestLogQuests_Update()
anchor = buttons[748].anchor
Expect("the objective icon takes the left of the row, and the button goes where the title ends",
    anchor and anchor.relativeTo == row.Text.anchor.relativeTo, true)
Expect("...against its left edge", anchor and anchor.point .. " " .. anchor.relativePoint, "RIGHT LEFT")
Expect("...with the title ended short of it", Fit(row, buttons[748]), "fits")
titleEndsAt, titleOffset = TitleEnd(row)
Expect("...the client's gap and the button's room further left", titleOffset, -27)
-- An elite, dungeon or raid quest says so in words, and the title ends against those words:
-- the button sits between them, covering neither the title nor "(Elite)".
local eliteRow = stub.questLogRows[2]
Expect("an elite quest's button sits left of its (Elite)", buttons[96130].anchor.relativeTo == eliteRow.TagText, true)
Expect("...with the title ended short of it", Fit(eliteRow, buttons[96130]), "fits")
-- A storyline quest has its icon between the type text and the checkbox: still the words.
eliteRow.quest.storyline = true
QuestLogQuests_Update()
Expect("an elite storyline quest's button stays left of (Elite)",
    buttons[96130].anchor.relativeTo == eliteRow.TagText, true)
Expect("...and fits", Fit(eliteRow, buttons[96130]), "fits")
-- With no words, the title ends at the storyline icon.
eliteRow.quest.tag = nil
QuestLogQuests_Update()
Expect("a storyline quest with no words: the button is left of the storyline icon",
    buttons[96130].anchor.relativeTo == eliteRow.StorylineTexture, true)
Expect("...and fits", Fit(eliteRow, buttons[96130]), "fits")
eliteRow.quest.typeIcon = true
QuestLogQuests_Update()
Expect("a storyline quest with a type icon fits too", Fit(eliteRow, buttons[96130]), "fits")
eliteRow.quest.storyline = nil
QuestLogQuests_Update()
Expect("a type icon alone fits", Fit(eliteRow, buttons[96130]), "fits")
eliteRow.quest.typeIcon = nil
eliteRow.quest.tag = "(Elite)"

-- The client may set the title's end without the relative point, where it is the point itself.
eliteRow.quest.shortAnchor = true
QuestLogQuests_Update()
Expect("a title anchored without the relative point is ended short of the button", Fit(eliteRow, buttons[96130]), "fits")
titleEndsAt, titleOffset = TitleEnd(eliteRow)
Expect("...the same distance", titleOffset, -27)
Expect("...against the edge it names", eliteRow.Text.anchor.relativePoint, "RIGHT")
eliteRow.quest.shortAnchor = nil

-- A title that sits off the middle of its end keeps that, and so does the button.
eliteRow.quest.titleY = -3
QuestLogQuests_Update()
Expect("a title anchored off the line has the button on the same line", buttons[96130].anchor.y, -3)
Expect("...and fits", Fit(eliteRow, buttons[96130]), "fits")
eliteRow.quest.titleY = nil

-- A row with no checkbox has the title's end all the same.
local checkbox = row.Checkbox
row.Checkbox = nil
QuestLogQuests_Update()
Expect("a row with no checkbox has its button at the title's end", Fit(row, buttons[748]), "fits")
row.Checkbox = checkbox

-- Switched off, the part leaves the title as the client set it.
Spoken:SetPartOn("quests", false)
QuestLogQuests_Update()
titleEndsAt, titleOffset = TitleEnd(row)
Expect("with the quests part off the title keeps its own end", titleOffset, -4)
Spoken:SetPartOn("quests", true)
QuestLogQuests_Update()
titleEndsAt, titleOffset = TitleEnd(row)
Expect("...and is ended short again when it is on", titleOffset, -27)

-- A calling quest has no objective icon, so the setting alone does not move the button.
local calling = {}
_G.C_QuestLog.IsQuestCalling = function(questID) return calling[questID] end
calling[748] = true
stub.SetQuestLogPOIIcons(true)
stub.questLogPOIButtons[1]:Hide()
QuestLogQuests_Update()
titleEndsAt, titleOffset = TitleEnd(row)
Expect("a calling quest keeps the title's own end", titleOffset, -4)
Expect("...and its button is left of the title", buttons[748].anchor.point, "TOPLEFT")
Expect("a quest beside it still has the icon's room", select(2, TitleEnd(eliteRow)), -27)
calling[748] = nil
-- The client's own question failing is not the quest log's.
_G.C_QuestLog.IsQuestCalling = function() error("not known yet") end
Expect("a failing IsQuestCalling does not reach the client's redraw", pcall(QuestLogQuests_Update), true)
_G.C_QuestLog.IsQuestCalling = nil

-- The client draws the icon whatever the setting says: the title is not moved once the row is laid
-- out, so the button stays off its end.
stub.SetQuestLogPOIIcons(true)
SetCVar("questPOI", "0")
QuestLogQuests_Update()
titleEndsAt, titleOffset = TitleEnd(row)
Expect("an icon the setting did not announce leaves the title where the client anchored it", titleOffset, -4)
Expect("...and the button is not on the title's end", buttons[748].anchor.point, "TOPLEFT")

-- An error in the title hook never reaches the client's redraw, and does not leave it stuck.
local blocked = true
for _, each in ipairs(stub.questLogRows) do
    local setPoint = each.Text.SetPoint
    each.Text.SetPoint = function(self, point, relativeTo, relativePoint, x, y)
        if blocked and x == -27 then
            blocked = false
            error("the client refused it")
        end
        return setPoint(self, point, relativeTo, relativePoint, x, y)
    end
end
stub.SetQuestLogPOIIcons(true)
Expect("a title that cannot be moved does not reach the client's redraw", pcall(QuestLogQuests_Update), true)
Expect("...and the next row's title is still ended short", select(2, TitleEnd(eliteRow)), -27)
local failing = stub.questLogRows[1].Text
failing.GetParent = function() error("no parent") end
Expect("an error in the hook itself does not reach the client's redraw", pcall(QuestLogQuests_Update), true)
failing.GetParent = nil

QuestLogQuests_Update()

stub.SetQuestLogPOIIcons(false)
QuestLogQuests_Update()
Expect("with the icons off it is back beside the title", buttons[748].anchor.relativeTo == row, true)
titleEndsAt, titleOffset = TitleEnd(row)
Expect("...and the title has its own end back", titleEndsAt == row.StorylineTexture and titleOffset, -4)

Expect("two rows drawn, two buttons displayed", table.getn(VO.QuestOverlayUI.displayedButtons), 2)
Expect("...once, however often the log is redrawn", stub.SetCreatureCount() - setCreatures, 1)

-- Clicking it reads the quest's accept line, under the title the client reports rather than
-- the one the row draws with its level prefix.
buttons[748]:Click()
-- Read before the clip ends: the button drops its sound data when playback stops.
Expect("...under the quest's own title", buttons[748].soundData.title, "Poison Water")
Expect("...the row's Play wears the player's square dress, with the checkbox's border", type(buttons[748].SetState), "function")
Expect("...showing Stop while its line speaks", buttons[748].state, "stop")
stub.Advance(3)
Expect("clicking play reads the accept line", table.concat(played, ", "), "748-accept")
Expect("...and Play once it has", buttons[748].state, "play")

-- The giver, named the way the dialog would have: on an English client the pack's name, on
-- any other the client's own, which the addon ships because the packs only have English.
local QUESTS = here .. "/../../addons/Spoken_Quests/"
Expect("an English client names the giver from the pack", VO.DataModules:GetObjectName(VO.Enums.GUID.Creature, 2948),
    "Mull Thunderhorn")
stub.SetLocale("ruRU")
for _, lang in ipairs({ "deDE", "ruRU", "zhCN" }) do
    dofile(QUESTS .. "Locale/Names/" .. lang .. ".lua")
end
buttons[748]:Click()
Expect("a Russian client names the quest-log giver in Russian", buttons[748].soundData.name, "Мулл Громовой Рог")
stub.Advance(3)
Expect("...and the other languages' files built nothing there", VO.GiverNames.creature[2948], "Мулл Громовой Рог")
stub.SetLocale("enUS")

-- A quest a poster gives has no face to draw: its Play in the log shows the notice, as the dialog's
-- line does, and a creature's keeps its face.
local function Portrait() local clip = _G.Spoken:GetCurrent() return clip and clip.present.portrait end
buttons[748]:Click()
Expect("a creature's quest in the log keeps its model", Portrait() and Portrait().kind, "model")
stub.Advance(3)
VO.QuestOverlayUI:BindPlayButton(buttons[748], 176, "Wanted: Hogger")
buttons[748]:Click()
Expect("a quest from a poster in the log shows a posted notice", Portrait() and Portrait().texture,
    [[Interface\Icons\INV_Misc_Note_01]])
stub.Advance(3)
VO.QuestOverlayUI:BindPlayButton(buttons[748], 748, "Poison Water")
VO.GiverNames = nil


-- A quest with no line stays silent when clicked.
local before = table.getn(played)
buttons[96130]:Click()
stub.Advance(3)
Expect("a greyed out button plays nothing", table.getn(played), before)

-- The details view is the other place a quest is read from, and the list's own buttons cannot
-- follow it there.
QuestMapFrame_ShowQuestDetails(748)
local detailsButton = VO.QuestOverlayUI.detailsPlayButton
Expect("the details view has a play button", detailsButton ~= nil, true)
local detailsReport = VO.QuestOverlayUI.detailsReportButton
Expect("...on the side opposite Back, Report on its right", detailsButton and detailsButton.anchor.point
    .. " " .. tostring(detailsButton.anchor.relativeTo == detailsReport), "RIGHT true")
Expect("...4 apart, as the subtitle spaces its round buttons", detailsButton.anchor.x, -4)
Expect("...on Back's own line", detailsReport and detailsReport.anchor.y, 4)
Expect("...both the subtitle's round button, 24 across", detailsButton.width .. " " .. detailsReport.width, "24 24")
Expect("...on the panel's own header strip, where the Back button hangs",
    detailsButton and detailsButton:GetParent() == QuestMapFrame.DetailsFrame.BackFrame, true)
Expect("...lit for a quest with a line", detailsButton and detailsButton:IsEnabled(), true)
Expect("...showing Play", detailsButton and detailsButton.playing, false)
Expect("...shown for a quest with a line", detailsReport and detailsReport:IsShown(), true)
Expect("...and bound to it", detailsReport and detailsReport.questID, 748)
local hiddenActions = _G.SpokenEnv.Addon.db.profile.Frame.HiddenActions
hiddenActions.report = true
_G.SpokenEnv.Callbacks:Fire("REPORT_SETTINGS_CHANGED")
Expect("Hide Report Buttons, in Spoken's settings, takes it away at once", detailsReport:IsShown(), false)
Expect("...Play moving into its corner", detailsButton.anchor.relativePoint, "RIGHT")
Expect("...as Spoken says to the addons that ask",
    _G.Spoken.AreReportButtonsHidden and _G.Spoken:AreReportButtonsHidden(), true)
hiddenActions.report = nil
_G.SpokenEnv.Callbacks:Fire("REPORT_SETTINGS_CHANGED")
Expect("...and gives it back when it is off", detailsReport:IsShown(), true)

detailsButton:Click()
Expect("...and Stop once it is reading, as the quest log's button", detailsButton.playing, true)
detailsButton:Click()
Expect("clicked while it reads, it pauses the line for Replay",
    tostring(_G.Spoken:IsPaused()) .. " " .. tostring(_G.Spoken:GetQueueSize()) .. " " .. tostring(detailsButton.playing),
    "true 1 false")
detailsButton:Click()
Expect("clicking it again resumes the stopped line", tostring(_G.Spoken:IsPaused()) .. " " .. tostring(detailsButton.playing),
    "false true")
detailsButton:Click()
Expect("clicking it again pauses the line for a new dialogue",
    tostring(_G.Spoken:IsPaused()) .. " " .. tostring(_G.Spoken:GetQueueSize()), "true 1")
local npc = _G.Spoken:RegisterSource("npc", { title = "NPC", addon = "Spoken" })
npc:Enqueue(require("queue_helpers").Clip({ key = "npc-dialogue", path = "npc-dialogue.ogg", length = 1,
    priority = "low" }))
Expect("new NPC dialogue skips the stopped quest-log line and plays",
    tostring(_G.Spoken:IsPaused()) .. " " .. _G.Spoken:GetCurrent().key, "false npc-dialogue")
stub.Advance(3)
Expect("...and the quest-log button is Play again once its line is gone", detailsButton.playing, false)

detailsButton:Click()
Expect("the quest-log line can be started again", detailsButton.playing, true)
_G.Spoken:Pause()
Expect("global Stop pauses a quest-log line for Replay",
    tostring(_G.Spoken:IsPaused()) .. " " .. tostring(_G.Spoken:GetQueueSize()), "true 1")
local npcAfterGlobalStop = _G.Spoken:RegisterSource("npc-after-global-stop", { title = "NPC", addon = "Spoken" })
npcAfterGlobalStop:Enqueue(require("queue_helpers").Clip({ key = "npc-after-global-stop-dialogue",
    path = "npc-after-global-stop-dialogue.ogg", length = 1, priority = "low" }))
Expect("NPC dialogue skips a globally stopped quest-log line and plays",
    tostring(_G.Spoken:IsPaused()) .. " " .. _G.Spoken:GetCurrent().key,
    "false npc-after-global-stop-dialogue")
stub.Advance(3)

-- Queued from somewhere else -- autoplay, the log's own button -- when the details open, and
-- finished since: Play reads the quest again rather than holding on to the finished line.
buttons[748]:Click()
QuestMapFrame_ShowQuestDetails(748)
stub.Advance(3)
before = table.getn(played)
detailsButton:Click()
stub.Advance(3)
Expect("a line queued elsewhere and finished leaves Play working", table.getn(played) > before, true)

-- Waiting behind a stopped line, this quest's line plays when Play is clicked on it.
local filler = _G.Spoken:RegisterSource("filler", { title = "Filler", addon = "Spoken" })
filler:Enqueue(require("queue_helpers").Clip({ length = 30 }))
buttons[748]:Click()
_G.Spoken:Pause()
QuestMapFrame_ShowQuestDetails(748)
before = table.getn(played)
detailsButton:Click()
Expect("a line waiting behind a stopped one plays when clicked",
    tostring(_G.Spoken:IsPaused()) .. " " .. tostring(table.getn(played) > before), "false true")
_G.Spoken:StopAll()

-- One button, rebound: showing another quest's details must not read the last one.
QuestMapFrame_ShowQuestDetails(96130)
Expect("a quest with no line greys the same button", detailsButton:IsEnabled(), false)
Expect("...and hides Report, there being no reading to report", detailsReport:IsShown(), false)
before = table.getn(played)
detailsButton:Click()
stub.Advance(3)
Expect("...and plays nothing", table.getn(played), before)

-- Contributing on: a quest the pack has no line for offers Contribute where its Play would be.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
QuestLogQuests_Update()
local contribute = VO.QuestOverlayUI.questContributeButtons[96130]
Expect("with contributing on, a quest with no line gets a Contribute button", contribute ~= nil, true)
Expect("...shown", contribute and contribute:IsShown(), true)
Expect("...in place of its Play", buttons[96130]:IsShown(), false)
Expect("...where Play sits", contribute and contribute.anchor and contribute.anchor.point, "TOPLEFT")
Expect("a quest with a line keeps its Play", buttons[748]:IsShown(), true)
Expect("...and gets no Contribute", VO.QuestOverlayUI.questContributeButtons[748], nil)

if contribute then
    contribute:GetScript("OnEnter")(contribute)
    Expect("the tooltip says what is missing", GameTooltip.text, "Spoken Quests doesn't have this quest")
    contribute:Click()
    local box = Spoken.ContributeBox
    Expect("clicking it opens the contribute box", box and box.frame:IsShown(), true)
    local link = box and box.editBox:GetText() or ""
    Expect("...holding a link to the contribute page", link:match("^https://spoken%.rusty%.one/contribute#e1=") ~= nil, true)
    local envelope = VO.Contribute:CaptureFromLog(96130, "Chakuyak")
    Expect("the log's envelope carries the quest", envelope:match("\nquest=96130\n") ~= nil, true)
    Expect("...as its accept moment", envelope:match("\nevent=accept\n") ~= nil, true)
    Expect("...says it came from the log", envelope:match("\nfrom=log\n") ~= nil, true)
    Expect("...and carries the quest's own text", envelope:match("Bring me the tusks, and be quick about it%.") ~= nil, true)
    Expect("...but no NPC, which the log does not know", envelope:match("\nnpc=") == nil, true)
end

-- The details view offers Contribute in the pair's place instead of greying out.
QuestMapFrame_ShowQuestDetails(96130)
local contributeButton = VO.QuestOverlayUI.detailsContributeButton
Expect("the details view offers Contribute for a quest with no line", contributeButton:IsShown()
    and contributeButton:GetText(), "Contribute")
Expect("...in place of Play and Report", detailsButton:IsShown() or detailsReport:IsShown(), false)
QuestMapFrame_ShowQuestDetails(748)
Expect("...and Play and Report come back for a quest with one", detailsButton:IsShown() and detailsReport:IsShown()
    and not contributeButton:IsShown(), true)

_G.CreateFrame = createFrame
Expect("no frame was created with a parent inside the open quest log", #parentedInLog, 0)

if failures > 0 then
    print(string.format("\n%d check(s) failed", failures))
    os.exit(1)
end
print("\nall checks passed")

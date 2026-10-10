-- Spoken Quests inside DialogueUI's window (UI/DialogueUIBridge.lua), against a fake
-- DUIQuestFrame built from the parts the bridge reaches for. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local Expect, Failures = H.Expecter(print)

local GOLD, RED = "|cffffd100", "|cff9c1a1a"
local QUEST_TEXT = "Greetings, Test. The wolves near the farm grow bolder every night.\n\n"
    .. "Kill eight of them and bring me their pelts."

---------------------------------------------------------------- a fake DialogueUI
-- DialogueUI puts the NPC's name in front of the text and draws each line of it as its own
-- FontString, from a pool it releases whenever it builds a page.
local loaded = true
_G.IsAddOnLoaded = function(name) return name == "DialogueUI" and loaded end
local provider
_G.DialogueUIAPI = { SetVOProvider = function(p) provider = p end }

local DUI = stub.Widget("Frame")
DUI.GetEffectiveScale = function() return 0.8 end
DUI.ContentFrame = stub.Widget("Frame")
DUI.ScrollFrame = stub.Widget("Frame")
DUI.ScrollFrame.range = 400
DUI.fontStringPool = { active = {} }
function DUI.fontStringPool:EnumerateActive() return ipairs(self.active) end
local function Build(text, flag)
    for _, fs in ipairs(DUI.fontStringPool.active) do
        fs:SetText(nil)
        fs.ttsFlag = nil
    end
    DUI.fontStringPool.active = {}
    for line in string.gmatch(text, "[^\n]+") do
        local fs = DUI.ContentFrame:CreateFontString()
        fs:SetText(line)
        fs.ttsFlag = flag
        table.insert(DUI.fontStringPool.active, fs)
    end
    return true
end
-- The header a quest page has and a gossip page does not, its title stopped 8 short of its right
-- end, or 56 with the warband alert shown; where they are, from the window's top right at 400, 600.
DUI.GetRight, DUI.GetTop = function() return 400 end, function() return 600 end
DUI.FrontFrame = stub.Widget("Frame")
local header = stub.Widget("Frame")
header:SetSize(358, 51)
header.GetRight, header.GetTop, header.GetBottom = function() return 380 end, function() return 572 end,
    function() return 521 end
header.Title = stub.Widget("FontString")
header.Title:SetHeight(20)
DUI.FrontFrame.Header = header
DUI.WarbandCompleteAlert = stub.Widget("Frame")
DUI.WarbandCompleteAlert:Hide()
DUI.FrontFrame.HeaderDivider = stub.Widget("Texture")
DUI.scrollFrameBaseHeight = 500
function DUI:UseQuestLayout(state)
    self.questLayout = state
    header:SetShown(state)
    if state then
        header.Title:SetPoint("RIGHT", header, "RIGHT", self.WarbandCompleteAlert:IsShown() and -56 or -8, 2)
    end
end
function DUI:HandleQuestDetail() self:UseQuestLayout(true); return Build(world.npcName .. ": " .. world.questText, 3) end
function DUI:HandleQuestProgress() self:UseQuestLayout(true); return Build(world.progressText, 3) end
function DUI:HandleQuestComplete() self:UseQuestLayout(true); return Build(world.rewardText, 3) end
function DUI:HandleQuestGreeting() self:UseQuestLayout(false); return Build(world.greetingText or "", 0) end
function DUI:HandleGossip() self:UseQuestLayout(false); return Build(world.gossipText or "", 0) end
function DUI:IsScrollable() return self.scrollable end
function DUI:ScrollTo(value) self.scrolledTo = value end
_G.DUIQuestFrame = DUI

local function Paragraph(i) return DUI.fontStringPool.active[i]:GetText() end
local function Lit()
    local count = 0
    for _, fs in ipairs(DUI.fontStringPool.active) do
        local _, n = string.gsub(fs:GetText() or "", "|c", "")
        count = count + n
    end
    return count
end

---------------------------------------------------------------- boot
local GREETING, DIRECTIONS = "Well met. How can I help?", "The bank is past the fountain."
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
dofile(QUESTS .. "UI/DialogueUIBridge.lua")
local Bridge = VO.DialogueUIBridge
VO.Addon:OnInitialize()
-- The gossip module too: gossip and greetings on DialogueUI's window are its to read.
local G = stub.LoadGossip(GOSSIP, SPOKEN, true)
G.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["101-accept"] = 12, ["101-progress"] = 2, ["gossip-hello"] = 3,
        ["guard-greeting"] = 2, ["guard-directions"] = 2 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    GossipLookupByNPCID = {
        -- A speaker the pack knows, whose one line has no recording in it; and one whose lines have.
        [5678] = { ["Hail, friend. The roads are long."] = "gossip-missing" },
        [4321] = { ["Well met, traveller."] = "gossip-hello", [GREETING] = "guard-greeting",
            [DIRECTIONS] = "guard-directions" },
    },
})
stub.Advance(2)
world.title = "Wolves"; world.questText = QUEST_TEXT; world.progressText = "Well?"
world.rewardText = "Thank you."
world.npcName = "Farmer Test"; world.npcGUID = "Creature-0-0-0-0-1234-0"
local Spoken = _G.Spoken
local driver = Bridge.driver
-- Spoken's own Display settings, which DialogueUI's text follows.
local words = env.Addon.db.profile.Transcript
local dui = VO.Addon.db.profile.DialogueUI

Expect("DialogueUI is hooked once every addon has loaded", Bridge.status, "hooked")
Expect("the player keeps its own style", Spoken:GetPlayerStyle(), "classic")
Expect("...and the quests addon is its voiceover provider", provider and provider.name, "Spoken Quests")
local function Tick(seconds)
    stub.Advance(seconds or 0)
    driver.scripts.OnUpdate(driver, 0.06)
end

---------------------------------------------------------------- matching, as pure functions
local function Paras(...)
    local list = {}
    for _, text in ipairs({ ... }) do
        table.insert(list, { text = text, words = Bridge.MarkLinks(text, Spoken:SplitCaption(text)) })
    end
    return list
end
local caption = Spoken:SplitCaption("Hello there, traveller. Safe roads.")
local map, span = Bridge.Align(caption, Paras("Farmer Test: Hello there, traveller.", "Safe roads."))
Expect("the NPC name DialogueUI puts in front is skipped", map and map[1] and map[1].p .. ":" .. map[1].w, "1:3")
Expect("...and the next paragraph continues the match", map and map[4] and map[4].p .. ":" .. map[4].w, "2:1")
Expect("...the line covers both paragraphs", span and span.first .. "-" .. span.last, "1-2")
map, span = Bridge.Align(caption, Paras("Hello there, traveller. Safe roads.", "Hello there, traveller. Safe roads."))
Expect("with gossip history kept above, the current page is the one matched", map and map[1] and map[1].p, 2)
Expect("...and only it is the line's", span and span.first .. "-" .. span.last, "2-2")
Expect("a line DialogueUI is not showing matches nothing",
    Bridge.Align(caption, Paras("The Barrens are wide and dry.")), nil)
local chinese = Spoken:SplitCaption("你好，勇士。")
map = Bridge.Align(chinese, Paras("农夫：你好，勇士。"))
Expect("Chinese matches character by character", map and map[1] and map[1].w, 3)
Expect("a word carrying a link or colour is never compared", Bridge.Key("|cffff0000Name|r"), nil)
Expect("...nor is bare punctuation", Bridge.Key("--"), nil)
local linked = Paras("Bring me the |Hitem:1|h[Linen Bolt of Cloth]|h today.")[1].words
Expect("the words inside a link are never matched either", linked[5].inLink and linked[6].inLink, true)
Expect("...but those after it are", linked[8].inLink, nil)
Expect("dark text gets the red highlight", Bridge.ColorFor(0.2, 0.1, 0.05), RED)
Expect("light text gets the captions' gold", Bridge.ColorFor(0.9, 0.85, 0.8), GOLD)
Expect("a word and its neighbour are wrapped, nothing else",
    Bridge.Wrap("a bc d", { { first = 3, last = 4 } }, GOLD), "a " .. GOLD .. "bc|r d")
Expect("the last word of a paragraph keeps the one before it lit",
    table.concat({ Bridge.Pick({ [1] = { p = 1 }, [2] = { p = 1 }, [3] = { p = 2 } }, 2) }, ","), "2,1")
Expect("a word the window lacks lights the last one it has",
    table.concat({ Bridge.Pick({ [1] = { p = 1 }, [2] = { p = 1 } }, 3) }, ","), "2,1")

local paras = Paras("Farmer Test: Hello there, traveller.", "Safe roads.")
map, span = Bridge.Align(caption, paras)
local function Cut(fields)
    fields.typewriter = fields.typewriter ~= false
    local p, byte = Bridge.Cut(fields, map, span, paras)
    return p and (p .. ":" .. byte) or "all"
end
Expect("before the voice starts nothing of the line shows", Cut({ progress = 0, speaking = false }), "1:0")
Expect("while it speaks, up to and with the word being read",
    Cut({ progress = 0.1, speaking = true, activeWord = 2 }), "1:25")
Expect("...into the next paragraph", Cut({ progress = 0.9, speaking = true, activeWord = 4 }), "2:4")
Expect("once it has finished, all of it", Cut({ progress = 1, speaking = false }), "all")
Expect("a clip with no length to time it shows all of it", Cut({ speaking = false }), "all")
Expect("with Type Words Out off, all of it", Cut({ typewriter = false, progress = 0.1, speaking = true, activeWord = 1 }), "all")

---------------------------------------------------------------- the highlight alone
words.HighlightWord, words.Typewriter = true, false
DUI:HandleQuestDetail()
local original1, original2 = Paragraph(1), Paragraph(2)
world.questID = 101
VO.Addon:QUEST_DETAIL()
Expect("the line is queued", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Tick(0.1)
Expect("the first two words light up in DialogueUI's text", Paragraph(1),
    "Farmer Test: " .. GOLD .. "Greetings,|r " .. GOLD .. "Test.|r The wolves near the farm grow bolder every night.")
Expect("...and nothing in the next paragraph", Paragraph(2), original2)
DUI.scrollable = true
DUI.ScrollFrame.height = 40
Tick(9)
Expect("later the light has moved to the second paragraph", Paragraph(1), original1)
Expect("...two words of it", Lit(), 2)
Expect("...and DialogueUI was scrolled to keep them in view", DUI.scrolledTo ~= nil, true)

-- An item reward resolving makes DialogueUI build the page again, into fresh FontStrings.
local before = DUI.fontStringPool.active[2]
DUI:HandleQuestDetail()
Tick(0)
Expect("a rebuilt page is lit again", Lit(), 2)
Expect("...and the FontString DialogueUI released is left alone", before:GetText(), nil)

dui.Captions = false
Tick(0)
Expect("turning the module's switch off puts the text back", Paragraph(2), original2)
dui.Captions = true
Tick(0)
Expect("...and on again lights it", Lit(), 2)
words.HighlightWord = false
Tick(0)
Expect("Spoken's Highlight Words off: DialogueUI's own text", Paragraph(1) .. Paragraph(2), original1 .. original2)
words.HighlightWord = true
words.Enabled = false
Tick(0)
Expect("...and with Spoken's Show Words off, which greys it", Lit(), 0)
words.Enabled = true
Tick(0)
Expect("...lit again when it is back on", Lit(), 2)

Tick(5)
Expect("when the line ends DialogueUI's own text is back", Paragraph(1) .. Paragraph(2), original1 .. original2)
Expect("...with nothing lit", Lit(), 0)

---------------------------------------------------------------- typing out
words.HighlightWord, words.Typewriter = false, true
Spoken:StopAll()
-- DialogueUI draws the page as the dialog opens; Spoken Quests reads it a moment later.
-- The words the line will type out must not show in between, or they flash up and vanish.
DUI:HandleQuestDetail()
Expect("a page about to be read is blank from the frame it is built in",
    Paragraph(1) .. "|" .. Paragraph(2), "|")
Tick(0.4)
Expect("...and stays blank while its line is on its way", Paragraph(1) .. "|" .. Paragraph(2), "|")
VO.Addon:QUEST_DETAIL()
Tick(0.1)
Expect("the text types out as the voice reads it", Paragraph(1), "Farmer Test: Greetings,")
Expect("...the paragraph it has not reached is blank", Paragraph(2), "")
Expect("...and nothing is lit", Lit(), 0)
Tick(9)
Expect("later the first paragraph is whole", Paragraph(1), original1)
local typed = Paragraph(2)
Expect("...and the second is typed part way", typed ~= "" and typed ~= original2
    and string.sub(original2, 1, string.len(typed)) == typed, true)
words.HighlightWord = true
Tick(0)
local lit = Paragraph(2)
Expect("with Highlight Words on too, the word being read is lit at the end of what is typed",
    string.find(lit, GOLD, 1, true) ~= nil and string.sub(lit, -2) == "|r", true)
Expect("...and the word after it is not shown to be lit", Lit(), 1)
Tick(5)
Expect("when the line ends the whole text is back", Paragraph(1) .. Paragraph(2), original1 .. original2)

Spoken:StopAll()
DUI:HandleQuestDetail()
Tick(3)
Expect("a line that never comes: the page shows whole after a moment", Paragraph(1) .. Paragraph(2),
    original1 .. original2)
world.questID = 102
DUI:HandleQuestDetail()
Expect("a page with no recording shows whole at once", Paragraph(1), original1)
world.questID = 101
VO.Addon:SetAutoplay(false)
DUI:HandleQuestDetail()
Expect("...and so does one with Read Automatically off, which waits for the Play button", Paragraph(1), original1)
VO.Addon:SetAutoplay(true)
words.Typewriter = false
DUI:HandleQuestDetail()
Expect("...and every page with Type Words Out off", Paragraph(1), original1)
words.Typewriter = true

-- A speaker a pack knows, with no recording for this page's line.
local questGiver = world.npcGUID
world.npcGUID = "Creature-0-0-0-0-5678-0"
world.gossipText = "Hail, friend. The roads are long."
DUI.handler = "HandleGossip"
DUI:HandleGossip()
Expect("gossip whose recording is missing shows whole at once", Paragraph(1) ~= "" and Paragraph(1) ~= nil, true)
-- Gossip is the gossip module's: the bridge asks it for the words its line will carry.
local gossipHandler, expectedLine = G.Addon.GOSSIP_SHOW, G.Addon.ExpectedLine
G.Addon.GOSSIP_SHOW = function() end
G.Addon.ExpectedLine = function() return world.gossipText end
DUI:HandleGossip()
Expect("a gossip page kept blank for the gossip module's line", Paragraph(1), "")
G.Addon:InvokeHandler("GOSSIP_SHOW", "test")
Tick(0)
Expect("...shows whole once the read queues nothing, not after the wait", Paragraph(1) ~= "", true)
G.Addon.GOSSIP_SHOW, G.Addon.ExpectedLine = gossipHandler, expectedLine

-- Once per NPC, a guard already heard: the greeting stays quiet, the directions picked from it
-- do not. DialogueUI can draw the directions before Spoken Gossip notes the page or after.
world.npcGUID = "Creature-0-0-0-0-4321-0"
G.Addon.db.profile.Audio.GossipFrequency = G.Enums.GossipFrequency.OncePerNPC
G.Addon.db.char.hasSeenGossipForNPC[world.npcGUID] = true
local function Greet()
    Spoken:StopAll()
    stub.ShowGossip(GREETING, { "Where is the bank?" })
    DUI:HandleGossip()
    stub.FireEvent("GOSSIP_SHOW")
    stub.Advance(1)
end
Greet()
Expect("a greeting heard before shows whole at once", Paragraph(1), GREETING)
stub.SelectGossipOption("Where is the bank?")
stub.ShowGossip(DIRECTIONS)
DUI:HandleGossip()
Expect("directions drawn before Spoken Gossip sees the page are kept blank for their line",
    Paragraph(1), "")
stub.FireEvent("GOSSIP_SHOW")
stub.Advance(1)
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
Greet()
stub.PickGossipOption("Where is the bank?", DIRECTIONS)
stub.Advance(0.6)
Spoken:StopAll()
Expect("...and so are directions drawn after it", G.Addon:ExpectedLine("GOSSIP_SHOW", true), DIRECTIONS)
Spoken:StopAll()
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
Greet()
Expect("...but not the greeting on the next visit", G.Addon:ExpectedLine("GOSSIP_SHOW", true), nil)
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
Spoken:StopAll()
world.npcGUID, world.gossipText, DUI.handler = questGiver, nil, nil

-- A zone clip whose transcript is the quest text word for word.
Spoken:StopAll()
DUI:HandleQuestDetail()
local zones = Spoken:RegisterSource("zones", { title = "Zones", addon = "Spoken_Zones" })
zones:Enqueue({ key = "z:12", path = "z12.ogg", length = 12,
    present = { header = "Elwynn Forest", transcript = QUEST_TEXT, bullet = "zone",
        portrait = { kind = "texture", texture = "Book" } } })
Expect("a zone clip is playing", Spoken:GetCurrent() and Spoken:GetCurrent().key, "z:12")
Tick(1)
Expect("...and DialogueUI's text is left as it is", Paragraph(1) .. Paragraph(2), original1 .. original2)
Spoken:StopAll()
words.HighlightWord, words.Typewriter = false, true

---------------------------------------------------------------- DialogueUI's Play button
Expect("DialogueUI is told there is a recording for the page", provider.doesFileExist("quest", 101, "detail"), true)
Expect("...not playing yet", provider.isPlaying(), false)
provider.playFile()
Expect("Play queues it", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Expect("...and DialogueUI sees it playing", provider.isPlaying(), true)
provider.playFile()
Expect("Play again, or DialogueUI's own autoplay, does not queue it twice", Spoken:GetQueueSize(), 1)
-- Accepting a quest closes DialogueUI, whose TTS Auto Stop (on by default) then calls stop.
DUI:Hide()
provider.stopPlaying()
Expect("closing DialogueUI does not cut the line off", Spoken:GetQueueSize(), 1)
DUI:Show()
provider.stopPlaying()
Expect("Stop removes it", Spoken:GetQueueSize(), 0)
zones:Enqueue({ key = "z:13", path = "z13.ogg", length = 12,
    present = { header = "Elwynn Forest", transcript = "Lore.", bullet = "zone",
        portrait = { kind = "texture", texture = "Book" } } })
zones:Enqueue({ key = "z:14", path = "z14.ogg", length = 12,
    present = { header = "Teldrassil", transcript = "More lore.", bullet = "zone",
        portrait = { kind = "texture", texture = "Book" } } })
Expect("another part's line is speaking", Spoken:GetCurrent() and Spoken:GetCurrent().key, "z:13")
provider.doesFileExist("quest", 101, "detail")
Expect("...so DialogueUI's button offers Play", provider.isPlaying(), false)
provider.playFile()
Expect("Play reads the page at once", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Expect("...DialogueUI sees it playing", provider.isPlaying(), true)
local keys = {}
for _, clip in ipairs(Spoken:GetQueue()) do table.insert(keys, clip.key) end
Expect("...the line it cut off skipped, and the next one still waiting", table.concat(keys, " "), "101-accept z:14")
Spoken:StopAll()
zones:StopAll()
zones:Enqueue({ key = "z:15", path = "z15.ogg", length = 12,
    present = { header = "Darkshore", transcript = "Lore.", bullet = "zone",
        portrait = { kind = "texture", texture = "Book" } } })
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test", true)
Expect("the page's line queued behind another", Spoken:GetQueueSize(), 2)
provider.doesFileExist("quest", 101, "detail")
Expect("...is not playing, so the button offers Play", provider.isPlaying(), false)
provider.playFile()
Expect("...and Play brings it forward", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Spoken:StopAll()
zones:StopAll()
-- Answered for what the client is showing, which is the page DialogueUI asks about.
world.questID = 102
Expect("no recording, no button", provider.doesFileExist("quest", 102, "detail"), false)
world.questID = 101
dui.PlayButton = false
Expect("with the setting off DialogueUI is told there is nothing", provider.doesFileExist("quest", 101, "detail"), false)
dui.PlayButton = true

---------------------------------------------------------------- DialogueUI's Text To Speech, left alone
local said = {}
local realPrint = _G.print
_G.print = function(text) table.insert(said, text) end
_G.DialogueUI_DB = { TTSEnabled = false, TTSAutoPlay = false }
dui.PlayButton = false
Bridge:Refresh()
dui.PlayButton = true
Bridge:Refresh()
Expect("DialogueUI's Text To Speech is left off", DialogueUI_DB.TTSEnabled, false)
Expect("...and nothing asks for a reload", table.getn(said), 0)
_G.print = realPrint

---------------------------------------------------------------- autoplay is Read Automatically's
-- DialogueUI's autoplay asks the delay, then calls Play; that call is ignored, a click's is not.
local audio = VO.Addon.db.profile.Audio
audio.Autoplay = false
DialogueUI_DB.TTSEnabled, DialogueUI_DB.TTSAutoPlay = true, true
Expect("with DialogueUI's Auto Play on, Read Automatically still decides", VO.Addon:IsAutoplayOn(), false)
audio.Autoplay = true
DialogueUI_DB.TTSAutoPlay = false
Expect("...either way", VO.Addon:IsAutoplayOn(), true)
Spoken:StopAll()
provider.doesFileExist("quest", 101, "detail")
provider.getAutoPlayDelay()
stub.Advance(0.5)
provider.playFile()
Expect("DialogueUI's autoplay call is left to Read Automatically", Spoken:GetQueueSize(), 0)
provider.playFile()
Expect("...while a click on its button plays", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
_G.DialogueUI_DB = nil

---------------------------------------------------------------- Spoken's controls on DialogueUI's title line
-- DialogueUI draws its own Play only with its Text To Speech on; Spoken's round Play and Skip are
-- there either way, on the title line, as Spoken's DialogueUI window shows them.
world.questID = 101
DUI.handler = "HandleQuestDetail"
DUI:HandleQuestDetail()
DUI:Show()
driver:Show()
driver.scripts.OnShow(driver)
local play, _, controls = Bridge:PlayButtonState()
local skip = controls and controls.skip
Expect("a page with a recording shows Spoken's Play button", play ~= nil and play:IsShown() and play:IsEnabled(), true)
Expect("...the player's round one, Skip beside it", play and play.ring ~= nil and skip ~= nil and skip:IsShown(), true)
Expect("...on DialogueUI's window, which UIParent's hiding leaves up", controls and controls.frame:GetParent(), DUI)
-- Stand-ins where code without the row has none, so each expectation below fails on its own.
controls = controls or { frame = stub.Widget("Frame") }
if not skip then
    skip = stub.Widget("Button")
    for _, script in ipairs({ "OnEnter", "OnLeave", "OnClick" }) do skip:SetScript(script, function() end) end
end
local function Anchor(f)
    local a = f.anchor
    if not a then
        return "no anchor"
    end
    return a.point .. " " .. tostring(a.relativeTo == DUI and "window" or a.relativeTo) .. " " .. a.relativePoint
        .. " " .. a.x .. " " .. a.y
end
-- At the top right, beside a close button, as DialogueUI's book view has them: the close button 26
-- in of the book art's pixels (0.5333 each at DialogueUI's size), its middle 36 of UIParent's units
-- and half a button under the window's top.
local lineScale = UIParent:GetEffectiveScale() / DUI:GetEffectiveScale()
local middle = -(36 + 24 / 2) * lineScale
local _, _, _, closeButton = Bridge:PlayButtonState()
Expect("...beside the book view's close button at the window's top right, 64 across of the book art",
    closeButton ~= nil and closeButton:IsShown() and Anchor(closeButton) .. " " .. closeButton.width,
    "RIGHT window TOPRIGHT " .. (-26 * 0.53333) .. " " .. middle .. " " .. (64 * 0.53333))
closeButton = closeButton or stub.Widget("Button")
-- 36 under the line to the quest title's top, as on the book view, not to the portrait's: the title
-- (20 tall) sits 2 over the middle of DialogueUI's 51-tall header, so the header goes 13.5 higher.
-- The text moves down with it, its height shorter by as much.
local shift = (2 * 36 + 24) * lineScale - (51 / 2 - 2 - 20 / 2) - 28
Expect("DialogueUI's header moved down so its title starts 36 under the controls' line, as on the book view",
    header.anchor and header.anchor.point .. " " .. header.anchor.y, "TOP " .. -(28 + shift))
Expect("...the quest text with it, its height shorter by as much",
    DUI.ScrollFrame.anchor and DUI.ScrollFrame.anchor.y .. " " .. tostring(DUI.scrollViewHeight),
    -(68 + shift) .. " " .. (500 - 40 - shift))
Expect("...the row just left of it, on its middle", controls.frame.anchor and controls.frame.anchor.relativeTo == closeButton
    and controls.frame.anchor.point .. " " .. controls.frame.anchor.relativePoint .. " " .. controls.frame.anchor.x
    .. " " .. controls.frame.anchor.y, "RIGHT LEFT -4 0")
Expect("...Play left of Skip", play.anchor and play.anchor.relativeTo == skip and play.anchor.relativePoint, "LEFT")
local round = UIParent:GetEffectiveScale() / DUI:GetEffectiveScale()
Expect("...as large on screen as Place Lore draws them, 24 at UIParent's scale, whatever DialogueUI's size",
    play:GetWidth() .. " " .. play:GetScale() .. " " .. skip:GetScale(), "24 " .. round .. " " .. round)
Expect("...the title left as DialogueUI lays it out", header.Title.anchor and header.Title.anchor.relativeTo == header
    and header.Title.anchor.x .. " " .. header.Title.anchor.y, "-8 2")
Expect("...in the paper's art on DialogueUI's parchment", closeButton.file,
    "Interface/AddOns/DialogueUI/Art/Book/TextureKit-Parchment.png")
-- A gossip page has no header to show: nothing moves.
DUI.handler = "HandleGossip"
DUI:HandleGossip()
Bridge:RefreshPlayButton("GOSSIP_SHOW")
-- The gossip text's top 36 under the line too, not the quest header's distance.
local gossipShift = (2 * 36 + 24) * lineScale - 42
Expect("...and on a gossip page its text starts 36 under the line, its own line moved with it",
    DUI.ScrollFrame.anchor and DUI.FrontFrame.HeaderDivider.anchor and DUI.ScrollFrame.anchor.y .. " "
        .. DUI.FrontFrame.HeaderDivider.anchor.y .. " " .. tostring(DUI.scrollViewHeight),
    -(42 + gossipShift) .. " " .. -(42 + gossipShift) .. " " .. (500 - gossipShift))
Expect("on a gossip page the close button and the row stay where they were", Anchor(closeButton) .. " "
    .. tostring(controls.frame.anchor ~= nil and controls.frame.anchor.relativeTo == closeButton),
    "RIGHT window TOPRIGHT " .. (-26 * 0.53333) .. " " .. middle .. " true")
-- DialogueUI's Copy Text button, which it puts in that corner, goes left of the row.
local copyText = stub.Widget("Button")
copyText:SetPoint("TOPRIGHT", DUI, "TOPRIGHT", -8, -8)
copyText:Show()
DUI.CopyTextButton = copyText
Bridge:DrawPlayButton()
Expect("DialogueUI's Copy Text button goes left of the row, on its middle", copyText.anchor and copyText.anchor.relativeTo == controls.frame
    and copyText.anchor.point .. " " .. copyText.anchor.relativePoint, "RIGHT LEFT")
DUI.CopyTextButton = nil
local hidUI
DUI.HideUI = function() hidUI = true end
if closeButton.scripts.OnClick then closeButton.scripts.OnClick(closeButton) end
Expect("the close button closes the window as Escape does", hidUI, true)
DUI.HideUI = nil
_G.DUIFont_QuestType_Left = { GetTextColor = function() return 1, 0.82, 0 end }
Bridge:DrawPlayButton()
Expect("...in the stone's art on DialogueUI's dark theme", closeButton.file,
    "Interface/AddOns/DialogueUI/Art/Book/TextureKit-Metal.png")
_G.DUIFont_QuestType_Left = nil
DUI.handler = "HandleQuestDetail"
DUI:HandleQuestDetail()
Bridge:RefreshPlayButton("QUEST_DETAIL")
DUI.WarbandCompleteAlert:Show()
DUI:HandleQuestDetail()
Bridge:DrawPlayButton()
Expect("with DialogueUI's warband alert at the title line's end, nothing moves either", Anchor(closeButton),
    "RIGHT window TOPRIGHT " .. (-26 * 0.53333) .. " " .. middle)
DUI.WarbandCompleteAlert:Hide()
DUI:HandleQuestDetail()
Expect("Skip is greyed with nothing speaking", skip:IsEnabled(), false)
play.scripts.OnClick(play, "LeftButton")
Expect("left-click plays the page's line", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Expect("...and Play turns to Stop while it speaks", play.state, "stop")
Expect("...and Skip can skip it", skip:IsEnabled(), true)
play.scripts.OnEnter(play)
local tip = play.tooltip
Expect("its tooltip says a click stops it", tip and tip.text, _G.SpokenEnv.L.DIALOGUE_STOP)
local saysRightClick = false
for _, text in ipairs(tip and tip.lines or {}) do
    if text == VO.L.OPT_DUI_PLAY_RIGHT_CLICK then saysRightClick = true end
end
Expect("...and that a right-click switches Read Automatically", saysRightClick, true)
play.scripts.OnLeave(play)
skip.scripts.OnEnter(skip)
Expect("Skip's tooltip names it", skip.tooltip and skip.tooltip.text, _G.SpokenEnv.L.BIND_SKIP)
skip.scripts.OnLeave(skip)
play.scripts.OnClick(play, "LeftButton")
Expect("left-click again stops it", Spoken:GetQueueSize(), 0)
Tick()
Expect("...and Stop turns back to Play", play.state, "play")
play.scripts.OnClick(play, "RightButton")
Expect("right-click turns Read Automatically off", audio.Autoplay, false)
play.scripts.OnClick(play, "RightButton")
Expect("...and on again", audio.Autoplay, true)
play.scripts.OnClick(play, "LeftButton")
skip.scripts.OnClick(skip)
Expect("Skip skips what speaks", Spoken:GetCurrent() == nil or Spoken:GetCurrent().fileName ~= "101-accept", true)
Spoken:StopAll()

-- On a gossip page Play reads the gossip module's line: the bridge asks the module the page
-- belongs to. Gossip has no Read Automatically, so its tooltip says nothing of it and a
-- right-click leaves the quests module's alone.
Spoken:StopAll()
local questNPC = world.npcGUID
world.npcGUID, world.gossipText = "Creature-0-0-0-0-4321-0", "Well met, traveller."
DUI.handler = "HandleGossip"
DUI:HandleGossip()
Bridge:RefreshPlayButton("GOSSIP_SHOW")
local _, gossipLine = Bridge:PlayButtonState()
Expect("a gossip page with a recording shows the Play button, for the gossip module's line",
    play:IsShown() and gossipLine and gossipLine.fileName, "gossip-hello")
Expect("...the row in its place beside the close button", controls.frame.anchor and controls.frame.anchor.relativeTo, closeButton)
Expect("...the line the Report button asks the bridge for", Bridge:LineFor("GOSSIP_SHOW") and
    Bridge:LineFor("GOSSIP_SHOW").fileName, "gossip-hello")
play.scripts.OnClick(play, "LeftButton")
local playing = Spoken:GetCurrent()
Expect("left-click plays it, from the gossip module", playing and playing.fileName .. " " ..
    tostring(playing.source == G.Player.source), "gossip-hello true")
play.scripts.OnEnter(play)
local gossipTip = play.tooltip
local mentionsAutoplay = false
for _, text in ipairs(gossipTip and gossipTip.lines or {}) do
    if text == VO.L.OPT_DUI_PLAY_RIGHT_CLICK or text == VO.L.OPT_PANEL_AUTOPLAY then mentionsAutoplay = true end
end
Expect("...its tooltip says nothing of Read Automatically, which is the quests module's", mentionsAutoplay, false)
play.scripts.OnLeave(play)
play.scripts.OnClick(play, "RightButton")
Expect("...and a right-click leaves Read Automatically as it was", audio.Autoplay, true)
Spoken:StopAll()
world.npcGUID, world.gossipText = questNPC, nil
DUI.handler = "HandleQuestDetail"
DUI:HandleQuestDetail()
Bridge:RefreshPlayButton("QUEST_DETAIL")
zones:Enqueue({ key = "z:16", path = "z16.ogg", length = 12,
    present = { header = "Duskwood", transcript = "Lore.", bullet = "zone",
        portrait = { kind = "texture", texture = "Book" } } })
play.scripts.OnClick(play, "LeftButton")
Expect("...in front of a zone's lore, which is skipped", Spoken:GetCurrent() and Spoken:GetCurrent().fileName,
    "101-accept")
Expect("...the lore not kept to replay", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
zones:StopAll()
DUI.TTSButton = stub.Widget("Button")
DUI.TTSButton:SetAlpha(0.6)
Bridge:RefreshPlayButton()
Expect("DialogueUI's own button is kept out of sight while Play is there", DUI.TTSButton:GetAlpha(), 0)
world.questID = 102
-- The bridge rechecks the page on a timer while the window is open.
driver.scripts.OnUpdate(driver, 0.6)
Expect("a page with no recording greys Play, keeping its place", play:IsShown() and play:IsEnabled(), false)
world.questID = 101
Bridge:RefreshPlayButton()
Expect("...back on a page with one", play:IsEnabled(), true)
dui.PlayButton = false
Bridge:Refresh()
Expect("with the setting off Play is not there", play:IsShown(), false)
Expect("...and DialogueUI's own button is given back", DUI.TTSButton:GetAlpha(), 0.6)
Expect("...Skip moving up to the row's left end", controls.frame:GetWidth(), 24 * round)
dui.PlayButton = true
Bridge:Refresh()
DUI.TTSButton = nil
DUI:Hide()
driver.scripts.OnHide(driver)
Expect("the window closing hides the row", controls.frame:IsShown(), false)
DUI:Show()
driver.scripts.OnShow(driver)
Expect("...and opening shows it again", controls.frame:IsShown() and play:IsShown(), true)
Expect("diagnostics say whether Play shows", string.find(Bridge:Describe(), "button=shown", 1, true) ~= nil, true)
DUI.handler = nil
Bridge:RefreshPlayButton()

---------------------------------------------------------------- waiting for the window
Spoken:StopAll()
world.questID = 101
DUI.handler = "HandleQuestDetail"
DUI:SetAlpha(0.3)
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test")
Expect("autoplay waits while DialogueUI's window fades in", Spoken:GetQueueSize(), 0)
DUI:SetAlpha(1)
DUI.ContentFrame:SetAlpha(0.5)
driver.scripts.OnUpdate(driver, 0.06)
Expect("...and while its text does", Spoken:GetQueueSize(), 0)
DUI.ContentFrame:SetAlpha(1)
driver.scripts.OnUpdate(driver, 0.06)
Expect("...then reads, with the words on screen", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
DUI:SetAlpha(0.3)
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test")
stub.Advance(1.6)
driver.scripts.OnUpdate(driver, 0.06)
Expect("...or once it has waited long enough", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test", true)
Expect("a line asked for is read at once", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test")
driver:Hide()
driver.scripts.OnHide(driver)
driver:Show()
DUI:SetAlpha(1)
driver.scripts.OnUpdate(driver, 0.06)
Expect("closed before it showed, the line is not read", Spoken:GetQueueSize(), 0)
DUI:Hide()
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test")
Expect("with DialogueUI not showing the dialog, autoplay reads at once", Spoken:GetQueueSize(), 1)
Spoken:StopAll()
DUI:Show()
DUI.handler = nil

---------------------------------------------------------------- the player over the window
local frame = env.PlayerFrame.frame
driver.scripts.OnShow(driver)
Expect("by default the player is left out of DialogueUI's window", frame:GetParent(), _G.UIParent)
Expect("...and can still be dragged", env.Addon:IsFrameLocked(), false)
driver:Hide()
driver.scripts.OnHide(driver)
driver:Show()
dui.ShowPlayer = true
driver.scripts.OnShow(driver)
Expect("turned on, while DialogueUI is open the player sits on its window", frame:GetParent(), DUI)
Expect("...the same size on screen", frame:GetScale(), env.Addon.db.profile.Frame.FrameScale / 0.8)
Expect("...and can still be dragged there", env.Addon:IsFrameLocked(), false)
driver:Hide()
driver.scripts.OnHide(driver)
Expect("when it closes the player goes back to UIParent", frame:GetParent(), _G.UIParent)
Expect("...at its own size", frame:GetScale(), env.Addon.db.profile.Frame.FrameScale)
Expect("...and can be dragged again", env.Addon:IsFrameLocked(), false)
driver:Show()
dui.ShowPlayer = false
driver.scripts.OnShow(driver)
Expect("with the setting off the player is left alone", frame:GetParent(), _G.UIParent)
dui.ShowPlayer = true
driver:Hide()
driver.scripts.OnHide(driver)

-- Subtitles Only is the default style, and DialogueUI hides them with UIParent too.
local Subtitle = env.Subtitle
-- The stub client measures no text; the subtitle needs a height to lay its lines out.
do
    local build = Subtitle.Build
    Subtitle.Build = function(self)
        build(self)
        self.title.GetStringHeight = function() return 18 end
        self.measure.GetStringHeight = function() return 16 end
    end
end
env.Addon:SetPlayerStyle("subtitle")
env.PlayerFrame:RefreshConfig()
VO.Addon:QUEST_DETAIL()
Subtitle:Update()
local subtitle = Subtitle.frame
Expect("the subtitles are up", subtitle ~= nil and subtitle:GetParent() == _G.UIParent, true)
local strata
subtitle.SetFrameStrata = function(_, value) strata = value end
local anchor = subtitle.anchor and subtitle.anchor.y
driver:Show()
driver.scripts.OnShow(driver)
Expect("while DialogueUI is open the subtitles sit on its window", subtitle:GetParent(), DUI)
Expect("...the same size on screen", subtitle:GetScale(), (words.SubtitleScale or 1) / 0.8)
Expect("...above it", strata, "FULLSCREEN")
Expect("...in the same place", subtitle.anchor and subtitle.anchor.y, anchor)
Subtitle:Update()
Expect("...and stay there as they update", subtitle:GetParent(), DUI)
driver:Hide()
driver.scripts.OnHide(driver)
Expect("when it closes they go back to UIParent", subtitle:GetParent(), _G.UIParent)
Expect("...at their own size", subtitle:GetScale(), words.SubtitleScale or 1)
Expect("...and their own strata, under the game's panels", strata, "LOW")
Spoken:StopAll()
env.Addon:SetPlayerStyle("classic")
driver:Show()

---------------------------------------------------------------- Report and Contribute
dofile(SPOKEN .. "Dialogue/ContributeButton.lua")
local Contribute = VO.ContributeButton
Contribute:Setup()
local panelButton = Contribute.button
local function Fire(widget, script)
    if widget.scripts[script] then widget.scripts[script](widget) end
    for _, fn in ipairs(widget.hooks[script] or {}) do fn(widget) end
end
stub.ShowPanel(nil)
world.questID = 101
DUI:Show()
DUI.handler = nil
Expect("no page built yet, none is known", Bridge:Page(), nil)
DUI.handler = "HandleQuestDetail"
Expect("the page DialogueUI shows is known", Bridge:Page(), "QUEST_DETAIL")
DUI:HandleQuestDetail()
local corner = Contribute.corner
local icon = corner and corner.icon
Expect("a voiced quest shows the Report icon", icon ~= nil and icon:IsShown(), true)
Expect("...on DialogueUI's window, which UIParent's hiding leaves up", icon and icon:GetParent(), DUI)
local _, _, controls = Bridge:PlayButtonState()
controls = controls or { frame = stub.Widget("Frame"), play = stub.Widget("Button"), skip = stub.Widget("Button") }
Expect("...at the top right, rightmost in Spoken's row after Play and Skip", icon.anchor and icon.anchor.point
    .. " " .. tostring(icon.anchor.relativeTo == controls.frame) .. " " .. tostring(controls.skip.anchor ~= nil and controls.skip.anchor.relativeTo == icon),
    "RIGHT true true")
Expect("...as large as they are", icon:GetWidth() .. " " .. icon:GetScale(),
    controls.play:GetWidth() .. " " .. controls.play:GetScale())
Expect("...and as strong", icon and icon:GetAlpha(), 1)
env.Addon.db.profile.Frame.HiddenActions.report = true
_G.SpokenEnv.Callbacks:Fire("REPORT_SETTINGS_CHANGED")
Expect("Hide Report Buttons, in Spoken's settings, takes it away at once", icon:IsShown(), false)
env.Addon.db.profile.Frame.HiddenActions.report = nil
_G.SpokenEnv.Callbacks:Fire("REPORT_SETTINGS_CHANGED")
Expect("...and gives it back when it is off", icon:IsShown(), true)
Expect("...with no line of words to contribute under the window's buttons", corner.link, nil)
Expect("...and not the game's panel button", panelButton:IsShown(), false)
Fire(icon, "OnEnter")
Expect("...full under the pointer", icon:GetAlpha(), 1)
local tip = Contribute.tooltip
Expect("...with a tooltip of its own on DialogueUI's window, which UIParent's hiding leaves up",
    tip ~= nil and tip:GetParent() == DUI and tip:IsShown(), true)
Expect("...saying what Report is for", tip and tip.lines and tip.lines[1], _G.SpokenEnv.L.DIALOGUE_REPORT_PROBLEM)
Expect("...at the size the game's tooltip would be", tip and tip:GetScale(), 1 / 0.8)
Fire(icon, "OnLeave")
Expect("...still in full after", icon:GetAlpha(), 1)
Expect("...and the tooltip gone", tip and tip:IsShown(), false)
-- Without Spoken Quests' row (its bridge not loaded), the icon keeps the corner, faint.
Contribute.dialogueUISlot = nil
Contribute:ShowOnDialogueUI(DUI, false)
Expect("with no row to go in, the icon keeps the corner under DialogueUI's Decline, right-aligned with it",
    icon.anchor and icon.anchor.relativeTo == DUI and icon.anchor.relativePoint .. " " .. icon.anchor.x .. " " .. icon.anchor.y,
    "BOTTOMRIGHT -29 28")
Expect("...small and faint, at the window's own scale", icon:GetWidth() .. " " .. icon:GetAlpha() .. " " .. icon:GetScale(),
    "16 0.4 1")
-- The margins as DialogueUI laid them out, which its window size setting changes.
local footer = stub.Widget("Button")
footer.GetBottom = function() return 50 end
footer.GetRight = function() return 370 end
DUI.ExitButton = footer
Contribute:ShowOnDialogueUI(DUI, false)
Expect("...measured from DialogueUI's footer once it is laid out", icon.anchor.x .. " " .. icon.anchor.y, "-30 38")
DUI.ExitButton = nil
DUI:HandleQuestDetail()
Expect("...and goes back in the row on the next page", icon.anchor and icon.anchor.relativeTo, controls.frame)
driver.scripts.OnShow(driver)
Fire(icon, "OnClick")
local box = Spoken.ContributeBox
Expect("Report opens the quest page's address", box and box.editBox:GetText(), "https://voiceover.rusty.one/r/quest/101/accept")
Expect("...over DialogueUI's window", box and box.frame:GetParent(), DUI)
box.frame:Hide()

world.questID = 102
DUI:HandleQuestDetail()
Expect("a quest no pack voices keeps the icon in the row, in full, to contribute",
    tostring(icon:IsShown() and icon:GetAlpha()) .. " " .. tostring(corner.missing), "1 true")
Fire(icon, "OnEnter")
Expect("...its tooltip saying what is missing", tip and tip.lines and tip.lines[1], _G.SpokenEnv.L.DIALOGUE_CONTRIBUTE_TIP_QUEST)
Fire(icon, "OnLeave")
Expect("...still in full once the pointer leaves", icon:GetAlpha(), 1)
local envelope = VO.Contribute:Capture()
Expect("...and it sends the quest DialogueUI shows", envelope and envelope:match("\nquest=102\n") ~= nil
    and envelope:match("\nevent=accept\n") ~= nil, true)
world.questID = 101
DUI:HandleQuestDetail()
Expect("back on a voiced quest, it reports again", corner.missing, false)
world.questID = 102
world.gossipText = "Strange times, friend."
DUI.handler = "HandleGossip"
DUI:HandleGossip()
Expect("gossip no pack voices offers it too", icon:IsShown() and corner.missing, true)
Expect("...for the gossip line", Contribute.gossip, true)
local gossip = VO.Contribute:Capture()
Expect("...and it sends the words DialogueUI shows", gossip and gossip:match("\nquest=") == nil
    and gossip:match("\nStrange times, friend%.\n") ~= nil, true)
-- Each page is its own module's: Gossip off takes the corner from gossip pages only, Quests off from
-- quest pages only. DialogueUI hides Blizzard's panels, so the page it shows tells which.
_G.Spoken:SetPartOn("gossip", false)
DUI:HandleGossip()
local onGossip = icon:IsShown()
DUI.handler = "HandleQuestDetail"
DUI:HandleQuestDetail()
Expect("with Gossip off, the corner leaves gossip pages but stays on quest pages",
    tostring(onGossip) .. " " .. tostring(icon:IsShown()), "false true")
_G.Spoken:SetPartOn("gossip", true)
_G.Spoken:SetPartOn("quests", false)
DUI:HandleQuestDetail()
local onQuest = icon:IsShown()
DUI.handler = "HandleGossip"
DUI:HandleGossip()
Expect("...and with Quests off, it leaves quest pages but stays on gossip pages",
    tostring(onQuest) .. " " .. tostring(icon:IsShown()), "false true")
_G.Spoken:SetPartOn("quests", true)
DUI:HandleGossip()
Fire(icon, "OnClick")
Expect("the copy box opens over DialogueUI's window", box and box.frame:IsShown() and box.frame:GetParent(), DUI)
Expect("...the same size on screen", box and box.frame:GetScale(), 1 / 0.8)
DUI:Hide()
driver:Hide()
driver.scripts.OnHide(driver)
Expect("closing the window leaves no page", Bridge:Page(), nil)
Expect("...and takes the icon with it", icon:IsShown(), false)
Expect("...and nothing is left on the game's frames", panelButton:IsShown(), false)
Expect("the copy box goes back to UIParent", box and box.frame:GetParent(), _G.UIParent)
Expect("...still open, at its own size", box and box.frame:IsShown() and box.frame:GetScale(), 1)
DUI.handler = nil
world.gossipText = nil
world.questID = 101
DUI:Show()
driver:Show()

---------------------------------------------------------------- the settings
local panel = stub.LoadQuestsPanel(QUESTS, VO)
panel:Setup()
local Page = env.DialogueUIOptions
local layout = Page.layout
Expect("Spoken built its DialogueUI page", layout ~= nil, true)
local function Row(label)
    for _, entry in ipairs(layout.entries) do
        if entry.label == label then return entry.frame end
    end
end
local captions, scroll = Row(VO.L.OPT_DUI_CAPTIONS), Row(VO.L.OPT_DUI_AUTOSCROLL)
Expect("the panel has nothing that changes DialogueUI's own settings", table.getn(layout.entries) > 0
    and Row("Turn On Text To Speech") == nil, true)
Expect("the panel has the DialogueUI options", captions ~= nil and Row(VO.L.OPT_DUI_SHOW_PLAYER) ~= nil
    and Row(VO.L.OPT_DUI_PLAY_BUTTON) ~= nil and scroll ~= nil, true)
layout:Refresh()
Expect("...live while DialogueUI is loaded", captions and captions.layoutReason, nil)
loaded = false
local before = table.getn(layout.entries)
local bare = stub.LoadQuestsPanel(QUESTS, VO)
bare:Setup()
local found = table.getn(layout.entries) ~= before
for _, entry in ipairs(bare.panel.layout.entries) do
    if entry.label == VO.L.OPT_DUI_CAPTIONS then found = true end
end
Expect("...and without DialogueUI there are none", found, false)
loaded = true
local hooks = DUI.HandleGossip
-- false, not nil: the fake widget answers any capitalised name with a function.
DUI.HandleGossip = false
layout:Refresh()
Expect("...or that this DialogueUI is not one it knows", captions and captions.layoutReason, VO.L.OPT_DUI_UNKNOWN)
DUI.HandleGossip = hooks
dui.Captions = false
layout:Refresh()
Expect("scrolling waits on the words being marked", scroll and scroll.layoutReason, VO.L.REASON_DUI_CAPTIONS)
dui.Captions = true
layout:Refresh()
Expect("...and wakes with them", scroll and scroll.layoutReason, nil)
for _, entry in ipairs(panel.panel.layout.entries) do
    if entry.label == VO.L.OPT_DUI_CAPTIONS then Expect("...and the Quests page has none of them", entry.label, nil) end
end
dui.Captions, dui.PlayButton = false, false
Page:Reset()
Expect("the DialogueUI page's Defaults puts them back", dui.Captions and dui.PlayButton, true)
Expect("diagnostics describe it", string.find(Bridge:Describe(), "words=true", 1, true) ~= nil, true)
local readRow
for _, entry in ipairs(panel.panel.layout.entries) do
    if entry.label == VO.L.OPT_PANEL_AUTOPLAY then readRow = entry.frame end
end
_G.DialogueUI_DB = { TTSEnabled = true, TTSAutoPlay = true }
panel.panel.layout:Refresh()
Expect("the Quests page's Read Automatically stays live with DialogueUI's Auto Play on",
    readRow ~= nil and readRow.layoutReason, nil)
_G.DialogueUI_DB = nil

if Failures() > 0 then
    print(string.format("\n%d DialogueUI test(s) failed", Failures()))
    os.exit(1)
end
print("\nAll DialogueUI tests passed")

-- The subtitle shows Sentences at Once whole sentences (3 unless set, 1 to 4) and never more than
-- four lines: a longer line is split into pages of whole sentences, a sentence longer than four
-- lines at its phrases, and between words only for a phrase too long on its own. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
stub.LoadQuests(QUESTS, SPOKEN)
local Subtitle = _G.SpokenEnv.Subtitle
-- The stub measures 7 per character, so a line holds 68 of them (512 less 16 each side).
Subtitle.measure = CreateFrame("Frame"):CreateFontString()

local function Words(text)
    local words = {}
    for word in text:gmatch("%S+") do words[#words + 1] = word end
    return table.concat(words, " ")
end

local short = "A short line."
Expect("a line of four lines or fewer is one page", #Subtitle:Paginate(short), 1)

-- The most any page of `list` has of what `measure` counts.
local function Most(list, measure)
    local top = 0
    for _, page in ipairs(list) do top = math.max(top, measure(page)) end
    return top
end
local function Lines(page) return #Subtitle:Wrap(page) end

-- Twelve sentences of about 50 characters: well past four lines.
local sentences = {}
for i = 1, 12 do
    sentences[i] = string.format("Sentence number %02d tells a little more of the story.", i)
end
local long = table.concat(sentences, " ")
local pages = Subtitle:Paginate(long)
local most = Most(pages, Lines)
Expect("a long line is split into several pages", #pages > 2, true)
Expect("...none longer than four lines", most <= 4, true)
Expect("...each ending at a sentence end", pages[1]:sub(-1), ".")
Expect("...and together they give back every word, in order", Words(table.concat(pages, " ")), Words(long))

-- One phrase longer than four lines: cut between words.
local run = {}
for i = 1, 80 do run[i] = "word" .. i end
local endless = table.concat(run, " ") .. "."
pages = Subtitle:Paginate(endless)
most = Most(pages, Lines)
Expect("a phrase longer than four lines is cut between words", #pages > 1 and most <= 4, true)
Expect("...losing none of them", Words(table.concat(pages, " ")), Words(endless))

local cfg = _G.SpokenEnv.Addon.db.profile.Transcript
local function Count(page)
    local n = 0
    for _ in page:gmatch("[.!?]") do n = n + 1 end
    return n
end
Expect("three sentences to a page unless set", Most(Subtitle:Paginate(long), Count), 3)

-- One sentence at a time: each page one whole sentence, two lines if it needs them.
cfg.SubtitleSentences = 1
local mixed = "The war ended. When the war ended, the orcs who had survived the long march north were placed in the camps. The land was quiet."
pages = Subtitle:Paginate(mixed)
Expect("one at a time, a page for each sentence", #pages, 3)
Expect("...the long one whole, on the lines it needs", #Subtitle:Wrap(pages[2]), 2)
Expect("...losing no words", Words(table.concat(pages, " ")), Words(mixed))

-- A sentence longer than four lines turns at its phrases, never mid-phrase.
local phrases = {}
for i = 1, 12 do phrases[i] = string.format("and then phrase number %02d went by", i) end
local rambling = table.concat(phrases, ", ") .. "."
pages = Subtitle:Paginate(rambling)
local atPhrases = #pages > 1
for index = 1, #pages - 1 do
    if not pages[index]:find(",$") then atPhrases = false end
end
Expect("a sentence past four lines turns its pages at its commas", atPhrases, true)
Expect("...none longer than four lines", Most(pages, function(page) return #Subtitle:Wrap(page) end) <= 4, true)
Expect("...losing no words", Words(table.concat(pages, " ")), Words(rambling))
cfg.SubtitleSentences = 3

-- Show Name and Title off: the words alone, from the top.
if not Subtitle.frame then Subtitle:Build() end
-- Heights the stub's text cannot measure.
Subtitle.measure.GetStringHeight = function() return 16 end
Subtitle.title.GetStringHeight = function() return 18 end
Subtitle:Layout(short)
local named = Subtitle.lines[1].anchor.y
cfg.SubtitleName = false
Subtitle:Layout(short)
Expect("with Show Name and Title off the row over the words is hidden", Subtitle.nameRow and Subtitle.nameRow:IsShown(), false)
Expect("...and the words start at the top, where the row was", Subtitle.lines[1].anchor.y .. " " .. tostring(named < -12),
    "-12 true")
cfg.SubtitleName = true
Subtitle:Layout(short)
Expect("...on again, the row is back over them", tostring(Subtitle.nameRow and Subtitle.nameRow:IsShown()) .. " " .. Subtitle.lines[1].anchor.y,
    "true " .. named)

-- A line with neither a header nor a label has no title over its words: its key is no name.
Subtitle:Prepare({ key = "q:123:accept:456", present = {} }, short)
Expect("a line with no header and no label shows no title", Subtitle.title:GetText() .. "|" .. tostring(Subtitle.labelText), "|nil")
Subtitle:Prepare({ key = "q:123:accept:456", present = { header = "Thrall", label = "A Task" } }, short)
Expect("...and one with both shows them", Subtitle.title:GetText() .. "|" .. tostring(Subtitle.labelText), "Thrall|A Task")

-- Each layout setting changed under the sample shows on it at once, not at the next line or page.
local frame = _G.SpokenEnv.Addon.db.profile.Frame
-- The measure follows Text Size here: 7 a character at the quest font's 12, more as it grows.
_G.QuestFont = _G.QuestFont or CreateFrame("Frame"):CreateFontString()
Subtitle.measure.SetFont = function(self, _, size) self.fontSize = size end
Subtitle.measure.GetStringWidth = function(self)
    return #tostring(self.text or "") * 7 * (self.fontSize or 12) / 12
end
local saved = { FontSize = cfg.FontSize, Lines = cfg.Lines, SubtitleScroll = cfg.SubtitleScroll,
    SubtitleProgress = cfg.SubtitleProgress }
Subtitle:ShowSample(true)
Expect("the sample is up, the row over its words", Subtitle.sample ~= nil and Subtitle.nameRow
    and Subtitle.nameRow:IsShown() and Subtitle.picture:IsShown(), true)
cfg.SubtitleName = false
Subtitle:Update()
Expect("Show Name and Title off: the sample's row goes", Subtitle.nameRow and Subtitle.nameRow:IsShown(), false)
cfg.SubtitleName = true
Subtitle:Update()
Expect("...on: it is back", Subtitle.nameRow and Subtitle.nameRow:IsShown(), true)
frame.HidePortrait = true
Subtitle:Update()
Expect("Hide Portrait: the sample's picture goes", Subtitle.picture:IsShown(), false)
frame.HidePortrait = false
Subtitle:Update()
Expect("...off: it is back", Subtitle.picture:IsShown(), true)
local rows = #Subtitle.rows
cfg.SubtitleScroll = "line"
Subtitle:Update()
Expect("Auto-Scroll line by line: a line's room over and under the words",
    tostring(Subtitle.words and Subtitle.words.height),
    tostring(Subtitle.lineStep and ((Subtitle.shownRows or 0) + 2) * Subtitle.lineStep - 2))
cfg.Lines = 1
Subtitle:Update()
Expect("Lines Shown: the sample shows that many", tostring(rows > 1) .. " " .. tostring(Subtitle.shownRows), "true 1")
cfg.Lines, cfg.SubtitleScroll = saved.Lines, saved.SubtitleScroll
Subtitle:Update()
Expect("...page by page again: every row of the page", Subtitle.shownRows, rows)
cfg.FontSize = 40
Subtitle:Update()
Expect("Text Size: the sample's words wrap at the new size", #Subtitle.rows > rows, true)
Expect("...and are paged at it, no page past four lines", #Subtitle.pages > 1 and #Subtitle.rows <= 4, true)
cfg.FontSize = saved.FontSize
Subtitle:Update()
Expect("...back to its size, one page again", tostring(#Subtitle.pages) .. " " .. #Subtitle.rows, "1 " .. rows)
cfg.SubtitleSentences = 1
Subtitle:Update()
Expect("Sentences at Once: the sample paged a sentence at a time", #Subtitle.pages, 3)
cfg.SubtitleSentences = 3
Subtitle:Update()
cfg.SubtitleProgress = false
Subtitle:Update()
Expect("Show Progress off: the sample's progress line goes", Subtitle.progressShown, false)
cfg.SubtitleProgress = saved.SubtitleProgress
Subtitle:Update()

-- Ctrl and the wheel over the subtitles: Subtitle Size, and with Shift Text Size. Without Ctrl, or
-- locked, it does not take the wheel, which zooms the camera.
local ctrl, shift, wheelOn = false, false, nil
local hadCtrl, hadShift = _G.IsControlKeyDown, _G.IsShiftKeyDown
_G.IsControlKeyDown = function() return ctrl end
_G.IsShiftKeyDown = function() return shift end
Subtitle.frame.IsMouseOver = function() return true end
Subtitle.frame.EnableMouseWheel = function(_, on) wheelOn = on end
Subtitle:TakeWheel()
Expect("the subtitles leave the wheel to the camera without Ctrl", wheelOn, nil)
ctrl = true
Subtitle:TakeWheel()
Expect("...and take it while Ctrl is held over them", wheelOn, true)
local before = cfg.SubtitleScale
Subtitle.frame:GetScript("OnMouseWheel")(Subtitle.frame, 1)
Expect("Ctrl and the wheel grow Subtitle Size", math.abs(cfg.SubtitleScale - before - 0.05) < 1e-9, true)
Expect("...drawing them larger", math.abs(Subtitle.frame.spokenBaseScale - cfg.SubtitleScale) < 1e-9, true)
Expect("...and saying so", _G.GameTooltip.text,
    _G.SpokenEnv.L.OPT_SUBTITLE_SIZE .. ": " .. math.floor(cfg.SubtitleScale * 100 + 0.5) .. "%")
cfg.SubtitleScale = 1.6
Subtitle.frame:GetScript("OnMouseWheel")(Subtitle.frame, 1)
Expect("...no further than the slider goes", cfg.SubtitleScale, 1.6)
cfg.SubtitleScale = before
shift = true
Subtitle.frame:GetScript("OnMouseWheel")(Subtitle.frame, 1)
Expect("Ctrl, Shift and the wheel grow Text Size", cfg.FontSize, saved.FontSize + 1)
cfg.FontSize = saved.FontSize
shift = false
_G.SpokenEnv.Addon.db.profile.Frame.LockFrame = true
Subtitle:TakeWheel()
Expect("locked, they leave the wheel to the camera", wheelOn, false)
Subtitle.frame:GetScript("OnMouseWheel")(Subtitle.frame, 1)
Expect("...and a turn that reaches them changes nothing", cfg.SubtitleScale, before)
_G.SpokenEnv.Addon.db.profile.Frame.LockFrame = false
Subtitle:TakeWheel()
Expect("...unlocked, they take it again", wheelOn, true)
Subtitle.frame:Hide()
Subtitle:TakeWheel()
Expect("...and give it back once they hide", wheelOn, false)
Subtitle.frame:Show()
ctrl = false
_G.IsControlKeyDown, _G.IsShiftKeyDown = hadCtrl, hadShift
Subtitle:Update()
Subtitle:ShowSample(false)

-- A line held back shows, saying why after its title, as the windows do: the subtitles otherwise
-- wait for the voice to start before they show.
do
    local env = _G.SpokenEnv
    local held = env.Sources:Register("held", { title = "Held", addon = "Spoken", order = 9 })
    local holding = true
    held:AddGate(function() if holding then return "in combat" end end)
    env.Addon:SetPlayerStyle("subtitle")
    held:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Held",
        transcript = "The kobolds dig deeper into the mine every night.", portrait = { kind = "none" } } }))
    env.Transcript:Sync()
    Subtitle:CountWaiting()
    Expect("a held line shows in the subtitles, saying why after its title",
        tostring(Subtitle.frame:IsShown()) .. " " .. tostring(Subtitle.held:IsShown()) .. " " .. Subtitle.held:GetText(),
        "true true (in combat)")
    cfg.SubtitleName = false
    Subtitle:Update()
    Subtitle:CountWaiting()
    Expect("...and with Show Name and Title off, why it waits is the row",
        tostring(Subtitle.nameRow:IsShown()) .. " " .. tostring(Subtitle.held:IsShown()) .. " "
        .. tostring(Subtitle.heldDot:IsShown()), "true true false")
    cfg.SubtitleName = true
    Subtitle:Update()
    held:Enqueue(H.Clip({ length = 30, present = { header = "Grull", label = "Next", transcript = "More.",
        portrait = { kind = "none" } } }))
    Subtitle:CountWaiting()
    Expect("the subtitles' count lists the lines waiting under the pointer",
        tostring(Subtitle.more:IsShown()) .. " " .. tostring(Subtitle.moreHover:IsShown()), "true true")
    holding = false
    env.SoundQueue:RemoveAllSoundsFromQueue()
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll subtitle page tests passed")

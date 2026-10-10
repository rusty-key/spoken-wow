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
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
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

-- Show Name and Title off (issue #288): the words alone, as a film's subtitles, from the top.
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

-- Each setting the subtitle is laid out with, changed under the sample, shows on it at once, as
-- the settings page changes it: not at the next line or page.
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
Subtitle:ShowSample(false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll subtitle page tests passed")

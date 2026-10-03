-- The subtitle shows at most four lines at once: a longer line is split into pages of up to
-- four, at sentence ends where a sentence fits, and between words where one does not. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local QUESTS = here .. "/../../addons/SpokenQuests/"

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

-- Twelve sentences of about 50 characters: well past four lines.
local sentences = {}
for i = 1, 12 do
    sentences[i] = string.format("Sentence number %02d tells a little more of the story.", i)
end
local long = table.concat(sentences, " ")
local pages = Subtitle:Paginate(long)
local most = 0
for _, page in ipairs(pages) do most = math.max(most, #Subtitle:Wrap(page)) end
Expect("a long line is split into several pages", #pages > 2, true)
Expect("...none longer than four lines", most <= 4, true)
Expect("...each ending at a sentence end", pages[1]:sub(-1), ".")
Expect("...and together they give back every word, in order", Words(table.concat(pages, " ")), Words(long))

-- One sentence longer than a page: cut between words.
local run = {}
for i = 1, 80 do run[i] = "word" .. i end
local endless = table.concat(run, " ") .. "."
pages = Subtitle:Paginate(endless)
most = 0
for _, page in ipairs(pages) do most = math.max(most, #Subtitle:Wrap(page)) end
Expect("a sentence longer than a page is cut between words", #pages > 1 and most <= 4, true)
Expect("...losing none of them", Words(table.concat(pages, " ")), Words(endless))

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll subtitle page tests passed")

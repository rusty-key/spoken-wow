-- Spoken's controls on DialogueUI's book view (UI/DialogueUIBook.lua), against a fake
-- DUIBookFrame. The queue is the real Spoken one. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local BOOKS = here .. "/../../addons/Spoken_Books/"
local Expect, Failures = H.Expecter(print)

-- The Hillsbrad Town Registry: four real pages of one real book, 261 through 265; a pack with
-- the first three, and the first page of A Dusty Unsent Letter (16).
local REGISTRY = { 261, 262, 263, 265 }
_G.SpokenBooksAudioPacks = {
    SpokenBooksAudio = {
        version = 1, addon = "SpokenBooksAudio", quality = "high", bitrate = 128,
        pages = { [261] = { file = "261", len = 30.5 }, [262] = { file = "262", len = 41.0 },
            [263] = { file = "263", len = 20.0 }, [16] = { file = "16", len = 12.0 } },
    },
}

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist", "UI/CopyLink",
        "UI/DialogueUIBook" }) do
        local chunk = assert(loadfile(BOOKS .. file .. ".lua"))
        chunk("Spoken_Books", SpokenBooks)
    end
    return SpokenBooks
end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
_G.SpokenBooksSettings = nil
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()

-- DialogueUI's book view: no parent, drawn at 0.8, its close button in its top right, its own
-- speaker in its top left.
local view = stub.Widget("Frame")
view.GetEffectiveScale = function() return 0.8 end
view.CloseButton = stub.Widget("Button")
view.CloseButton:SetSize(64 * 0.53333, 64 * 0.53333)
view.CloseButton:SetPoint("TOPRIGHT", view, "TOPRIGHT", -26 * 0.53333, -26 * 0.53333)
-- Its top at 600 and its title's 48 under it.
view.GetTop = function() return 600 end
view.Header = stub.Widget("Frame")
view.Header.Title = stub.Widget("FontString")
view.Header.Title:Show()
view.Header.Title.GetTop = function() return 552 end
-- How DialogueUI lays a short page out: the line under the title hung off the top, the text under
-- it, the frame as tall as they need.
view.Header.HeaderDivider = stub.Widget("Texture")
view.ScrollFrame = stub.Widget("Frame")
view.ContentFrame = stub.Widget("Frame")
view:SetHeight(300)
function view:SetFrameHeight(height) self:SetHeight(height) end
function view:SetScrollContentHeight()
    self.Header.Title:SetPoint("TOP", self, "TOP", 0, -90 * 0.53333)
    self.Header.HeaderDivider:SetPoint("CENTER", self, "TOP", 0, -60)
    self.ScrollFrame:SetPoint("TOPLEFT", self, "TOPLEFT", 0, -70)
    self.ContentFrame:SetPoint("TOP", self, "TOP", 0, -70)
    self:SetHeight(300)
end
view.TTSButton = stub.Widget("Button")
view.TTSButton:SetAlpha(0.6)
-- Its Copy Text, which it puts in its top left corner as it lays its buttons out.
view.CopyTextButton = stub.Widget("Button")
view.CopyTextButton:Show()
function view:LayoutWidgets()
    self.CopyTextButton:ClearAllPoints()
    self.CopyTextButton:SetPoint("TOPLEFT", self, "TOPLEFT", 14, -14)
end
view:LayoutWidgets()
view:Hide()
_G.DUIBookFrame = view

local B = LoadBooks()
B:InitDB()
B:SetupSource()
dofile(BOOKS .. "Data/Books.lua")
B:SetupDialogueUIBook()
local Book = B.DialogueUIBook
local watch = Book.watch

local function QueuedPages()
    local pages = {}
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then table.insert(pages, clip.pageId) end
    end
    return table.concat(pages, ",")
end

---------------------------------------------------------------- room for the controls
-- 36 of UIParent's units over the controls' line and under it, as on the quest window: the title,
-- its line and the text moved down for it by as much as the title moved from DialogueUI's place for
-- it (90 of the book art's pixels under the top), so the line stays as close under the title as
-- DialogueUI has it; a short page's frame taller by as much.
view:SetScrollContentHeight(100, 1)
local shift = (2 * 36 + 24) * (UIParent:GetEffectiveScale() / 0.8) - 90 * 0.53333
Expect("the title moved down to leave 36 over and under the controls' line", view.Header.Title.anchor.y,
    -(90 * 0.53333 + shift))
Expect("...its line and the text with it", view.Header.HeaderDivider.anchor.y .. " " .. view.ScrollFrame.anchor.y
    .. " " .. view.ContentFrame.anchor.y, (-60 - shift) .. " " .. (-70 - shift) .. " " .. (-70 - shift))
Expect("...a short page's frame taller by as much", view:GetHeight(), 300 + shift)
view.ScrollFrame, view.ContentFrame = nil, nil

---------------------------------------------------------------- the row
-- DialogueUI loads every page as it opens the book and leaves the game on the last.
B.lastPage = 265
view:Show()
watch.scripts.OnShow(watch)
local row = Book.row
Expect("the book view opening shows Spoken's controls on it", row ~= nil and row.frame:IsShown()
    and row.frame:GetParent() == view, true)
Expect("...Play, Skip and Report, the player's round buttons", row.play.ring ~= nil and row.skip.bar ~= nil
    and row.report:IsShown(), true)
Expect("...left of the book's close button", row.frame.anchor.point .. " " .. tostring(row.frame.anchor.relativeTo
    == view.CloseButton) .. " " .. row.frame.anchor.relativePoint .. " " .. row.frame.anchor.x, "RIGHT true LEFT -4")
local closeAt = view.CloseButton.anchor
Expect("...the close button's middle halfway between the book's top and its title's, 26 in as DialogueUI has it",
    closeAt.point .. " " .. tostring(closeAt.relativeTo == view) .. " " .. closeAt.relativePoint .. " " .. closeAt.x
    .. " " .. closeAt.y, "RIGHT true TOPRIGHT " .. (-26 * 0.53333) .. " -24")
Expect("...Report rightmost, then Skip, then Play", row.report.anchor.relativeTo == row.frame
    and row.skip.anchor.relativeTo == row.report and row.play.anchor.relativeTo == row.skip, true)
Expect("...as large on screen as Place Lore draws them, 24 at UIParent's scale",
    row.play:GetWidth() .. " " .. row.play:GetScale(), "24 " .. (UIParent:GetEffectiveScale() / 0.8))
Expect("...in place of DialogueUI's own speaker", view.TTSButton:GetAlpha(), 0)
Expect("...DialogueUI's Copy Text left of them, on their middle, as on the quest window",
    view.CopyTextButton.anchor.point .. " " .. tostring(view.CopyTextButton.anchor.relativeTo == row.frame) .. " "
    .. view.CopyTextButton.anchor.relativePoint .. " " .. view.CopyTextButton.anchor.x, "RIGHT true LEFT -4")
view:LayoutWidgets()
Expect("...staying there as DialogueUI lays its buttons out again", view.CopyTextButton.anchor.relativeTo == row.frame, true)
Expect("Play is lit for a book with a recording", row.play:IsEnabled(), true)
Expect("Skip is greyed with nothing speaking", row.skip:IsEnabled(), false)

---------------------------------------------------------------- playing it
row.play.scripts.OnClick(row.play, "LeftButton")
Expect("Play reads the book from its first page, not the last the game is on", QueuedPages() .. "+"
    .. table.concat(B.following[261] and B.following[261].pages or {}, ","), "261+262,263")
Book:Draw()
Expect("...and turns to Stop while it reads", row.play.state, "stop")
Expect("...Skip lit", row.skip:IsEnabled(), true)
row.play.scripts.OnEnter(row.play)
Expect("its tooltip is on the book view, which DialogueUI's hiding of the interface leaves up",
    row.play.tooltip ~= nil and row.play.tooltip:GetParent() == view and row.play.tooltip.text, B.L.STOP_TIP)
row.play.scripts.OnLeave(row.play)
row.report.scripts.OnClick(row.report)
local box = Spoken.ContributeBox
Expect("Report gives the address for the page being read, in Spoken's box",
    box and box.editBox:GetText(), B:ReportURL(261))
-- The letter open in the view while the Registry is still read: Report is for the letter shown.
B.lastPage = 16
Book:Draw()
row.report.scripts.OnClick(row.report)
box = Spoken.ContributeBox
Expect("...and with another book open in the view, the address for that book, not the one being read",
    box and box.editBox:GetText(), B:ReportURL(16))
B.lastPage = 265
Book:Draw()
row.play.scripts.OnClick(row.play, "LeftButton")
Expect("Stop stops it", QueuedPages(), "")
Book:Draw()
Expect("...and Stop turns back to Play", row.play.state, "play")
local autoplay = SpokenBooksSettings.autoplay
row.play.scripts.OnClick(row.play, "RightButton")
Expect("right-click switches Read Automatically", SpokenBooksSettings.autoplay, not autoplay)
row.play.scripts.OnClick(row.play, "RightButton")

---------------------------------------------------------------- the words
-- DialogueUI lays the book out as one column of paragraphs and draws those in view on
-- FontStrings it hands from one to another as it scrolls.
local RED = "|cff9c1a1a"
local data = B:Data()
local content = { { text = "Hillsbrad Town Registry" }, { text = data.pages[261].text }, { text = data.pages[262].text } }
local strings = {}
for i = 1, 3 do
    strings[i] = view:CreateFontString()
    strings[i]:SetText(content[i].text)
end
local scroll = stub.Widget("Frame")
scroll.content, scroll.contentIndexObject = content, { strings[1], strings[2], strings[3] }
function scroll:SetObjectData(obj, entry) obj:SetText(entry.text) end
view.ScrollFrame = scroll
view.textureKitID = 1
function view:ScrollToContent(index) self.scrolledTo = index end
function view:RebuildContentFromCache() end
local words = env.Addon.db.profile.Transcript
words.Enabled, words.HighlightWord, words.Typewriter = true, true, false
B.lastPage = 265
local function Tick(seconds)
    stub.Advance(seconds)
    watch.scripts.OnUpdate(watch, 0.1)
end
row.play.scripts.OnClick(row.play, "LeftButton")
Tick(2)
local lit = strings[2]:GetText()
Expect("the page being read lights its word in the book view, deep red on the paper",
    string.find(lit, RED, 1, true) ~= nil and select(2, string.gsub(lit, "|c", "")) == 2, true)
Expect("...the title and the next page left alone", strings[1]:GetText() .. "|" .. strings[3]:GetText(),
    content[1].text .. "|" .. content[3].text)
-- Scrolled, DialogueUI hands the first FontString to the page being read.
scroll:SetObjectData(strings[1], content[2], 2)
Expect("a FontString handed to the page as the view scrolls shows it lit", strings[1]:GetText(), lit)
strings[1]:SetText(content[1].text)
words.HighlightWord, words.Typewriter = false, true
Tick(0.1)
local typed = strings[2]:GetText()
Expect("with Type Out, the page types out as the voice reads it", typed ~= "" and typed ~= content[2].text
    and string.sub(content[2].text, 1, string.len(typed)) == typed, true)
Expect("...the next page whole: only the page being read types", strings[3]:GetText(), content[3].text)
view.textureKitID = 2
words.HighlightWord, words.Typewriter = true, false
Spoken:StopAll()
Tick(0.1)
Expect("stopped, the book's own text is back", strings[2]:GetText(), content[2].text)
row.play.scripts.OnClick(row.play, "LeftButton")
Tick(2)
Expect("on stone the word is lit in gold", string.find(strings[2]:GetText(), "|cffffd100", 1, true) ~= nil, true)
Spoken:StopAll()
Tick(0.1)
view.textureKitID = 1

---------------------------------------------------------------- a book with no recording
B.lastPage = 2810
Book:Draw()
Expect("a book no pack voices greys Play", row.play:IsEnabled(), false)
Expect("...and has nothing to report", row.report:IsShown(), false)
Expect("...Skip and Play moving up to the close button", row.skip.anchor.relativeTo, row.frame)

---------------------------------------------------------------- closing
view:Hide()
watch.scripts.OnHide(watch)
Expect("the book view closing takes the row with it", row.frame:IsShown(), false)
Expect("...and gives DialogueUI's speaker back", view.TTSButton:GetAlpha(), 0.6)
Expect("...and its Copy Text its own corner", view.CopyTextButton.anchor.point .. " "
    .. tostring(view.CopyTextButton.anchor.relativeTo == view), "TOPLEFT true")
Expect("...and its close button its own corner", view.CloseButton.anchor.point .. " " .. view.CloseButton.anchor.y,
    "TOPRIGHT " .. (-26 * 0.53333))

if Failures() > 0 then
    print(string.format("\n%d book view test(s) failed", Failures()))
    os.exit(1)
end
print("\nAll book view tests passed")

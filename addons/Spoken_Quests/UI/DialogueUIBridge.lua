setfenv(1, VoiceOver)

-- DialogueUI hides UIParent while its quest and gossip window is open, taking Spoken's player
-- and captions with it. This file shows them on DialogueUI's window instead: its text marks
-- the words being read, and the player, a Play button and the Contribute button sit on it.
--
-- A page's line is read by the module that reads it outside DialogueUI: a quest window's by this
-- addon, gossip and a quest-giver's greeting by the gossip module (Spoken_Gossip), which hands
-- this file its reader where it is installed (ReaderFor).
--
-- DUIQuestFrame, its fontStringPool and its Handle* methods are DialogueUI internals, not an
-- API: Recognised checks them once at setup and the module stands down if any is missing.
--
-- Marks go into the paragraph's own text: colour codes take no width and a left-aligned
-- prefix wraps as the whole did, so nothing moves. The original text goes back when the line
-- ends, because DialogueUI reads it for its own text-to-speech.
--
-- Parses as Lua 5.0 (no #, no %) because addon.xml is shared with the 1.12 client.

DialogueUIBridge = { status = "waiting" }
local Bridge = DialogueUIBridge

if Version.IsAnyLegacy then
    Bridge.status = "legacy client"
    return
end

-- A page can be built again (an item reward resolving, QUEST_DETAIL firing twice).
local HANDLERS = { "HandleQuestDetail", "HandleQuestProgress", "HandleQuestComplete",
    "HandleQuestGreeting", "HandleGossip" }
-- How many words of DialogueUI's text a caption word may skip to find its match: the NPC
-- name DialogueUI can put in front of the text, a hint, a word that differs.
local LOOKAHEAD = 6
-- Below this share of the caption's words found, the window shows something else (an earlier
-- page, another NPC's gossip) and nothing is marked.
local MIN_SHARE = 0.6
-- Gold reads on DialogueUI's dark theme but not on its tan parchment, where a deep red does.
local ON_DARK = "|cffffd100"
local ON_LIGHT = "|cff9c1a1a"
local TICK = 0.05
-- Spoken Quests reads a dialog a moment after DialogueUI draws it, so typed-out words the line
-- will read stay blank for up to this long; shown whole until the voice began, they flashed.
local HOLD = 2.5
-- The longest autoplay waits for DialogueUI's window to fade in: its slowest intro is 0.75s
-- and its text fades in over 0.35s. Past it the line reads anyway.
local WAIT_LIMIT = 1.5
local EVENTS = { HandleQuestDetail = "QUEST_DETAIL", HandleQuestProgress = "QUEST_PROGRESS",
    HandleQuestComplete = "QUEST_COMPLETE", HandleQuestGreeting = "QUEST_GREETING", HandleGossip = "GOSSIP_SHOW" }
-- Keyed by the page names DialogueUI passes its voiceover provider.
local QUEST_EVENTS = { detail = "QUEST_DETAIL", progress = "QUEST_PROGRESS", completion = "QUEST_COMPLETE" }

local function Config()
    return Addon.db.profile.DialogueUI
end

-- Who reads a page's line: GetVisibleLine(event), ExpectedLine(event, textIsCurrent),
-- ReadNow(event, source) at once ahead of the queue, QueuedClipFor(line), Remove(clip), source()
-- the player source its lines carry, and `autoplay` where it has a Read Automatically switch.
local QUESTS = {
    GetVisibleLine = function(event) return Addon:GetVisibleLine(event) end,
    ExpectedLine = function(event, textIsCurrent) return Addon:ExpectedLine(event, textIsCurrent) end,
    ReadNow = function(event, source)
        Player.playNow = true
        local ok, err = pcall(Addon.InvokeQuestHandler, Addon, event, source, true)
        Player.playNow = nil
        return ok, err
    end,
    QueuedClipFor = function(line) return Player:QueuedClipFor(line) end,
    Remove = function(clip) Player:Remove(clip) end,
    source = function() return Player.source end,
    autoplay = {
        IsOn = function() return Addon:IsAutoplayOn() end,
        Set = function(on) Addon:SetAutoplay(on) end,
    },
}
local SPEECH = { GOSSIP_SHOW = true, QUEST_GREETING = true }

--- The gossip module's reader, where it is installed (Spoken_Gossip/DialogueUI.lua).
local function GossipReader()
    local env = rawget(_G, "SpokenGossipEnv")
    return env and rawget(env, "DialogueUIReader")
end

--- The reader of `event`'s page, or nil where no module installed reads it.
local function ReaderFor(event)
    if SPEECH[event] then
        return GossipReader()
    end
    return event and QUESTS or nil
end

--- The line `event`'s page would read, asked of the module that reads it, or nil: for the
--- Report button on DialogueUI's window (the dialogue core's ContributeButton.lua).
function Bridge:LineFor(event)
    local reader = ReaderFor(event)
    return reader and reader.GetVisibleLine(event) or nil
end

--- Whether `clip` is a line one of the dialogue modules read off a window, as against a zone's
--- story or a book's page, which never match DialogueUI's text.
local function IsDialogueClip(clip)
    if not clip then
        return false
    end
    if clip.source == Player.source then
        return true
    end
    local gossip = GossipReader()
    return gossip ~= nil and clip.source == gossip.source()
end

local function IsLoaded(name)
    return IsAddOnLoaded ~= nil and IsAddOnLoaded(name) and true or false
end

--- Whether DUIQuestFrame still has everything this file reaches for.
local function Recognised()
    local frame = _G.DUIQuestFrame
    if type(frame) ~= "table" or type(frame.fontStringPool) ~= "table" or not frame.ContentFrame then
        return false
    end
    if type(frame.fontStringPool.EnumerateActive) ~= "function" then
        return false
    end
    for _, name in ipairs(HANDLERS) do
        if type(frame[name]) ~= "function" then
            return false
        end
    end
    return true
end

--- Why `feature` (a key of the DialogueUI settings) cannot work, or nil when it can. The
--- settings panel greys the option and shows this.
function Bridge:Problem(feature)
    if not IsLoaded("DialogueUI") then
        return L.OPT_DUI_MISSING
    elseif not (_G.Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then
        return L.OPT_DUI_NO_PLAYER
    elseif not Recognised() then
        return L.OPT_DUI_UNKNOWN
    elseif (feature == "Captions" or feature == "AutoScroll") and not (Spoken.GetCaption and Spoken.SplitCaption) then
        return L.OPT_DUI_OLD_PLAYER
    elseif feature == "ShowPlayer" and not Spoken.SetPlayerHost then
        return L.OPT_DUI_OLD_PLAYER
    end
end

--------------------------------------------------------------------------------
-- Matching the caption to the window
--------------------------------------------------------------------------------

--- A word as compared: lower case, without ASCII punctuation. nil for all punctuation, or for
--- an escape sequence (a link, a colour): only DialogueUI's copy has those, and they must
--- never be split.
function Bridge.Key(text)
    if string.find(text, "|", 1, true) then
        return nil
    end
    local key = string.gsub(string.lower(text), "%p", "")
    if key == "" then
        return nil
    end
    return key
end

--- Mark the words inside a hyperlink (|H...|h[name]|h): the name's inner words carry no
--- escape of their own, and lighting one, or typing up to it, would split the link.
function Bridge.MarkLinks(text, words)
    local from = 1
    while true do
        local s, e = string.find(text, "|H.-|h.-|h", from)
        if not s then
            return words
        end
        for _, word in ipairs(words) do
            if word.last >= s and word.first <= e then
                word.inLink = true
            end
        end
        from = e + 1
    end
end

--- Match the caption's words to the paragraphs' from paragraph `first` on. Each caption word
--- is looked for a few words past the last match; the first only within paragraph `first`.
--- Returns map[i] = { p = paragraph, w = word } for the words found, how many were found,
--- and how many could have been.
function Bridge.AlignFrom(words, paragraphs, first)
    local tokens = {}
    local firstEnd = 0
    for p = first, table.getn(paragraphs) do
        for w, word in ipairs(paragraphs[p].words) do
            table.insert(tokens, { p = p, w = w, key = not word.inLink and Bridge.Key(word.text) or nil })
        end
        if p == first then
            firstEnd = table.getn(tokens)
        end
    end
    local map, found, counted, nextToken = {}, 0, 0, 1
    local total = table.getn(tokens)
    for i, word in ipairs(words) do
        local key = Bridge.Key(word.text)
        if key then
            counted = counted + 1
            local last = math.min(total, found == 0 and firstEnd + LOOKAHEAD or nextToken + LOOKAHEAD)
            for t = nextToken, last do
                if tokens[t].key == key then
                    map[i] = tokens[t]
                    found = found + 1
                    nextToken = t + 1
                    break
                end
            end
        end
    end
    return map, found, counted
end

--- The best match over every starting paragraph, or nil when none is good enough. DialogueUI
--- can keep earlier gossip and a hint above the text, so the later start wins a tie. The
--- second value is the span of paragraphs matched, { first, last }: only those are typed out.
function Bridge.Align(words, paragraphs)
    local bestMap, bestFound, bestCounted = nil, 0, 0
    for first = 1, table.getn(paragraphs) do
        local map, found, counted = Bridge.AlignFrom(words, paragraphs, first)
        if found > 0 and found >= bestFound then
            bestMap, bestFound, bestCounted = map, found, counted
        end
    end
    if not bestMap or bestFound < math.min(3, bestCounted) or bestFound < bestCounted * MIN_SHARE then
        return nil
    end
    local span
    for _, at in pairs(bestMap) do
        if not span then
            span = { first = at.p, last = at.p }
        else
            span.first, span.last = math.min(span.first, at.p), math.max(span.last, at.p)
        end
    end
    return bestMap, span
end

--- The pair to light for caption word `index`: that word, or the last one before it the
--- window has, and its neighbour in the same paragraph: the next word, or at a paragraph's
--- end the one before, as the captions keep the last pair lit at a page boundary.
function Bridge.Pick(map, index)
    if not index then
        return nil
    end
    local lit = index
    while lit > 0 and not map[lit] do
        lit = lit - 1
    end
    if lit == 0 then
        return nil
    end
    local at = map[lit]
    local after, before = map[lit + 1], map[lit - 1]
    if after and after.p == at.p then
        return lit, lit + 1
    elseif before and before.p == at.p then
        return lit, lit - 1
    end
    return lit
end

--- How far the text is typed out: the paragraph the voice is in and the last byte of it
--- shown, or nil for all of it (finished, or a clip with no length to time it by). A caption
--- word the window lacks types up to the last one before it that it has.
function Bridge.Cut(caption, map, span, paragraphs)
    if not caption.typewriter or not caption.progress or caption.progress >= 1 then
        return nil
    end
    local index = caption.speaking and caption.activeWord or 0
    while index > 0 and not map[index] do
        index = index - 1
    end
    if index == 0 then
        return span.first, 0
    end
    local at = map[index]
    return at.p, paragraphs[at.p].words[at.w].last
end

--- `text` with the words at `spans` (sorted by position) wrapped in `color`.
function Bridge.Wrap(text, spans, color)
    local parts, from = {}, 1
    for _, span in ipairs(spans) do
        table.insert(parts, string.sub(text, from, span.first - 1))
        table.insert(parts, color .. string.sub(text, span.first, span.last) .. "|r")
        from = span.last + 1
    end
    table.insert(parts, string.sub(text, from))
    return table.concat(parts)
end

function Bridge.ColorFor(r, g, b)
    return Utils:IsBright(r, g, b) and ON_DARK or ON_LIGHT
end

--------------------------------------------------------------------------------
-- Drawing it
--------------------------------------------------------------------------------

-- paragraphs: { fs, text (DialogueUI's), shown (what this file last set), words, color }.
-- clip, map and span: the caption last matched against them. lit/neighbor: the caption words
-- lit; cutP/cutByte: how far the text is typed out (Bridge.Cut). pending: the line about to be
-- read for the page just built, before it is queued: { words, untilTime, map, span }.
local state = { dirty = true }
-- Whether the player reports the word being read (Spoken:GetCaption).
local canMark = false

-- A FontString set to "" may read back as nil.
local function Showing(fs)
    return fs:GetText() or ""
end

--- Put every paragraph's own text back. Only where it still shows what this file set:
--- DialogueUI may have reused the FontString for something else since.
local function Restore()
    for _, para in ipairs(state.paragraphs or {}) do
        if para.shown ~= para.text and Showing(para.fs) == para.shown then
            para.fs:SetText(para.text)
        end
        para.shown = para.text
    end
    state.lit, state.neighbor, state.cutP, state.cutByte = nil, nil, nil, nil
end

--- The text DialogueUI is showing now: its paragraphs, not their translations, not the
--- title or the objectives' heading (which carry no text-to-speech flag).
local function Collect()
    local paragraphs = {}
    for _, fs in DUIQuestFrame.fontStringPool:EnumerateActive() do
        if not fs.isTranslation and (fs.ttsFlag ~= nil or fs.isTranslation == false) then
            local text = fs:GetText()
            local words = type(text) == "string" and Spoken:SplitCaption(text)
            if words and table.getn(words) > 0 then
                table.insert(paragraphs, { fs = fs, text = text, shown = text, words = Bridge.MarkLinks(text, words),
                    color = Bridge.ColorFor(fs:GetTextColor()) })
            end
        end
    end
    return paragraphs
end

--- A page was built: drop what was matched against the last one. Kept gossip history is not
--- rebuilt, so its paragraphs are restored first.
local function Invalidate()
    Restore()
    state.paragraphs, state.clip, state.map, state.span, state.dirty = nil, nil, nil, nil, true
    state.scrolledTo = nil
end

local function ScrollIntoView(fs)
    local frame = DUIQuestFrame
    if not (frame.IsScrollable and frame:IsScrollable() and frame.ScrollTo and frame.ScrollFrame) then
        return
    end
    local scroll = frame.ScrollFrame
    local contentTop, top, bottom = frame.ContentFrame:GetTop(), fs:GetTop(), fs:GetBottom()
    if not (contentTop and top and bottom) then
        return
    end
    local from, to = contentTop - top, contentTop - bottom
    local view = scroll:GetHeight()
    local current = scroll.scrollTarget or scroll.value or 0
    if from >= current and to <= current + view then
        return
    end
    -- A little of what came before stays in view above it.
    frame:ScrollTo(math.max(0, math.min(scroll.range or 0, from - view * 0.2)))
end

local function Draw(map, span, lit, neighbor, cutP, cutByte)
    local spans = {}
    for _, index in ipairs({ lit, neighbor }) do
        local at = map[index]
        if at then
            spans[at.p] = spans[at.p] or {}
            table.insert(spans[at.p], state.paragraphs[at.p].words[at.w])
        end
    end
    for p, para in ipairs(state.paragraphs) do
        local want = para.text
        -- Only the line's paragraphs type out; earlier gossip and the objectives stay whole.
        if cutP and p >= span.first and p <= span.last then
            if p > cutP then
                want = ""
            elseif p == cutP then
                want = string.sub(para.text, 1, cutByte)
            end
        end
        if spans[p] then
            -- Only words already typed: the neighbour past the voice is not shown yet.
            local shown, kept = string.len(want), {}
            for _, word in ipairs(spans[p]) do
                if word.last <= shown then
                    table.insert(kept, word)
                end
            end
            table.sort(kept, function(a, b) return a.first < b.first end)
            want = Bridge.Wrap(want, kept, para.color)
        end
        if want ~= para.shown then
            if Showing(para.fs) ~= para.shown then
                -- DialogueUI changed it under us without a rebuild this file heard of.
                Invalidate()
                return
            end
            para.fs:SetText(want)
            para.shown = want
        end
    end
    state.lit, state.neighbor, state.cutP, state.cutByte = lit, neighbor, cutP, cutByte
    -- Keep the voice in view: the word lit, or else the paragraph being typed.
    local target = lit and map[lit] and map[lit].p or cutP
    if target and target ~= state.scrolledTo then
        state.scrolledTo = target
        if Config().AutoScroll then
            ScrollIntoView(state.paragraphs[target].fs)
        end
    end
end

local function Tick()
    if not Config().Captions then
        Restore()
        state.pending = nil
        return
    end
    if state.dirty then
        state.paragraphs, state.dirty = Collect(), false
        state.clip = nil
    end
    local caption = Spoken:GetCaption()
    local clip = caption and caption.clip
    -- A quest's or an NPC's line only: a zone's or a book's never match DialogueUI's text anyway.
    if IsDialogueClip(clip) then
        if clip ~= state.clip then
            -- Put back and drawn again in this one call: nothing shows in between.
            Restore()
            state.clip, state.scrolledTo = clip, nil
            state.map, state.span = Bridge.Align(caption.words, state.paragraphs)
        end
    else
        state.clip, state.map = nil, nil
    end
    if state.map and (caption.highlight or caption.typewriter) then
        state.pending = nil
        local lit, neighbor
        if caption.highlight then
            lit, neighbor = Bridge.Pick(state.map, caption.speaking and caption.activeWord or nil)
        end
        local cutP, cutByte = Bridge.Cut(caption, state.map, state.span, state.paragraphs)
        if lit ~= state.lit or neighbor ~= state.neighbor or cutP ~= state.cutP or cutByte ~= state.cutByte then
            Draw(state.map, state.span, lit, neighbor, cutP, cutByte)
        end
        return
    end
    -- A line is about to be queued for this page: its words wait blank, unless another part's
    -- line (a zone's lore, a book page) is playing, which the quest's waits behind.
    local pending = state.pending
    local otherPart = clip ~= nil and not IsDialogueClip(clip)
    if pending and not otherPart and GetTime() < pending.untilTime then
        if not pending.span then
            pending.map, pending.span = Bridge.Align(pending.words, state.paragraphs)
        end
        if pending.map then
            if state.lit or state.cutP ~= pending.span.first or state.cutByte ~= 0 then
                Draw(pending.map, pending.span, nil, nil, pending.span.first, 0)
            end
            return
        end
    end
    state.pending = nil
    Restore()
end

--- A page was just built. When Spoken Quests is about to read it and Spoken types words
--- out, remember the words its line will carry, so the first frame the page is drawn in
--- already has them blank (Tick, run at once by the hook in Hook).
function Bridge.Expect(handler)
    state.pending = nil
    local event = EVENTS[handler]
    local reader = ReaderFor(event)
    if not (reader and Config().Captions and Spoken.GetCaptionOptions) then
        return
    end
    local _, typewriter = Spoken:GetCaptionOptions()
    if not typewriter then
        return
    end
    local ok, text = pcall(reader.ExpectedLine, event, true)
    local words = ok and type(text) == "string" and Spoken:SplitCaption(text)
    if words and table.getn(words) > 0 then
        state.pending = { event = event, words = words, untilTime = GetTime() + HOLD }
    end
end

--- Spoken Quests read `event`'s page: `queued` when a line came of it. When none did, the
--- words kept blank for it show at once (next Tick) rather than after HOLD.
function Bridge:Read(event, queued)
    if not queued and state.pending and state.pending.event == event then
        state.pending = nil
    end
end

--------------------------------------------------------------------------------
-- The player over the window
--------------------------------------------------------------------------------

local hosting = false

--- Put the player on DialogueUI's window while it is open and the setting is on; back on
--- UIParent otherwise.
function Bridge:UpdatePlayerHost()
    if not (_G.Spoken and Spoken.SetPlayerHost and self.driver) then
        return
    end
    local want = self.driver:IsVisible() and Config().ShowPlayer and true or false
    if want ~= hosting then
        hosting = want
        Spoken:SetPlayerHost(want and DUIQuestFrame or nil)
    end
end

--------------------------------------------------------------------------------
-- The Contribute button
--------------------------------------------------------------------------------

--- The dialog event of the page DialogueUI's window shows, or nil while it is closed or this
--- file stood down. `frame.handler` is nil until the first dialog, so Recognised skips it.
function Bridge:Page()
    local frame = self.driver and _G.DUIQuestFrame
    if frame and frame:IsShown() then
        return EVENTS[frame.handler]
    end
end

--- The Contribute button follows the window: it opens, closes and changes page with no
--- event the button hears in time, since DialogueUI builds the page before showing it.
local function RefreshContribute()
    local button = rawget(VoiceOver, "ContributeButton")
    if button and button.Refresh then
        button:Refresh()
    end
end

--- Spoken's copy box, which a click on the button opens, over the window while it is open:
--- it is a child of UIParent, which DialogueUI hides.
local function HostContributeBox(host)
    if _G.Spoken and Spoken.SetContributeHost then
        Spoken:SetContributeHost(host)
    end
end

--------------------------------------------------------------------------------
-- The Play button
--------------------------------------------------------------------------------
--
-- DialogueUI draws a Play button only while its Text To Speech is on, which is off by default
-- and read only at load, so this file draws its own in the same corner. Read Automatically,
-- never DialogueUI's Auto Play, decides whether a line reads on its own.

-- A 64-wide cell per theme (1 parchment, 2 dark): the speaker on top, its three waves below.
local PLAY_ART = "Interface/AddOns/DialogueUI/Art/Theme_Shared/TTSButton.png"
local PLAY_SIZE, PLAY_ICON, PLAY_ALPHA, PLAY_INSET = 24, 16, 0.6, 8
-- How often the button looks again for the page's line while the window is open: a quest's ID
-- can arrive a moment after its page is drawn, and the packs load after login.
local LOOK_EVERY = 0.5

-- The line the window's page would read, and its event; Play and Stop act on it.
local line, lineEvent
-- DialogueUI's minimum autoplay delay.
local AUTOPLAY_DELAY = 0.5
-- When DialogueUI's autoplay will call playFile. It asks the delay (getAutoPlayDelay) just
-- before it waits, and a click on its button never does, which is how the two are told apart.
local autoplayAt
local playButton

--- Whether `soundData` is the line at the head of the player's queue, and not stopped there:
--- the line Stop acts on. A line stopped at the head is one to play again.
local function IsSpeaking(soundData)
    local head = Spoken.GetCurrent and Spoken:GetCurrent()
    return head ~= nil and head.fileName == soundData.fileName
        and not (Spoken.IsPaused and Spoken:IsPaused())
end

--- Read the page's line now, in front of whatever speaks (Player:PlayPreparedNow).
local function PlayLine(source)
    local reader = ReaderFor(lineEvent)
    if not (line and reader) then
        return
    end
    local ok, err = reader.ReadNow(lineEvent, source)
    if not ok then
        Debug:Record("dialogueui-play-error", tostring(err))
    end
end

--- Take the page's line out of the queue, speaking or waiting.
local function StopLine()
    local reader = ReaderFor(lineEvent)
    local clip = line and reader and reader.QueuedClipFor(line)
    if clip then
        reader.Remove(clip)
    end
end

--- The line for `event`'s page, or none, with the setting off or no pack voicing it.
local function LookForLine(event)
    line, lineEvent = nil, nil
    local reader = ReaderFor(event)
    if reader and Config().PlayButton then
        local ok, found = pcall(reader.GetVisibleLine, event)
        if ok and found then
            line, lineEvent = found, event
        end
    end
end

local function SetPlayTheme(button)
    local x = (Utils:DialogueUIThemeID() - 1) * 0.125
    button.Icon:SetTexCoord(x, 64 / 512 + x, 0, 0.5)
    button.Wave1:SetTexCoord(x, 16 / 512 + x, 0.5, 1)
    button.Wave2:SetTexCoord(16 / 512 + x, 40 / 512 + x, 0.5, 1)
    button.Wave3:SetTexCoord(40 / 512 + x, 64 / 512 + x, 0.5, 1)
end

local function Wave(button, key, width, anchor, x)
    local wave = button:CreateTexture(nil, "OVERLAY")
    wave:SetSize(width, PLAY_ICON)
    wave:SetPoint("LEFT", anchor, "RIGHT", x, 0)
    wave:SetTexture(PLAY_ART)
    wave:Hide()
    button[key] = wave
    return wave
end

--- What a click does now, and Read Automatically, which a right-click switches. On a tooltip of
--- the window's own (the game's is a child of UIParent, which DialogueUI hides).
local function ShowPlayTooltip(button)
    local contribute = rawget(VoiceOver, "ContributeButton")
    local tooltip = contribute and contribute.DialogueUITooltip and contribute:DialogueUITooltip(DUIQuestFrame)
        or GameTooltip
    local speaking = line ~= nil and IsSpeaking(line)
    tooltip:SetOwner(button, "ANCHOR_RIGHT")
    tooltip:SetText(speaking and SpokenEnv.L.DIALOGUE_STOP or SpokenEnv.L.DIALOGUE_LISTEN)
    tooltip:AddLine(speaking and SpokenEnv.L.DIALOGUE_STOP_TIP or SpokenEnv.L.DIALOGUE_READ_TIP, 1, 1, 1, true)
    -- Read Automatically is the quests module's; gossip goes by NPC Greetings, on its own page.
    local reader = ReaderFor(lineEvent)
    local autoplay = reader and reader.autoplay
    if autoplay then
        local on = autoplay.IsOn()
        tooltip:AddDoubleLine(L.OPT_PANEL_AUTOPLAY, on and L.OPT_DUI_ON or L.OPT_DUI_OFF, 1, 1, 1,
            on and 0.1 or 1, on and 1 or 0.125, on and 0.1 or 0.125)
        tooltip:AddLine(L.OPT_DUI_PLAY_RIGHT_CLICK, 1, 0.82, 0, true)
    end
    tooltip:Show()
    button.tooltip = tooltip
end

--- The button, built the first time a page has a line: a child of the window, so it shows
--- while DialogueUI hides UIParent and closes with the window, and drawn above it, over
--- DialogueUI's own button where that one is shown.
local function PlayButton()
    if playButton then
        return playButton
    end
    local frame = DUIQuestFrame
    local button = CreateFrame("Button", nil, frame)
    button:SetSize(PLAY_SIZE, PLAY_SIZE)
    button:SetPoint("TOPLEFT", frame, "TOPLEFT", PLAY_INSET, -PLAY_INSET)
    button:SetFrameStrata("FULLSCREEN")
    button:SetAlpha(PLAY_ALPHA)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button.Icon = button:CreateTexture(nil, "OVERLAY")
    button.Icon:SetSize(PLAY_ICON, PLAY_ICON)
    button.Icon:SetPoint("CENTER", button, "CENTER", 0, 0)
    button.Icon:SetTexture(PLAY_ART)
    local wave1 = Wave(button, "Wave1", PLAY_ICON * 0.25, button, -8)
    local wave2 = Wave(button, "Wave2", PLAY_ICON * 0.375, wave1, -3)
    Wave(button, "Wave3", PLAY_ICON * 0.375, wave2, -4)
    -- DialogueUI's own animation of the waves where it has it; still waves where it does not.
    local ok, anim = pcall(button.CreateAnimationGroup, button, nil, "DUISpeakerAnimationTemplate")
    button.anim = ok and anim or nil
    button:SetScript("OnClick", function(_, mouse)
        local reader = ReaderFor(lineEvent)
        if mouse == "RightButton" then
            if reader and reader.autoplay then
                reader.autoplay.Set(not reader.autoplay.IsOn())
            end
        elseif line and IsSpeaking(line) then
            StopLine()
        else
            PlayLine("Spoken's Play button on DialogueUI")
        end
        Bridge:DrawPlayButton()
        if button.tooltip and button.tooltip:IsShown() then
            ShowPlayTooltip(button)
        end
    end)
    button:SetScript("OnEnter", function()
        button:SetAlpha(1)
        ShowPlayTooltip(button)
    end)
    button:SetScript("OnLeave", function()
        button:SetAlpha(PLAY_ALPHA)
        if button.tooltip then
            button.tooltip:Hide()
        end
    end)
    button:Hide()
    playButton = button
    return button
end

--- DialogueUI's own button, kept out of sight while this one stands in its place, and given
--- back as DialogueUI leaves it when this one goes.
local covering = false
local function CoverTheirs(cover)
    local theirs = _G.DUIQuestFrame and DUIQuestFrame.TTSButton
    if type(theirs) ~= "table" or not theirs.SetAlpha or theirs == playButton then
        covering = false
        return
    end
    if cover then
        if (theirs:GetAlpha() or 0) > 0 then
            theirs:SetAlpha(0)
        end
        covering = true
    elseif covering then
        theirs:SetAlpha(PLAY_ALPHA)
        covering = false
    end
end

--- Show the button while the page has a line, and draw it sounding while that line does.
--- Run as a page is built, as the window opens, and on the driver's tick.
function Bridge:DrawPlayButton()
    local show = line ~= nil and self:Page() ~= nil
    if not show then
        CoverTheirs(false)
        if playButton and playButton:IsShown() then
            playButton:Hide()
            if playButton.tooltip and playButton.tooltip:IsShown() then
                playButton.tooltip:Hide()
            end
        end
        return
    end
    local button = PlayButton()
    if not button:IsShown() then
        SetPlayTheme(button)
        button:Show()
    end
    CoverTheirs(true)
    local now = Spoken.GetNowPlaying and Spoken:GetNowPlaying()
    local sounding = now ~= nil and now.fileName == line.fileName and true or false
    if sounding ~= button.sounding then
        button.sounding = sounding
        for _, key in ipairs({ "Wave1", "Wave2", "Wave3" }) do
            button[key]:SetShown(sounding)
        end
        if button.anim then
            if sounding then button.anim:Play() else button.anim:Stop() end
        end
    end
end

--- Look again for the page's line and redraw the button: `event` is the page just built, or
--- the page the window shows.
function Bridge:RefreshPlayButton(event)
    LookForLine(event or self:Page())
    self:DrawPlayButton()
end

--- The button as a test or /spq diagnostics sees it.
function Bridge:PlayButtonState()
    return playButton, line
end

--------------------------------------------------------------------------------
-- DialogueUI's own Play button
--------------------------------------------------------------------------------
--
-- Where the player has DialogueUI's Text To Speech on, its button and hotkey play the
-- recording too, through the voiceover provider DialogueUI lets one addon register.

local provider = {
    name = "Spoken Quests",
    -- DialogueUI hears the client's event before this addon's recorder does, so the event is
    -- taken from what DialogueUI says it is showing, never from GetVisibleDialogueEvent.
    doesFileExist = function(interactionType, _, page)
        local event = interactionType == "gossip" and "GOSSIP_SHOW" or QUEST_EVENTS[page]
        if not event then
            line, lineEvent = nil, nil
            return false
        end
        LookForLine(event)
        return line ~= nil
    end,
    playFile = function()
        -- Ignore DialogueUI's autoplay: Read Automatically decides that.
        local now = GetTime()
        if autoplayAt and now >= autoplayAt - 0.1 and now <= autoplayAt + 0.5 then
            autoplayAt = nil
            return
        end
        -- A line queued behind another is brought to the front.
        if line and not IsSpeaking(line) then
            PlayLine("DialogueUI Play button")
        end
    end,
    -- Only while the window is up: DialogueUI also calls this on close (its TTS Auto Stop, on
    -- by default), and this addon's Stop When Window Closes decides that case.
    stopPlaying = function()
        if DUIQuestFrame:IsShown() then
            StopLine()
        end
    end,
    -- Speaking, not just queued: DialogueUI's button stops a line that plays and plays one that
    -- does not, and a line waiting behind another is one to bring forward, not to drop.
    isPlaying = function()
        return line ~= nil and IsSpeaking(line)
    end,
    getAutoPlayDelay = function()
        autoplayAt = GetTime() + AUTOPLAY_DELAY
        return AUTOPLAY_DELAY
    end,
}

--------------------------------------------------------------------------------
-- Waiting for the window
--------------------------------------------------------------------------------

-- The read waiting for DialogueUI's window: { event, run, untilTime }.
local waiting

--- Whether DialogueUI's window shows `event`'s page in full: open on that page, its intro
--- played (DialogueUI fades or unfolds the window in) and its text faded in.
local function InFullView(event)
    local frame = _G.DUIQuestFrame
    if not (frame and frame:IsShown() and EVENTS[frame.handler] == event) then
        return false
    end
    local content = frame.ContentFrame
    return (frame:GetAlpha() or 1) >= 0.99 and not (content and (content:GetAlpha() or 1) < 0.99)
end

--- An automatic read of `event`, held until DialogueUI's window shows its page in full, so the
--- voice starts with the words on screen rather than while the window is still appearing.
--- `run` reads it then, or after WAIT_LIMIT. False (read at once) where DialogueUI is not
--- showing this page: not hooked, closed (a muted quest, an instance), or on another page.
function Bridge:Defer(event, run)
    if not self.driver or self.reading then
        return false
    end
    local frame = _G.DUIQuestFrame
    if not (frame and frame:IsShown() and EVENTS[frame.handler] == event) or InFullView(event) then
        return false
    end
    waiting = { event = event, run = run, untilTime = GetTime() + WAIT_LIMIT }
    return true
end

--- Read what was waiting, once its page is in full view or it has waited long enough. Run by
--- the driver, which ticks only while the window is open.
local function Release()
    if not waiting or not (InFullView(waiting.event) or GetTime() >= waiting.untilTime) then
        return
    end
    local run = waiting.run
    waiting = nil
    Bridge.reading = true
    local ok, err = pcall(run)
    Bridge.reading = nil
    if not ok then
        Debug:Record("dialogueui-wait-error", tostring(err))
    end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function Bridge:Hook()
    if self.driver then
        return
    end
    local problem = self:Problem()
    if problem then
        self.status = problem
        return
    end
    local frame = DUIQuestFrame
    -- Asked once: the player's API cannot change within a session.
    canMark = not self:Problem("Captions")
    for _, name in ipairs(HANDLERS) do
        local handler = name
        hooksecurefunc(frame, handler, function()
            Invalidate()
            -- At once rather than on the next tick: the page DialogueUI just built is drawn
            -- at the end of this frame, and must already be as it should look.
            if canMark then
                Bridge.Expect(handler)
                Tick()
            end
            Bridge:RefreshPlayButton(EVENTS[handler])
            RefreshContribute()
        end)
    end

    -- A child of the window, so it runs only while the window is up. DUIQuestFrame's own
    -- OnHide is no use: DialogueUI sets it with SetScript, replacing any hook.
    local driver = CreateFrame("Frame", nil, frame)
    local elapsedSince, lookedSince = 0, 0
    driver:SetScript("OnUpdate", function(_, elapsed)
        Release()
        elapsedSince = elapsedSince + elapsed
        lookedSince = lookedSince + elapsed
        if elapsedSince >= TICK then
            elapsedSince = 0
            if canMark then
                Tick()
            end
            -- The page's line looked for again now and then; whether it sounds, every tick.
            if lookedSince >= LOOK_EVERY then
                lookedSince = 0
                self:RefreshPlayButton()
            else
                self:DrawPlayButton()
            end
        end
    end)
    driver:SetScript("OnShow", function()
        self:UpdatePlayerHost()
        HostContributeBox(frame)
        self:RefreshPlayButton()
        RefreshContribute()
    end)
    driver:SetScript("OnHide", function()
        Restore()
        state.pending = nil
        -- Closed before it showed in full: the player walked on, and the line is not read.
        waiting = nil
        self:UpdatePlayerHost()
        HostContributeBox(nil)
        self:DrawPlayButton()
        RefreshContribute()
    end)
    self.driver = driver

    -- Registered even with the setting off, so turning it on needs no reload. DialogueUI takes
    -- one provider per session and warns if another voiceover addon has it.
    if _G.DialogueUIAPI and DialogueUIAPI.SetVOProvider then
        DialogueUIAPI.SetVOProvider(provider)
        self.provider = true
    end
    self.status = "hooked"
end

function Bridge:Setup()
    if not IsLoaded("DialogueUI") then
        self.status = L.OPT_DUI_MISSING
        return
    end
    -- After every addon has loaded: DialogueUI builds the page methods with its frame.
    if IsLoggedIn and IsLoggedIn() then
        self:Hook()
        return
    end
    local login = CreateFrame("Frame")
    login:RegisterEvent("PLAYER_LOGIN")
    login:SetScript("OnEvent", function(waiter)
        waiter:UnregisterEvent("PLAYER_LOGIN")
        local ok, err = pcall(self.Hook, self)
        if not ok then
            self.status = "error: " .. tostring(err)
            Debug:Record("dialogueui-error", tostring(err))
        end
    end)
end

--- A setting changed on the panel.
function Bridge:Refresh()
    if not Config().Captions then
        Restore()
    end
    self:RefreshPlayButton()
    self:UpdatePlayerHost()
end

--- One line for /spq diagnostics.
function Bridge:Describe()
    local cfg = Config()
    return format("DialogueUI: %s; words=%s scroll=%s player=%s play=%s button=%s provider=%s", tostring(self.status),
        tostring(cfg.Captions), tostring(cfg.AutoScroll), tostring(cfg.ShowPlayer),
        tostring(cfg.PlayButton), playButton and playButton:IsShown() and "shown" or "hidden",
        tostring(self.provider == true))
end

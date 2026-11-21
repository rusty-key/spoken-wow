setfenv(1, VoiceOver)

-- Lights the word being read in the game's chat bubble, World Chatter's only narrator, and puts the
-- bubble's text back when the line ends. The bubble is an outer frame whose only child holds the
-- text in `String`; inside an instance the client forbids it and every read raises, so each is guarded.
ChatBubble = {}

local TICK = 0.05
-- How long a line that has started waits for the captions to reach it: a window fading out its
-- last line holds the new one back for a moment.
local CATCH_UP = 2

-- The bubble being marked: { fs, text (as the game set it), shown (as last set here), para, map, span, color,
-- lit, neighbor }, and the clip it was found for.
local state = {}
local frame
-- The line that stopped: the captions keep it while the queue holds it, so it is not marked again.
local halted
-- The chat line that has started, and until when the captions may still show another: { clip, untilTime }.
local started

local function Marks()
    return Spoken and Spoken.WordMarks and Spoken:WordMarks()
end

-- The bubble's text and FontString, or nil when the frame is forbidden or its text is a secret.
local function Read(outer)
    local ok, fs, text = pcall(function()
        local child = outer:GetChildren()
        local label = child and child.String
        return label, label and label:GetText()
    end)
    text = ok and NotSecret(text) or nil
    if fs and type(text) == "string" then
        return fs, text
    end
end

--- The FontString of the bubble showing `wanted` (a line's text as Followup.Normalize leaves it, in lower case).
local function FindBubble(wanted)
    if not (C_ChatBubbles and C_ChatBubbles.GetAllChatBubbles) then
        return nil
    end
    local ok, list = pcall(C_ChatBubbles.GetAllChatBubbles)
    if not ok or type(list) ~= "table" then
        return nil
    end
    for _, outer in ipairs(list) do
        local fs, text = Read(outer)
        if fs and string.lower(Followup.Normalize(text)) == wanted then
            return fs, text
        end
    end
end

-- Gold on pale bubble text.
local function ColorOf(fs)
    local marks = Marks()
    local ok, r, g, b = pcall(fs.GetTextColor, fs)
    r, g, b = NotSecret(r), NotSecret(g), NotSecret(b)
    return ok and r and g and b and marks.ColorFor(r, g, b) or marks.ON_DARK
end

--- Put the bubble's own text back, where it still shows what this file set.
function ChatBubble:Restore()
    local fs = state.fs
    if fs and state.shown ~= state.text then
        local ok, now = pcall(fs.GetText, fs)
        if ok and NotSecret(now) == state.shown then
            pcall(fs.SetText, fs, state.text)
        end
    end
    state = {}
end

-- Whether the line playing is NPC chat with its words marked; false once there is nothing left to mark.
local function Tick()
    local marks = Marks()
    local caption = marks and Spoken:GetCaption()
    local clip = caption and caption.clip
    if Spoken:IsPaused() then
        started = nil
    end
    -- Not caption.highlight: that is the narrator's Highlight Words, which this line never shows.
    if not (clip and clip ~= halted and clip.event == Enums.SoundEvent.NPCChatter
        and caption.progress and caption.progress < 1 and not Spoken:IsPaused()) then
        ChatBubble:Restore()
        return started ~= nil and GetTime() < started.untilTime
    end
    started = nil
    if clip ~= state.clip then
        ChatBubble:Restore()
        state.clip, state.wanted = clip, string.lower(Followup.Normalize(clip.text or ""))
    end
    if not state.fs then
        -- The bubble can come a moment after the line starts.
        local fs, text = FindBubble(state.wanted)
        local words = fs and Spoken:SplitCaption(text)
        if not (words and words[1]) then
            return true
        end
        local para = { fs = fs, text = text, words = marks.MarkLinks(text, words) }
        local map, span = marks.Align(caption.words, { para })
        if not map then
            return true
        end
        state.fs, state.text, state.shown, state.para, state.map, state.span = fs, text, text, para, map, span
        state.color = ColorOf(fs)
    end
    local lit, neighbor = marks.Pick(state.map, caption.speaking and caption.activeWord or nil)
    if lit ~= state.lit or neighbor ~= state.neighbor then
        local spans = marks.Spans(state.map, { state.para }, lit, neighbor)
        local want = marks.Want(state.para, 1, state.span, nil, nil, spans, state.color)
        local ok, now = pcall(state.fs.GetText, state.fs)
        if not ok or NotSecret(now) ~= state.shown then
            -- The game reused the bubble for something else: leave it alone.
            state = {}
            return true
        end
        pcall(state.fs.SetText, state.fs, want)
        state.shown, state.lit, state.neighbor = want, lit, neighbor
    end
    return true
end

ChatBubble.Tick = Tick

local function Run()
    if not frame then
        return
    end
    local since = 0
    frame:SetScript("OnUpdate", function(self, elapsed)
        since = since + elapsed
        if since < TICK then
            return
        end
        since = 0
        if not Tick() then
            self:SetScript("OnUpdate", nil)
        end
    end)
end

function ChatBubble:Setup()
    if frame or not (Spoken and Spoken.RegisterCallback) then
        return
    end
    frame = CreateFrame("Frame")
    ChatBubble.frame = frame
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.event == Enums.SoundEvent.NPCChatter then
            halted, started = nil, { clip = clip, untilTime = GetTime() + CATCH_UP }
            Run()
        end
    end)
    -- A stop leaves the voice mid-line: the bubble gets its own text back at once.
    Spoken:RegisterCallback("CLIP_STOPPED", function(clip)
        if clip.event == Enums.SoundEvent.NPCChatter then
            halted, started = clip, nil
            ChatBubble:Restore()
        end
    end)
end

setfenv(1, VoiceOver)

-- Immersion turns its talk box's parts on a timer that knows nothing of the voice. While Spoken
-- Quests reads the page, this holds that timer and turns to the part being read. The methods used
-- are Immersion internals, not an API, so Setup stands down if any is missing.

ImmersionBridge = {}
local Bridge = ImmersionBridge

-- Toasts and books are left to Immersion: a toast replays a page already read, and a book is
-- Spoken Readables' line, not this addon's.
local PAGES = { QUEST_DETAIL = true, QUEST_PROGRESS = true, QUEST_COMPLETE = true, QUEST_GREETING = true,
    GOSSIP_SHOW = true }
local METHODS = { "CreateLineData", "ForceNext", "PauseTimer", "ResumeTimer", "GetNumTexts", "GetNumRemaining" }

local Marks
-- clip and text: what map was matched for, map[i].p the part caption word i is in. holding: this
-- file paused Immersion's timer, so only it resumes it.
local clip, text, map, holding

local function Release(fs)
    if holding then
        holding = nil
        fs:ResumeTimer()
    end
end

local function Follow(fs)
    local caption = Spoken:GetCaption()
    local playing = caption and caption.clip
    local stored = NotSecret(fs.storedText)
    local setup = _G.ImmersionSetup
    -- With Immersion's progression off the player turns every part, and its timer is never touched.
    if not (playing and Player:Owns(playing) and caption.speaking and not Spoken:IsPaused()
        and PAGES[ImmersionFrame.playbackEvent] and type(stored) == "string"
        and not (type(setup) == "table" and setup.disableprogression)) then
        return Release(fs)
    end
    if playing ~= clip or stored ~= text then
        clip, text = playing, stored
        local _, chunks = fs:CreateLineData(stored)
        local paragraphs = {}
        for i, chunk in ipairs(chunks) do
            paragraphs[i] = { text = chunk, words = Marks.MarkLinks(chunk, Spoken:SplitCaption(chunk)) }
        end
        map = Marks.Align(caption.words, paragraphs)
    end
    if not map then
        return Release(fs)
    end
    fs:PauseTimer()
    holding = true
    local lit = Marks.Pick(map, caption.activeWord)
    local target = lit and map[lit].p or 1
    -- Forward only: a part the player clicked on to stays until the voice reaches it.
    while fs:GetNumTexts() - fs:GetNumRemaining() + 1 < target and fs:GetNumRemaining() > 1 do
        fs:ForceNext()
    end
end

function Bridge:Setup()
    local frame = _G.ImmersionFrame
    local fs = type(frame) == "table" and frame.TalkBox and frame.TalkBox.TextFrame and frame.TalkBox.TextFrame.Text
    Marks = Spoken.WordMarks and Spoken:WordMarks()
    if not (fs and Marks and Spoken.GetCaption and Spoken.SplitCaption) then
        return
    end
    for _, name in ipairs(METHODS) do
        if type(fs[name]) ~= "function" then
            Debug:Record("immersion-unknown", "Immersion's talk box has no " .. name .. "; its pages turn on their own")
            return
        end
    end
    local driver = CreateFrame("Frame", nil, frame)
    driver:SetScript("OnUpdate", function() Follow(fs) end)
    driver:SetScript("OnHide", function()
        Release(fs)
        clip, text, map = nil, nil, nil
    end)
    self.driver = driver
end

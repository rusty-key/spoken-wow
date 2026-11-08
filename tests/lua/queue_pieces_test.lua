-- A line kept as sentence pieces plays them back to back as one line, and a stopped one plays on
-- from the piece it was stopped in rather than from its start. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests, places, Q, rec
local function Fresh()
    env, quests, places = H.Fresh(stub, SPOKEN)
    Q = env.SoundQueue
    rec = H.Recorder(env)
end

local function Piece(clip, index)
    return clip.path:gsub("%.ogg$", "") .. string.format("\\%02d.ogg", index)
end

---------------------------------------------------------------- back to back, as one line
Fresh()
local line = H.Clip({ pieces = "2 3 1.5", length = 6.4 })
quests:Enqueue(line)
Expect("a line kept as pieces starts with its first", world.played[1], Piece(line, 1))
Expect("...its length is its pieces' sum", line.length, 6.5)
stub.Advance(2.05)
Expect("the second piece follows the first's length", world.played[2], Piece(line, 2))
stub.Advance(3)
Expect("...then the third", world.played[3], Piece(line, 3))
Expect("...announced once, as one line", rec:Count("CLIP_STARTED"), 1)
Expect("...and never stopped between pieces", rec:Count("CLIP_STOPPED"), 0)
local after = H.Clip()
quests:Enqueue(after)
stub.Advance(1.5)
Expect("the next line waits for the last piece", world.played[4] == after.path, false)
stub.Advance(1.0)
Expect("...and follows it", world.played[4], after.path)

---------------------------------------------------------------- pause and resume from the sentence
Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(3.0)
Q:PauseQueue()
Expect("paused in the second piece, it is stopped", world.stopped[#world.stopped], 2)
Expect("...and keeps that piece", line.piece, 2)
Q:ResumeQueue()
Expect("resumed, it plays on from the second piece's start", world.played[#world.played], Piece(line, 2))
Expect("...its progress picks up there", Q:VoiceElapsed(line), 2)
Expect("...where its words do", Q:PieceOffset(line), 2)
Expect("...and it resumes rather than replays", Q:Resumes(line), true)
stub.Advance(3.05)
Expect("...and goes on to the third", world.played[#world.played], Piece(line, 3))

---------------------------------------------------------------- Stop plays again from the start
Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(3.0)
Q:ToggleStopQueue()
Expect("Stop halts the line as a stop", Q:HaltedBy(), "stop")
Q:ToggleStopQueue()
Expect("...and Replay plays it from its first piece", world.played[#world.played], Piece(line, 1))
Expect("...from its start", Q:VoiceElapsed(line), 0)

Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(3.0)
Q:TogglePauseQueue()
Expect("Pause halts the line as a pause", Q:HaltedBy(), "pause")
Q:StopQueue()
Expect("a paused line stopped becomes stopped", Q:HaltedBy(), "stop")
Q:TogglePauseQueue()
Expect("...and with no section on screen, Play goes back only its sentence", world.played[#world.played], Piece(line, 2))
Expect("playing, it is halted by nothing", Q:HaltedBy(), nil)

---------------------------------------------------------------- Stop backs up to the section on screen
-- Pieces start at 0, 2, 5 and 6.5; the voice is in the third when stopped.
local section
local function Stopped(at)
    Fresh()
    Q:AddSectionFinder(function() return section end)
    line = H.Clip({ pieces = "2 3 1.5 2" })
    quests:Enqueue(line)
    stub.Advance(at or 6.0)
end
section = 2.1
Stopped()
Q:ToggleStopQueue()
Q:TogglePauseQueue()
Expect("Play after Stop goes back to the first sentence of the section on screen", world.played[#world.played], Piece(line, 2))
Expect("...its progress there too", Q:VoiceElapsed(line), 2)

Stopped()
Q:ToggleStopQueue()
Q:ToggleStopQueue()
Expect("Replay after Stop goes back to the line's start", world.played[#world.played], Piece(line, 1))

section = 5.2
Stopped()
Q:ToggleStopQueue()
Q:TogglePauseQueue()
Expect("a section estimated a little late still counts its first sentence", world.played[#world.played], Piece(line, 3))

section = 6.9
Stopped()
Q:ToggleStopQueue()
Q:TogglePauseQueue()
Expect("a section never sends the line past the sentence speaking", world.played[#world.played], Piece(line, 3))

section = 2.1
Stopped()
Q:TogglePauseQueue()
stub.Advance(30)
Q:StopQueue()
Q:TogglePauseQueue()
Expect("paused, then stopped later, it backs up to the section it was paused in", world.played[#world.played], Piece(line, 2))

---------------------------------------------------------------- a sentence already heard is not repeated
Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(4.8)
Q:PauseQueue()
Q:ResumeQueue()
Expect("paused in a piece's last moment, it plays on from the next", world.played[#world.played], Piece(line, 3))

Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(6.3)
Q:PauseQueue()
Q:ResumeQueue()
Expect("...but never past its last piece", world.played[#world.played], Piece(line, 3))

---------------------------------------------------------------- a gate keeps the place too
Fresh()
local hold = nil
quests:AddGate(function() return hold end)
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(2.5)
hold = "in combat"
Q:RecheckGates(quests)
hold = nil
stub.Advance(1.05)
Expect("a line a gate cut off plays on from its sentence once it opens", world.played[#world.played], Piece(line, 2))

---------------------------------------------------------------- the client cutting the voice
Fresh()
local playing = true
_G.C_Sound = { IsPlaying = function() return playing end }
line = H.Clip({ pieces = "2 3 1.5" })
quests:Enqueue(line)
stub.Advance(1.0)
Expect("the watch does not mistake a join for a cut", Q:IsPaused(), false)
stub.Advance(1.5)
playing = false
stub.Advance(0.55)
Expect("a voice the client cut stops the line", Q:IsPaused(), true)
playing = true
Q:ResumeQueue()
Expect("...which resumes from the piece cut", world.played[#world.played], Piece(line, 2))
_G.C_Sound = nil

---------------------------------------------------------------- missing pieces
Fresh()
local tested = env.Sources:Register("tested", { title = "Tested", addon = "Spoken_Quests", order = 3,
    testBeforeQueue = true })
line = H.Clip({ pieces = "2 3" })
world.missing[Piece(line, 1)] = true
local ok, why = tested:Enqueue(line)
Expect("a line whose first piece is missing is refused", ok, nil)
Expect("...as missing", why, "missing")

Fresh()
line = H.Clip({ pieces = "2 3 1.5" })
world.missing[Piece(line, 2)] = true
quests:Enqueue(line)
after = H.Clip()
quests:Enqueue(after)
stub.Advance(2.05)
Expect("a piece missing later ends the line where it is", Q:GetCurrentSound() == line, true)
stub.Advance(1.5)
Expect("...and the next line plays", world.played[#world.played], after.path)

---------------------------------------------------------------- not kept as pieces
Fresh()
line = H.Clip({ pieces = "2 x 3" })
quests:Enqueue(line)
Expect("a malformed pieces row plays the line as one file", world.played[1], line.path)
Expect("...and says it replays", Q:Resumes(line), false)

Fresh()
line = H.Clip({ pieces = "4" })
quests:Enqueue(line)
Expect("one piece is one file", world.played[1], line.path)

---------------------------------------------------------------- sentences in other languages
local function AnchorWord(text, offset)
    Fresh()
    local clip = H.Clip({ pieces = "2 2 2", length = 6 })
    clip.present.transcript = text
    env.Transcript:SetClip(clip)
    local _, index = env.Transcript:ResumeAnchor(offset)
    return index and env.Transcript.words[index].text
end
Expect("German: a sentence closed inside „...“ quotes ends there",
    AnchorWord("„Hallo, Fremder.“ Ich brauche Hilfe. Bring mir sechs Felle.", 2.0), "Ich")
Expect("French: a sentence closed before » ends there",
    AnchorWord("« Bonjour, étranger. » Il me faut de l'aide. Rapportez six peaux.", 2.0), "Il")
Expect("Chinese: a sentence ends at 。 with no space after it",
    (AnchorWord("你好，陌生人。我需要你的帮助。给我带六张皮来。", 2.0) or ""):sub(1, 3), "我")

---------------------------------------------------------------- the subtitle's pages are its sections
Fresh()
line = H.Clip({ pieces = "2 3 1.5 2" })
env.Addon.DisplayStyle = function() return "subtitle" end
env.Subtitle.clip, env.Subtitle.sample = line, nil
-- Three sentences to a page: the second page's words are estimated to start at 4.9 s.
env.Subtitle.pages = { { start = 0 }, { start = 4.9 } }
quests:Enqueue(line)
stub.Advance(7.0)
Q:ToggleStopQueue()
Q:TogglePauseQueue()
Expect("with subtitles, Play after Stop goes back to the start of the page on screen", world.played[#world.played], Piece(line, 3))
env.Subtitle.clip, env.Subtitle.pages = nil, nil

---------------------------------------------------------------- the words resume at the sentence, not the word before
local SAID = "One two three. Four five six. Seven eight nine."
local function Said(fields)
    local clip = H.Clip(fields)
    clip.present.transcript = SAID
    return clip
end
Fresh()
local T = env.Transcript
-- Six seconds, as the queue makes a line of its pieces' sum when it admits it.
line = Said({ pieces = "2 2 2", length = 6 })
T:SetClip(line)
local at, word = T:ResumeAnchor(2.0)
Expect("estimated, a resume picks up at the sentence nearest the piece", word, 4)
Expect("...at that word's own time, not the pause before it", at > 0 and T:WordAt(at / line.length) == 4, true)

Fresh()
T = env.Transcript
-- Timed: the second sentence's first word starts 0.3 s after the pause the piece starts in.
line = Said({ pieces = "2 2 2", length = 6,
    present = { header = "h", label = "l", portrait = { kind = "none" },
        timings = "0 .5 1 2.3 2.8 3.3 4.3 4.8 5.3" } })
line.present.transcript = SAID
T:SetClip(line)
at, word = T:ResumeAnchor(2.0)
Expect("timed, a resume picks up at the first word after the pause", word .. " " .. at, "4 2.3")

Fresh()
T = env.Transcript
line = Said({ pieces = "2 2 2" })
quests:Enqueue(line)
T:Started(line)
stub.Advance(3.0)
Q:PauseQueue()
T:Sync()
Q:ResumeQueue()
T:Started(line)
Expect("resumed, the word lit is the sentence's first, never the one before", T:WordAt(T:GetProgress()), 4)

Fresh()
local S = env.Subtitle
line = Said({ pieces = "2 2 2" })
S.clip = line
S.pages = { { text = "One two three. Four five six.", start = 0 }, { text = "Seven eight nine.", start = 3.9 } }
Expect("a resume time is moved into the page that holds its word", S:PageTimeFor(line, 7, 3.5), 3.9)
Expect("...and kept where it already is", S:PageTimeFor(line, 4, 2.0), 2.0)
Expect("...and pulled back from the next page", S:PageTimeFor(line, 4, 4.2) < 3.9, true)
S.clip, S.pages = nil, nil

---------------------------------------------------------------- on clients in other languages
for _, case in ipairs({ { "deDE", "Pausiert" }, { "frFR", "En pause" }, { "zhCN", "已暂停" }, { "koKR", "일시정지됨" } }) do
    stub.SetLocale(case[1])
    Fresh()
    line = H.Clip({ pieces = "2 3 1.5" })
    quests:Enqueue(line)
    stub.Advance(3.0)
    Q:TogglePauseQueue()
    local word = env.Actions.HaltWord()
    Q:ResumeQueue()
    Expect(case[1] .. ": paused reads in the client's language, and resumes from the sentence",
        word .. " " .. tostring(world.played[#world.played] == Piece(line, 2)), case[2] .. " true")
end
stub.SetLocale("enUS")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll queue pieces tests passed")

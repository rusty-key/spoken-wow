if not (VoiceOver and VoiceOver.SpokenDialogue) then return end
setfenv(1, VoiceOver)

-- What an NPC says in /say, /yell or a whisper after a quest is accepted or turned in. The world DB's
-- quest scripts send those lines as chat, never as quest text, so the dialog handlers never
-- see them; FollowupLines.lua is the export that recognises them.
--
-- The line goes to everybody near the NPC, so hearing it proves nothing about who set it off.
-- In a busy capital the same turn-in happens every few seconds, and reading every one would
-- have the addon talking constantly about other people's quests. So a line is armed only by
-- this player's own accept or turn-in, lives only as long as its script could still be
-- running, and plays only when the chat text is that exact line - which, for the many lines
-- that name the player, is also proof it was said to this player and not to someone else.
Followup = {
    -- Armed lines in the order they were armed: { line, sayings, questID, kind, title, expires }.
    -- Empty whenever this player has triggered nothing lately, which is what keeps a chat
    -- message in a crowded zone down to one table lookup.
    armed = {},
}

-- A script's last line lands at most its delay after the trigger; the slack absorbs server
-- lag and the time the turn-in takes to confirm.
local EXPIRY_SLACK = 10

-- Store original function before EQL3 (Extended Quest Log 3) overrides it and starts prepending quest level
local GetTitleText = GetTitleText

function Followup:IsEnabled()
    local audio = Addon and Addon.db and Addon.db.profile.Audio
    return audio and audio.FollowupLines ~= false and Addon:IsAutoplayOn() or false
end

--------------------------------------------------------------------------------
-- Rendering a line as the server would say it to this player
--------------------------------------------------------------------------------

-- Blizzard's own text double-spaces after a full stop and the chat frame may not.
local function Normalize(text)
    return string.trim((string.gsub(text or "", "%s+", " ")))
end

-- A replacement string for gsub: a name is never going to hold a %, but a pattern error in
-- a chat handler would be a new error on every NPC line for the rest of the session.
local function Literal(text)
    return (string.gsub(text or "", "%%", "%%%%"))
end

--- The line's text with the server's tokens filled in for the local player. The name is
--- UnitName("player") deliberately: a line naming somebody else then cannot match.
local function Render(text, sender)
    local female = UnitSex and UnitSex("player") == 3
    -- $gmale:female; and $Gmale:female; - the export keeps Blizzard's spacing, "$GHe : She;".
    text = string.gsub(text, "%$[gG]([^:;]*):([^;]*);", function(male, femaleForm)
        return string.trim(female and femaleForm or male)
    end)
    text = string.gsub(text, "%$[nN]", Literal(UnitName("player")))
    text = string.gsub(text, "%$[rR]", Literal(UnitRace and UnitRace("player")))
    text = string.gsub(text, "%$[cC]", Literal(UnitClass and UnitClass("player")))
    -- Emote-style lines carry the speaker as %s, which the client fills with the sender.
    if sender then
        text = string.gsub(text, "%%s", Literal(sender))
    end
    return Normalize(text)
end

--- Only an English client shows the English text the export holds. Anywhere else a line
--- can only be told by who said it.
local function ClientSpeaksExportLanguage()
    local locale = GetLocale and GetLocale()
    return locale == "enUS" or locale == "enGB"
end

--- The text a line is matched by, rendered when it is armed: nothing in it changes before
--- it is said. Except a %s, which is the sender, known only when the line arrives - such a
--- line keeps `raw` and renders per message.
local function Sayings(line)
    local sayings = {}
    for _, raw in ipairs({ line.male, line.female ~= line.male and line.female or nil }) do
        if string.find(raw, "%%s") then
            table.insert(sayings, { raw = raw })
        else
            table.insert(sayings, { text = Render(raw) })
        end
    end
    return sayings
end

--------------------------------------------------------------------------------
-- Arming and matching
--------------------------------------------------------------------------------

--- Remove the lines armed for one quest trigger, so a second trigger re-arms rather than
--- doubles them.
function Followup:Disarm(kind, questID)
    for index = getn(self.armed), 1, -1 do
        local entry = self.armed[index]
        if entry.kind == kind and entry.questID == questID then
            table.remove(self.armed, index)
        end
    end
end

--- The player's own trigger: `kind` is "end" for a turn-in and "start" for an accept.
function Followup:Arm(kind, questID, title)
    if not questID or questID == 0 or not self:IsEnabled() then
        return
    end
    local byQuest = FollowupLines and FollowupLines[kind]
    local lines = byQuest and byQuest[questID]
    if not lines or not lines[1] then
        return
    end

    local latest = 0
    for _, line in ipairs(lines) do
        if (line.delay or 0) > latest then
            latest = line.delay
        end
    end
    local expires = GetTime() + latest + EXPIRY_SLACK

    self:Disarm(kind, questID)
    for _, line in ipairs(lines) do
        table.insert(self.armed, { line = line, sayings = Sayings(line), questID = questID, kind = kind,
            title = title, expires = expires })
    end
    Debug:Record("followup-armed", format("Listening %ds for %d line(s) after quest %d's %s",
        latest + EXPIRY_SLACK, getn(lines), questID, kind == "end" and "turn-in" or "accept"))
end

function Followup:Prune()
    local now = GetTime()
    for index = getn(self.armed), 1, -1 do
        if self.armed[index].expires < now then
            table.remove(self.armed, index)
        end
    end
end

--- Whether line `a` comes before line `b` in its script. Steps are numbered in the order
--- they are said, so they break a tie between two lines at one delay; an export from before
--- steps has only the delay.
local function Earlier(a, b)
    local delayA, delayB = a.delay or 0, b.delay or 0
    if delayA ~= delayB then
        return delayA < delayB
    end
    return (a.step or 0) < (b.step or 0)
end

--- Whether two lines are outcomes of one script step, so hearing one means the other will
--- never be said. The export names the step. Without it - a FollowupLines.lua from before
--- steps - the same speaker at the same delay is the best guess, which is wrong where one
--- entry is several NPCs each saying their own line at once (Scarlet Subterfuge's cavaliers).
local function SameStep(a, b)
    if a.step and b.step then
        return a.step == b.step
    end
    return a.speaker == b.speaker and a.delay == b.delay
end

--- The armed entry this chat message is, or nil.
function Followup:Match(message, sender, npcID)
    if ClientSpeaksExportLanguage() then
        local said = Normalize(message)
        for _, entry in ipairs(self.armed) do
            local speaker = entry.line.speaker
            -- Checked only when both sides know: a line with no resolved speaker, or a client
            -- with no GUID in its chat events, falls back on the text alone.
            if not (speaker and npcID) or speaker == npcID then
                for _, saying in ipairs(entry.sayings) do
                    if (saying.text or Render(saying.raw, sender)) == said then
                        return entry
                    end
                end
            end
        end
        return nil
    end

    -- The text is translated and cannot be compared, so the speaker is all there is: the
    -- earliest step still armed for that NPC. No speaker on either side is no evidence at
    -- all, and a line played on no evidence is the busy-zone problem again.
    if not npcID then
        return nil
    end
    local best
    for _, entry in ipairs(self.armed) do
        if entry.line.speaker == npcID and (not best or Earlier(entry.line, best.line)) then
            best = entry
        end
    end
    return best
end

--- Consume a matched entry and its siblings. A script step can pick one of up to four texts
--- at random, and the export lists each as its own entry of the same step; once one of them
--- has been said, the others never will be, and left armed they would let the speaker-only
--- match play the next line of the script one step early.
function Followup:Consume(matched)
    for index = getn(self.armed), 1, -1 do
        local entry = self.armed[index]
        if entry.kind == matched.kind and entry.questID == matched.questID
            and SameStep(entry.line, matched.line) then
            table.remove(self.armed, index)
        end
    end
end

function Followup:OnChat(event, message, sender, guid)
    if not self.armed[1] then
        return
    end
    self:Prune()
    if not self.armed[1] then
        return
    end
    if not self:IsEnabled() then
        self.armed = {}
        return
    end

    local npcID = Utils:GetCreatureIDFromGUID(guid)
    local entry = self:Match(message or "", sender, npcID)
    if not entry then
        Debug:Record("followup-ignored", format("%s from %s (NPC %s) is none of the %d armed line(s)",
            event, tostring(sender), tostring(npcID or "unknown"), getn(self.armed)))
        return
    end
    self:Consume(entry)
    Debug:Record("followup-matched", format("Line %d from %s after quest %d", entry.line.id or 0,
        tostring(sender), entry.questID))
    self:Play(entry, message, sender, guid, npcID)
end

--------------------------------------------------------------------------------
-- Playing
--------------------------------------------------------------------------------

--- The line's own recording, from whichever pack has it. A pack's FollowupLookup names the
--- file by speaker and broadcast text id, since one text said by two NPCs is two recordings in
--- two voices; a pack built before follow-up lines has no FollowupLookup and finds nothing.
---
--- The lookup only names the file. Which pack plays it is ResolveSoundFile's decision, the
--- one every other line goes through: the selected language before the fallback, priority
--- within each, and the player-gendered m-/f- variant ahead of the plain one. Every pack
--- carries the full lookup whether or not it has the audio, so the first stem is usually the
--- only one; a second is tried only in case packs of different builds disagree.
---@return SoundData|nil
local function OwnClip(line, npcID)
    local speaker = line.speaker or npcID
    if not (line.id and speaker) then
        return nil
    end
    local tried = {}
    for _, module in DataModules:GetModules() do
        local byLine = module.FollowupLookup and module.FollowupLookup[speaker]
        local stem = byLine and byLine[line.id]
        if stem and not tried[stem] then
            tried[stem] = true
            local probe = { event = Enums.SoundEvent.QuestFollowup, fileName = stem }
            if DataModules:ResolveSoundFile(probe) then
                return probe
            end
        end
    end
end

function Followup:Play(entry, message, sender, guid, npcID)
    -- Only the line's own recording plays. A borrowed clip - the speaker's gossip, the
    -- quest's accept or complete - says other words in the NPC's voice while the chat shows
    -- this line, which is worse than the silence of a line nobody has voiced yet.
    local clip = OwnClip(entry.line, npcID)
    if not clip then
        Debug:Record("followup-no-recording", format("No installed pack has a recording of follow-up line %d (NPC %s)",
            entry.line.id or 0, tostring(entry.line.speaker or npcID or "unknown")))
        return false
    end
    local speaker = entry.line.speaker or npcID
    if not guid and speaker then
        guid = Utils:MakeGUID(Enums.GUID.Creature, speaker)
    end
    ---@type SoundData
    local soundData = {
        event = Enums.SoundEvent.QuestFollowup,
        name = sender or (speaker and DataModules:GetObjectName(Enums.GUID.Creature, speaker)) or "",
        title = entry.title,
        text = message,
        unitGUID = guid,
        unitIsObjectOrItem = false,
        -- The queue's dedup key: the resolved file name, like any other clip.
        fileName = clip.fileName,
        filePath = clip.filePath,
        length = clip.length,
        module = clip.module,
        language = clip.language,
    }
    -- Appended like any other line, so it waits for the turn-in's own voiceover to finish.
    return Player:EnqueuePrepared(soundData)
end

--------------------------------------------------------------------------------
-- The triggers
--------------------------------------------------------------------------------

local function TitleFor(questID)
    local title = C_QuestLog and C_QuestLog.GetTitleForQuestID and C_QuestLog.GetTitleForQuestID(questID)
    return title or (GetTitleText and GetTitleText()) or nil
end

-- The event each exported chat label arrives as, for /spq followup to replay it through.
local CHAT_EVENTS = {
    say = "CHAT_MSG_MONSTER_SAY",
    yell = "CHAT_MSG_MONSTER_YELL",
    whisper = "CHAT_MSG_MONSTER_WHISPER",
}

--- `/spq followup <questID> [start]`: arm the quest as if it had just been turned in (or
--- accepted) and replay its script's chat on its own delays, one line per script step.
--- The lines only reach this client, never the server, but go through the same arm, match
--- and play path as the real chat - so a line that is not heard here would not be heard in
--- the world either, without walking a character to the NPC to find out.
function Followup:Simulate(input)
    local _, _, questID, kind = string.find(input or "", "^%s*(%d+)%s*(%a*)")
    questID = tonumber(questID)
    kind = (kind == "start" or kind == "accept") and "start" or "end"
    local print = function(message) DEFAULT_CHAT_FRAME:AddMessage("|cFF00CCFFSpoken follow-up:|r " .. message) end

    if not questID then
        print("usage: /spq followup <questID> [start]  -- e.g. /spq followup 3364")
        return
    end
    if not self:IsEnabled() then
        print("off - both autoplay and the follow-up lines option must be on.")
        return
    end
    local lines = FollowupLines and FollowupLines[kind] and FollowupLines[kind][questID]
    if not lines then
        print(format("quest %d has no %s lines.", questID, kind == "end" and "turn-in" or "accept"))
        return
    end

    self:Arm(kind, questID, TitleFor(questID))
    local seen = {}
    for _, line in ipairs(lines) do
        -- An export from before steps groups by speaker and delay, as Consume does.
        local group = line.step and tostring(line.step) or format("%d:%d", line.delay or 0, line.speaker or 0)
        if not seen[group] then
            seen[group] = true
            local name = line.speaker and DataModules:GetObjectName(Enums.GUID.Creature, line.speaker) or "NPC"
            local guid = line.speaker and Utils:MakeGUID(Enums.GUID.Creature, line.speaker) or nil
            local event = CHAT_EVENTS[line.chat] or "CHAT_MSG_MONSTER_SAY"
            local text = Render(line.male, name)
            print(format("line %d in %ds, %s: %s%s", line.id, line.delay or 0, name, text,
                OwnClip(line) and "" or "  |cFFFF8040(no recording yet — silent)|r"))
            Addon:ScheduleTimer(function()
                Followup:OnChat(event, text, name, guid)
            end, line.delay or 0)
        end
    end
end

function Followup:Setup()
    if self.frame then
        return
    end
    local frame = CreateFrame("Frame")
    self.frame = frame
    -- A whisper is addressed to this player alone, but is still only matched while armed:
    -- an NPC whispers the same words to everybody who takes the quest, and one armed by
    -- nothing is no evidence of which quest it followed. CHAT_MSG_RAID_BOSS_WHISPER is the
    -- server's boss whisper; the 1.12 client has no such event, and the pcall below lets it
    -- fail there. Both carry the same payload as a /say: text, sender, and the GUID in arg12
    -- where the client sends one.
    local events = { "CHAT_MSG_MONSTER_SAY", "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_WHISPER",
        "CHAT_MSG_RAID_BOSS_WHISPER" }
    if not Version.IsAnyLegacy then
        table.insert(events, "QUEST_TURNED_IN")
        table.insert(events, "QUEST_ACCEPTED")
    end
    for _, event in ipairs(events) do
        pcall(frame.RegisterEvent, frame, event)
    end
    -- Named arguments rather than ...: on 1.12 the handler is called by Compatibility.lua's
    -- SetScript wrapper with the arg1..arg9 globals, and Lua 5.0 has no select() for varargs.
    frame:SetScript("OnEvent", function(_, event, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12)
        if event == "QUEST_TURNED_IN" then
            Followup:Arm("end", a1, TitleFor(a1))
        elseif event == "QUEST_ACCEPTED" then
            -- Classic sends (questLogIndex, questID); mainline sends the questID alone.
            local questID = a2 or a1
            Followup:Arm("start", questID, TitleFor(questID))
        else
            Followup:OnChat(event, a1, a2, a12)
        end
    end)

    -- The legacy clients have neither event, but every accept and turn-in, clicked or
    -- automated by another addon, goes through these two calls while the dialog is still up.
    if Version.IsAnyLegacy and hooksecurefunc then
        -- IsEnabled first: resolving the quest can mean a fuzzy search of every loaded pack.
        pcall(hooksecurefunc, "GetQuestReward", function()
            if Followup:IsEnabled() then
                local questID = Addon:DialogQuestID("QUEST_COMPLETE")
                Followup:Arm("end", questID, TitleFor(questID))
            end
        end)
        pcall(hooksecurefunc, "AcceptQuest", function()
            if Followup:IsEnabled() then
                local questID = Addon:DialogQuestID("QUEST_DETAIL")
                Followup:Arm("start", questID, TitleFor(questID))
            end
        end)
    end
end

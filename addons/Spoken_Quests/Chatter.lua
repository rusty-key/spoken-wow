setfenv(1, VoiceOver)

-- What NPCs say out loud in the world, told by speaker and exact text against ChatterLines.lua.
-- Nothing is armed, so chat from a speaker with no lines costs one table lookup. A line a quest's
-- script makes the NPC say is left to Followup.lua, which plays it only for the player's own quest.
Chatter = {
    -- [speaker .. ":" .. line id] = when it last started.
    heard = {},
}

local REPEAT_SECONDS = 120

-- The creature entries by lower-case name, built when first needed. Forever sends no GUID with NPC
-- chat, which leaves the name the event gives as the only evidence of who spoke.
local speakersByName

local function SpeakersNamed(name)
    if not speakersByName then
        speakersByName = {}
        for npcID, lines in pairs(ChatterLines or {}) do
            local key = lines.name and string.lower(lines.name)
            if key then
                speakersByName[key] = speakersByName[key] or {}
                table.insert(speakersByName[key], npcID)
            end
        end
        for _, ids in pairs(speakersByName) do
            table.sort(ids)
        end
    end
    return speakersByName[string.lower(Followup.Normalize(name))]
end

function Chatter:IsEnabled()
    return Addon and Addon.db and Addon:IsPartOn("chatter") or false
end

--- The line of `npcID` that `message` is, or nil: the text must equal the line once the tokens are
--- filled in for the local player. English clients only: elsewhere the text is translated, and an NPC
--- says more than its exported lines (lines the game voices, emotes, quest scripts), so not even an
--- NPC with a single line can be told by who said it.
function Chatter:Match(npcID, message, sender)
    local lines = ChatterLines and ChatterLines[npcID]
    if not (lines and Followup.ClientSpeaksExportLanguage()) then
        return nil
    end
    local said = string.lower(Followup.Normalize(message))
    for _, line in ipairs(lines) do
        if string.lower(Followup.Render(line.text, sender)) == said and not Followup.IsScripted(npcID, line.id) then
            return line
        end
    end
    return nil
end

--- The speaker and line of a message that came with no GUID: an NPC of that name with a line of that
--- text. Several entries can share both; the one a pack has a recording for is the one told. Match
--- refuses other languages, where the name is translated too.
function Chatter:MatchByName(message, sender)
    if not sender then
        return nil
    end
    local firstID, firstLine
    for _, npcID in ipairs(SpeakersNamed(sender) or {}) do
        local line = self:Match(npcID, message, sender)
        if line then
            if Followup.OwnClip({ id = line.id, speaker = npcID }, npcID) then
                return npcID, line
            end
            firstID, firstLine = firstID or npcID, firstLine or line
        end
    end
    return firstID, firstLine
end

--- A chat message from an NPC: `asked` when /spq chatter replays it.
function Chatter:OnChat(event, message, sender, guid, asked)
    -- Not gated on Read Automatically: that is the quest window's, and World Chatter has its own switch.
    if not self:IsEnabled() then
        return
    end
    -- In a dungeon the server's NPC chat can come as secrets, which cannot be matched.
    message, sender, guid = NotSecret(message), NotSecret(sender), NotSecret(guid)
    if not message then
        return
    end
    local told = guid ~= nil and guid ~= ""
    guid = told and guid or Utils:GetSpeakerGUIDByName(sender)
    local npcID = guid and Utils:GetCreatureIDFromGUID(guid)
    local line = npcID and self:Match(npcID, message, sender)
    -- A unit found by name may be another entry of that name than the one that spoke.
    if not line and not told then
        npcID, line = self:MatchByName(message, sender)
    end
    if not line then
        return
    end
    local key = npcID .. ":" .. line.id
    if not asked and self.heard[key] and GetTime() - self.heard[key] < REPEAT_SECONDS then
        return
    end
    Debug:Record("chatter-matched", format("Line %d from %s (NPC %d)", line.id, tostring(sender), npcID))
    -- Counted from when it starts, not when it is queued: a line dropped from the queue was never heard.
    Followup:Play({ line = { id = line.id, speaker = npcID }, lineKey = key }, message, sender, guid, npcID, asked,
        Enums.SoundEvent.NPCChatter)
end

--- `/spq chatter [NPC id]`: replay what the NPC says, three seconds apart, through the same match
--- and play path as the real chat; the NPC of your target when none is given. A line with no
--- recording is marked, so a missing voice shows without walking to the NPC. The target's own GUID
--- goes along when it is the NPC, so a split NPC plays the body on screen.
function Chatter:Simulate(input)
    local print = function(message) DEFAULT_CHAT_FRAME:AddMessage("|cFF00CCFFSpoken world chatter:|r " .. message) end
    local npcID = tonumber(string.match(input or "", "%d+"))
    local targetGUID = UnitExists and UnitExists("target") and NotSecret(UnitGUID("target"))
    local targetID = targetGUID and Utils:GetCreatureIDFromGUID(targetGUID)
    npcID = npcID or targetID
    if not npcID then
        print("usage: /spq chatter <NPC id>  -- or target the NPC and type /spq chatter")
        return
    end
    if not self:IsEnabled() then
        print("off - World Chatter is switched off on Spoken's page.")
        return
    end
    local lines = ChatterLines and ChatterLines[npcID]
    if not lines then
        print(format("NPC %d has no lines.", npcID))
        return
    end
    local name = DataModules:GetObjectName(Enums.GUID.Creature, npcID) or "NPC"
    local guid = targetID == npcID and targetGUID or Utils:MakeGUID(Enums.GUID.Creature, npcID)
    for index, line in ipairs(lines) do
        local text = Followup.Render(line.text, name)
        print(format("line %d, %s: %s%s", line.id, name, text,
            Followup.OwnClip({ id = line.id, speaker = npcID }, npcID) and "" or "  |cFFFF8040(no recording yet - silent)|r"))
        Addon:ScheduleTimer(function()
            Chatter:OnChat("CHAT_MSG_MONSTER_SAY", text, name, guid, true)
        end, (index - 1) * 3)
    end
end

function Chatter:Setup()
    if self.frame then
        return
    end
    local frame = CreateFrame("Frame")
    self.frame = frame
    -- An NPC speaking to everybody near it, and whispering to this player alone.
    for _, event in ipairs({ "CHAT_MSG_MONSTER_SAY", "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_WHISPER",
        "CHAT_MSG_RAID_BOSS_WHISPER" }) do
        frame:RegisterEvent(event)
    end
    frame:SetScript("OnEvent", function(_, event, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12)
        Chatter:OnChat(event, a1, a2, a12)
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.lineKey and clip.event == Enums.SoundEvent.NPCChatter then
            Chatter.heard[clip.lineKey] = GetTime()
        end
    end)
    if ChatBubble then
        ChatBubble:Setup()
    end
end

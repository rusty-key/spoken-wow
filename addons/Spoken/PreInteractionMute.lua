setfenv(1, SpokenEnv)

-- Arm only on a world left/right-button press over a voiced NPC. Hover and target
-- changes never change audio. The client timing still needs in-game verification.
local armed, talking = false, false
local elapsed, deadline = 0, 0
local releaseHold, speakerGUID = false, nil
local OriginalMuteChannel = SoundUtils.MuteChannel

-- Experimental farewell tracking, using the same sound-handle/volume technique
-- as Spoken Quests' Game Greeting First feature. No fixed farewell duration.
local farewell
local function WaitingForFarewell()
    return farewell ~= nil
end
local function RetryAfterFarewell()
    farewell = nil
    for _, key in ipairs({ "quests", "gossip" }) do
        local source = Sources:Get(key)
        if source then source:Retry() end
    end
end
local function BeginFarewell()
    farewell = nil
    if not (C_Sound and C_Sound.PlaySoundWithOptions and C_Sound.IsPlaying
        and C_Sound.GetSoundScaledVolume and StopSound) then return end
    local master = tonumber(GetCVar("Sound_MasterVolume")) or 0
    local volume = tonumber(GetCVar("Sound_DialogVolume")) or 0
    if master <= 0 or volume <= 0 or GetCVar("Sound_EnableDialog") ~= "1" then return end
    -- A shared level cannot identify dialogue safely. Keep the previous behaviour.
    if math.abs(volume - 1) < 0.00001 then return end
    for _, channel in ipairs({ "SFX", "Music", "Ambience" }) do
        local other = tonumber(GetCVar("Sound_" .. channel .. "Volume"))
        if not other or math.abs(volume - other) < 0.00001 then return end
    end
    local ok, played, marker = pcall(C_Sound.PlaySoundWithOptions, {
        soundKitID = 856, uiSoundSubType = "SFX", forceNoDuplicates = false,
        runFinishCallback = false, volumeOverride = 0,
    })
    if not ok or not played or type(marker) ~= "number" then return end
    pcall(StopSound, marker)
    farewell = { started = GetTime(), expected = master * volume, voices = {},
        marker = marker, cursor = math.max(0, marker - 128), last = marker + 128,
        first = math.max(0, marker - 128) }
end
local function PollFarewell()
    local state = farewell
    if not state then return end
    local now = GetTime()
    if now - state.started > 10 then RetryAfterFarewell(); return end
    local current = Spoken.GetNowPlaying and Spoken:GetNowPlaying()
    local own = current and current.handle
    local count = 0
    for handle in pairs(state.voices) do
        local ok, playing = pcall(C_Sound.IsPlaying, handle)
        if ok and playing then count = count + 1
        else state.voices[handle] = nil; state.ended = now end
    end
    -- Discover only near the close event; never adopt a later NPC's greeting.
    if now - state.started <= 0.35 then
        for _ = 1, 96 do
            local handle = state.cursor
            state.cursor = handle >= state.last and state.first or handle + 1
            if handle ~= state.marker and handle ~= own and not state.voices[handle] then
                local ok, playing = pcall(C_Sound.IsPlaying, handle)
                if ok and playing then
                    local vok, level = pcall(C_Sound.GetSoundScaledVolume, handle)
                    if vok and type(level) == "number" and math.abs(level - state.expected) < 0.000001 then
                        state.voices[handle] = true
                        state.found = true
                        count = count + 1
                    end
                end
            end
        end
    end
    if count == 0 and ((state.found and state.ended and now - state.ended >= 0.05)
        or (not state.found and now - state.started >= 0.35)) then
        RetryAfterFarewell()
    end
end
Spoken:AddGate(function(clip)
    if WaitingForFarewell() and clip and
        (clip.source == Sources:Get("gossip") or clip.source == Sources:Get("quests")) then
        return "Waiting for the previous NPC's farewell"
    end
end)

function SoundUtils:MuteChannel(channel, muted, fadeOut)
    if channel == "Dialog" then
        if muted and (releaseHold or WaitingForFarewell()) then return end
        if not muted and armed then return end
    end
    return OriginalMuteChannel(self, channel, muted, fadeOut)
end

-- Once playback starts, the original queue owns the mute until it drains.
-- Holding our pre-click guard beyond that point delays farewell restoration.
Spoken:RegisterCallback("CLIP_STARTED", function(clip)
    if armed and clip and (clip.source == Sources:Get("gossip") or clip.source == Sources:Get("quests")) then
        armed = false
        deadline = 0
    end
end)

local function Allowed()
    local source = Sources:Get("gossip")
    if not source or not Addon.db or not Addon.db.profile.Audio.AutoToggleDialog
        or Sources:IsTurnedOff("gossip") or SoundQueue:IsPaused()
        or source:GetChannel() == "Dialog" or Version.IsAnyLegacy then return false end
    local db = source.profiles and source.profiles()
    local audio = db and db.profile and db.profile.Audio
    if not audio or audio.GreetingFirst or audio.Autoplay == false or audio.GossipFrequency == 4 then return false end
    if not Addon:ReadsHere() then return false end
    return true
end

-- Ask the quest module's installed-pack resolver using the hovered unit's own
-- GUID/name, rather than the conversation-only npc token. Cache briefly so the
-- periodic guard does not repeat fuzzy lookups every frame; pack/language changes
-- are picked up without a reload.
local voiced = {}
local function HasVoice(unit)
    local quests = _G.VoiceOver
    if not quests or not quests.DataModules or not quests.DataModules.HasGossipFor
        or not quests.Addon or quests.Addon.dataModulesPending then return false end
    local guid = UnitGUID(unit)
    if not guid then return false end
    local db = quests.Addon.db
    local audio = db and db.profile and db.profile.Audio
    local seen = db and db.char and db.char.hasSeenGossipForNPC
    local frequency = audio and audio.GossipFrequency
    if frequency == 4 then return false end
    if seen and seen[guid] then
        if frequency == 3 then return false end
        if frequency == 2 then
            -- Quest counts belong to the open conversation, not a hovered NPC.
            -- For an already-heard speaker, let the normal opening-event path
            -- decide once those counts are available instead of pre-muting.
            if unit ~= "npc" and unit ~= "questnpc" then return false end
            if quests.Addon.ShouldPlayGossip then
                local ok, play = pcall(quests.Addon.ShouldPlayGossip, quests.Addon, guid, nil, false, false)
                if not ok or not play then return false end
            else
                return false
            end
        end
    end
    local now = GetTime()
    local cached = voiced[guid]
    if cached and now - cached.time < 2 then return cached.value end
    local name = UnitName(unit)
    if quests.NotSecret then name = quests.NotSecret(name) end
    local ok, found = pcall(quests.DataModules.HasGossipFor, quests.DataModules,
        { unitGUID = guid, name = name, unitIsObjectOrItem = false })
    if not ok then return false end
    -- Bound storage to units currently encountered, rather than every spawn visited.
    if not cached and next(voiced) then
        for key, value in pairs(voiced) do
            if now - value.time >= 2 then voiced[key] = nil end
        end
    end
    voiced[guid] = { time = now, value = found == true }
    return found == true
end

local function Friendly(unit)
    return UnitExists(unit) and not UnitIsPlayer(unit) and UnitIsFriend("player", unit)
        and not UnitIsDeadOrGhost(unit) and HasVoice(unit)
end

local function SetArmed(value)
    if armed == value then return end
    armed = value
    if armed then
        SoundUtils:MuteChannel("Dialog", true)
    else
        SoundUtils:MuteChannel("Dialog", false)
    end
end

local function Release()
    talking = false
    deadline = 0
    releaseHold = true
    SetArmed(false)
    OriginalMuteChannel(SoundUtils, "Dialog", false)
end

local function Refresh()
    if not Allowed() or (not talking and deadline > 0 and GetTime() >= deadline) then
        if armed then Release() end
    end
end

if WorldFrame and WorldFrame.HookScript then
    WorldFrame:HookScript("OnMouseDown", function(_, button)
        if (button ~= "RightButton" and button ~= "LeftButton") or talking or not Allowed() then return end
        if not Friendly("mouseover") then return end
        local quests = _G.VoiceOver
        if not WaitingForFarewell() and quests and quests.GreetingFirst then
            -- Give dialogue a distinct volume before the next farewell begins.
            pcall(quests.GreetingFirst.SetDialogApart, quests.GreetingFirst)
        end
        speakerGUID = UnitGUID("mouseover")
        releaseHold = false
        deadline = GetTime() + 1.5
        if not WaitingForFarewell() then SetArmed(true) end
    end)
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "GOSSIP_SHOW", "QUEST_GREETING", "QUEST_DETAIL", "QUEST_PROGRESS",
    "QUEST_COMPLETE", "GOSSIP_CLOSED", "QUEST_FINISHED", "PLAYER_LEAVING_WORLD" }) do
    pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event)
    if event == "GOSSIP_CLOSED" or event == "QUEST_FINISHED" or event == "PLAYER_LEAVING_WORLD" then
        Release()
        if event ~= "PLAYER_LEAVING_WORLD" then BeginFarewell() else farewell = nil end
    else
        local guid = UnitGUID("npc") or UnitGUID("questnpc")
        -- Never keep a click's mute for a different NPC. Without a matching
        -- click, retain the original addon's event-time muting behaviour.
        if armed and (not guid or guid == speakerGUID) then
            talking = true
            deadline = 0
        else
            if armed then Release() end
            releaseHold = false
        end
    end
end)
frame:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed < 0.05 then return end
    elapsed = 0
    PollFarewell()
    Refresh()
end)

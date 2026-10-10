setfenv(1, VoiceOver)

-- Game Greeting First (Audio.GreetingFirst, off by default): the NPC's own greeting is not cut as
-- its window opens, and what Spoken reads off that window waits until the greeting is over.
--
-- The client cannot say which sound is an NPC's voice. A sound played at no volume hands back a
-- handle number next to the greeting's, and of the handles around it, one playing at exactly
-- Master x Dialog volume is the voice. That needs Dialog below 100% (a Master sound plays at
-- Master x 1) and at a level none of SFX, Music or Ambience is at, so SetDialogApart moves it 1%.
-- Without these calls, or for a greeting already playing as Dialog moves, the line waits 1.5s.
GreetingFirst = {}

local FALLBACK, END_GAP, POLL = 1.5, 0.05, 0.025
-- How long a voice has to show up before there is taken to be none, and the longest wait.
local DISCOVERY, LONGEST = 0.25, 10
-- The handles asked about either side of the marker, how many a poll asks, and how many
-- voices at once is too many to be one NPC.
local RADIUS, BUDGET, MOST_VOICES = 128, 64, 32
-- A checkbox click, played at no volume and stopped at once.
local MARKER_KIT = 856
local WINDOWS = { "GossipFrame", "QuestFrame", "DUIQuestFrame", "ImmersionFrame" }
local OTHER_CHANNELS = { "SFX", "Music", "Ambience" }

local watch          -- the greeting being listened to, or nil
local holdUntil = 0  -- the fixed wait, where there is nothing to listen with
local visit          -- the NPC whose windows are open: it greets once, as the first opens
local opened = 0     -- windows opened, to tell a closing visit from gossip turning into a quest

function GreetingFirst:IsOn()
    return Addon.db and Addon.db.profile.Audio.GreetingFirst == true
end

function GreetingFirst:IsWaiting()
    return watch ~= nil or GetTime() < holdUntil
end

local function Retry()
    -- Held lines are otherwise retried once a second.
    if Player.source and Player.source.Retry then
        Player.source:Retry()
    end
end

local function Number(cvar)
    return tonumber(GetCVar(cvar))
end

--- Whether a Dialog level can't be told from other sounds: 100% is shared with every sound on the
--- Master channel, and any other level with SFX, Music or Ambience at it.
local function Shared(dialog)
    if math.abs(dialog - 1) < 0.00001 then
        return true
    end
    for _, channel in ipairs(OTHER_CHANNELS) do
        local volume = Number("Sound_" .. channel .. "Volume")
        if not volume or math.abs(volume - dialog) < 0.00001 then
            return true
        end
    end
    return false
end

--- The volume an NPC's voice plays at: nil where it cannot be told from other sounds, 0 where
--- the game's dialogue is not heard at all.
local function VoiceVolume()
    local master, dialog = Number("Sound_MasterVolume"), Number("Sound_DialogVolume")
    if not master or not dialog then
        return nil
    end
    if master == 0 or dialog == 0 or GetCVar("Sound_EnableAllSound") == "0" or GetCVar("Sound_EnableDialog") == "0" then
        return 0
    end
    if Shared(dialog) then
        return nil
    end
    return master * dialog
end

--- Moves the Dialog slider 1% where it is at 100% or shares a level with SFX, Music or Ambience,
--- and says so in chat. Kept rather than put back: a greeting starts before Spoken hears of the
--- window, so the level has to be apart already. Returns whether it moved.
function GreetingFirst:SetDialogApart()
    local dialog = Number("Sound_DialogVolume")
    if not dialog or dialog <= 0 then
        return false
    end
    if not Shared(dialog) then
        return false
    end
    for _, step in ipairs({ -0.01, 0.01, -0.02, 0.02, -0.03, 0.03 }) do
        local volume = math.floor((dialog + step) * 100 + 0.5) / 100
        if volume > 0 and volume <= 1 and not Shared(volume) then
            SetCVar("Sound_DialogVolume", tostring(volume))
            print(format(L.GREETING_DIALOG_APART, math.floor(volume * 100 + 0.5)))
            return true
        end
    end
    return false
end

local function CanListen()
    return C_Sound and C_Sound.PlaySoundWithOptions and C_Sound.IsPlaying and C_Sound.GetSoundScaledVolume
        and StopSound and true or false
end

--- A handle number from now: the greeting that just started has one close to it.
local function Marker()
    local ok, willPlay, handle = pcall(C_Sound.PlaySoundWithOptions, {
        soundKitID = MARKER_KIT, uiSoundSubType = "SFX", forceNoDuplicates = false,
        runFinishCallback = false, volumeOverride = 0,
    })
    if not ok or not willPlay or type(handle) ~= "number" then
        return nil
    end
    pcall(StopSound, handle)
    return handle
end

local function Wait(seconds)
    watch = nil
    holdUntil = math.max(holdUntil, GetTime() + seconds)
    Addon:ScheduleTimer(Retry, seconds)
end

local function Fallback(state, now)
    return Wait(math.max(0, state.started + FALLBACK - now))
end

local function Done()
    watch = nil
    Retry()
end

local function Speaking(handle)
    local ok, playing = pcall(C_Sound.IsPlaying, handle)
    return ok and playing == true
end

local function Poll(state)
    if watch ~= state then
        return
    end
    local now = GetTime()
    local expected = VoiceVolume()
    if not expected or now >= state.started + LONGEST then
        return Fallback(state, now)
    end
    if expected == 0 then
        return Done()
    end
    -- Spoken's own line, should another part's start meanwhile, is not the NPC.
    local nowPlaying = Spoken.GetNowPlaying and Spoken:GetNowPlaying()
    local own = nowPlaying and nowPlaying.handle
    local count = 0
    for handle in pairs(state.voices) do
        if Speaking(handle) then
            count = count + 1
        else
            state.voices[handle] = nil
            state.lastEnd = now
        end
    end
    for _ = 1, BUDGET do
        local handle = state.next
        state.next = handle >= state.last and state.first or handle + 1
        if not state.voices[handle] and handle ~= state.marker and handle ~= own and Speaking(handle) then
            local ok, volume = pcall(C_Sound.GetSoundScaledVolume, handle)
            if ok and type(volume) == "number" and math.abs(volume - expected) <= 0.000001 then
                if count >= MOST_VOICES then
                    return Fallback(state, now)
                end
                state.voices[handle] = true
                count = count + 1
            end
        end
    end
    if count == 0 then
        -- A voice found and gone leaves lastEnd. Silence and a voice not found look the same, so
        -- no voice found means the fixed wait.
        if not state.lastEnd then
            if now >= state.started + DISCOVERY then
                return Fallback(state, now)
            end
        elseif now >= state.lastEnd + END_GAP then
            return Done()
        end
    end
    Addon:ScheduleTimer(Poll, POLL, state)
end

--- An NPC's window opened. The first window of a visit is where the NPC greets: Spoken's lines
--- wait for that greeting. The windows after it, a quest picked from the gossip, do not.
function GreetingFirst:Open()
    opened = opened + 1
    local npc = Utils:GetNPCGUID() or Utils:GetNPCName()
    if visit and visit == npc then
        return
    end
    visit = npc
    -- An object or an item says nothing; and while Spoken speaks the NPC is silenced anyway, or
    -- talks over a line the new one queues behind.
    if Utils:IsNPCObjectOrItem() or Spoken:IsPlaying() then
        return
    end
    self:SetDialogApart()
    local expected = VoiceVolume()
    if expected == 0 then
        return
    end
    local marker = expected and CanListen() and Marker()
    if not marker then
        return Wait(FALLBACK)
    end
    local state = {
        started = GetTime(), voices = {}, marker = marker,
        first = math.max(0, marker - RADIUS), last = marker + RADIUS,
    }
    state.next = state.first
    watch = state
    Addon:ScheduleTimer(Poll, POLL, state)
end

--- A window closed. Unless another opens at once (gossip turning into a quest), the visit is over
--- and the NPC greets again next time.
function GreetingFirst:Closed()
    if not self:IsOn() then
        visit = nil
        return
    end
    local before = opened
    Addon:ScheduleTimer(function()
        if opened ~= before then
            return
        end
        for _, name in ipairs(WINDOWS) do
            local frame = _G[name]
            if frame and frame.IsVisible and frame:IsVisible() then
                return
            end
        end
        visit = nil
    end, 0.1)
end

function GreetingFirst:Setup()
    if self.ready or not Player.source then
        return
    end
    self.ready = true
    Player.source:AddGate(function()
        if GreetingFirst:IsWaiting() then
            return L.QUEUE_HELD_GREETING
        end
    end)
    local frame = CreateFrame("Frame")
    for _, event in ipairs({ "GOSSIP_CLOSED", "QUEST_FINISHED" }) do
        pcall(frame.RegisterEvent, frame, event)
    end
    frame:SetScript("OnEvent", function() GreetingFirst:Closed() end)
    if self:IsOn() then
        self:SetDialogApart()
    end
end

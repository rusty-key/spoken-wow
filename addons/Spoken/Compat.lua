setfenv(1, SpokenEnv)

--------------------------------------------------------------------------- polyfills
--
-- What the legacy clients lack of the Lua the rest of this addon is written in.
-- Lifted from the quests addon. Written into the environment, never into _G, so other
-- addons on those clients see their own Lua and not ours.
--
-- Load order note: this file loads last, and that is fine -- nothing above calls
-- `select`, `hooksecurefunc` or the rest at load time, only from functions that run
-- after login.

-- Patch 11.0.2 removed the legacy global AddOn-management API. Current
-- Classic clients expose the same operations through C_AddOns, with the
-- character/addon argument order reversed for GetAddOnEnableState.
-- Keep these shims private to VoiceOver's environment so other addons are
-- not affected.
if C_AddOns then
    GetNumAddOns = GetNumAddOns or C_AddOns.GetNumAddOns
    GetAddOnInfo = GetAddOnInfo or C_AddOns.GetAddOnInfo
    GetAddOnMetadata = GetAddOnMetadata or C_AddOns.GetAddOnMetadata
    IsAddOnLoadOnDemand = IsAddOnLoadOnDemand or C_AddOns.IsAddOnLoadOnDemand
    LoadAddOn = LoadAddOn or C_AddOns.LoadAddOn
    EnableAddOn = EnableAddOn or C_AddOns.EnableAddOn
    DisableAddOn = DisableAddOn or C_AddOns.DisableAddOn

    if not GetAddOnEnableState and C_AddOns.GetAddOnEnableState then
        function GetAddOnEnableState(character, addon)
            if addon == nil then
                addon = character
                character = nil
            end
            return C_AddOns.GetAddOnEnableState(addon, character)
        end
    end

    if not IsAddOnLoaded and C_AddOns.IsAddOnLoaded then
        function IsAddOnLoaded(addon)
            local loadedOrLoading, loaded = C_AddOns.IsAddOnLoaded(addon)
            if loaded ~= nil then
                return loaded
            end
            return loadedOrLoading
        end
    end
end

if not select then
    function select(index, ...)
        if index == "#" then
            return arg.n
        else
            local result = {}
            for i = index, arg.n do
                table.insert(result, arg[i])
            end
            return unpack(result)
        end
    end
end

if not print or Version.IsLegacyVanilla or Version.IsLegacyBurningCrusade then
    local argn, argi
    if Version.IsLegacyVanilla then
        argn, argi = "arg.n", "arg[i]"
    else
        argn, argi = [[select("#", ...)]], [[(select(i, ...))]]
    end
    print = loadstring(format([[return function(...)
        local text = ""
        for i = 1, %s do
            text = text .. (i > 1 and " " or "") .. tostring(%s)
        end
        DEFAULT_CHAT_FRAME:AddMessage(text)
    end]], argn, argi))()
end

-- Patch 7.3.0 added SOUNDKIT, ids under names like the old strings; before it PlaySound
-- takes the string, and no channel, so these play on effects. The quests addon keeps its
-- own copy in its own environment, without the keys used here.
if not SOUNDKIT or Version:IsBelowLegacyVersion(70300) then
    SOUNDKIT = {
        U_CHAT_SCROLL_BUTTON = "uChatScrollButton",
        IG_QUEST_LOG_CLOSE = "igQuestLogClose",
    }
end

if not strsplit then
    function strsplit(delimiter, text)
        local result = {}
        local from = 1
        local delim_from, delim_to = string.find(text, delimiter, from)
        while delim_from do
            table.insert(result, string.sub(text, from, delim_from - 1))
            from = delim_to + 1
            delim_from, delim_to = string.find(text, delimiter, from)
        end
        table.insert(result, string.sub(text, from))
        return unpack(result)
    end
end

if not string.gmatch then
    string.gmatch = string.gfind
end

if not string.match then
    local function getargs(s, e, ...)
        return unpack(arg)
    end
    function string.match(str, pattern)
        return getargs(string.find(str, pattern))
    end
end

if not string.trim then
    function string.trim(str)
        return (string.match(str, "^%s*(.-)%s*$"))
    end
end

if not table.wipe then
    function table.wipe(tbl)
        for key in next, tbl do
            tbl[key] = nil
        end
    end
end
if not wipe then
    wipe = table.wipe
end

if not hooksecurefunc then
    ---@overload fun(name, hook)
    function hooksecurefunc(table, name, hook)
        if not hook then
            name, hook = table, name
            table = _G
        end

        local old = table[name]
        assert(type(old) == "function")
        table[name] = function(...)
            local result = { old(unpack(arg)) }
            hook(unpack(arg))
            return unpack(result)
        end
    end
end

if not GetAddOnEnableState then
    ---@overload fun(addon)
    function GetAddOnEnableState(character, addon)
        addon = addon or character
        local name, _, _, _, loadable, reason = _G.GetAddOnInfo(addon)
        if not name or not loadable and reason == "DISABLED" then
            return 0
        end
        return 2
    end

    function GetAddOnInfo(indexOrName)
        local name, title, notes, enabled, loadable, reason, security, newVersion = _G.GetAddOnInfo(indexOrName)
        return name, title, notes, loadable, reason, security, newVersion
    end
end

-- Camelot's FrameXML no longer defines MouseIsOver. The global was only ever a
-- wrapper over Region:IsMouseOver with the same argument order, and that method is
-- on every client this addon runs on, so the wrapper is safe to restore ourselves.
if not MouseIsOver then
    function MouseIsOver(frame, topOffset, bottomOffset, leftOffset, rightOffset)
        return frame:IsMouseOver(topOffset, bottomOffset, leftOffset, rightOffset)
    end
end


-- Per-client overrides. Loaded last, so everything it replaces already exists. Each block
-- writes into the environment, never into _G, which is the whole point of the environment.
--
-- Only the playback half of VoiceOverRedux's Compatibility.lua lives here so far: what the
-- frame and model overrides need arrives with the player's UI. The quest-side policy that
-- used to sit inside these functions -- toggling the NPC's own greeting off on 1.12 when
-- AutoToggleDialog is set -- does not: that is the quests addon's, and it hooks the queue.

--------------------------------------------------------------------------------- 1.12
if Version.IsLegacyVanilla then

    -- One sound system, one CVar, no channels and no way to stop a single sound. What it
    -- can do is stop *every* sound by toggling effects off and on again.
    function SoundUtils:WhyInaudible(channel)
        if tonumber(GetCVar("MasterSoundEffects")) ~= 1 then
            return "sound effects are disabled"
        end
        return nil
    end

    -- PlaySoundFile reports success for any filename here, so a probe learns nothing;
    -- the lookup table is the only word on whether a file exists.
    function SoundUtils:TestSound(clip)
        return true
    end

    function SoundUtils:PlaySound(clip, channel)
        PlaySoundFile(clip.path)
        clip.handle = 1 -- anything non-nil: marks the clip as one StopSound can act on
        return true, clip.handle
    end

    function SoundUtils:StopSound(clip)
        SetCVar("MasterSoundEffects", 0)
        SetCVar("MasterSoundEffects", 1)
        clip.handle = nil
    end

end

--------------------------------------------------------------------------- 2.4.3 / 3.3.5
if Version.IsLegacyBurningCrusade or Version.IsLegacyWrath then

    function SoundUtils:WhyInaudible(channel)
        if tonumber(GetCVar("Sound_EnableAllSound")) ~= 1 then
            return "all sound is disabled"
        end
        if Addon.db.profile.Audio.LegacyMusicChannel.Enabled then
            return nil
        end
        if tonumber(GetCVar("Sound_EnableSFX")) ~= 1 then
            return "the SFX sound channel is disabled"
        end
        return nil
    end

    function SoundUtils:TestSound(clip)
        return true
    end

    --[[
        Here begins the code the plays the VO over music channel in order to support the ability to pause/stop the VO.
        2.4.3's and 3.3.5's PlaySound/PlaySoundFile cannot be stopped by any means short of restarting the whole sound system (freezes the client for a couple of seconds).
        But PlayMusic can be stopped with StopMusic. This, however, causes the currently played script music to fade out instead of cutting,
            which is a problem, because by letting this happen we'll hear the VO looping until it fully fades out. This can be worked around
            by PlayMusic'ing another file (even one that doesn't exist), as that causes the script music to be instantly interrupted.
        Toggling Sound_EnableMusic cvar off-and-on additionally allows us to interrupt the current in-game background music.
        The whole process looks as follows:
        1. Sound queue requests to start playing the VO by calling SoundUtils:PlaySound
        2. Music volume is smoothly lowered to 0 over the config.FadeOutMusic duration
        3. In-game background music is instantly stopped by toggling Sound_EnableMusic cvar off-and-on
        4. Music volume is instantly changed to config.Volume level
        5. VO sound file is played on the music channel
        6. Once the VO's duration has ran out (soundData.stopSoundTimer) - silence.wav is played as music to instantly stop the VO and prevent it from looping
        7. Sound queue requests to stop playing the VO by calling SoundUtils:StopSound (either due to pause or soundData being removed from the queue) - silence.wav is played again to interrupt the VO in case it hasn't finished playing naturally
        8. Music volume is instantly changed to 0
        9. Music volume is smoothly raised to back to the pre-VO level over the config.FadeOutMusic duration
        10. In-game background music is removed by calling StopMusic()

        On 2.4.3 steps 2 and 3 are swapped, because 3.3.5's trick to instantly stop music by toggling cvars causes it to instead
            fade out over a short time on 2.4.3 (around 0.4-0.5 secs). So we lock config.FadeOutMusic to 0.5 secs let the client
            fade music out naturally during these 0.5 seconds, after which we bump the volume up and proceed as normal.
    ]]
    local function GetCurrentVolume()
        return tonumber(GetCVar("Sound_MusicVolume")) or 1
    end
    local function PlaySilence()
        PlayMusic([[Interface\AddOns\Spoken\Sounds\silence.wav]])
    end

    -- Functions that deal with temporarily changing player's sound settings to utilize the music channel for VO playback
    local prev_Sound_EnableMusic
    local prev_Sound_MusicVolume
    local function ReplaceCVars()
        if prev_Sound_EnableMusic == nil then
            prev_Sound_EnableMusic = GetCVar("Sound_EnableMusic")
            prev_Sound_MusicVolume = GetCVar("Sound_MusicVolume")
            SetCVar("Sound_EnableMusic", 1)
        end
    end
    local function RestoreCVars()
        if prev_Sound_EnableMusic ~= nil then
            SetCVar("Sound_EnableMusic", prev_Sound_EnableMusic)
            SetCVar("Sound_MusicVolume", prev_Sound_MusicVolume)
            prev_Sound_EnableMusic = nil
            prev_Sound_MusicVolume = nil
        end
    end

    -- Functions that deal with smoothly changing the music channel's volume to avoid abrupt changes
    local slideVolumeTarget
    local slideVolumeRate
    local slideVolumeCallback
    local EPS_VOLUME = 0.01
    local function GetMusicFadeOutDuration()
        if tonumber(prev_Sound_EnableMusic) == 0 or tonumber(prev_Sound_MusicVolume) == 0 then
            return 0
        end
        return Addon.db.profile.Audio.LegacyMusicChannel.FadeOutMusic or 0
    end
    local function StopSlideVolume()
        slideVolumeTarget = nil
        slideVolumeRate = nil
        slideVolumeCallback = nil
    end
    local function SlideVolume(target, callback)
        local duration = GetMusicFadeOutDuration()
        if duration <= 0 then
            -- Instantly change the volume if the player had reduced the duration all the way to 0
            return false
        end
        local current = GetCurrentVolume()
        if math.abs(target - current) <= EPS_VOLUME then
            -- Instantly "change" the volume if it's already fuzzy-equal to the target volume, and cancel the ongoing slide volume ("remove currently played sound from queue" case)
            StopSlideVolume()
            return false
        end
        -- Interpolate towards the target volume over the configured duration
        slideVolumeTarget = target
        slideVolumeRate = (target - current) / duration
        slideVolumeCallback = callback
        return true
    end
    local volumeFrame = CreateFrame("Frame", "SpokenSlideVolumeFrame", UIParent)
    volumeFrame:RegisterEvent("PLAYER_LOGOUT")
    volumeFrame:SetScript("OnEvent", function(self, event)
        if event == "PLAYER_LOGOUT" then
            StopSlideVolume()
            RestoreCVars()
        end
    end)
    volumeFrame:SetScript("OnUpdate", function(self, elapsed)
        if slideVolumeRate then
            local current = GetCurrentVolume()
            local target = slideVolumeTarget
            local next = current + slideVolumeRate * elapsed
            local finished = false
            if math.abs(target - current) <= EPS_VOLUME or current < target and next >= target or current > target and next <= target then
                next = target
                finished = true
            end
            SetCVar("Sound_MusicVolume", next)
            if finished then
                if slideVolumeCallback then
                    slideVolumeCallback()
                end
                StopSlideVolume()
            end
        end
    end)

    function SoundUtils:PlaySound(soundData)
        soundData.delay = nil
        if not Addon.db.profile.Audio.LegacyMusicChannel.Enabled then
            -- Play VO as a sound, but have no ability to stop it
            _G.PlaySoundFile(soundData.path)
            return true
        end

        soundData.handle = 1 -- Just put something here to flag the sound as stoppable

        ReplaceCVars()
        local function Play()
            -- Hack to instantly interrupt the music
            SetCVar("Sound_EnableMusic", 0)
            SetCVar("Sound_EnableMusic", 1)

            SetCVar("Sound_MusicVolume", Addon.db.profile.Audio.LegacyMusicChannel.Volume)
            PlayMusic(soundData.path)

            soundData.stopSoundTimer = Addon:ScheduleTimer(function()
                PlaySilence() -- Instantly interrupt the VO sound
            end, soundData.length)
        end
        if SlideVolume(0, Play) then
            soundData.delay = GetMusicFadeOutDuration()

            if Version.IsLegacyBurningCrusade then
                -- On 2.4.3 we ask the client to interrupt the music here and give it time to fade out naturally
                SetCVar("Sound_EnableMusic", 0)
                SetCVar("Sound_EnableMusic", 1)
                PlaySilence()
            end
        else
            Play()
        end
        -- PlayMusic reports nothing; the queue would discard a clip reported as not playing.
        return true
    end

    function SoundUtils:StopSound(soundData)
        if not soundData.handle then
            -- VO was played as a sound - we cannot stop it
            return
        end

        Addon:CancelTimer(soundData.stopSoundTimer, true)
        soundData.stopSoundTimer = nil
        -- Upstream left the handle set here, so a stopped clip still looked stoppable.
        soundData.handle = nil

        PlaySilence() -- Instantly interrupt the VO sound
        SetCVar("Sound_MusicVolume", 0)

        local function ResumeMusic()
            StopMusic()
            RestoreCVars()
        end
        if not SlideVolume(tonumber(prev_Sound_MusicVolume) or 1, ResumeMusic) then
            ResumeMusic()
        end
    end


end

--------------------------------------------------------------------------- frames
--
-- Everything the UI builds goes through this file's CreateFrame, which applies what an
-- old client lacks (SetShown, SetSize, SetResizeBounds, Get*Texture, HookScript...) as
-- mixins and overrides on the frame it returns. Lifted from the quests addon.

local RegionMixins = {}
local RegionOverrides = {}
local FrameMixins = {}
local FrameOverrides = {}
local FontStringMixins = {}
local ModelMixins = {}
local function ApplyMixinsAndOverrides(self, mixins, overrides)
    if mixins then
        for k, v in pairs(mixins) do
            if not self[k] then
                self[k] = v
            end
        end
    end
    if overrides then
        for k, v in pairs(overrides) do
            if self[k] then
                self["_" .. k], self[k] = self[k], v
            end
        end
    end
end
local hookFrame
local hookModel
function CreateFrame(frameType, name, parent, template)
    if UIParent.SetBackdrop and template == "BackdropTemplate" then
        template = nil
    end

    local frame = _G.CreateFrame(frameType, name, parent, template)
    ApplyMixinsAndOverrides(frame, RegionMixins, RegionOverrides)
    ApplyMixinsAndOverrides(frame, FrameMixins, FrameOverrides)
    if hookFrame then
        hookFrame(frame)
    end
    if frameType == "Model" or frameType == "PlayerModel" or frameType == "DressUpModel" then
        ApplyMixinsAndOverrides(frame, ModelMixins)
        if hookModel then
            hookModel(frame)
        end
    end
    return frame
end

function RegionMixins:SetShown(shown)
    if shown then
        self:Show()
    else
        self:Hide()
    end
end
function RegionMixins:SetSize(width, height)
    self:SetWidth(width)
    self:SetHeight(height)
end
function FrameMixins:SetResizeBounds(minWidth, minHeight, maxWidth, maxHeight)
    self:SetMinResize(minWidth, minHeight)
    if maxWidth and maxHeight then
        self:SetMaxResize(maxWidth, maxHeight)
    end
end
function ModelMixins:SetAnimation(animation)
    self:SetSequence(animation)
end
function ModelMixins:SetCustomCamera(camera)
    self:SetCamera(camera)
end

-- Patch 7.0.3 (2016-07-19): Added.
if Version:IsBelowLegacyVersion(70000) then
    local modelToFileID = {
        ["Original"] = {
            ["interface/buttons/talktomequestion_white"]                = 130737,

            ["character/bloodelf/female/bloodelffemale"]                = 116921,
            ["character/bloodelf/male/bloodelfmale"]                    = 117170,
            ["character/broken/female/brokenfemale"]                    = 117400,
            ["character/broken/male/brokenmale"]                        = 117412,
            ["character/draenei/female/draeneifemale"]                  = 117437,
            ["character/draenei/male/draeneimale"]                      = 117721,
            ["character/dwarf/female/dwarffemale"]                      = 118135,
            ["character/dwarf/female/dwarffemale_hd"]                   = 950080,
            ["character/dwarf/female/dwarffemale_npc"]                  = 950080,
            ["character/dwarf/male/dwarfmale"]                          = 118355,
            ["character/dwarf/male/dwarfmale_hd"]                       = 878772,
            ["character/dwarf/male/dwarfmale_npc"]                      = 878772,
            ["character/felorc/female/felorcfemale"]                    = 118652,
            ["character/felorc/male/felorcmale"]                        = 118653,
            ["character/felorc/male/felorcmaleaxe"]                     = 118654,
            ["character/felorc/male/felorcmalesword"]                   = 118667,
            ["character/foresttroll/male/foresttrollmale"]              = 118798,
            ["character/gnome/female/gnomefemale"]                      = 119063,
            ["character/gnome/female/gnomefemale_hd"]                   = 940356,
            ["character/gnome/female/gnomefemale_npc"]                  = 940356,
            ["character/gnome/male/gnomemale"]                          = 119159,
            ["character/gnome/male/gnomemale_hd"]                       = 900914,
            ["character/gnome/male/gnomemale_npc"]                      = 900914,
            ["character/goblin/female/goblinfemale"]                    = 119369,
            ["character/goblin/male/goblinmale"]                        = 119376,
            ["character/goblinold/male/goblinoldmale"]                  = 119376,
            ["character/human/female/humanfemale"]                      = 119563,
            ["character/human/female/humanfemale_hd"]                   = 1000764,
            ["character/human/female/humanfemale_npc"]                  = 1000764,
            ["character/human/male/humanmale"]                          = 119940,
            ["character/human/male/humanmale_cata"]                     = 119940,
            ["character/human/male/humanmale_hd"]                       = 1011653,
            ["character/human/male/humanmale_npc"]                      = 1011653,
            ["character/icetroll/male/icetrollmale"]                    = 232863,
            ["character/naga_/female/naga_female"]                      = 120263,
            ["character/naga_/male/naga_male"]                          = 120294,
            ["character/nightelf/female/nightelffemale"]                = 120590,
            ["character/nightelf/female/nightelffemale_hd"]             = 921844,
            ["character/nightelf/female/nightelffemale_npc"]            = 921844,
            ["character/nightelf/male/nightelfmale"]                    = 120791,
            ["character/nightelf/male/nightelfmale_hd"]                 = 974343,
            ["character/nightelf/male/nightelfmale_npc"]                = 974343,
            ["character/northrendskeleton/male/northrendskeletonmale"]  = 233367,
            ["character/orc/female/orcfemale"]                          = 121087,
            ["character/orc/female/orcfemale_npc"]                      = 121087,
            ["character/orc/male/orcmale"]                              = 121287,
            ["character/orc/male/orcmale_hd"]                           = 917116,
            ["character/orc/male/orcmale_npc"]                          = 917116,
            ["character/scourge/female/scourgefemale"]                  = 121608,
            ["character/scourge/female/scourgefemale_hd"]               = 997378,
            ["character/scourge/female/scourgefemale_npc"]              = 997378,
            ["character/scourge/male/scourgemale"]                      = 121768,
            ["character/scourge/male/scourgemale_hd"]                   = 959310,
            ["character/scourge/male/scourgemale_npc"]                  = 959310,
            ["character/skeleton/male/skeletonmale"]                    = 121942,
            ["character/taunka/male/taunkamale"]                        = 233878,
            ["character/tauren/female/taurenfemale"]                    = 121961,
            ["character/tauren/female/taurenfemale_hd"]                 = 986648,
            ["character/tauren/female/taurenfemale_npc"]                = 986648,
            ["character/tauren/male/taurenmale"]                        = 122055,
            ["character/tauren/male/taurenmale_hd"]                     = 968705,
            ["character/tauren/male/taurenmale_npc"]                    = 968705,
            ["character/troll/female/trollfemale"]                      = 122414,
            ["character/troll/female/trollfemale_hd"]                   = 1018060,
            ["character/troll/female/trollfemale_npc"]                  = 1018060,
            ["character/troll/male/trollmale"]                          = 122560,
            ["character/troll/male/trollmale_hd"]                       = 1022938,
            ["character/troll/male/trollmale_npc"]                      = 1022938,
            ["character/tuskarr/male/tuskarrmale"]                      = 122738,
            ["character/vrykul/male/vrykulmale"]                        = 122815,
        },
        ["HD"] = {
            ["character/scourge/female/scourgefemale"]                  = 997378,
        },
    }
    local function CleanupModelName(model)
        model = string.lower(model)
        model = string.gsub(model, "\\", "/")
        model = string.gsub(model, "%.m2", "")
        model = string.gsub(model, "%.mdx", "")
        return model
    end
    function ModelMixins:GetModelFileID()
        local model = self:GetModel()
        if model and type(model) == "string" then
            model = CleanupModelName(model)
            local models = modelToFileID[Portrait:GetCurrentModelSet()] or modelToFileID["Original"]
            return models[model] or modelToFileID["Original"][model]
        end
    end
end

if Version.IsLegacyVanilla then
    function RegionOverrides:SetPoint(point, region, relativeFrame, offsetX, offsetY)
        if region == nil and relativeFrame == nil and offsetX == nil and offsetY == nil then
            self:_SetPoint(point, 0, 0)
        else
            self:_SetPoint(point, region, relativeFrame, offsetX, offsetY)
        end
    end
    function FrameOverrides:SetScript(script, handler)
        self:_SetScript(script, script == "OnEvent"
            and function() handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end
    function FrameMixins:HookScript(script, handler)
        local old = self:GetScript(script)
        self:_SetScript(script, script == "OnEvent"
            and function() if old then old() end handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() if old then old() end handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end


    hooksecurefunc(GameTooltip, "SetOwner", function(self, owner, anchor)
        self._owner = owner
    end)
    function GameTooltip:GetOwner()
        return self._owner
    end


end
if Version.IsLegacyBurningCrusade then
    function FrameOverrides:SetScript(script, handler)
        self:_SetScript(script, script == "OnEvent"
            and function() handler(this, event, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end
            or  function() handler(this,        arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) end)
    end
end

if Version.IsLegacyVanilla or Version.IsLegacyBurningCrusade then

    local modelFramePool = {}
    function Portrait:AcquireModelFrame(portrait, clip)
        if portrait.pooledModel and portrait.pooledModel._inUse then
            return portrait.pooledModel
        end

        local frame
        for _, pooled in ipairs(modelFramePool) do
            if not pooled._inUse then
                frame = pooled
                break
            end
        end

        if not frame then
            frame = CreateFrame("PlayerModel", nil, portrait)
            table.insert(modelFramePool, frame)
        end

        frame._inUse = true
        frame:ClearAllPoints()
        frame:SetPoint("BOTTOMLEFT")
        frame:SetSize(1, 1)
        frame:Show()
        frame:SetUnit("npc")

        portrait.pooledModel = frame
        return frame
    end
    function Portrait:ReleaseModelFrame(portrait, frame)
        if not frame then
            return
        end
        if portrait.pooledModel == frame then
            portrait.pooledModel = nil
        end
        frame:Hide()
        frame:ClearModel()
        frame._inUse = false
    end


    function hookModel(self)
        self._sequence = 0
        hooksecurefunc(self, "ClearModel", function(self)
            self._sequence = 0
            self._sequenceStart = nil
        end)
        hooksecurefunc(self, "SetSequence", function(self, sequence)
            self._sequence = sequence
            self._sequenceStart = GetTime()
        end)
        self:HookScript("OnUpdate", function(self, elapsed)
            if self._sequence ~= 0 then
                self:SetSequenceTime(self._sequence, (GetTime() - self._sequenceStart) * 1000)
            end
        end)
    end

    function FrameOverrides:HookScript(script, handler)
        if self:GetScript(script) then
            self:_HookScript(script, handler)
        else
            self:SetScript(script, handler)
        end
    end
    function FrameOverrides:CreateTexture(name, layer)
        local region = self:_CreateTexture(name, layer)
        ApplyMixinsAndOverrides(region, RegionMixins, RegionOverrides)
        return region
    end
    function FrameOverrides:CreateFontString(name, layer, template)
        local region = self:_CreateFontString(name, layer, template)
        ApplyMixinsAndOverrides(region, RegionMixins, RegionOverrides)
        ApplyMixinsAndOverrides(region, FontStringMixins)
        return region
    end
    function FrameOverrides:SetNormalTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._normalTexture = texture
        self:_SetNormalTexture(texture)
        return success
    end
    function FrameMixins:GetNormalTexture()
        return self._normalTexture
    end
    function FrameOverrides:SetPushedTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._pushedTexture = texture
        self:_SetPushedTexture(texture)
        return success
    end
    function FrameMixins:GetPushedTexture()
        return self._pushedTexture
    end
    function FrameOverrides:SetDisabledTexture(file)
        local texture = self:CreateTexture(nil, "ARTWORK")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._disabledTexture = texture
        self:_SetDisabledTexture(texture)
        return success
    end
    function FrameMixins:GetDisabledTexture()
        return self._disabledTexture
    end
    function FrameOverrides:SetHighlightTexture(file)
        local texture = self:CreateTexture(nil, "HIGHLIGHT")
        local success = texture:SetTexture(file)
        texture:SetAllPoints()
        self._highlightTexture = texture
        self:_SetHighlightTexture(texture)
        return success
    end
    function FrameMixins:GetHighlightTexture()
        return self._highlightTexture
    end
    function FontStringMixins:SetWordWrap(wrap)
        if not wrap then
            self:SetHeight((select(2, self:GetFont())))
        end
    end
    function ModelMixins:SetCreature()
    end

    function GameTooltip_Hide()
        -- Used for XML OnLeave handlers
        GameTooltip:Hide()
    end

end

if Version.IsLegacyBurningCrusade or Version.IsLegacyWrath then
    function Portrait:GetCurrentModelSet()
        return Addon.db.profile.Audio.LegacyHDModels and "HD" or "Original"
    end

    -- Frame fade-in to soften the delay the music-channel path adds before a clip.
    hooksecurefunc(PlayerFrame, "InitDisplay", function(self)
        local fadeIn, animation
        if self.frame.CreateAnimationGroup then
            fadeIn = self.frame:CreateAnimationGroup()
            animation = fadeIn:CreateAnimation("Alpha")
            animation:SetOrder(1)
            animation:SetDuration(0)
            animation:SetChange(-1)
            animation = fadeIn:CreateAnimation("Alpha")
            animation:SetOrder(2)
            animation:SetDuration(1)
            animation:SetChange(1)
            animation:SetSmoothing("OUT")
        else
            fadeIn, animation = { frame = self.frame }, {}
            function fadeIn:Stop() self.frame:SetAlpha(1); self.enabled = nil end
            function fadeIn:Play() self.frame:SetAlpha(0); self.enabled = true end
            function animation:SetDuration(duration) self.duration = duration end
            self.frame:HookScript("OnUpdate", function(frame, elapsed)
                if fadeIn.enabled then
                    local alpha = math.min(1, frame:GetAlpha() + elapsed / animation.duration)
                    if alpha >= 1 then fadeIn:Stop() else frame:SetAlpha(alpha) end
                end
            end)
        end
        self.frame:HookScript("OnShow", function()
            fadeIn:Stop()
            local head = SoundQueue:GetCurrentSound()
            local duration = head and head.delay or 0
            if duration > 0 then
                animation:SetDuration(duration)
                fadeIn:Play()
            end
        end)
    end)
end

if Version.IsLegacyWrath then

    -- 3.3.5 can show a creature it has not cached only after the client fetches it, so
    -- the portrait shows a placeholder until then and the pause button says why on hover.
    function hookModel(self)
        local function HasModelLoaded(self)
            local model = self:GetModel()
            return model and type(model) == "string" and self:GetModelFileID() ~= 130737
        end
        self._sequence = 0
        hooksecurefunc(self, "ClearModel", function(self)
            self._awaitingModel = nil
            self._camera = nil
            self._sequence = 0
            self._sequenceStart = nil
        end)
        local oldSetSequence = self.SetSequence
        function self:SetSequence(sequence)
            self._sequence = sequence
            self._sequenceStart = GetTime()
            if not self._awaitingModel then
                oldSetSequence(self, sequence)
            end
        end
        local oldSetCreature = self.SetCreature
        function self:SetCreature(id)
            self:ClearModel()
            self:SetModel([[Interface\Buttons\TalkToMeQuestion_White.mdx]])
            oldSetCreature(self, id)
            self._awaitingModel = not HasModelLoaded(self)
        end
        local oldSetCamera = self.SetCamera
        function self:SetCamera(id)
            self._camera = id
            if not self._awaitingModel then
                oldSetCamera(self, id)
            end
        end
        self:HookScript("OnUpdate", function(self, elapsed)
            if self._awaitingModel and HasModelLoaded(self) then
                self._awaitingModel = nil
                self:SetModelScale(2)
                self:SetPosition(0, 0, 0)

                if self._sequence ~= 0 then
                    self:SetSequence(self._sequence)
                end
            elseif self._awaitingModel then
                self:SetModelScale(0.71 / self:GetEffectiveScale())
                self:SetPosition(5 * self:GetModelScale(), 0, 2 * self:GetModelScale())
            end
            if self._sequence ~= 0 and not self._awaitingModel then
                self:SetSequenceTime(self._sequence, (GetTime() - self._sequenceStart) * 1000)
            end
        end)
    end

    hooksecurefunc(PlayerFrame, "InitPortrait", function(self)
        self.frame.portrait.pause:HookScript("OnEnter", function()
            if self.frame.portrait.model and self.frame.portrait.model._awaitingModel then
                GameTooltip:SetOwner(self.frame.portrait.pause, "ANCHOR_NONE")
                GameTooltip:SetPoint("BOTTOMLEFT", self.frame.portrait.pause, "BOTTOMRIGHT", 4, -4)
                GameTooltip:SetText(L.UNCACHED_NPC, HIGHLIGHT_FONT_COLOR.r, HIGHLIGHT_FONT_COLOR.g, HIGHLIGHT_FONT_COLOR.b)
                GameTooltip:AddLine(L.UNCACHED_NPC_TIP, NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b, 1)
                GameTooltip:Show()
            end
        end)
        self.frame.portrait.pause:HookScript("OnLeave", GameTooltip_Hide)
    end)

end

-- Forever runs the modern engine and its HD models whatever project id it answers.
if Version.IsRetailMainline or Version.IsCamelot then
    function Portrait:GetCurrentModelSet()
        return "HD"
    end
end

if Version.IsCamelot then
    -- Camelot accepts SetCustomCamera and ignores it: the model keeps the default
    -- full-body framing, so the portrait showed the whole NPC standing in the box.
    -- SetPortraitZoom is the framing that client honours, and 1 is the head shot the
    -- M2's camera 0 used to give. Verified in the client on tauren male (122055).
    -- It frames the head on its own, so the model scale of 2 that the camera-0 clients
    -- need is undone here: with both, the face filled the box past its own edges.
    function Portrait:FrameHead(model)
        model:SetPortraitZoom(1)
        model:SetModelScale(1)
    end
end

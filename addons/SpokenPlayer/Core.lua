setfenv(1, SpokenEnv)

-- The object the ported queue code reaches timers and settings through, under the name
-- upstream gave it. A plain table with AceTimer embedded, not an AceAddon: the player has
-- no options table to register, no console commands of its own, and every client from
-- 1.12 up can embed AceTimer into anything. Reproducing the name is what keeps the
-- ported bodies diffable against upstream.
Addon = LibStub("AceTimer-3.0"):Embed({})

-- What feature addons register through API.lua and the UI reads back.
Bullets = {}
Renderers = {}

-- The red a queue line turns when a click will take it out, in either player layout.
RemoveColor = { 225 / 255, 20 / 255, 8 / 255 }

-- Player-wide settings only. Anything a single domain cares about -- gossip frequency,
-- autoplay, which pack to prefer -- stays in that feature addon's own saved variables.
Defaults = {
    profile = {
        Frame = {
            LockFrame = false,
            FrameScale = 0.7,
            FrameStrata = "HIGH",
            HidePortrait = false,
            HideFrame = false,
            MinimalPlayer = true,
            -- Subtitles in place of either window. A switch of its own rather than a third
            -- value of MinimalPlayer, so the window a player chose is still remembered when
            -- they go back to one. Addon:PlayerStyle reads the two together. The default only
            -- on the modern clients: the legacy ones start in the window they always had.
            SubtitlePlayer = not Version.IsAnyLegacy or false,
            -- Forever only: the bronze its own frames wear, on the minimal player's metal.
            BronzeTint = true,
            MinimalWidth = 380,
            -- Per action id, for the ones an addon declared optional. Absent means shown.
            HiddenActions = {},
        },
        -- The voice language and its fallback, for every module at once (Spoken:GetLanguageChoice).
        -- Unset, each module keeps the choice it had before there was one setting for all.
        Language = {},
        Audio = {
            -- A string, because that is what PlaySoundFile takes. The quests addon keeps
            -- its enum internally and converts at the boundary.
            SoundChannel = "Master",
            -- The client speaks its own NPC barks on the Dialog channel, over the top of a
            -- line being read. Muting it while we speak belongs to the player: any addon's
            -- clip is the one being talked over. Not on clients without the channel, where
            -- Compat.lua interrupts the bark a different way.
            AutoToggleDialog = (Version.IsLegacyVanilla or Version:IsRetailOrAboveLegacyVersion(60100)) or false,
            -- The other channels turned down while a line is spoken (OtherSounds.lua), each to
            -- this share of the player's own volume, for the length of a line. Not on the legacy
            -- clients, where speech itself goes out on the music channel.
            LowerOthers = (not Version.IsAnyLegacy or nil) and {
                Enabled = true,
                Music = 0.3,
                Ambience = 0.4,
                SFX = 0.6,
                Dialog = 1,
            },
            -- 2.4.3 and 3.3.5 only. Those clients cannot stop a sound once started, so the
            -- player routes speech through the music channel, which can be stopped. This
            -- moved here from the quests addon because it is how the *player* plays on those
            -- clients, whichever addon queued the line.
            LegacyMusicChannel = (Version.IsLegacyWrath or Version.IsLegacyBurningCrusade or nil) and {
                Enabled = true,
                Volume = 1,
                FadeOutMusic = 0.5,
            },
            -- 2.4.3 and 3.3.5 with HD model patches: which set the portrait's animation
            -- durations are looked up in.
            LegacyHDModels = (Version.IsLegacyWrath or Version.IsLegacyBurningCrusade or nil) and false,
        },
        -- Parts of Spoken switched off in the settings, by source key, as false. Absent means on.
        -- See Sources:IsTurnedOff for why this is the player's switch and not the client's.
        Parts = {},
        Contribute = {
            -- One switch for every feature addon's Contribute button, since they all hand
            -- the player the same box and a player who does not want one wants none.
            HideButtons = false,
        },
        Transcript = {
            Enabled = true,
            AutoScroll = true,
            Lines = 2,
            HighlightWord = false,
            FontSize = 16,
            -- The subtitle player's own (UI/Subtitle.lua).
            Typewriter = true,
            -- "letter": each word typed in; "word": each word appears whole.
            TypewriterBy = "letter",
            SubtitleShadow = 0.6,
            SubtitleScale = 1,
        },
        Minimap = {
            -- LibDBIcon's own: minimapPos, lock, hide, and -- on the modern clients that
            -- have one -- the addon compartment flag. On by default, as it is for the
            -- minimap button; AceDB fills the new key into profiles that predate it.
            LibDBIcon = { showInCompartment = true },
            -- What each mouse button does. "Menu" opens the list; any other value is a
            -- menu entry id, the player's or a source's.
            Commands = {
                LeftButton = "Menu",
                MiddleButton = "PlayPause",
                RightButton = "Settings",
            },
        },
    },
    char = {
        IsPaused = false,
    },
}

--- Idempotent, so the test harness and ADDON_LOADED can both call it.
function Addon:InitDB()
    if self.db then
        return
    end
    self.db = LibStub("AceDB-3.0"):New("SpokenPlayerDB", Defaults)
    -- Another profile chosen, copied over this one or reset, from Spoken's page or anywhere
    -- else: its settings apply now rather than at the next reload.
    if self.db.RegisterCallback then
        local function Apply() Addon:ApplyProfile() end
        self.db.RegisterCallback(self, "OnProfileChanged", Apply)
        self.db.RegisterCallback(self, "OnProfileCopied", Apply)
        self.db.RegisterCallback(self, "OnProfileReset", Apply)
    end
    self:Migrate()
end

--- Put the profile's settings into effect: the window or subtitles, the captions, the minimap
--- button, the other sounds' levels and the settings page. Each only where it is loaded on this
--- client, and only once Enable has built them.
function Addon:ApplyProfile()
    if not self.enabled then return end
    if PlayerFrame and PlayerFrame.RefreshConfig then PlayerFrame:RefreshConfig() end
    if Transcript and Transcript.RefreshConfig then Transcript:RefreshConfig() end
    if Subtitle and Subtitle.Update then Subtitle:Update() end
    -- Hands LibDBIcon the new profile's table: it keeps the one it was given.
    if Minimap and Minimap.Refresh then Minimap:Refresh() end
    if OtherSounds and OtherSounds.IsAvailable and OtherSounds:IsAvailable() then OtherSounds:RefreshConfig() end
    if Options and Options.UpdateRows then Options:UpdateRows() end
end

--- Where each player window sits, how wide it is, and whether the captions are expanded.
--- Account-wide, in global rather than the profile: AceDB names the profile after
--- UnitName("player") when its file loads, and the Forever client answers "Unknown" (in
--- the client's language) there on some logins and the name on others, so a window
--- placed on one login came back on the default spot the next. The client's own
--- SetUserPlaced cache fared no better, since the frames are built at PLAYER_LOGIN and
--- anchored to their defaults straight after.
function Addon:Layout()
    local global = self.db.global
    if type(global.Layout) ~= "table" then
        local transcript = self.db.profile.Transcript
        -- Expanded was a profile setting before; carry it over once.
        global.Layout = { CaptionsExpanded = type(transcript) == "table" and transcript.Expanded == true }
    end
    return global.Layout
end

--- Record a frame's place and width under key. The top-left corner, not the anchor the
--- client left after a drag: both players grow downwards as captions and the queue come
--- and go, and a saved BOTTOM anchor would put the frame back at the height it had then.
function Addon:SaveLayout(key, frame, width)
    local left, top = frame:GetLeft(), frame:GetTop()
    if not left or not top then return end
    self:Layout()[key] = { left = left, top = top, width = width or frame:GetWidth() }
end

--- Put a frame back where SaveLayout left it. False when nothing was saved.
function Addon:RestoreLayout(key, frame)
    local saved = self:Layout()[key]
    if type(saved) ~= "table" or not saved.left or not saved.top then return false end
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", saved.left, saved.top)
    return true
end

--- Which of the four ways of showing a line is in use: "minimal" (the Minimal Classic
--- window), "classic" (the original window), "subtitle" (no window, subtitles only) or "none"
--- (nothing on screen at all, the voice alone -- what HideFrame always meant). Neither
--- alternative to the original window exists everywhere: the minimal one is not built on the
--- legacy clients, and 1.12 has no captions, so no subtitles either.
function Addon:PlayerStyle()
    local frame = self.db and self.db.profile.Frame or Defaults.profile.Frame
    if frame.SubtitlePlayer and not Transcript.unavailable then return "subtitle" end
    if frame.HideFrame then return "none" end
    if frame.MinimalPlayer and not Version.IsAnyLegacy then return "minimal" end
    return "classic"
end

-- The window a player last chose is kept whichever style replaces it, so going back to a
-- window finds the one they had.
function Addon:SetPlayerStyle(style)
    local frame = self.db.profile.Frame
    frame.SubtitlePlayer = style == "subtitle"
    frame.HideFrame = style == "none"
    if style == "minimal" or style == "classic" then frame.MinimalPlayer = style == "minimal" end
end

local SOUND_CHANNEL_NAMES = { "Master", "SFX", "Music", "Ambience", "Dialog" }

-- The frame, minimap and channel settings used to live in each feature addon's own
-- saved variables. Their tombstone folders keep those files loading after the rename,
-- and this reads them once. The quests addon's win where both exist: it is the older
-- addon and the one whose player this is. Nothing in the old tables is changed.
function Addon:Migrate()
    local global = self.db.global
    if global.migratedFrom then
        return
    end

    -- AceDB without a default-profile flag, which is how both old addons made their
    -- tables, keys the profile by character; "Default" exists only when a player chose it.
    local charKey = UnitName("player") .. " - " .. GetRealmName()
    local function profileOf(sv)
        if type(sv) ~= "table" or type(sv.profiles) ~= "table" then
            return nil
        end
        local key = type(sv.profileKeys) == "table" and sv.profileKeys[charKey] or charKey
        return sv.profiles[key] or sv.profiles.Default
    end
    -- A feature addon disables its tombstone after adopting the old table. A player
    -- installed later never sees the old table, but the adopted copy has the same shape
    -- and says where it came from; and it loads after this addon, so this runs again at
    -- PLAYER_LOGIN.
    local function adopted(sv, marker)
        return type(sv) == "table" and marker(sv) and sv or nil
    end
    local function copyKeys(from, to, keys)
        for _, key in ipairs(keys) do
            if from[key] ~= nil then
                to[key] = from[key]
            end
        end
    end
    local quests = profileOf(rawget(_G, "VoiceOverDB"))
        or profileOf(adopted(rawget(_G, "SpokenQuestsDB"), function(sv) return type(sv.global) == "table" and sv.global.migratedFrom end))
    local zonesQueue = profileOf(rawget(_G, "ZoneLoreQueueDB"))
    local zones = rawget(_G, "ZoneLoreDB")
        or adopted(rawget(_G, "SpokenZonesDB"), function(sv) return sv.migratedFrom end)

    local frame = quests and quests.SoundQueueUI or zonesQueue and zonesQueue.SoundQueueUI
    if frame then
        copyKeys(frame, self.db.profile.Frame, { "LockFrame", "FrameScale", "FrameStrata", "HidePortrait", "HideFrame" })
    end

    local icon = quests and quests.MinimapButton and quests.MinimapButton.LibDBIcon
    if not icon and type(zones) == "table" then
        icon = zones -- LibDBIcon wrote its keys at the top level of ZoneLoreDB
    end
    if icon then
        copyKeys(icon, self.db.profile.Minimap.LibDBIcon, { "minimapPos", "hide", "lock" })
    end

    if quests and quests.Audio then
        local channel = quests.Audio.SoundChannel
        if type(channel) == "number" and SOUND_CHANNEL_NAMES[channel] then
            self.db.profile.Audio.SoundChannel = SOUND_CHANNEL_NAMES[channel]
        end
        -- Both addons carried their own copy of these. The quests one wins where both
        -- exist, as it does for the frame: it is the older addon.
        if quests.Audio.AutoToggleDialog ~= nil and self.db.profile.Audio.AutoToggleDialog ~= nil then
            self.db.profile.Audio.AutoToggleDialog = quests.Audio.AutoToggleDialog
        end
        local legacy = quests.LegacyWrath
        if legacy and self.db.profile.Audio.LegacyMusicChannel and legacy.PlayOnMusicChannel then
            for key, value in pairs(legacy.PlayOnMusicChannel) do
                self.db.profile.Audio.LegacyMusicChannel[key] = value
            end
        end
        if legacy and legacy.HDModels ~= nil and self.db.profile.Audio.LegacyHDModels ~= nil then
            self.db.profile.Audio.LegacyHDModels = legacy.HDModels
        end
    end

    -- The zones addon named the same setting differently, at the top level of its table.
    if not (quests and quests.Audio and type(quests.Audio.SoundChannel) == "number")
        and type(zones) == "table" and type(zones.voiceChannel) == "string" then
        self.db.profile.Audio.SoundChannel = zones.voiceChannel
    end

    if quests then
        global.migratedFrom = "VoiceOverRedux"
    elseif zonesQueue or type(zones) == "table" then
        global.migratedFrom = "ZoneLore"
    end
end

--- Everything that needs the world: the frame, the button, the settings, the slash
--- command. Idempotent, so the harness and PLAYER_LOGIN can both call it.
function Addon:Enable()
    if self.enabled then return end
    self:InitDB()
    self:Migrate()
    self.enabled = true
    PlayerFrame:Initialize()
    Transcript:Initialize()
    Minimap:Setup()
    Options:Setup()

    -- Through _G, not bare. Every file here runs inside a private environment whose
    -- metatable falls back to _G: reads fall through, writes do not. A bare assignment
    -- lands in the environment, and the client never hears of the command.
    -- One scheme across the three addons: the long name and a two-or-three letter short
    -- form. /sp here, /spq for quests, /spz for zones.
    _G.SLASH_SPOKEN1 = "/spoken"
    _G.SLASH_SPOKEN2 = "/sp"
    SlashCmdList.SPOKEN = function(input)
        local command = strlower(strtrim(input or ""))
        if command == "play" or command == "pause" or command == "" then
            SoundQueue:TogglePauseQueue()
        elseif command == "stop" then
            SoundQueue:RemoveAllSoundsFromQueue()
        elseif command == "skip" then
            SoundQueue:Skip()
        elseif command == "transcript" then
            Transcript:SetEnabled(not Addon.db.profile.Transcript.Enabled)
        elseif command == "transcript on" then
            Transcript:SetEnabled(true)
        elseif command == "transcript off" then
            Transcript:SetEnabled(false)
        elseif command == "transcript reset" then
            Transcript:Reset()
        elseif command == "transcript 1" or command == "transcript 2" then
            Addon.db.profile.Transcript.Lines = tonumber(string.sub(command, -1))
            Transcript:RefreshConfig()
        elseif command == "player minimal" or command == "player classic" or command == "player subtitle"
            or command == "player none" then
            Addon:SetPlayerStyle(string.sub(command, 8))
            PlayerFrame:RefreshConfig()
            Transcript:RefreshConfig()
        elseif command == "options" or command == "settings" then
            Options:Open()
        elseif command == "share" and Gather then
            Spoken:ShowGatherInstructions()
        elseif command == "reset" then
            PlayerFrame:Reset()
            -- Not on 1.12, which has no captions and so no subtitles to move.
            if Subtitle then Subtitle:Reset() end
        elseif command == "diagnostics" then
            print(format("Spoken %s, API %d, %d queued, %s", AddonVersion, Spoken.API_VERSION,
                SoundQueue:GetQueueSize(), SoundQueue:IsPaused() and "paused" or "playing"))
            for key, source in Sources:Iterate() do
                print(format("  source %s (%s)", key, source.addon or "?"))
            end
            for _, line in ipairs(PlayerFrame:Describe()) do print("  " .. line) end
            print("  " .. Transcript:Describe())
            for _, err in ipairs(Callbacks.errors) do print("  callback error: " .. err) end
        else
            print("Spoken: /spoken play | stop | skip | player [minimal|classic|subtitle|none] | transcript [on|off|1|2|reset] | options | reset | diagnostics")
        end
    end
end

-- Pause is kept per character across logins, so a character paused last session is silent this
-- one. Said at login, and again the first time a line waits behind it while nothing is on
-- screen to say so: with subtitles only or voice only, a paused queue and a broken addon look
-- the same.
local pauseReminded = false
local function RemindPaused()
    print("|cff66bbffSpoken:|r " .. L.PAUSED_REMINDER)
end
-- Registered from Enable, not here: this file loads before Callbacks.lua does.
local function WatchPausedQueue()
    Callbacks:Register("CLIP_QUEUED", function()
        if pauseReminded or not SoundQueue:IsPaused() then return end
        local style = Addon:PlayerStyle()
        if style == "none" or style == "subtitle" and not Addon.db.profile.Transcript.Enabled then
            pauseReminded = true
            RemindPaused()
        end
    end)
end

-- AceDB needs the saved variable to exist, which is only true once the client has loaded
-- this addon's file. 1.12 hands an OnEvent handler nothing and sets the globals `event`
-- and `arg1` instead, hence the fallback.
local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", function(_, ev, name)
    ev = ev or event
    if ev == "ADDON_LOADED" and (name or arg1) == AddonFolder then
        Addon:InitDB()
    elseif ev == "PLAYER_LOGIN" then
        Addon:Enable()
        WatchPausedQueue()
        if SoundQueue:IsPaused() then RemindPaused() end
    end
end)

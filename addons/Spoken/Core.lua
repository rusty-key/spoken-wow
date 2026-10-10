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
            -- "subtitle", "minimal" (Small Window), "classic" (Large Window), "dialogueui" or
            -- "none" (the voice alone). Legacy clients start in the window they always had.
            Style = Version.IsAnyLegacy and "classic" or "subtitle",
            -- Forever only: the bronze its own frames wear, on the minimal player's metal.
            BronzeTint = true,
            MinimalWidth = 380,
            -- Per action id, for the ones an addon declared optional. Absent means shown.
            HiddenActions = {},
            DialogueUI = {
                -- Parchment or dark, as DialogueUI is set, changing when it does.
                FollowTheme = true,
                -- When not following: 1 parchment, 2 dark, DialogueUI's own numbers.
                Theme = 1,
                -- Size, text size, lines and expand state are the player's shared settings.
                -- Only as tall as the line's words need, up to the panel's size.
                FitText = true,
            },
        },
        -- The voice language and its fallback, for every module at once (Spoken:GetLanguageChoice).
        -- Unset, each module keeps the choice it had before there was one setting for all.
        Language = {},
        Audio = {
            -- Seconds of quiet between one line and the next, on top of each module's own short
            -- gap: back to back, a new line started before the last had settled.
            LineGap = 1,
            -- The client speaks its own NPC barks on the Dialog channel, over the top of a
            -- line being read. Muting it while we speak belongs to the player: any addon's
            -- clip is the one being talked over. Not on clients without the channel, where
            -- Compat.lua interrupts the bark a different way.
            AutoToggleDialog = (Version.IsLegacyVanilla or Version:IsRetailOrAboveLegacyVersion(60100)) or false,
            -- On, an NPC's own greeting is heard and the lines read off its window wait for it
            -- (GreetingFirst.lua); off, Silence NPC Voices cuts it where a pack has one.
            GreetingFirst = false,
            -- A short sound in the pause between one line and the next (#142): at a quest hub a hand-in
            -- and the next pickup otherwise run together, often in the same NPC's voice.
            -- Off by default, as the queue has always played without it.
            CueBetweenLines = false,
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
            -- How the captions follow the voice: "line", "page" or "off".
            ScrollMode = "line",
            Lines = 2,
            HighlightWord = false,
            FontSize = 16,
            -- The subtitle player's own (UI/Subtitle.lua).
            Typewriter = true,
            -- "letter": each word typed in; "word": each word appears whole.
            TypewriterBy = "letter",
            SubtitleShadow = 0.6,
            SubtitleProgress = true,
            SubtitleScale = 1,
            -- How many sentences the subtitle shows at once, 1 to 4; longer text turns pages.
            SubtitleSentences = 3,
        },
        Minimap = {
            -- LibDBIcon's own: minimapPos, lock, hide, and -- on the modern clients that
            -- have one -- the addon compartment flag. On by default, as it is for the
            -- minimap button; AceDB fills the new key into profiles that predate it.
            LibDBIcon = { showInCompartment = true },
            -- What each mouse button does. "Menu" opens the list; any other value is a
            -- menu entry id, the player's or a source's.
            -- A click on the icon opens the settings, the way most addons' do; the menu is a
            -- right-click away.
            Commands = {
                LeftButton = "Settings",
                MiddleButton = "PlayPause",
                RightButton = "Menu",
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
    self.db = LibStub("AceDB-3.0"):New("SpokenSettings", Defaults)
    -- A saved AutoScroll = false predates ScrollMode: carry it over as "off", in every profile.
    for _, profile in pairs(self.db.sv and self.db.sv.profiles or {}) do
        local transcript = type(profile) == "table" and profile.Transcript
        if type(transcript) == "table" and transcript.AutoScroll ~= nil then
            if transcript.AutoScroll == false and (transcript.ScrollMode or "line") == "line" then
                transcript.ScrollMode = "off"
            end
            transcript.AutoScroll = nil
        end
        -- Style replaces three old switches: SubtitlePlayer, then HideFrame, then MinimalPlayer
        -- choosing the window. Read raw, so an absent switch is its old default.
        local frame = type(profile) == "table" and profile.Frame
        if type(frame) == "table" and frame.Style == nil
            and (frame.SubtitlePlayer ~= nil or frame.HideFrame ~= nil or frame.MinimalPlayer ~= nil) then
            local subtitles = frame.SubtitlePlayer
            if subtitles == nil then subtitles = not Version.IsAnyLegacy end
            if subtitles then frame.Style = "subtitle"
            elseif frame.HideFrame then frame.Style = "none"
            elseif frame.MinimalPlayer == false then frame.Style = "classic"
            else frame.Style = "minimal" end
            frame.SubtitlePlayer, frame.HideFrame, frame.MinimalPlayer = nil, nil, nil
        end
    end
    -- Another profile chosen, copied over this one or reset, from Spoken's page or anywhere
    -- else: its settings apply now rather than at the next reload.
    if self.db.RegisterCallback then
        local function Apply() Addon:ApplyProfile() end
        self.db.RegisterCallback(self, "OnProfileChanged", Apply)
        self.db.RegisterCallback(self, "OnProfileCopied", Apply)
        self.db.RegisterCallback(self, "OnProfileReset", Apply)
    end
end

--- Put the profile's settings into effect: the window or subtitles, the captions, the minimap
--- button, the other sounds' levels, the feature addons' Report and Contribute buttons and the
--- settings page. Each only where it is loaded on this client, and only once Enable has built them.
function Addon:ApplyProfile()
    if not self.enabled then return end
    if PlayerFrame and PlayerFrame.RefreshConfig then PlayerFrame:RefreshConfig() end
    if Transcript and Transcript.RefreshConfig then Transcript:RefreshConfig() end
    if Subtitle and Subtitle.Update then Subtitle:Update() end
    -- Hands LibDBIcon the new profile's table: it keeps the one it was given.
    if Minimap and Minimap.Refresh then Minimap:Refresh() end
    if OtherSounds and OtherSounds.IsAvailable and OtherSounds:IsAvailable() then OtherSounds:RefreshConfig() end
    -- Which modules are on is the profile's too: each puts its buttons back or takes them off,
    -- and what one now off had queued goes, as switching it off on Spoken's page does.
    for key in Sources:Iterate() do Sources:Apply(key) end
    -- The addons that draw their own Report and Contribute buttons redraw only when told.
    Callbacks:Fire("REPORT_SETTINGS_CHANGED")
    Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED")
    if Options and Options.UpdateRows then Options:UpdateRows() end
end

--- One of the profile's settings tables ("Frame", "Transcript"), or its defaults where there is
--- none. AceDB strips a subtable holding only defaults at PLAYER_LOGOUT, and the frames go on
--- updating while the UI is torn down after that; before InitDB there is no profile at all.
function Addon:Profile(section)
    return self.db and self.db.profile[section] or Defaults.profile[section]
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
    if type(global.Layout) ~= "table" then global.Layout = {} end
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

--- Hosted windows still move: ApplyHost keeps their effective scale and their anchor on
--- UIParent, so a place saved while hosted is the same place without the host.
function Addon:IsFrameLocked()
    return self:Profile("Frame").LockFrame
end

--- Put a player frame on the host, or back on UIParent, since a host that hides UIParent
--- (DialogueUI) would hide the player too. The anchor stays on UIParent and the scale keeps
--- the effective scale, so the frame keeps its exact place on screen. spokenBaseScale /
--- spokenBaseStrata give a frame's own scale and strata (the subtitles).
function Addon:ApplyHost(frame)
    if not frame then return end
    local host, cfg = self.playerHost, self:Profile("Frame")
    local base = frame.spokenBaseScale or cfg.FrameScale
    if host then
        frame:SetParent(host)
        frame:SetScale(base * UIParent:GetEffectiveScale() / host:GetEffectiveScale())
        -- Above the host's strata, so it never draws under the dialog it sits over.
        frame:SetFrameStrata("FULLSCREEN")
        frame.spokenHosted = true
    elseif frame.spokenHosted then
        frame:SetParent(UIParent)
        frame:SetScale(base)
        frame:SetFrameStrata(frame.spokenBaseStrata or cfg.FrameStrata)
        frame.spokenHosted = nil
    end
end

function Addon:SetPlayerHost(host)
    if self.playerHost == host then return end
    self.playerHost = host
    if PlayerFrame.frame then PlayerFrame:RefreshConfig() end
    -- RefreshConfig places only the window in use; the others must not stay on the host.
    self:ApplyHost(PlayerFrame.frame)
    self:ApplyHost(MinimalPlayer.frame)
    if DialogueUIPlayer then self:ApplyHost(DialogueUIPlayer.frame) end
    -- The subtitles go over the host too, and pass its clicks through.
    if Subtitle and Subtitle.frame then
        self:ApplyHost(Subtitle.frame)
        Subtitle:Mouse()
    end
end

--- What is on screen: the chosen style, or one previewed from the welcome window or the settings
--- (Options:Preview). The windows and the subtitles ask this; the settings ask PlayerStyle.
function Addon:DisplayStyle()
    return self.previewStyle or self:PlayerStyle()
end

--- The chosen style, or a fallback where it is not on offer: no Small Window on legacy
--- clients, no DialogueUI window without DialogueUI, no subtitles on 1.12. The setting is
--- kept, so installing DialogueUI later brings its window back.
function Addon:PlayerStyle()
    local style = self:Profile("Frame").Style
    if style == "none" or style == "classic" then return style end
    if style == "subtitle" and not Transcript.unavailable then return "subtitle" end
    if style == "dialogueui" and DialogueUITheme and DialogueUITheme:Available() then return "dialogueui" end
    if Version.IsAnyLegacy then return "classic" end
    return "minimal"
end

function Addon:SetPlayerStyle(style)
    self.db.profile.Frame.Style = style
end

--- Everything that needs the world: the frame, the button, the settings, the slash
--- command. Idempotent, so the harness and PLAYER_LOGIN can both call it.
function Addon:Enable()
    if self.enabled then return end
    self:InitDB()
    self.enabled = true
    PlayerFrame:Initialize()
    Transcript:Initialize()
    -- Redraw in the new art when DialogueUI's theme or window size changes.
    DialogueUITheme:Watch(function()
        if Addon:DisplayStyle() == "dialogueui" then PlayerFrame:RefreshConfig() end
    end)
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
            or command == "player none" or command == "player dialogueui" then
            local style = string.sub(command, 8)
            local problem = style == "dialogueui" and DialogueUITheme:Problem()
            if problem then
                print("Spoken: " .. problem)
            else
                Addon:SetPlayerStyle(style)
                PlayerFrame:RefreshConfig()
                Transcript:RefreshConfig()
            end
        elseif command == "options" or command == "settings" then
            Options:Open()
        elseif command == "share" and Gather then
            Spoken:ShowGatherInstructions()
        elseif command == "reset" then
            PlayerFrame:Reset()
            -- Not on 1.12, which has no captions and so no subtitles to move.
            if Subtitle then Subtitle:Reset() end
        elseif command == "log" or string.find(command, "^log ") then
            -- The debug log is the Spoken_Developer module's; this only hands the words on.
            local _, _, rest = string.find(command, "^log%s*(.-)$")
            if Developer.provider then
                Developer:Call("Command", rest)
            else
                print("Spoken: the debug log comes with the Spoken Developer module, which is not installed")
            end
        elseif command == "diagnostics" then
            print(format("Spoken %s, API %d, %d queued, %s", AddonVersion, Spoken.API_VERSION,
                SoundQueue:GetQueueSize(), SoundQueue:IsPaused() and "paused" or "playing"))
            print("  " .. (Developer:Call("Describe") or "debug log: no Spoken Developer module"))
            for key, source in Sources:Iterate() do
                print(format("  source %s (%s)", key, source.addon or "?"))
            end
            for _, line in ipairs(PlayerFrame:Describe()) do print("  " .. line) end
            print("  " .. Transcript:Describe())
            print("  " .. DialogueUITheme:Describe())
            for _, err in ipairs(Callbacks.errors) do print("  callback error: " .. err) end
        else
            print("Spoken: /spoken play | stop | skip | player [minimal|classic|dialogueui|subtitle|none] | transcript [on|off|1|2|reset] | log | options | reset | diagnostics")
        end
    end
end

-- Said the first time a line waits behind a stop with nothing on screen to show it: with subtitles
-- or voice only, a stopped queue looks like a broken addon.
local pauseReminded = false
local function RemindPaused()
    print("|cff66bbffSpoken:|r " .. L.STOPPED_REMINDER)
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

-- The Forever client's gamepad UI takes over every popup as it opens, inside the code that
-- opened it. Opened by an addon, that taints the gamepad's bindings: the next close is blocked,
-- and the "blocked from an action" dialog it raises hangs the client (#165). There the chat line
-- says it alone. pcall, because 1.12 raises on a CVar it has never heard of.
function Addon:IsGamepadUI()
    local ok, style = pcall(GetCVar, "InputDeviceInterfaceStyle")
    return ok and style == "1"
end

-- Folders an older release installed, which nothing ships any more: Spoken's own before it was
-- renamed, and the old names of Quests and Zones, whether the addons themselves or the empty
-- folders that stood in for them. Loaded beside this release, the old code narrates over it and
-- the empty ones only clutter the AddOns list.
--
-- SpokenQuests, SpokenZones and SpokenBooks are the modules' folders before 3.0.0-beta.3 moved
-- them to Spoken_Quests and the rest, out of the way of the retired CurseForge projects that own
-- the old names. A full old copy loads beside the renamed module: the same AceAddon, the same
-- globals and events, a second voice for every line. Their last releases, and the legacy zips,
-- leave a tombstone there instead (addons/SpokenQuests/SpokenQuests.toc), which is LoadOnDemand
-- and so never loaded, so it alone stays quiet here and only a full old copy is named.
--
-- Each one found is switched off for the next login, and the player is offered the reload that
-- finishes it. The Forever client accepts DisableAddOn from an addon (checked 2026-10-04); the
-- pcall is for a client that does not, where the popup still names the folders to delete.
local OLD_FOLDERS = { "SpokenPlayer", "VoiceOverRedux", "ZoneLore", "SpokenQuests", "SpokenZones", "SpokenBooks" }
function Addon:FindOldFolders()
    local found = {}
    if not IsAddOnLoaded then return found end
    for _, folder in ipairs(OLD_FOLDERS) do
        if IsAddOnLoaded(folder) then table.insert(found, folder) end
    end
    return found
end
function Addon:RetireOldFolders()
    local found = self:FindOldFolders()
    if not found[1] then return end
    for _, folder in ipairs(found) do
        if DisableAddOn then pcall(DisableAddOn, folder) end
    end
    local text = format(L.OLD_FOLDERS_FMT, "• " .. table.concat(found, "\n• "))
    print("|cff66bbffSpoken:|r " .. text)
    if StaticPopupDialogs and StaticPopup_Show and not self:IsGamepadUI() then
        -- Left-aligned while shown, for the list: the popup frames are shared by every addon and
        -- centred by default, so the alignment goes back as it closes.
        local function Body(dialog)
            return dialog.text or dialog.Text or (dialog.GetName and _G[dialog:GetName() .. "Text"])
        end
        StaticPopupDialogs.SPOKEN_OLD_FOLDERS = {
            text = text, button1 = L.OLD_FOLDERS_RELOAD, button2 = L.OLD_FOLDERS_LATER,
            OnAccept = function() ReloadUI() end,
            OnShow = function(dialog)
                local body = Body(dialog)
                if body and body.SetJustifyH then body:SetJustifyH("LEFT") end
            end,
            OnHide = function(dialog)
                local body = Body(dialog)
                if body and body.SetJustifyH then body:SetJustifyH("CENTER") end
            end,
            timeout = 0, whileDead = 1, hideOnEscape = 1,
        }
        StaticPopup_Show("SPOKEN_OLD_FOLDERS")
    end
end

--- Game Greeting First was the quests module's setting. On each character's first login it comes
--- over from that character's quests profile, once those settings have loaded. It cannot check
--- for "unset" here: AceDB copies its defaults in, so unset reads as false.
function Addon:TakeGreetingFirstFromQuests()
    local db = self.db
    if not db or db.char.greetingFromQuests then
        return
    end
    db.char.greetingFromQuests = true
    local quests = rawget(_G, "SpokenQuestsSettings")
    if type(quests) ~= "table" or type(quests.profiles) ~= "table" then
        return
    end
    -- The profile AceDB gives the character there: its own key unless it chose another.
    local charKey = db.keys and db.keys.char
    local name = charKey and (type(quests.profileKeys) == "table" and quests.profileKeys[charKey] or charKey)
    local profile = name and quests.profiles[name]
    local audio = type(profile) == "table" and profile.Audio
    if type(audio) == "table" and audio.GreetingFirst == true then
        db.profile.Audio.GreetingFirst = true
    end
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
        Addon:TakeGreetingFirstFromQuests()
        Addon:Enable()
        Addon:RetireOldFolders()
        WatchPausedQueue()
        -- A stop belongs to the line it stopped, which a reload drops, so a session never starts stopped.
        SoundQueue:SetPaused(false)
    end
end)

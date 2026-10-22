setfenv(1, SpokenEnv)

-- What the queue and the windows reach timers and settings through. A plain table with AceTimer
-- embedded, not an AceAddon: the player has no options table to register.
Addon = LibStub("AceTimer-3.0"):Embed({})

-- What feature addons register through API.lua and the UI reads back.
Bullets = {}
Renderers = {}

-- Window Size, Subtitle Size and Text Size: lowest, highest and step, for their sliders and for
-- Ctrl and the mouse wheel over the windows and the subtitles.
SIZES = {
    FrameScale = { 0.5, 2, 0.05 },
    SubtitleScale = { 0.6, 1.6, 0.05 },
    FontSize = { 12, 26, 1 },
}

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
            -- "none" (the voice alone).
            Style = "subtitle",
            -- The windows' metal in the bronze the Forever client's frames wear.
            BronzeTint = true,
            -- The small window's background: "parchment" or "dark" (the rock).
            MinimalBackground = "parchment",
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
            -- A string, because that is what PlaySoundFile takes.
            SoundChannel = "Master",
            -- Seconds of quiet between one line and the next, on top of each module's own short
            -- gap: back to back, a new line started before the last had settled.
            LineGap = 1,
            -- The client speaks its own NPC barks on the Dialog channel, over the top of a
            -- line being read. Muting it while we speak belongs to the player: any addon's
            -- clip is the one being talked over.
            AutoToggleDialog = true,
            -- Off, nothing is queued in a battleground or arena (Addon:ReadsHere).
            ReadInBattlegrounds = true,
            -- A short sound in the pause between one line and the next (#142): at a quest hub a hand-in
            -- and the next pickup otherwise run together, often in the same NPC's voice.
            -- Off by default, as the queue has always played without it.
            CueBetweenLines = false,
            -- The other channels turned down while a line is spoken (OtherSounds.lua), each to
            -- this share of the player's own volume, for the length of a line.
            LowerOthers = {
                Enabled = true,
                Music = 0.3,
                Ambience = 0.4,
                SFX = 0.6,
                Dialog = 1,
            },
            -- The game's Sound in Background turned on while a line speaks (BackgroundSound.lua).
            -- Off, as it plays the game's other sounds in the background too.
            KeepTalkingInBackground = false,
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
            -- Sources whose words are not shown while Enabled, by source key; empty shows every source's.
            WordsOff = {},
            -- How the captions follow the voice: "line", "page" or "off".
            ScrollMode = "line",
            Lines = 2,
            HighlightWord = true,
            FontSize = 16,
            -- The subtitle player's own (UI/Subtitle.lua).
            Typewriter = false,
            -- "letter": each word typed in; "word": each word appears whole.
            TypewriterBy = "letter",
            SubtitleShadow = 0.6,
            SubtitleProgress = false,
            SubtitleName = true,
            SubtitleScroll = "page",
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
            if subtitles ~= false then frame.Style = "subtitle"
            elseif frame.HideFrame then frame.Style = "none"
            elseif frame.MinimalPlayer == false then frame.Style = "classic"
            else frame.Style = "minimal" end
            frame.SubtitlePlayer, frame.HideFrame, frame.MinimalPlayer = nil, nil, nil
        end
    end
    -- Another profile chosen, copied over this one or reset, from Spoken's page or anywhere
    -- else: its settings apply now rather than at the next reload.
    if self.db.RegisterCallback then
        local function Apply()
            Addon:RebindModules()
            Addon:ApplyProfile()
        end
        self.db.RegisterCallback(self, "OnProfileChanged", Apply)
        self.db.RegisterCallback(self, "OnProfileCopied", Apply)
        self.db.RegisterCallback(self, "OnProfileReset", Apply)
    end
end

local function CopyOf(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, inner in pairs(value) do copy[key] = CopyOf(inner) end
    return copy
end

--- Point a feature addon at its settings table inside the current profile. These settings were
--- account-wide before they were in the profile, and every character has a profile of its own, so
--- the first time the table the addon kept itself (`legacy`, minus the keys named in `skip`) is
--- copied to `global.ModulesLegacy` and left alone from then on. A profile with no table of its
--- own gets a copy of that at login, whichever character that is; one made, copied over or reset
--- later starts from the addon's defaults. The keys keep their names. `bind` is called with the
--- table now and again whenever another profile is chosen, copied over this one or reset.
function Addon:BindModuleSettings(name, legacy, bind, skip)
    self.boundModules = self.boundModules or {}
    self.boundModules[name] = { legacy = legacy, bind = bind, skip = skip }
    local db = self.db
    if db then
        if type(db.global.ModulesLegacy) ~= "table" then db.global.ModulesLegacy = {} end
        if type(db.global.ModulesLegacy[name]) ~= "table" then
            local saved = {}
            for key, value in pairs(type(legacy) == "table" and legacy or {}) do
                if not (skip and skip[key]) then saved[key] = CopyOf(value) end
            end
            db.global.ModulesLegacy[name] = saved
        end
    end
    return self:BindModule(name, true)
end

--- `atLogin`: a profile with no table of its own takes the saved one, instead of the defaults.
function Addon:BindModule(name, atLogin)
    local entry = self.boundModules and self.boundModules[name]
    if not (entry and self.db) then return false end
    local profile = self.db.profile
    if type(profile.Modules) ~= "table" then profile.Modules = {} end
    local settings = profile.Modules[name]
    if type(settings) ~= "table" then
        local saved = atLogin and self.db.global.ModulesLegacy and self.db.global.ModulesLegacy[name]
        settings = CopyOf(type(saved) == "table" and saved or {})
        profile.Modules[name] = settings
    end
    entry.bind(settings)
    return true
end

function Addon:RebindModules()
    for name in pairs(self.boundModules or {}) do self:BindModule(name, false) end
end

--- Put the profile's settings into effect: the window or subtitles, the captions, the minimap
--- button, the other sounds' levels, the feature addons' Report and Contribute buttons and the
--- settings page. Each only where it is loaded on this client, and only once Enable has built them.
function Addon:ApplyProfile()
    if not self.enabled then return end
    if PlayerFrame and PlayerFrame.RefreshConfig then PlayerFrame:RefreshConfig() end
    if Transcript and Transcript.RefreshConfig then Transcript:RefreshConfig() end
    Subtitle:Update()
    -- Hands LibDBIcon the new profile's table: it keeps the one it was given.
    if Minimap and Minimap.Refresh then Minimap:Refresh() end
    if OtherSounds and OtherSounds.IsAvailable and OtherSounds:IsAvailable() then OtherSounds:RefreshConfig() end
    if BackgroundSound and BackgroundSound.Sync then BackgroundSound:Sync() end
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

--- Draws a clip's text in its `present.font`, for a script the game's font has no glyphs for
--- (Czech on a Western client), and any other clip's in the font string's own face. The size
--- and flags stay the player's.
function Addon:ClipFont(fontString, clip)
    local face, size, flags = fontString:GetFont()
    if not face then return end
    -- Anything but the face this set last is the player's own (a skin, a resize), so it is
    -- the one to go back to.
    if face ~= fontString.spokenClipFace then fontString.spokenOwnFace = face end
    local want = clip and clip.present and clip.present.font or fontString.spokenOwnFace
    -- Asked for last time and still on: done, also when that face failed and the player's
    -- own stands in, rather than trying it again on every update.
    if face == fontString.spokenClipFace and want == fontString.spokenClipWant then return end
    local asked = want
    -- A face the client cannot load: current clients answer false, older ones nil or nothing, so
    -- the face it reports afterwards is asked too. Back to the player's own rather than a
    -- string with no font.
    if want ~= face and (fontString:SetFont(want, size, flags or "") == false or not fontString:GetFont()) then
        want = fontString.spokenOwnFace
        fontString:SetFont(want, size, flags or "")
    end
    -- The face as the client reports it, since that is what the next call reads back, and the
    -- client need not spell a path the way it was given.
    fontString.spokenClipWant, fontString.spokenClipFace = asked, fontString:GetFont() or want
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

function Addon:Bronze()
    return self:Profile("Frame").BronzeTint ~= false
end

--- False in a battleground or arena with Read in Battlegrounds off. Every module's lines are
--- queued through Sources.lua's Enqueue, which asks this unless the player asked for the line.
function Addon:ReadsHere()
    if self:Profile("Audio").ReadInBattlegrounds ~= false or not IsInInstance then
        return true
    end
    local _, kind = IsInInstance()
    return kind ~= "pvp" and kind ~= "arena"
end

--- What was queued before the loading screen is not read in a battleground either.
function Addon:StopWhereNotRead()
    if self.enabled and not self:ReadsHere() then
        SoundQueue:RemoveAllSoundsFromQueue()
    end
end

--- Put a player frame on the host, or back on UIParent, since a host that hides UIParent
--- (DialogueUI) would hide the player too. The anchor stays on UIParent and the scale keeps
--- the effective scale, so the frame keeps its exact place on screen. spokenBaseScale /
--- spokenBaseStrata give a frame's own scale and strata (the subtitles).
function Addon:ApplyHost(frame)
    if not frame then return end
    -- A window drawn as one image must not move while it fades: it moves once it is itself again.
    if frame.spokenFrozen then
        frame.spokenHostPending = true
        -- Hidden with the host it leaves, it never ticks to its fade's end: ended now, unseen.
        if frame.spokenEndFade and not frame:IsVisible() then frame.spokenEndFade() end
        return
    end
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
    if Subtitle.frame then
        self:ApplyHost(Subtitle.frame)
        Subtitle:Mouse()
    end
end

--- Whether the window or subtitles show `clip`: Show Narrator is on, and not off for the clip's module.
--- The voice plays either way.
function Addon:ShowsNarrator(clip)
    local cfg = self.db.profile.Transcript
    local key = clip and clip.source and clip.source.key
    return cfg.Enabled and not (key and cfg.WordsOff[key])
end

--- What is on screen: the chosen style, or one previewed from the welcome window or the settings
--- (Options:Preview). The windows and the subtitles ask this; the settings ask PlayerStyle.
function Addon:DisplayStyle()
    return self.previewStyle or self:PlayerStyle()
end

--- The chosen style, or a fallback where it is not on offer: no DialogueUI window without
--- DialogueUI. The setting is kept, so installing DialogueUI later brings its window back.
function Addon:PlayerStyle()
    local style = self:Profile("Frame").Style
    if style == "none" or style == "classic" then return style end
    if style == "subtitle" then return "subtitle" end
    if style == "dialogueui" and DialogueUITheme and DialogueUITheme:Available() then return "dialogueui" end
    return "minimal"
end

function Addon:SetPlayerStyle(style)
    self.db.profile.Frame.Style = style
end

--- What Spoken itself says for a report: its version, the queue, the window and the modules
--- registered. Each module's own follows it in Options:ShowDiagnostics.
function Addon:PrintDiagnostics()
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
end

local function RegisterSlashCommand()
    -- Through _G, not bare. Every file here runs inside a private environment whose
    -- metatable falls back to _G: reads fall through, writes do not. A bare assignment
    -- lands in the environment, and the client never hears of the command.
    -- One scheme across the three addons: the long name and a two-or-three letter short
    -- form. /sp here, /spq for quests, /spp for places.
    _G.SLASH_SPOKEN1 = "/spoken"
    _G.SLASH_SPOKEN2 = "/sp"
    -- Spoken's page, drawn again for a setting changed here; not there on a client without it.
    local function Redraw() if Options.UpdateRows then Options:UpdateRows() end end
    -- The narrator styles by the words the settings use for them, and by the names they are
    -- stored under, which /sp player took before.
    local STYLES = { subtitles = "subtitle", subtitle = "subtitle", small = "minimal", minimal = "minimal",
        large = "classic", classic = "classic", dialogueui = "dialogueui", voice = "none", none = "none" }
    local function SetStyle(name)
        local style = STYLES[name]
        if not style then return false end
        local problem = style == "dialogueui" and DialogueUITheme:Problem()
        if problem then
            print("Spoken: " .. problem)
        else
            Addon:SetPlayerStyle(style)
            PlayerFrame:RefreshConfig()
            Transcript:RefreshConfig()
            Redraw()
        end
        return true
    end
    -- What /sp help lists: each command by the name its setting or key binding has on Spoken's
    -- page. The words before the colon are the command's own.
    local function Help()
        local lines = {
            { "/sp replay", L.BIND_PLAYPAUSE },
            { "/sp skip", L.BIND_SKIP },
            { "/sp stopall", L.BIND_STOP },
            { "/sp style subtitles | small | large | dialogueui | voice", L.OPT_PLAYER_STYLE },
            { "/sp narrator on | off", L.OPT_SHOW_NARRATOR },
            { "/sp rows 1 | 2", L.TRANSCRIPT_LINES },
            { "/sp compendium", L.OPT_COMPENDIUM_OPEN },
            { "/sp reset", L.OPT_RESET },
            { "/sp diagnostics", L.OPT_DIAGNOSTICS },
            { "/sp settings", L.SETTINGS },
        }
        table.insert(lines, { "/sp collect", L.OPT_GATHER })
        table.insert(lines, { "/sp send", L.OPT_GATHER_SHARE })
        if Developer.provider then table.insert(lines, { "/sp log", "Spoken Developer" }) end
        print("|cff66bbffSpoken|r")
        for _, line in ipairs(lines) do print("  " .. line[1] .. ": " .. line[2]) end
    end
    SlashCmdList.SPOKEN = function(input)
        local command = strlower(strtrim(input or ""))
        local _, _, verb, rest = string.find(command, "^(%S*)%s*(.-)$")
        -- play, pause and stop are the words Bindings.xml and players' macros send: kept.
        if command == "replay" or command == "play" or command == "pause" or command == "" then
            SoundQueue:TogglePauseQueue()
        elseif command == "stopall" or command == "stop" then
            SoundQueue:RemoveAllSoundsFromQueue()
        elseif command == "skip" then
            SoundQueue:Skip()
        elseif command == "compendium" then
            Options:ToggleCompendium()
        elseif (verb == "narrator" or verb == "words" or verb == "transcript") and (rest == "" or rest == "on" or rest == "off") then
            if rest == "" then
                Transcript:SetEnabled(not Addon.db.profile.Transcript.Enabled)
            else
                Transcript:SetEnabled(rest == "on")
            end
            Redraw()
        elseif (verb == "rows" or verb == "transcript") and (rest == "1" or rest == "2") then
            Addon.db.profile.Transcript.Lines = tonumber(rest)
            Transcript:RefreshConfig()
            Redraw()
        elseif command == "transcript reset" then
            Transcript:Reset()
        elseif (verb == "style" or verb == "player") and SetStyle(rest) then
            -- SetStyle did it.
        elseif command == "settings" or command == "options" then
            Options:Open()
        elseif (command == "send" or command == "share") and Gather then
            Spoken:ShowGatherInstructions()
        elseif command == "collect" and Gather then
            Gather:SetEnabled(not Gather:IsEnabled())
            print("Spoken: " .. L.OPT_GATHER .. " " .. (Gather:IsEnabled() and L.ON or L.OFF))
            Redraw()
        elseif command == "reset" then
            Options:ResetPositions()
        elseif verb == "log" then
            -- The debug log is the Spoken_Developer module's; this only hands the words on.
            if Developer.provider then
                Developer:Call("Command", rest)
            else
                print("Spoken: the debug log comes with the Spoken Developer module, which is not installed")
            end
        elseif command == "diagnostics" then
            Options:ShowDiagnostics()
        else
            Help()
        end
    end
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
    RegisterSlashCommand()
end

-- Said the first time a line waits behind a stop with nothing on screen to show it: with voice
-- only, or Show Narrator off for the line, a stopped queue looks like a broken addon.
local pauseReminded = false
-- Registered at login, not at load: this file loads before Callbacks.lua does.
local function WatchPausedQueue()
    Callbacks:Register("CLIP_QUEUED", function(clip)
        if pauseReminded or not SoundQueue:IsPaused() then return end
        if Addon:PlayerStyle() == "none" or not Addon:ShowsNarrator(clip) then
            pauseReminded = true
            print("|cff66bbffSpoken:|r " .. L.STOPPED_REMINDER)
        end
    end)
end

-- The Forever client's gamepad UI takes over every popup as it opens, inside the code that
-- opened it. Opened by an addon, that taints the gamepad's bindings: the next close is blocked,
-- and the "blocked from an action" dialog it raises hangs the client (#165). There the chat line
-- says it alone.
function Addon:IsGamepadUI()
    return GetCVar("InputDeviceInterfaceStyle") == "1"
end

-- Folders an older release installed, which nothing ships any more: Spoken's own before it was
-- renamed, and the old names of Quests and Zones, whether the addons themselves or the empty
-- folders that stood in for them. Loaded beside this release, the old code narrates over it and
-- the empty ones only clutter the AddOns list.
--
-- SpokenQuests, SpokenZones and SpokenBooks are the modules' folders before 3.0.0-beta.3 moved
-- them to Spoken_Quests and the rest, out of the way of the retired CurseForge projects that own
-- the old names. A full old copy loads beside the renamed module: the same AceAddon, the same
-- globals and events, a second voice for every line. An empty folder an older release left there
-- is LoadOnDemand and so never loaded, so it stays quiet here and only a full old copy is named.
--
-- Spoken_Books and Spoken_Writings are the Readables module's folders before it took that name, and
-- Spoken_Zones the Places module's. An older zip unpacked by hand leaves one beside its module, where
-- it registers the same source and reads every page twice.
--
-- Each one found is switched off for the next login, and the player is offered the reload that
-- finishes it. The Forever client accepts DisableAddOn from an addon (checked 2026-10-04); the
-- pcall is for a client that does not, where the popup still names the folders to delete.
local OLD_FOLDERS = { "SpokenPlayer", "VoiceOverRedux", "ZoneLore", "SpokenQuests", "SpokenZones", "SpokenBooks",
    "Spoken_Books", "Spoken_Zones", "Spoken_Writings" }
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

-- The Audio table of the profile the quests module gives this character, as saved; nil without one.
local function QuestsAudio(db)
    local quests = rawget(_G, "SpokenQuestsSettings")
    if type(quests) ~= "table" or type(quests.profiles) ~= "table" then
        return nil
    end
    -- The profile AceDB gives the character there: its own key unless it chose another.
    local charKey = db.keys and db.keys.char
    local name = charKey and (type(quests.profileKeys) == "table" and quests.profileKeys[charKey] or charKey)
    local profile = name and quests.profiles[name]
    local audio = type(profile) == "table" and profile.Audio
    return type(audio) == "table" and audio or nil
end

--- The voice language and the fallback were set on the quests page; they are Spoken's now. On each
--- character's first login with the quests settings loaded, that character's choice there is copied
--- to the profile it is on, unless that profile has one of its own, so the page shows what is being
--- heard. The quests settings are not loaded while that module is off: nothing is marked then, and
--- the next login that has them does it.
function Addon:TakeVoiceLanguageFromQuests()
    local db = self.db
    if not db or db.char.voiceLanguageFromQuests then
        return
    end
    local quests = rawget(_G, "SpokenQuestsSettings")
    if type(quests) ~= "table" or type(quests.profiles) ~= "table" then
        return
    end
    db.char.voiceLanguageFromQuests = true
    local audio = QuestsAudio(db)
    local language = db.profile.Language
    if not (audio and language) or language.Voice ~= nil or language.Fallback ~= nil then
        return
    end
    if type(audio.VoiceLanguage) == "string" and audio.VoiceLanguage ~= "auto" then
        language.Voice = audio.VoiceLanguage
    end
    if type(audio.FallbackLanguage) == "string" and audio.FallbackLanguage ~= "enUS" then
        language.Fallback = audio.FallbackLanguage
    end
end

-- AceDB needs the saved variable to exist, which is only true once the client has loaded
-- this addon's file.
local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:RegisterEvent("PLAYER_LOGIN")
loader:RegisterEvent("PLAYER_ENTERING_WORLD")
loader:SetScript("OnEvent", function(_, ev, name)
    if ev == "ADDON_LOADED" and name == AddonFolder then
        Addon:InitDB()
    elseif ev == "PLAYER_ENTERING_WORLD" then
        Addon:StopWhereNotRead()
    elseif ev == "PLAYER_LOGIN" then
        Addon:TakeVoiceLanguageFromQuests()
        Addon:Enable()
        Addon:RetireOldFolders()
        WatchPausedQueue()
        -- A stop belongs to the line it stopped, which a reload drops, so a session never starts stopped.
        SoundQueue:SetPaused(false)
    end
end)

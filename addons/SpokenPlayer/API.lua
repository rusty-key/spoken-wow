setfenv(1, SpokenEnv)

-- The public surface. Everything a feature addon may rely on is defined in this file;
-- nothing else on `Spoken` is a contract, and nothing here writes anywhere but `Spoken`.
--
-- API_VERSION moves only on a breaking change. A feature addon's entire hard requirement
-- is `_G.Spoken and Spoken:IsCompatible(1)`. A copy bundled into a legacy-client zip may
-- lag the one an addon manager installs, so this is what lets the two disagree safely.
Spoken.API_VERSION = 1
Spoken.ADDON_VERSION = AddonVersion

---@param required number The API_VERSION the caller was written against.
function Spoken:IsCompatible(required)
    return type(required) == "number" and required <= self.API_VERSION
end

--------------------------------------------------------------------------------
-- Sources: how a feature addon joins the player. See Sources.lua for the info shape.
--------------------------------------------------------------------------------

---@param key string  "quests" | "zones" | "books"
---@param info SpokenSourceInfo
---@return table source  Carries Enqueue, PlayNow, Remove, StopAll, AddGate, CanPlay,
---                      SetQueueLimit and SetInterClipGap.
function Spoken:RegisterSource(key, info)
    return Sources:Register(key, info)
end

function Spoken:GetSource(key)
    return Sources:Get(key)
end

--- Iterates `key, source` in menu order.
function Spoken:IterateSources()
    return Sources:Iterate()
end

--------------------------------------------------------------------------------
-- Clips and presentation
--------------------------------------------------------------------------------
--
-- A clip is what a source enqueues. The caller owns the file and the duration; the player
-- never resolves a path.
--
--   clip = {
--     key      = "q:33:accept",               -- caller-unique; the dedup key
--     path     = [[Interface\AddOns\...\x.ogg]],
--     length   = 3.4,                         -- seconds; the client cannot report this
--     delay    = nil,                         -- silence before; only 2.4.3/3.3.5 set it
--     priority = "normal" | "low",            -- low yields at the door; gossip is low
--     present  = {
--       header   = "Eagan Peltskinner",       -- NPC name | zone name | book title
--       label    = "Wolves Across the Border",-- quest title | subzone | page label
--       transcript = "Full dialogue text",   -- optional; falls back to clip.text
--       bullet   = "quest-accept",            -- a RegisterBullet id
--       tint     = { r, g, b },               -- optional row tint
--       portrait = { kind = "model", creatureID = 196 }
--                | { kind = "texture", texture = [[...]], texCoord = { l, r, t, b } }
--                | { kind = "none" },
--       actions  = { { id, text, tooltip, visible, onClick, create }, ... },
--     },
--     addedCallback = fun(clip), startCallback = fun(clip),
--     stopCallback  = fun(clip, finishedPlaying),
--   }
--
-- The player sets id, handle, source and nextSoundTimer; a caller never does.

--- A row bullet, registered once by a feature addon so SpokenBooks needs no change to
--- the player to have one of its own.
--- Declare an action switchable, and what the player's settings should call it. Both
--- shipped addons declare their Report action, so one setting covers whichever is speaking.
---@param id string the action id, as it appears in a clip's presentation
---@param label string what to call it, e.g. "Report"
function Spoken:RegisterOptionalAction(id, label)
    return Actions:RegisterOptional(id, label)
end

function Spoken:RegisterBullet(id, texture, size)
    Bullets[id] = { texture = texture, size = size }
end

function Spoken:GetBullet(id)
    return Bullets[id]
end

--- A portrait renderer: { Acquire(portrait, parent) -> frame, Update(frame, clip) -> bool,
--- Release(frame) }. Acquire/Release exist because 1.12 and 2.4.3 pool DressUpModel
--- frames, and the pooling has to live somewhere. "texture", "model" and "none" ship with
--- the player.
function Spoken:RegisterPortraitRenderer(kind, renderer)
    Renderers[kind] = renderer
end

function Spoken:GetPortraitRenderer(kind)
    return Renderers[kind]
end

--- Ask the client about a creature whose portrait may soon be drawn, so the minimal player
--- has its face by then rather than the book while the client fetches it. A no-op in the
--- other layout, which draws a 3D model and needs nothing ahead of time.
function Spoken:PrimePortrait(creatureID)
    if MinimalPlayer and MinimalPlayer:IsEnabled() then StaticPortrait:Prime(creatureID) end
end

--------------------------------------------------------------------------------
-- Contributions: sending text the corpus does not have
--------------------------------------------------------------------------------
--
-- Additive, so API_VERSION does not move. A feature addon guards on the field rather than the
-- version: `if Spoken.Contribute and Spoken.ShowContribution then`. A legacy-client zip may
-- bundle a player older than the addon beside it, and that player should mean no contribute
-- button, not an error.
--
-- The same goes for the setting that hides those buttons: guard on the method, and an older
-- player without it simply means the buttons are shown.

--- Whether the player turned every Contribute button off in the Spoken Player settings.
--- A feature addon asks this in its gap check, and re-asks on CONTRIBUTE_SETTINGS_CHANGED.
function Spoken:AreContributeButtonsHidden()
    return Addon.db and Addon.db.profile.Contribute.HideButtons and true or false
end

--------------------------------------------------------------------------------
-- The frame, the minimap button, the settings
--------------------------------------------------------------------------------

--- The player window, for a feature addon that must anchor something to it.
function Spoken:GetPlayerFrame()
    if MinimalPlayer:IsEnabled() then return MinimalPlayer.frame end
    return PlayerFrame.frame
end

--- The Settings category, so a feature addon can nest its panel under it with
--- Settings.RegisterCanvasLayoutSubcategory. Nil on clients without the Settings API.
function Spoken:GetSettingsCategory()
    return Options.category
end

function Spoken:OpenSettings()
    Options:Open()
end

--- Re-read the speaking clip's presentation -- after a setting changed an action's
--- label, say. Cheap; the frame rebuilds from the queue every time anyway.
function Spoken:RefreshPlayer()
    PlayerFrame:Update()
end

--- A feature addon's settings page, shown under Spoken's own in the game's settings as `name`,
--- listed in `order` (Quests 1, Readables 2, Zones 3). Pass the page's SpokenLayout and its
--- scroller to make its rows searchable from Home. Returns a table whose `category` is
--- filled in once the page is registered, for Settings.OpenToCategory; nil where the client
--- cannot nest pages, in which case the addon registers a top-level page as before.
function Spoken:AddSettingsPage(panel, name, order, layout, scroller)
    return Options:AddPage(panel, name, order, layout, scroller)
end

--- Whether a part of Spoken is switched on in the settings (Sources:IsTurnedOff), for the
--- switch each feature addon puts at the top of its own page. `key` is its source key.
function Spoken:IsPartOn(key)
    return not Sources:IsTurnedOff(Sources:Get(key) or { key = key })
end

--- How a part stands, as a state ("ok", "warn", "off") and the words for it: not installed,
--- switched off, or how many voice packs it found. For the line at the top of its own page.
function Spoken:PartStatus(key)
    return Options:PartStatus(key)
end

--- A module's voice packs, as its card and its page show them: how many of them it has
--- (PartVoice, "Voice Pack ... 2/4"), and which, by name (PartVoiceNames). Each returns a kind,
--- the words, the value and the value's kind.
function Spoken:PartVoice(key)
    return Options:PartVoice(key)
end

function Spoken:PartVoiceNames(key)
    return Options:PartVoiceNames(key)
end

--- How Spoken's settings are laid out: "pages", each page an entry nested under Spoken in the
--- game's settings list, on a client with the settings canvas; nil without one.
function Spoken:SettingsStyle()
    if not (Settings and Settings.RegisterCanvasLayoutCategory) then return nil end
    return "pages"
end

--- The voice language and the fallback the player chose for every module, as stored: "auto"
--- or a language code, and a language code or "none". Either is nil while the player has not
--- chosen it here, and the module then keeps its own.
function Spoken:GetLanguageChoice()
    local language = Addon.db and Addon.db.profile.Language
    if not language then return nil, nil end
    return language.Voice, language.Fallback
end

function Spoken:SetPartOn(key, on)
    Sources:SetTurnedOff(key, not on)
    -- Home lists the same switch.
    Options:UpdateRows()
end

--- A button on the player's panel that opens a feature addon's own settings, for the
--- addons whose panel cannot be nested.
function Spoken:AddSettingsLink(text, onClick)
    Options:AddLink(text, onClick)
end

--- Menu entries for the one minimap button. entry = { id, text, icon, order, onClick,
--- tooltip, visible }.
Spoken.Minimap = {}
function Spoken.Minimap:AddEntry(sourceKey, entry)
    Minimap:AddEntry(sourceKey, entry)
end
function Spoken.Minimap:RemoveEntry(sourceKey, id)
    Minimap:RemoveEntry(sourceKey, id)
end

--------------------------------------------------------------------------------
-- The queue, player-wide. Source-scoped operations live on the source.
--------------------------------------------------------------------------------

--- The head: speaking, paused, or held by a gate. Queue rows read this.
function Spoken:GetCurrent()
    return SoundQueue:GetCurrentSound()
end

--- The head only if it is speaking or paused mid-clip. Controls read this: a held clip
--- sits at the head making no sound, and offering Pause over silence lies.
function Spoken:GetNowPlaying()
    return SoundQueue:GetNowPlaying()
end

--- A shallow copy.
function Spoken:GetQueue()
    return SoundQueue:GetQueue()
end

function Spoken:GetQueueSize()
    return SoundQueue:GetQueueSize()
end

--- Excludes the speaking head.
function Spoken:GetWaitingCount()
    return SoundQueue:GetWaitingCount()
end

function Spoken:IsPlaying(clip)
    return SoundQueue:IsPlaying(clip)
end

function Spoken:IsPaused()
    return SoundQueue:IsPaused()
end

function Spoken:GetHeldReason(clip)
    return SoundQueue:GetHeldReason(clip)
end

--- Pause is stop, and resume replays from the start: the client has no seek.
function Spoken:Pause()
    return SoundQueue:PauseQueue()
end

function Spoken:Resume()
    return SoundQueue:ResumeQueue()
end

function Spoken:TogglePause()
    return SoundQueue:TogglePauseQueue()
end

--- The player's round button, the same one its subtitle shows, for a feature addon's own
--- window: `kind` "play" (Play's glyph; `button:SetPlaying(on)` shows Pause while a line
--- speaks), "report" (the bug), or "icon" (the texture `icon`, cut round). Anchor it and give
--- it OnClick yourself.
function Spoken:CreateRoundButton(parent, kind, name, icon)
    return Actions.NewRound(parent, kind, name, icon)
end

--- End the head; the backlog runs.
function Spoken:Skip()
    return SoundQueue:Skip()
end

--- Everything, every source, and the paused flag with it.
function Spoken:StopAll()
    SoundQueue:RemoveAllSoundsFromQueue()
end

--- A gate that applies to every source: fn(clip) -> reason | nil.
--- Switch a channel off on a source's behalf, e.g. Dialog while a quest line speaks.
--- Unlike a channel the user disabled, clips on it are still admitted, and the mute is
--- lifted before one plays.
function Spoken:MuteChannel(channel, muted)
    SoundUtils:MuteChannel(channel, muted)
end

--- The source is about to queue a line: silence the game's NPC dialogue now rather than
--- when the line starts, so an NPC's greeting is never heard instead of being cut short.
--- Honours the player's "mute game dialogue" setting, and lifts itself if nothing comes.
function Spoken:MuteGameDialogueAhead(source)
    SoundQueue:MuteGameDialogueAhead(source:GetChannel())
end

function Spoken:AddGate(fn)
    SoundQueue:AddGate(fn)
end

--------------------------------------------------------------------------------
-- Callbacks
--------------------------------------------------------------------------------
--
--   AUDIO_CHANGED      ()                  coarse; after every mutation
--   CLIP_QUEUED        (clip)
--   CLIP_STARTED       (clip)
--   CLIP_STOPPED       (clip, finishedPlaying)
--   CLIP_DROPPED       (clip, reason)      queue-limit | outranked | missing | an admit reason
--   QUEUE_EMPTY        ()
--   SOURCE_REGISTERED  (source)
--   CONTRIBUTE_SETTINGS_CHANGED ()          the hide-Contribute-buttons setting was toggled

function Spoken:RegisterCallback(event, fn)
    return Callbacks:Register(event, fn)
end

function Spoken:UnregisterCallback(handle)
    Callbacks:Unregister(handle)
end

--------------------------------------------------------------------------------
-- Packs
--------------------------------------------------------------------------------
--
-- A registry convention, not a resolver: each feature addon owns discovering and
-- resolving its own packs, and the player only ever sees a clip's path. This gives new
-- packs one place to register and one shared utility for the TOC-key scan.

Spoken.Packs = { bySource = {} }

function Spoken.Packs:Register(sourceKey, folderName, pack)
    self.bySource[sourceKey] = self.bySource[sourceKey] or {}
    self.bySource[sourceKey][folderName] = pack
end

--- Unsorted; the source ranks them.
function Spoken.Packs:Get(sourceKey)
    local list = {}
    for _, pack in pairs(self.bySource[sourceKey] or {}) do
        table.insert(list, pack)
    end
    return list
end

--- Every installed addon whose TOC carries `tocKey`, as an iterator over
--- `index, folderName, value`. The reusable half of the quests addon's DataModules
--- scan, wrapping the GetAddOnMetadata / C_AddOns split.
function Spoken:EnumerateAddonsWithKey(tocKey)
    local numAddons = C_AddOns and C_AddOns.GetNumAddOns and C_AddOns.GetNumAddOns() or GetNumAddOns()
    local getInfo = C_AddOns and C_AddOns.GetAddOnInfo or GetAddOnInfo
    local getMeta = C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
    local i = 0
    return function()
        while i < numAddons do
            i = i + 1
            local value = getMeta(i, tocKey)
            if value and value ~= "" then
                local folder = getInfo(i)
                return i, folder, value
            end
        end
    end
end

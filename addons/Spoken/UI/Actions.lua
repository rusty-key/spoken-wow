setfenv(1, SpokenEnv)

-- The buttons the speaking clip's presentation brings beside a window's own Stop or Replay and
-- Skip: every module's Report. The player lays them out and knows nothing about what they do.
--
--   action = { id, icon,
--              tooltip = fun(GameTooltip), label = L.OPT_REPORT_PROBLEM?, -- its name in a menu
--              visible = fun():boolean, onClick = fun(clip), anchor = "header" | "topright"?,
--              create = fun(parent):Button?, onClipChanged = fun(clip, button)? }
--
-- `create` builds the button instead of the round icon, and such a button keeps its own
-- OnClick; the player only tells it which clip it now stands beside.
Actions = {}

local function Clamp01(n) return math.max(0, math.min(1, tonumber(n) or 0)) end

local ART = [[Interface\AddOns\Spoken\Textures\]]

-- Actions an addon has declared optional, in the order declared: { id, label }. The player
-- offers a setting for each, named by the addon, and never learns what the action does.
Actions.optional = {}

--- Declare that an action may be switched off, and what to call it in the settings.
function Actions:RegisterOptional(id, label)
    for _, entry in ipairs(self.optional) do
        if entry.id == id then
            entry.label = label or entry.label
            return entry
        end
    end
    local entry = { id = id, label = label or id }
    table.insert(self.optional, entry)
    return entry
end

function Actions:Build(frame)
    frame.actions = { buttons = {}, byId = {} }
end

-- SettingsButton with the dark middle at 90%, so the round buttons let a little of what is behind show.
local RING = ART .. "SettingsButtonSoft"
-- A round button's glyph at rest; 1 under the pointer.
local GLYPH_ALPHA = 0.85
-- How much brighter a square Play button's border is under the pointer (added over itself).
local BOX_LIT = 0.7
-- The Forever client's bronze, as its own frames wear it: the round buttons' rings and the small
-- window's metal take it while Bronze Border is on. Every ring made, to tint again when the setting
-- changes.
local BRONZE = Version.Variant == "forever" and { .95, .68, .35 } or nil
Actions.BRONZE = BRONZE
local rings = setmetatable({}, { __mode = "k" })

--- The bronze while Bronze Border is on, on Forever; nil otherwise. Every tint asks this.
function Actions.Bronze()
    if BRONZE and Addon.db and Addon:Bronze() then return BRONZE end
    return nil
end

local function TintRing(ring)
    local bronze = Actions.Bronze()
    if bronze then
        ring:SetVertexColor(bronze[1], bronze[2], bronze[3])
    else
        ring:SetVertexColor(1, 1, 1)
    end
end

--- Every round button's ring in the bronze, or out of it, as Bronze Border now says.
function Actions.RefreshRings()
    for ring in pairs(rings) do TintRing(ring) end
end

--- `ring`, a portrait's ring, tinted with the round buttons' from now on.
function Actions.TintWithRings(ring)
    rings[ring] = true
    TintRing(ring)
end

--- Dress `button` as the player's round buttons are -- the windows' pause, the subtitle's
--- controls: the ring round its edge, `icon` inside it, brighter under the pointer. Sized by the
--- button, so a corner icon and a subtitle control are the same button at different sizes. With
--- `own`, the caller squares the button in EllesmereUI's look once all its parts exist.
function Actions.RoundIcon(button, icon, own)
    local ring = button:CreateTexture(nil, "BACKGROUND")
    ring:SetTexture(RING)
    ring:SetPoint("TOPLEFT", button, "TOPLEFT", -3, 3)
    ring:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", 3, -3)
    rings[ring] = true
    TintRing(ring)
    local glyph = button:CreateTexture(nil, "ARTWORK")
    glyph:SetPoint("TOPLEFT", button, "TOPLEFT", 4, -4)
    glyph:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", -4, 4)
    if icon then glyph:SetTexture(icon) end
    glyph:SetAlpha(GLYPH_ALPHA)
    -- Brighter under the pointer; a disabled button keeps the dimmer look it was given.
    button:HookScript("OnEnter", function() if button:IsEnabled() then glyph:SetAlpha(1) end end)
    button:HookScript("OnLeave", function() if button:IsEnabled() then glyph:SetAlpha(GLYPH_ALPHA) end end)
    button.ring, button.glyph = ring, glyph
    if Ellesmere and not own then Ellesmere:When(function(skin) Actions.Square(skin, button) end) end
    return button
end

-- Whether `button` keeps its ring in EllesmereUI's look: on the DialogueUI window and DialogueUI's
-- own windows, which keep DialogueUI's look.
local function KeepsRound(button)
    local frame = button
    while frame do
        if frame.spokenRound == true or frame == _G.DUIQuestFrame or frame == _G.DUIBookFrame then return true end
        frame = frame.GetParent and frame:GetParent() or nil
    end
    return false
end

--- A round button as one of EllesmereUI's square buttons, its glyph or picture kept, square too.
function Actions.Square(skin, button)
    if button.squared or KeepsRound(button) then return end
    button.squared = true
    if button.mask and button.glyph.RemoveMaskTexture then button.glyph:RemoveMaskTexture(button.mask) end
    skin.Button(button, { "glyph", "bar" })
end

-- Big enough to aim at and to read as a bug rather than a smudge; and the gap between a row of them.
local ROUND_SIZE, ROUND_GAP = 24, 4
Actions.ROUND_SIZE, Actions.ROUND_GAP = ROUND_SIZE, ROUND_GAP
local PORTRAIT_ATLAS = ART .. "PortraitFrameAtlas"
local PORTRAIT_ATLAS_SIZE = 512
local BUG = [[Interface\HelpFrame\HelpIcon-Bug]]

-- Hides the game's tooltip where `owner` is what it shows.
local function HideTipFor(owner)
    if GameTooltip:GetOwner() == owner then GameTooltip_Hide() end
end
Actions.HideTipFor = HideTipFor

--- A Report button's right-click: the debug log's menu, where the Spoken_Developer module is
--- installed (Developer.lua). Hooked on mouse-up rather than set as the click, so whatever the
--- caller gives the button as OnClick keeps the left button, and a caller that sets OnClick after
--- this does not undo it. `isReport(button)`, optional, says whether the button reports right
--- now: the windows' action buttons are reused for other actions.
function Actions.OfferLogMenu(button, isReport)
    if button.offersLogMenu then return end
    button.offersLogMenu = true
    button:HookScript("OnMouseUp", function(self, mouse)
        if mouse ~= "RightButton" or (isReport and not isReport(self)) then return end
        HideTipFor(self)
        Developer:ShowMenu(self)
    end)
end

--- The subtitle's round button, the one every window shows: 24 across, the player's ring,
--- `glyphSize` square glyph centred in it (or reaching the rim with none). Made without a parent
--- and given one after, which a button on the open quest log needs (taint), and which costs the
--- rest nothing. `name` for a button that must be named. `own` as for Actions.RoundIcon.
function Actions.RoundButton(parent, glyphSize, name, own)
    local button = CreateFrame("Button", name, nil)
    button:SetParent(parent)
    button:SetSize(ROUND_SIZE, ROUND_SIZE)
    Actions.RoundIcon(button, nil, own)
    if glyphSize then
        button.glyph:ClearAllPoints()
        button.glyph:SetPoint("CENTER")
        button.glyph:SetSize(glyphSize, glyphSize)
    end
    button:HookScript("OnLeave", function() HideTipFor(button) end)
    return button
end

-- A line's button shows one of four glyphs: Play for a line a click starts, Stop while it
-- speaks, Replay once it is stopped and still at the head, and a plus for "queue" and "queued",
-- a line that waits or would wait behind another. Play is the portrait atlas's cell; the others
-- are drawn in its gold, each in a 93-wide cell of a 128 canvas.
local GLYPHS = { stop = ART .. "GlyphStop", replay = ART .. "GlyphReplay", queue = ART .. "GlyphQueue",
    queued = ART .. "GlyphQueue" }
local CELL = 93 / 128

function Actions.Glyph(texture, state)
    if GLYPHS[state] then
        texture:SetTexture(GLYPHS[state])
        texture:SetTexCoord(0, CELL, 0, CELL)
        return
    end
    texture:SetTexture(PORTRAIT_ATLAS)
    texture:SetTexCoord(0, 93 / PORTRAIT_ATLAS_SIZE, 419 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
end

--- Stop while the head plays, Replay once it is stopped.
function Actions.HeadState()
    return SoundQueue:IsPaused() and "replay" or "stop"
end

--- A round button's glyph for `state`, remembered on it for its tooltip.
function Actions.SetPlayGlyph(button, state)
    Actions.Glyph(button.glyph, state)
    button.state, button.playing = state, state == "stop"
end

--- Dims and disables `buttons` while the line at the head cannot be stopped. Returns whether it can.
function Actions.SetPausable(buttons)
    local pausable = SoundQueue:CanBePaused()
    for _, button in ipairs(buttons) do
        button:SetAlpha(pausable and 1 or .4)
        if pausable then button:Enable() else button:Disable() end
    end
    return pausable
end

--- Skip the line playing, with the click a window's Skip makes.
function Actions.Skip()
    local skipped = SoundQueue:Skip()
    if skipped then SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON") end
    return skipped
end

--- Skip: the round button with the play glyph against a bar, the usual "next" mark.
function Actions.SkipButton(parent, name)
    local skip = Actions.RoundButton(parent, 10, name, true)
    Actions.Glyph(skip.glyph, "play")
    skip.glyph:ClearAllPoints()
    skip.glyph:SetPoint("CENTER", -2, 0)
    skip.bar = skip:CreateTexture(nil, "ARTWORK")
    local P = SpokenLayout and SpokenLayout.Pixels
    skip.bar:SetSize(P and P(skip, 2) or 2, P and P(skip, 9) or 9)
    skip.bar:SetPoint("LEFT", skip.glyph, "RIGHT", 0, 0)
    if skip.bar.SetColorTexture then skip.bar:SetColorTexture(1, 0.82, 0, 0.85) end
    -- Squared once the bar exists, so EllesmereUI keeps it with the glyph.
    if Ellesmere then Ellesmere:When(function(skin) Actions.Square(skin, skip) end) end
    skip:SetScript("OnClick", Actions.Skip)
    skip:SetScript("OnEnter", function()
        skip.glyph:SetAlpha(1)
        GameTooltip:SetOwner(skip, "ANCHOR_TOP")
        GameTooltip:SetText(L.BIND_SKIP)
        GameTooltip:Show()
    end)
    return skip
end

--- Stop or Replay for the line at the head. `allowed()`, optional, says whether the window has
--- a line to act on; `after()`, optional, runs once it has acted.
function Actions.StopButton(parent, allowed, after)
    local play = Actions.RoundButton(parent, 12)
    play:SetScript("OnClick", function()
        if (allowed and not allowed()) or not SoundQueue:CanBePaused() then return end
        SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
        SoundQueue:TogglePauseQueue()
        if after then after() end
    end)
    play:SetScript("OnEnter", function()
        play.glyph:SetAlpha(1)
        GameTooltip:SetOwner(play, "ANCHOR_TOP")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.REPLAY or L.STOP)
        GameTooltip:Show()
    end)
    return play
end

--- A row of round buttons laid out left to right in `controls`, `gap` apart, which takes their size.
function Actions.LayOutRow(controls, row, gap)
    local x, tallest = 0, 1
    for _, button in ipairs(row) do
        button:ClearAllPoints()
        button:SetPoint("LEFT", controls, "LEFT", x, 0)
        x = x + button:GetWidth() + gap
        tallest = math.max(tallest, button:GetHeight())
    end
    controls:SetSize(math.max(1, x - gap), tallest)
end

-- What follows a window's title: why the line is held, "• (Stopped)" while it is stopped and the
-- lines waiting, "• +N", TAIL_GAP after it. One more fades the count in over TAIL_IN; Stopped fades in and
-- out, and keeps its room until it has faded.
local TAIL_GAP, TAIL_IN = 6, .25
local function EaseOut(t) return 1 - (1 - t) * (1 - t) end

-- A line queued while Spoken is stopped waits unheard, and a count that only fades in reads as
-- nothing happening (#706). The count swells to PULSE_GROW its size by PULSE_PEAK, lit gold with
-- a glow behind it, and settles back by PULSE_TIME.
local PULSE_TIME, PULSE_PEAK, PULSE_GROW = .7, .15, 1.8
local PULSE_GOLD = { 1, .82, 0 }
local COUNT_GLOW = ART .. "CountGlow"

local Pulse = {}

--- The swell for `text`, a waiting count: a larger copy of it drawn over it, and a glow.
function Actions.Pulse(text)
    local parent = text:GetParent()
    local glow = parent:CreateTexture(nil, "OVERLAY")
    glow:SetTexture(COUNT_GLOW)
    if glow.SetBlendMode then glow:SetBlendMode("ADD") end
    glow:SetVertexColor(unpack(PULSE_GOLD))
    glow:SetPoint("CENTER", text, "CENTER")
    glow:Hide()
    local burst = parent:CreateFontString(nil, "OVERLAY")
    burst:SetShadowColor(0, 0, 0, 1)
    burst:SetShadowOffset(1, -1)
    burst:SetWordWrap(false)
    burst:SetPoint("CENTER", text, "CENTER")
    burst:Hide()
    local pulse = { text = text, glow = glow, burst = burst }
    for key, fn in pairs(Pulse) do pulse[key] = fn end
    return pulse
end

--- From the start, in the count's font and colour as they are now.
function Pulse:Start()
    local font, size, flags = self.text:GetFont()
    if not font then return end
    self.font, self.size, self.flags = font, size or 12, flags or ""
    local r, g, b = self.text:GetTextColor()
    self.color = { r or 1, g or 1, b or 1 }
    self.t = 0
end

function Pulse:Active() return self.t ~= nil end

--- `elapsed` on; the count itself is hidden under the copy until it settles.
function Pulse:Step(elapsed)
    if not self.t then return end
    self.t = self.t + elapsed
    if self.t >= PULSE_TIME or not self.text:IsShown() then return self:Stop() end
    local swell = self.t < PULSE_PEAK and EaseOut(self.t / PULSE_PEAK)
        or 1 - EaseOut((self.t - PULSE_PEAK) / (PULSE_TIME - PULSE_PEAK))
    local burst, color = self.burst, self.color
    burst:SetFont(self.font, self.size * (1 + (PULSE_GROW - 1) * swell), self.flags)
    burst:SetText(self.text:GetText())
    burst:SetTextColor(color[1] + (PULSE_GOLD[1] - color[1]) * swell, color[2] + (PULSE_GOLD[2] - color[2]) * swell,
        color[3] + (PULSE_GOLD[3] - color[3]) * swell)
    burst:Show()
    self.glow:SetSize((burst:GetStringWidth() or 0) + self.size * 3, self.size * 3.5)
    self.glow:SetAlpha(.8 * swell)
    self.glow:Show()
    self.text:SetAlpha(0)
end

function Pulse:Stop()
    if not self.t then return end
    self.t = nil
    self.burst:Hide()
    self.glow:Hide()
    self.text:SetAlpha(1)
end

local Tail = {}

--- The tail for the font strings the window made: `stopped`, its text already set, `count`, and
--- `held` where the window says why a line has not started. The count lists the lines waiting
--- under the pointer (Actions.WaitingHover).
function Actions.Tail(stopped, count, held)
    local tail = { stopped = stopped, count = count, held = held, alpha = 0, want = false, parts = {} }
    for key, fn in pairs(Tail) do tail[key] = fn end
    tail.hover = Actions.WaitingHover(count)
    tail.pulse = Actions.Pulse(count)
    return tail
end

-- The most waiting lines the count's tooltip names.
local WAITING_MOST = 12

--- The lines waiting behind the one playing, in the order they will play, in `tooltip`: each
--- line's title, and who says it where that is not the title.
function Actions.WaitingTip(owner)
    GameTooltip:SetOwner(owner, "ANCHOR_TOP")
    GameTooltip:SetText(L.WAITING_TITLE)
    local sounds = SoundQueue.sounds or {}
    local count = SoundQueue.sounds and SoundQueue:GetQueueSize() or 0
    for index = 2, math.min(count, WAITING_MOST + 1) do
        local clip = sounds[index]
        GameTooltip:AddDoubleLine(Actions.Label(clip), Actions.Speaker(clip), 1, 1, 1, .62, .62, .62)
    end
    if count > WAITING_MOST + 1 then GameTooltip:AddLine("...", 1, 1, 1) end
    GameTooltip:Show()
end

--- A frame over `text`, the "+N" count, that lists the waiting lines while the pointer is on it.
function Actions.WaitingHover(text)
    return Actions.Hover(text, Actions.WaitingTip)
end

--- A frame over `text` that shows `tip(hover)` while the pointer is on it, hidden until shown.
--- It only listens: a click goes through to the window under it, which it drags as before.
function Actions.Hover(text, tip)
    local hover = CreateFrame("Frame", nil, text:GetParent())
    hover:SetAllPoints(text)
    if hover.SetMouseClickEnabled and hover.SetMouseMotionEnabled then
        hover:SetMouseClickEnabled(false)
        hover:SetMouseMotionEnabled(true)
    else
        hover:EnableMouse(true)
    end
    hover:SetScript("OnEnter", function() tip(hover) end)
    hover:SetScript("OnLeave", function() HideTipFor(hover) end)
    hover:SetScript("OnHide", function() HideTipFor(hover) end)
    hover:Hide()
    return hover
end

--- Whether Stopped should show; Step fades it in or out.
function Tail:SetStopped(stopped)
    self.want = stopped and true or false
end

--- Why the line is held back, "• (in combat)", or nil once it may play. A held line with no
--- reason looks exactly like narration that failed.
function Tail:SetHeld(reason)
    if not self.held or reason == self.reason then return end
    self.reason = reason
    self.held:SetText(reason and "• (" .. reason .. ")" or "")
end

--- `waiting` lines behind the one playing: the count says it, fading in when it grew, or
--- swelling when it grew behind a stop. Not on its first count: that is the window opening.
function Tail:SetCount(waiting)
    if waiting ~= self.counted then
        if waiting > (self.counted or 0) then
            if self.counted and SoundQueue:IsPaused() then self.pulse:Start() else self.fade = 0 end
        end
        self.counted = waiting
        self.count:SetText(waiting > 0 and "• +" .. waiting or "")
    end
    self.hover:SetShown(waiting > 0)
    self.parts = {}
    if self.held then
        self.held:SetShown(self.reason ~= nil)
        if self.reason then table.insert(self.parts, self.held) end
    end
    local stoppedShown = self.want or self.alpha > 0
    self.stopped:SetShown(stoppedShown)
    if stoppedShown then table.insert(self.parts, self.stopped) end
    self.count:SetShown(waiting > 0)
    if waiting > 0 then table.insert(self.parts, self.count) end
end

function Tail:Room()
    local room = 0
    for _, part in ipairs(self.parts) do room = room + (part:GetStringWidth() or 0) + TAIL_GAP end
    return room
end

--- Each part after the last, from `x` along `text`, where the title's words end.
function Tail:Place(text, x)
    for _, part in ipairs(self.parts) do
        part:ClearAllPoints()
        part:SetPoint("LEFT", text, "LEFT", x + TAIL_GAP, 0)
        x = x + TAIL_GAP + (part:GetStringWidth() or 0)
    end
end

function Tail:Paint()
    self.count:SetAlpha(self.pulse:Active() and 0 or EaseOut(self.fade and math.min(1, self.fade / TAIL_IN) or 1))
    self.stopped:SetAlpha(EaseOut(self.alpha))
end

--- The fades, `elapsed` on. True when Stopped has faded out and its room is to be given back.
function Tail:Step(elapsed)
    self.pulse:Step(elapsed)
    if self.fade then
        self.fade = self.fade + elapsed
        self:Paint()
        if self.fade >= TAIL_IN then self.fade = nil end
    end
    local want = self.want and 1 or 0
    if self.alpha == want then return false end
    local step = elapsed / TAIL_IN
    self.alpha = want > self.alpha and math.min(1, self.alpha + step) or math.max(0, self.alpha - step)
    self:Paint()
    return self.alpha == 0
end

--- The fades at their ends at once.
function Tail:Finish()
    self.pulse:Stop()
    self.fade = nil
    self.alpha = self.want and 1 or 0
end

--- The tail after `text`, the title in its box `width` wide: the title is cut short, not the tail.
function Tail:Fit(text, width)
    local room = self:Room()
    text:ClearAllPoints()
    text:SetPoint("TOPLEFT")
    text:SetPoint("BOTTOMRIGHT", -room, 0)
    if room == 0 then return end
    self:Place(text, math.min(text:GetStringWidth() or 0, math.max(0, width - room)))
    self:Paint()
end

---------------------------------------------------------------- what the windows share
-- The Small Window and the DialogueUI window name a line, count what waits and take the pointer
-- alike.

--- A line's title on a dark window.
Actions.TITLE_COLOR = { .88, .84, .76 }

--- A line's own label; nil where it has none, an empty one included.
local function OwnLabel(present)
    local label = present and present.label
    return label ~= "" and label or nil
end

--- A line's title. A line with no label (a one-page letter, a quest event with no title) goes by
--- its header, and one with neither has no title: its key means nothing to a player.
function Actions.Label(clip)
    local present = clip and clip.present
    return present and (OwnLabel(present) or present.header) or ""
end

--- The speaker's name over the title: the header, unless it is already the title (a line with no
--- label), and said once, so never the same as the title.
function Actions.Speaker(clip)
    local present = clip and clip.present
    local name = OwnLabel(present) and present.header or ""
    return name ~= Actions.Label(clip) and name or ""
end

--- The lines waiting behind the one playing.
function Actions.Waiting()
    return math.max(0, SoundQueue:GetQueueSize() - 1)
end

--- Whether `frame` is `root` or inside it.
function Actions.BelongsTo(frame, root)
    while frame do
        if frame == root then return true end
        frame = frame.GetParent and frame:GetParent()
    end
    return false
end

--- A line of a window's header on `parent`, `size` high, in `r, g, b`, one line, from the left.
function Actions.Text(parent, size, r, g, b)
    local text = parent:CreateFontString(nil, "OVERLAY")
    text:SetFont(GameFontNormal:GetFont(), size, "")
    text:SetShadowColor(0, 0, 0, 1)
    text:SetShadowOffset(1, -1)
    text:SetJustifyH("LEFT")
    text:SetWordWrap(false)
    text:SetTextColor(r, g, b)
    return text
end

--- Locked, clicks on a window pass through to the game; its buttons still take theirs. Where the
--- client cannot tell a click from the pointer passing over, the window keeps both.
function Actions.ClickThrough(frame)
    if frame.SetMouseClickEnabled and frame.SetMouseMotionEnabled then
        frame:SetMouseMotionEnabled(true)
        frame:SetMouseClickEnabled(not Addon:IsFrameLocked())
    end
end

--- Ctrl and the wheel step `key`, the window's own size (Frame's FrameScale or Transcript's
--- SubtitleScale); Ctrl, Shift and the wheel Text Size; each within its slider's range (SIZES).
--- Nothing while Lock Position is on, so the words under the pointer scroll instead. Returns
--- what changed, for a tooltip, or nil when the wheel was not taken.
function Actions.WheelSize(delta, key)
    if delta == 0 or not (IsControlKeyDown and IsControlKeyDown()) or Addon:IsFrameLocked() then return nil end
    local shift = IsShiftKeyDown and IsShiftKeyDown()
    local part = (shift or key == "SubtitleScale") and "Transcript" or "Frame"
    local field = shift and "FontSize" or key
    local cfg, limits = Addon:Profile(part), SIZES[field]
    local low, high, step = limits[1], limits[2], limits[3]
    local value = (tonumber(cfg[field]) or Defaults.profile[part][field]) + (delta > 0 and step or -step)
    value = math.max(low, math.min(high, math.floor(value / step + 0.5) * step))
    cfg[field] = value
    PlayerFrame:RefreshConfig()
    Transcript:RefreshConfig()
    if Options and Options.UpdateRows then Options:UpdateRows() end
    if shift then return format("%s: %d", L.TRANSCRIPT_SIZE, value) end
    return format("%s: %d%%", key == "SubtitleScale" and L.OPT_SUBTITLE_SIZE or L.OPT_SCALE, math.floor(value * 100 + 0.5))
end

--- Whether the pointer is over `frame`, which must be shown.
function Actions.PointerOver(frame)
    if not (frame and frame:IsShown()) then return false end
    if frame.IsMouseOver then return frame:IsMouseOver() and true or false end
    return MouseIsOver and MouseIsOver(frame) and true or false
end

--- A window takes the wheel only while Ctrl is held over it and it is not `locked`; otherwise the
--- wheel zooms the camera, which a frame with the wheel enabled would swallow. Asked every frame,
--- since Ctrl goes down only just before the wheel turns. It touches the frame only when the
--- answer changes, so it may be called freely, but not on a window frozen as one image.
function Actions.TakeWheel(frame, locked)
    local wheel = not locked and IsControlKeyDown ~= nil and IsControlKeyDown() and Actions.PointerOver(frame) or false
    if frame.EnableMouseWheel and (frame.spokenWheelOn or false) ~= wheel then
        frame.spokenWheelOn = wheel
        frame:EnableMouseWheel(wheel)
    end
end

--- The window gives the wheel back to the camera: it is hiding, or about to become one image.
function Actions.DropWheel(frame)
    Actions.TakeWheel(frame, true)
end

--- The size the wheel just set, beside the pointer.
function Actions.WheelTip(owner, text)
    GameTooltip:SetOwner(owner, "ANCHOR_CURSOR")
    GameTooltip:SetText(text)
    GameTooltip:Show()
end

--- `window.progress` filled to where `window.clip`'s voice is; `window.seconds` holds it while the
--- line is stopped.
function Actions.FollowProgress(window)
    local clip = window.clip
    if not clip then return end
    window.seconds = Actions.Elapsed(clip, window.seconds)
    Actions.SetProgress(window.progress, SoundQueue:Share(clip, window.seconds))
end

-- The progress line: Spoken Subtitles' layout and spark, framed as the game frames a status bar
-- (UIWidgetTemplateStatusBar). Without that art, Spoken Subtitles' own hairline.
local PROGRESS_HEIGHT = 7
local PROGRESS_LINE = ART .. "SubtitleLine"
local SPARK = [[Interface\CastingBar\UI-CastingBar-Spark]]
-- Called through the global environment: the client looks up Vector2DMixin in the caller's
-- environment, and from SpokenEnv it fails with "unable to find mixin or metatable".
local AtlasInfo = setfenv(function(name)
    return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) or nil
end, _G)

--- Whether the client has the atlas `name`.
function Actions.HasAtlas(name)
    return AtlasInfo(name) ~= nil
end

local function FrameProgress(bar, left, right, middle, yellow)
    local track, fill = bar.track, bar.fill
    -- The fill 8 inside the border's ends and 2 short of the background's, the border's own 31
    -- rows scaled to PROGRESS_HEIGHT.
    local k = PROGRESS_HEIGHT / (middle.height > 0 and middle.height or 31)
    track:SetHeight(PROGRESS_HEIGHT)
    local function Piece(atlas, layer, width)
        local texture = track:CreateTexture(nil, layer)
        texture:SetAtlas(atlas)
        texture:SetHeight(PROGRESS_HEIGHT)
        if width then texture:SetWidth(width * k) end
        return texture
    end
    local l = Piece("widgetstatusbar-borderleft", "OVERLAY", left.width)
    local r = Piece("widgetstatusbar-borderright", "OVERLAY", right.width)
    local m = Piece("widgetstatusbar-bordercenter", "OVERLAY")
    l:SetPoint("LEFT", track, "LEFT", 0, 0)
    r:SetPoint("RIGHT", track, "RIGHT", 0, 0)
    m:SetPoint("LEFT", l, "RIGHT", 0, 0)
    m:SetPoint("RIGHT", r, "LEFT", 0, 0)
    bar.border = { l, m, r }
    bar.room = 8 * k
    local back = track:CreateTexture(nil, "BACKGROUND")
    if AtlasInfo("widgetstatusbar-bgcenter") then back:SetAtlas("widgetstatusbar-bgcenter")
    elseif back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.6) end
    back:SetPoint("TOPLEFT", track, "TOPLEFT", bar.room - 2 * k, -2 * k)
    back:SetPoint("BOTTOMRIGHT", track, "BOTTOMRIGHT", -(bar.room - 2 * k), 2 * k)
    fill:SetAtlas("widgetstatusbar-fill-yellow")
    fill:SetHeight(math.min(tonumber(yellow.height) or 15, middle.height - 4) * k)
    bar.height = PROGRESS_HEIGHT
end

--- A progress line on `parent`: `track`, the frame to size and place; `fill`, running along it
--- `room` in from each end; `spark` at the fill's end; `height`, how tall it is drawn. Art that
--- fails to build leaves the hairline, and its error goes to the error handler.
function Actions.ProgressBar(parent)
    local track = CreateFrame("Frame", nil, parent)
    local bar = { track = track, fill = track:CreateTexture(nil, "ARTWORK"), room = 0 }
    local left, right, middle = AtlasInfo("widgetstatusbar-borderleft"), AtlasInfo("widgetstatusbar-borderright"),
        AtlasInfo("widgetstatusbar-bordercenter")
    local yellow = AtlasInfo("widgetstatusbar-fill-yellow")
    local framed = left and right and middle and yellow and bar.fill.SetAtlas
        and tonumber(middle.height) and tonumber(left.width) and tonumber(right.width) and true or false
    if framed then
        local ok, err = pcall(FrameProgress, bar, left, right, middle, yellow)
        if not ok then
            framed = false
            if geterrorhandler then geterrorhandler()(err) end
        end
    end
    if not framed then
        bar.room = 0
        local back = track:CreateTexture(nil, "BACKGROUND")
        back:SetAllPoints()
        if back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.5) end
        track:SetHeight(1.5)
        bar.fill:SetTexture(PROGRESS_LINE)
        bar.fill:SetHeight(1.5)
        bar.height = 2
    end
    bar.fill:SetPoint("LEFT", track, "LEFT", bar.room, 0)
    local spark = track:CreateTexture(nil, "OVERLAY", nil, 1)
    spark:SetTexture(SPARK)
    if spark.SetBlendMode then spark:SetBlendMode("ADD") end
    -- Taller than the bar, so its glow reaches past the frame.
    spark:SetSize(12, framed and bar.height + 9 or 14)
    spark:SetPoint("CENTER", bar.fill, "RIGHT")
    bar.spark = spark
    return bar
end

--- Fills `share` (0 to 1) of a ProgressBar.
function Actions.SetProgress(bar, share)
    local room = math.max(0, (bar.track:GetWidth() or 0) - 2 * bar.room)
    bar.fill:SetWidth(math.max(0.01, room * Clamp01(share)))
end

--- A ProgressBar's frame in `r, g, b` (1, 1, 1 for its own colours); the hairline, which has
--- none, takes it on its fill.
function Actions.TintProgress(bar, r, g, b)
    for _, part in ipairs(bar.border or { bar.fill }) do part:SetVertexColor(r, g, b) end
    bar.tint = { r, g, b }
end

--- How far into `clip` its voice is, in seconds, for its progress line: `seconds`, what was shown
--- last, kept while it is stopped.
function Actions.Elapsed(clip, seconds)
    local duration = tonumber(clip.length) or 0
    if clip.nextSoundTimer and duration > 0 then return SoundQueue:VoiceElapsed(clip) end
    if not SoundQueue:IsPaused() then return 0 end
    return seconds
end

local PORTRAIT_MASK = [[Interface\CharacterFrame\TempPortraitAlphaMask]]
local VIGNETTE = ART .. "RoundVignette"

--- `icon` filling the ring's dark middle, cut round with the game's portrait mask, its own bevel
--- trimmed off. The ring (SettingsButton, 32 drawn at 30) is dark from its 6th pixel to its
--- 24th, about 18 across on screen, its rim outside that: 3 in from the button's edge fills the
--- middle and leaves the rim. Left square, the icon's corners showed past the rim.
function Actions.RoundPicture(button, icon)
    local glyph = button.glyph
    glyph:ClearAllPoints()
    glyph:SetPoint("TOPLEFT", button, "TOPLEFT", 3, -3)
    glyph:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", -3, 3)
    glyph:SetTexture(icon)
    glyph:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    -- A square button in EllesmereUI's look keeps its picture square.
    if button.squared then return end
    local mask = button.CreateMaskTexture and glyph.AddMaskTexture and button:CreateMaskTexture()
    if type(mask) == "table" then
        mask:SetTexture(PORTRAIT_MASK, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
        mask:SetAllPoints(glyph)
        glyph:AddMaskTexture(mask)
        button.mask = mask
    elseif SetPortraitToTexture then
        SetPortraitToTexture(glyph, icon)
    end
    -- A vignette over it, darkest at the rim: the play and bug glyphs sit on the ring's black,
    -- and a bright picture edge to edge stood out beside them.
    local vignette = button:CreateTexture(nil, "ARTWORK", nil, 1)
    vignette:SetTexture(VIGNETTE)
    vignette:SetAllPoints(glyph)
    button.vignette = vignette
end

-- Greyed while disabled, as a button with nothing to play or skip.
local function Greys(button)
    local function Paint(self, on)
        for _, texture in ipairs({ self.glyph, self.bar }) do
            if texture.SetDesaturated then texture:SetDesaturated(not on) end
            texture:SetAlpha(on and GLYPH_ALPHA or 0.4)
        end
    end
    button:HookScript("OnDisable", function(self) Paint(self, false) end)
    button:HookScript("OnEnable", function(self) Paint(self, true) end)
end

--- Dress `button` as a square Play button with the game's checkbox for a border, as the quest
--- log's rows have beside it: Play's glyph inside, `button:SetState("play" | "stop" | "replay" | "queue" | "queued")`.
--- `button:MatchBox(checkbox)` takes the checkbox's size and, where it is drawn from an atlas,
--- that atlas, so the two read as a pair whatever the client draws its checkbox with.
function Actions.BoxPlay(button)
    local layout = SpokenLayout
    local border = layout and layout.AtlasTexture and layout.AtlasTexture(button, "BACKGROUND", "checkbox-minimal")
    if border then border:SetAllPoints(button) end
    -- Under the pointer the box lights up, as the checkbox's does: its border again, added over itself.
    local lit = layout and layout.AtlasTexture and layout.AtlasTexture(button, "HIGHLIGHT", "checkbox-minimal")
    if lit then
        lit:SetAllPoints(button)
        lit:SetBlendMode("ADD")
        lit:SetAlpha(BOX_LIT)
    end
    local glyph = button:CreateTexture(nil, "ARTWORK")
    glyph:SetPoint("CENTER")
    glyph:SetSize(11, 11)
    glyph:SetAlpha(GLYPH_ALPHA)
    button.border, button.lit, button.glyph = border, lit, glyph
    Actions.SetPlayGlyph(button, "play")
    function button:SetState(state) Actions.SetPlayGlyph(self, state) end
    button:HookScript("OnEnter", function(self) if self:IsEnabled() then glyph:SetAlpha(1) end end)
    button:HookScript("OnLeave", function(self) if self:IsEnabled() then glyph:SetAlpha(GLYPH_ALPHA) end end)
    --- The box's atlas and size, and Play's glyph at about seven tenths of it.
    function button:SetBox(atlas, width, height)
        if atlas then
            if self.border then self.border:SetAtlas(atlas) end
            if self.lit then self.lit:SetAtlas(atlas) end
        end
        if type(width) == "number" and type(height) == "number" and width >= 12 and height >= 12 then
            local P = SpokenLayout and SpokenLayout.Pixels
            width, height = P and P(self, width) or width, P and P(self, height) or height
            self:SetSize(width, height)
            glyph:SetSize(P and P(self, width * 0.7) or math.floor(width * 0.7),
                P and P(self, height * 0.7) or math.floor(height * 0.7))
        end
    end
    function button:MatchBox(box)
        -- The texture that draws the checkbox's box, at the size it draws it: its normal texture, else
        -- the first region painted from an atlas that is not the tick.
        local found
        local function Consider(texture)
            if found or type(texture) ~= "table" or not texture.GetAtlas then return end
            local atlas, width, height = texture:GetAtlas(), texture:GetWidth(), texture:GetHeight()
            if atlas and not atlas:find("mark") and type(width) == "number" and type(height) == "number"
                and width >= 12 and height >= 12 then
                found = { atlas = atlas, width = width, height = height }
            end
        end
        Consider(box.GetNormalTexture and box:GetNormalTexture())
        for _, region in ipairs({ box:GetRegions() }) do Consider(region) end
        local width, height = box:GetWidth(), box:GetHeight()
        if found then width, height = found.width, found.height end
        self:SetBox(found and found.atlas, width, height)
        return found and found.atlas, width, height
    end
    Greys(button)
    return button
end

--- The round Play, Skip and Report buttons, as feature addons ask for them
--- (Spoken:CreateRoundButton), and "icon", with `icon` in the ring, cut round to sit inside it.
function Actions.NewRound(parent, kind, name, icon)
    if kind == "play" then
        local button = Actions.RoundButton(parent, 12, name)
        Actions.SetPlayGlyph(button, "play")
        --- "play", "stop", "replay", "queue" or "queued".
        function button:SetState(state) Actions.SetPlayGlyph(self, state) end
        function button:SetPlaying(playing) Actions.SetPlayGlyph(self, playing and "stop" or "play") end
        Greys(button)
        return button
    end
    if kind == "skip" then
        local button = Actions.SkipButton(parent, name)
        Greys(button)
        return button
    end
    local button = Actions.RoundButton(parent, nil, name)
    if kind == "icon" and icon then
        Actions.RoundPicture(button, icon)
        return button
    end
    button.glyph:SetTexture(BUG)
    Actions.OfferLogMenu(button)
    return button
end

-- The dialog row's buttons, 24 at UIParent's scale whatever DialogueUI's own size.
local DialogRow = {}

--- Play, Skip and, with `report`, Report in a row on one of DialogueUI's dialogs (its quest window
--- or its book view), as Spoken Quests and Spoken Readables put them there: children of the dialog,
--- drawn over it, so they show while DialogueUI hides UIParent and close with it. `tooltip()`
--- returns the tooltip to use on the dialog, the game's being a child of UIParent. Skip skips and
--- names itself; the caller gives Play and Report their clicks and their tooltips (Row:SetTip).
function Actions.DialogRow(dialog, tooltip, report)
    local holder = CreateFrame("Frame", nil, dialog)
    holder:SetFrameStrata("FULLSCREEN")
    holder:SetSize(ROUND_SIZE, ROUND_SIZE)
    holder:Hide()
    local row = { frame = holder, dialog = dialog, tooltip = tooltip, tips = {}, placed = {} }
    for key, fn in pairs(DialogRow) do row[key] = fn end
    local function Round(kind)
        local button = Actions.NewRound(holder, kind)
        button:SetFrameStrata("FULLSCREEN")
        -- Brighter under the pointer, as the ring's own hover has it, and the tooltip the dialog's.
        button:SetScript("OnEnter", function(self)
            if self:IsEnabled() then self.glyph:SetAlpha(1) end
            row:ShowTip(self)
        end)
        button:SetScript("OnLeave", function(self)
            if self:IsEnabled() then self.glyph:SetAlpha(GLYPH_ALPHA) end
            if self.tooltip then self.tooltip:Hide() end
        end)
        return button
    end
    row.play = Round("play")
    row.play:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    row.skip = Round("skip")
    row.tips[row.skip] = function(tip) tip:SetText(L.BIND_SKIP) end
    if report then row.report = Round("report") end
    return row
end

--- `fill(tooltip)` writes `button`'s tooltip, its owner already set.
function DialogRow:SetTip(button, fill)
    self.tips[button] = fill
end

--- `button`'s tooltip on the dialog, written afresh.
function DialogRow:ShowTip(button)
    local fill = self.tips[button]
    if not fill then return end
    local tip = self.tooltip()
    tip:SetOwner(button, "ANCHOR_RIGHT")
    fill(tip)
    tip:Show()
    button.tooltip = tip
end

--- The tooltip again where it shows: what a click changed is in it.
function DialogRow:RefreshTip(button)
    if button.tooltip and button.tooltip:IsShown() then self:ShowTip(button) end
end

function DialogRow:HideTips()
    for _, button in ipairs({ self.play, self.skip, self.report }) do
        if button.tooltip then button.tooltip:Hide() end
    end
end

--- `buttons` laid out right to left from `anchor`'s left, on its middle (the dialog's top right
--- without one), each 24 on screen whatever the dialog's scale. Laid out again only when the
--- buttons or the scale change, or with `force`, for a button another file placed meanwhile: the
--- callers run this every frame the dialog is open.
function DialogRow:Place(buttons, anchor, force)
    local holder, placed = self.frame, self.placed
    local scale = UIParent:GetEffectiveScale() / math.max(0.01, self.dialog:GetEffectiveScale() or 1)
    local same = placed.scale == scale and placed.anchor == anchor and placed.count == getn(buttons)
    for index = 1, getn(buttons) do
        if placed[index] ~= buttons[index] then same = false end
        placed[index] = buttons[index]
    end
    if same and not force then return end
    placed.scale, placed.anchor, placed.count = scale, anchor, getn(buttons)
    holder:SetSize(math.max(1, (getn(buttons) * ROUND_SIZE + (getn(buttons) - 1) * ROUND_GAP) * scale), ROUND_SIZE * scale)
    local right
    for _, button in ipairs(buttons) do
        button:SetScale(scale)
        button:SetSize(ROUND_SIZE, ROUND_SIZE)
        button:ClearAllPoints()
        if right then
            button:SetPoint("RIGHT", right, "LEFT", -ROUND_GAP, 0)
        else
            button:SetPoint("RIGHT", holder, "RIGHT", 0, 0)
        end
        right = button
    end
    holder:ClearAllPoints()
    if anchor then
        holder:SetPoint("RIGHT", anchor, "LEFT", -ROUND_GAP, 0)
    else
        holder:SetPoint("TOPRIGHT", self.dialog, "TOPRIGHT", -48, -19)
    end
end

local function NewButton(frame, action)
    local button
    if action.create then
        button = action.create(frame)
    else
        -- No template: a button that is only a texture wants none of
        -- UIPanelButtonTemplate's furniture.
        -- The player's round button, the same Report the subtitle shows.
        button = CreateFrame("Button", nil, frame)
        button:SetSize(ROUND_SIZE, ROUND_SIZE)
        Actions.RoundIcon(button, action.icon)
        button.showsIcon = true
        button:SetScript("OnClick", function(self)
            if self.action and self.action.onClick then
                self.action.onClick(frame.actions.clip)
            end
        end)
        -- Hooked, not set: the round icon's own hover (Actions.RoundIcon) stays.
        button:HookScript("OnEnter", function(self)
            if self.action and self.action.tooltip then
                GameTooltip:SetOwner(self, "ANCHOR_LEFT")
                self.action.tooltip(GameTooltip)
                GameTooltip:Show()
            end
        end)
        button:HookScript("OnLeave", function() GameTooltip_Hide() end)
        Actions.OfferLogMenu(button, function(self) return self.action and self.action.id == "report" end)
    end
    return button
end

--- The corner icon action (Report) `clip` offers, for a frame that draws its own button for it
--- -- the subtitle. Nil when the clip has none, or the player hid it.
function Actions:CornerAction(clip)
    local list = clip and clip.present and clip.present.actions or {}
    local hidden = Addon:Profile("Frame").HiddenActions or {}
    for _, action in ipairs(list) do
        if action.anchor == "topright" and action.icon and not hidden[action.id]
            and (not action.visible or action.visible()) then
            return action
        end
    end
end

--- The buttons for `clip`'s actions (the head's) in `frame.actions.buttons`, in order, hiding
--- whatever the last clip left. Where they go is HeaderControls' caller's.
function Actions:Configure(frame, clip)
    -- One setting covers the lot. Every action either of the shipped addons offers is a
    -- convenience beside the line, so "hide them" is a player-wide answer rather than one
    -- checkbox per addon per button.
    local list = clip and clip.present and clip.present.actions or {}
    frame.actions.clip = clip
    local placed = 0
    local inUse = {}
    -- Keyed by source as well as id: both shipped addons call their action "report", and
    -- one button between them means the addon that built it first answers for the other.
    -- A button an addon built keeps its own click handler, so that is not a label problem.
    local owner = clip and clip.source and clip.source.key or "?"

    local hidden = Addon:Profile("Frame").HiddenActions or {}
    for _, action in ipairs(list) do
        if not hidden[action.id] and (not action.visible or action.visible()) then
            local id = owner .. ":" .. action.id
            local button = frame.actions.byId[id]
            if not button then
                button = NewButton(frame, action)
                frame.actions.byId[id] = button
            end
            button.action = action
            inUse[id] = true
            if action.onClipChanged then action.onClipChanged(clip, button) end
            button:Show()
            placed = placed + 1
            frame.actions.buttons[placed] = button
        end
    end
    for id, button in pairs(frame.actions.byId) do
        if not inUse[id] then button:Hide() end
    end
    for i = placed + 1, getn(frame.actions.buttons) do
        frame.actions.buttons[i] = nil
    end
end

--- The actions for `clip` in `controls`, after `first` (its Stop or Replay and Skip) and as large
--- and as strong. An action anchored to the header is left off: Skip does its work.
--- Returns the buttons shown, in order.
function Actions:HeaderControls(frame, controls, first, clip)
    self:Configure(frame, clip)
    local row = {}
    for _, button in ipairs(first) do table.insert(row, button) end
    for _, button in ipairs(frame.actions.buttons) do
        if button.action.anchor == "header" then
            button:Hide()
        else
            button:SetParent(controls)
            button:SetFrameLevel(controls:GetFrameLevel() + 1)
            if button.showsIcon then button:SetSize(first[1]:GetWidth(), first[1]:GetHeight()) end
            button:SetAlpha(1)
            if button:IsShown() then table.insert(row, button) end
        end
    end
    return row
end

-- DialogueUI's quest window and book view, and Immersion's window, which shows quests, gossip and
-- books in its own talking box.
local DIALOGS = { "DUIQuestFrame", "DUIBookFrame", "ImmersionFrame" }

local function Open(name)
    local dialog = _G[name]
    return type(dialog) == "table" and dialog.IsShown and dialog:IsShown() and true or false
end

--- Whether Immersion's window is open. The subtitles ask only this: DialogueUI hides them with
--- the rest of the interface.
function Actions.ImmersionOpen()
    return Open("ImmersionFrame")
end

--- Whether another addon's dialog is open and showing the line itself, so Spoken's windows stay
--- away rather than cover it. DialogueUI's, unless the windows are put over it
--- (Show Spoken Over DialogueUI): DialogueUI hides the interface, and a window left showing would
--- leave its 3D portrait over the dialog, which takes no alpha from it. Immersion's always: it
--- keeps the interface unless its Hide Interface is on, so the window would sit beside its box.
function Actions.DialogCovers()
    if Addon.playerHost then return Actions.ImmersionOpen() end
    for _, name in ipairs(DIALOGS) do
        if Open(name) then return true end
    end
    return false
end

--- Calls `fn` a frame after a dialog opens or closes, once DialogueUI's bridge has put the windows
--- over it or not. Immersion's window hides half a second after its last page, once it has faded:
--- the window comes back then. Between one page and the next it never hides.
function Actions.WatchDialogs(fn)
    local function Later()
        C_Timer.After(0, fn)
    end
    for _, name in ipairs(DIALOGS) do
        local dialog = _G[name]
        if type(dialog) == "table" and dialog.GetEffectiveScale then
            local watch = CreateFrame("Frame", nil, dialog)
            watch:SetScript("OnShow", Later)
            watch:SetScript("OnHide", Later)
        end
    end
end

-- A window fading in, and out: the Talking Head's words take a quarter second to show.
local FADE_IN, FADE_OUT = .25, .4

local Fader = {}

--- Shows and hides `frame` by fading it (Fader:Set), with the models `models()` lists: a model
--- takes no alpha from its parent. While it fades out the captions keep the words it had;
--- `faded()` is called once it has gone.
function Actions.Fader(frame, models, faded)
    local fader = { frame = frame, models = models, faded = faded, alpha = 0, want = false }
    for key, fn in pairs(Fader) do fader[key] = fn end
    fader.driver = CreateFrame("Frame")
    fader.driver:Hide()
    fader.driver:SetScript("OnUpdate", function(_, elapsed) fader:Step(elapsed) end)
    return fader
end

function Fader:Paint()
    local a = self.alpha
    local eased = a * a * (3 - 2 * a)
    self.frame:SetAlpha(eased)
    for _, model in ipairs(self.models and self.models() or {}) do
        if model.SetAlpha then model:SetAlpha(eased) end
    end
end

--- Fades the frame in or out; `immediate` shows or hides it at once.
function Fader:Set(shown, immediate)
    shown = shown and true or false
    if not self.frame:IsShown() then self.alpha = 0 end
    if shown then
        self:Release()
        self.frame:Show()
    elseif self.frame:IsShown() and not immediate and not self.holding and Transcript.Hold then
        -- The words stay for the fade; a line that comes meanwhile releases them.
        Transcript:Hold()
        self.holding = true
    end
    self.want = shown
    if immediate then self.alpha = shown and 1 or 0 end
    self:Step(0)
end

function Fader:Release()
    if not self.holding then return end
    self.holding = nil
    Transcript:Release()
end

--- Whether the frame is fading out, or out of sight.
function Fader:Leaving()
    return not self.want
end

function Fader:Step(elapsed)
    local target = self.want and 1 or 0
    if self.alpha < target then
        self.alpha = math.min(target, self.alpha + elapsed / FADE_IN)
    elseif self.alpha > target then
        self.alpha = math.max(target, self.alpha - elapsed / FADE_OUT)
    end
    self:Paint()
    if self.alpha ~= target then self.driver:Show(); return end
    self.driver:Hide()
    if not self.want and self.frame:IsShown() then
        self.frame:Hide()
        self:Release()
        if self.faded then self.faded() end
    end
end

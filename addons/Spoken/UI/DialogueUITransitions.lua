setfenv(1, SpokenEnv)

-- The DialogueUI window's moves to and from DialogueUI's own dialogs (DialogueUIPlayer.lua is the
-- window): settling out of a dialog that closes on its line, the dialog's words fading before it
-- closes, and a page the dialog queued going behind the window.

local Skin = DialogueUIPlayer
local Theme = DialogueUITheme
local LOOKS, LookOf, PaperOf = Skin.art.LOOKS, Skin.art.LookOf, Skin.art.PaperOf
local CapSize, DressStrips = Skin.art.CapSize, Skin.art.DressStrips

-- How the window gets from the dialog to where it rests (Skin:SettleStep): lifted
-- SETTLE_RISE up and SETTLE_GROW larger over SETTLE_LIFT, flown over SETTLE_TIME on a curve bowed
-- SETTLE_BOW to one side (down, so it stays on the screen), then landing with a jump of SETTLE_GIVE
-- over LAND_TIME.
-- The tuck's page lifts, flies and gives on the same rhythm.
local SETTLE_LIFT, SETTLE_TIME, LAND_TIME = .1, .42, .4
local SETTLE_GROW, SETTLE_RISE, SETTLE_BOW, SETTLE_GIVE = .03, 4, .16, 7
-- The dialog's words fading on DialogueUI's window before it closes (Skin:FadeDialogOut), and this
-- window's fading in once it has landed (Skin:LandStep): the flight is of the paper alone.
local CONTENT_OUT, CONTENT_IN = .1, .16
-- A quest page closing (QUEST_FINISHED): DialogueUI (1.0.5, Code/Core.lua) waits up to a second
-- before it hides its window: FOLLOWS when the NPC has more quests (GetQuestFinishedDelay), in case
-- the next page comes, and up to 0.5 more for its camera. Where it expects no page, the window
-- closes once the conversation with the NPC is over, watched for up to QUEST_WAIT. Otherwise it is
-- left to DialogueUI, words and all: fading them early would leave bare paper standing.
local QUEST_WAIT = 1.1
local FOLLOWS = .5
-- A line queued this long before its dialog showed is still the dialog's: Spoken and DialogueUI
-- hear the same event, in either order.
local JUST_BEFORE = 0.5
-- A dialog's line can also join the queue just after it closes: a quest page is read once its
-- words have held still, and a quest accepted at once (the space bar) closes before that. A line
-- from the dialog's own modules this soon after it closed is still the dialog's.
local JUST_AFTER = 1
local DIALOG_SOURCES = { DUIQuestFrame = { quests = true, gossip = true }, DUIBookFrame = { books = true } }
-- The tuck: the page slides behind over TUCK_SLIDE seconds and the count ripples over
-- TUCK_RIPPLE. The page lands at TUCK_SIZE of the window, TUCK_LOW of its height under its middle,
-- its foot showing under it.
local TUCK_SLIDE, TUCK_RIPPLE, TUCK_SIZE, TUCK_LOW = .18, .35, .9, .3

local function Clamp(n, low, high) return math.max(low, math.min(high, n)) end
local function Round(n) return math.floor(n + 0.5) end
local function Smooth(t) return t * t * (3 - 2 * t) end
local function Lerp(a, b, t) return a + (b - a) * t end
-- The little jump a window gives as something lands on or under it: up SETTLE_GIVE and back.
local function Bounce(t) return SETTLE_GIVE * math.exp(-6 * t) * math.sin(2 * math.pi * t / 0.34) end
-- A shadow texture or frame under `anchor`, thrown `dx`, `dy` and blurred `blur` past its edges.
local function PlaceShadow(region, anchor, dx, dy, blur, scale)
    scale = scale or 1
    region:ClearAllPoints()
    region:SetPoint("TOPLEFT", anchor, "TOPLEFT", (dx - blur) / scale, (dy + blur) / scale)
    region:SetPoint("BOTTOMRIGHT", anchor, "BOTTOMRIGHT", (dx + blur) / scale, (dy - blur) / scale)
end
local function EaseInOut(t)
    if t < 0.5 then return 4 * t * t * t end
    local f = 2 - 2 * t
    return 1 - f * f * f / 2
end
local function EaseOutCubic(t)
    local f = 1 - t
    return 1 - f * f * f
end
-- The point at u on a quadratic curve from a to c, bent toward b.
local function Bend(a, b, c, u) return (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c end
-- The point bowing a path from a to b `share` of its length to one side: the side below it, so a
-- window flying to the screen's top edge never runs off it.
local function BowOf(ax, ay, bx, by, share)
    local dx, dy = bx - ax, by - ay
    local length = math.sqrt(dx * dx + dy * dy)
    if length <= 0 then return ax, ay end
    local px, py = -dy / length, dx / length
    if py > 0 then px, py = -px, -py end
    return (ax + bx) / 2 + px * share * length, (ay + by) / 2 + py * share * length
end

--- The soft shadow DialogueUI's theme draws under its settings panel.
local function ShadowArt()
    return Theme:TexturePath() .. "Settings-BackgroundShadow.png"
end

---------------------------------------------------------------- watching the dialogs

--- DialogueUI's quest window or book view closing on a line that plays on: this one takes over
--- from it. Told by a child of each, since DialogueUI sets the quest window's own OnHide with
--- SetScript, which drops a hook.
function Skin:WatchDialogs()
    self.dialogs, self.dialogWatches = {}, {}
    -- Which lines each dialog queued (Skin:StartSession), so the one closing knows its own.
    self.queuedAt, self.sessions = setmetatable({}, { __mode = "k" }), {}
    -- The lines its earlier pages queued, while the quest window stays open from page to page.
    self.earlier = {}
    for _, name in ipairs({ "DUIQuestFrame", "DUIBookFrame" }) do
        local dialog = _G[name]
        if type(dialog) == "table" and dialog.GetEffectiveScale then
            local watch = CreateFrame("Frame", nil, dialog)
            self.dialogNames = self.dialogNames or {}
            self.dialogNames[dialog] = name
            watch:SetScript("OnHide", function()
                self.justClosed = { dialog = dialog, at = GetTime() }
                self:Settle(dialog)
            end)
            -- Opening, it shows the line itself: this one steps aside at once (Skin:Covered).
            watch:SetScript("OnShow", function()
                self.earlier[dialog] = nil
                self:StartSession(dialog)
                self:Update()
            end)
            table.insert(self.dialogs, dialog)
            self.dialogWatches[dialog] = watch
            -- Closing on its own line, its words fade before it hides (Skin:FadeDialogOut).
            local hide = dialog.Hide
            self.dialogHides = self.dialogHides or {}
            self.dialogHides[dialog] = hide
            dialog.Hide = function(frame, ...)
                -- DialogueUI closing it from ShowUI (a cutscene, gossip another addon handles):
                -- ShowUI's end would take it for another page and cancel the fade, so it hides now.
                if self.showingUI == frame then return hide(frame, ...) end
                local closing = self.closing
                -- Its words already fading: it closes once they have (Skin:CloseStep).
                if closing and closing.dialog == frame then return end
                -- Already hidden (DialogueUI hides it again from its own OnHide): nothing to fade.
                if not frame:IsShown() then return hide(frame, ...) end
                local ok, fades = pcall(self.FadesOnClose, self, frame)
                if not (ok and fades) then return hide(frame, ...) end
                self:FadeDialogOut(frame, hide)
            end
            local showUI = dialog.ShowUI
            if type(showUI) == "function" then
                dialog.ShowUI = function(frame, ...)
                    self.showingUI = frame
                    showUI(frame, ...)
                    self.showingUI = nil
                    self:CancelDialogFade(dialog)
                    -- Another page in the quest window, still open (the gossip back after a quest
                    -- is accepted): its lines are this page's, so closing on a giver's second quest
                    -- sends its page behind the first's line.
                    if dialog == _G.DUIQuestFrame and dialog:IsShown() then
                        self:KeepEarlier(dialog)
                        self:StartSession(dialog)
                    end
                end
            end
            self.sessions[dialog] = setmetatable({}, { __mode = "k" })
        end
    end
    Callbacks:Register("CLIP_QUEUED", function(clip) self:Queued(clip) end)
    -- A quest page with no page to follow closes at once, not after DialogueUI's wait
    -- (Skin:QuestFinished).
    local quest = _G.DUIQuestFrame
    if quest and self.dialogHides and self.dialogHides[quest] then
        local events = CreateFrame("Frame")
        events:RegisterEvent("QUEST_FINISHED")
        events:SetScript("OnEvent", function() self:QuestFinished(quest) end)
        self.questEvents = events
    end
end

---------------------------------------------------------------- settling out of a dialog

--- DialogueUI's quest window or book view closed while its line plays on: this window takes the
--- dialog's place, size and height, then shrinks to its own size and height as it moves to where
--- it rests, DialogueUI's opening in reverse. Closed while another line plays, this window comes
--- back as it is, and a line the dialog queued goes behind it (Skin:StartTuck). Not while it sits
--- on the dialog (Show Spoken Over DialogueUI): it is in place already. Should anything fail, it
--- is simply put where it rests.
function Skin:Settle(dialog)
    local frame = self.frame
    if not (self:IsEnabled() and PlayerFrame:Current()) or frame:GetParent() ~= UIParent then return end
    -- Fading as one image: it finishes, then shows the line as it does any.
    if self:Defer("update") then return end
    self:StopTuck()
    self.tuckWaiting = nil
    self:StopLanding()
    -- Coming back as it is: a fade under way goes on, and Update hands it the line. Not for a line
    -- an earlier page of this dialog queued (the greeting before a quest): this window never
    -- showed it, so it settles out of the dialog with it, the later pages' lines counted after it.
    if not self:Owns(dialog) and not self:OwnedEarlier(dialog) then
        local queued = self:QueuedBy(dialog)
        self:Update()
        if queued then
            self.justClosed = nil
            -- Fading in now as itself, not one image, so the page goes behind a window that is
            -- coming in with it rather than one still waiting to.
            self:FadeInAsItself()
            self:TuckWhenShown(dialog, queued)
        end
        return
    end
    self.justClosed = nil
    -- Shown in full at once: no fade or turn left waiting, and the captions free for its line.
    self.arming, self.preparing, self.turning = nil, nil, nil
    self:Undeafen()
    Transcript:Release()
    local ok, err = pcall(self.StartSettle, self, dialog)
    if not ok then
        self.settling = nil
        if self.wordsHidden then self:ShowWords(1) end
        frame:SetScale(frame.spokenBaseScale or 1)
        self:PlaceHome()
        self:Layout()
        if geterrorhandler then geterrorhandler()(err) end
    end
end

--- The dialog's middle and top, width and height in UIParent's units, and how large DialogueUI's
--- units are in them. The quest window's from where DialogueUI puts it: it has no place on screen
--- to read while it hides the interface. The book view's from its frame, which keeps its place as
--- it hides: its paper is the frame.
function Skin:DialogPlace(dialog)
    local ui = UIParent:GetEffectiveScale()
    local q = dialog:GetEffectiveScale() / ui
    if dialog == _G.DUIQuestFrame then
        local x, top = Theme:WindowPlace()
        local width, height = Theme:FrameSize()
        if x and top and width and height then return x, top, width * q, height * q, q end
        return nil
    end
    local left, bottom, w, h = dialog:GetRect()
    if left and bottom and w and h then
        return (left + w / 2) * q, (bottom + h) * q, w * q, h * q, q
    end
    return nil
end

function Skin:StartSettle(dialog)
    local frame = self.frame
    self:Update()
    local ui = UIParent:GetEffectiveScale()
    local x, top, width, height = self:DialogPlace(dialog)
    if not (x and top and width and frame:GetWidth() > 0) then error("DialogueUI's window has no place") end
    -- Its own scale, and the one at which it is drawn as wide as the dialog.
    local to = frame.spokenBaseScale or 1
    local from = width / frame:GetWidth()
    local toLeft, toTop = self:Home()
    local left = (x - width / 2) * ui
    local bendX, bendY = BowOf(left, top * ui, toLeft, toTop, SETTLE_BOW)
    self.settling = { time = 0, from = from, to = to,
        left = left, top = top * ui, height = height * ui, toLeft = toLeft, toTop = toTop, bendX = bendX, bendY = bendY }
    -- In full at once, where the dialog was: no fade, so not one image either (Update above may
    -- have it waiting to fade in). Its paper alone: its words come in as it lands (Skin:LandStep).
    self.wanted, self.fadeTime, self.preparing, self.arming = true, nil, nil, nil
    self:SetLevel(1)
    self:HideWords()
    frame:Show()
    self:SettleStep(0)
end

--- The window lifted off the dialog, a touch larger and its shadow thrown; flown to where it rests
--- on a curve, shrinking to its own size and height, its shadow drawn in; then landing
--- (Skin:LandStep).
function Skin:SettleStep(elapsed)
    local settling, frame = self.settling, self.frame
    settling.time = settling.time + elapsed
    local t = settling.time
    local lift = Smooth(Clamp(t / SETTLE_LIFT, 0, 1))
    local u = Clamp((t - SETTLE_LIFT) / SETTLE_TIME, 0, 1)
    local eased = EaseInOut(u)
    local ui = UIParent:GetEffectiveScale()
    -- Grown about its middle as it is lifted, back to size as it lands.
    local grow = 1 + SETTLE_GROW * lift * (1 - eased)
    local base = Lerp(settling.from, settling.to, eased)
    local scale = base * grow
    frame:SetScale(scale)
    self:FitControls()
    local pixels = ui * scale
    local toHeight = (self.settledHeight or frame:GetHeight()) * ui * settling.to
    local height = Lerp(settling.height, toHeight, eased)
    local width = (frame:GetWidth() or 0) * ui * base
    local left = Bend(settling.left, settling.bendX or settling.left, settling.toLeft, eased) - (grow - 1) * width / 2
    -- Up a touch as it is lifted, the curve starting from there.
    local rise = SETTLE_RISE * ui * lift
    local top = Bend(settling.top + rise, settling.bendY or settling.top, settling.toTop, eased) + (grow - 1) * height / 2
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left / pixels, top / pixels)
    frame:SetHeight(height * grow / pixels)
    -- Its shadow thrown as it is lifted, drawn in as it comes down.
    self:ShadowUnder((1 - 0.7 * eased) * lift, 0.5 * lift * (1 - 0.3 * eased))
    if u == 1 then
        self.settling = nil
        frame:SetScale(settling.to)
        self:PlaceHome()
        self:Layout()
        self.landing = { time = 0 }
    end
end

--- This window's words, title and buttons out of sight, its paper left (Skin:StartSettle).
function Skin:HideWords()
    self.wordsHidden, self.wordsAlpha = true, 0
    if self.content then self:PaintContent() end
    if Transcript.frame and Transcript.frame:GetParent() ~= self.content then Transcript.frame:SetAlpha(0) end
end

--- Its words at `alpha`; whole again, as this window draws them, at 1.
function Skin:ShowWords(alpha)
    if alpha >= 1 then self.wordsHidden, alpha = nil, 1 end
    self.wordsAlpha = alpha
    if self.content then self:PaintContent() end
    if Transcript.frame and self.content and Transcript.frame:GetParent() ~= self.content then Transcript.frame:SetAlpha(alpha) end
end

--- Landed where it rests: giving under it and back as it touches down, its shadow drawn in, its
--- words fading in on its paper.
function Skin:LandStep(elapsed)
    local landing = self.landing
    landing.time = landing.time + elapsed
    local t = landing.time
    if self.wordsHidden then self:ShowWords(Smooth(Clamp(t / CONTENT_IN, 0, 1))) end
    self:Give(landing, Bounce(t))
    local shadow = 1 - Smooth(Clamp(t / 0.25, 0, 1))
    self:ShadowUnder(0.3 * shadow, 0.35 * shadow)
    if t >= LAND_TIME then self:StopLanding() end
end

--- The flight from the dialog cut short: where it rests at once, at its own size.
function Skin:StopSettle()
    if not self.settling then return end
    local frame = self.frame
    self.settling = nil
    frame:SetScale(frame.spokenBaseScale or 1)
    self:PlaceHome()
    if self.shadow then self.shadow:Hide() end
    if not self:Defer("refresh") then self:Layout() end
end

function Skin:StopLanding()
    local landing = self.landing
    self.landing = nil
    if self.wordsHidden then self:ShowWords(1) end
    if self.shadow then self.shadow:Hide() end
    if landing then self:Rest(landing) end
end

--- This window's own shadow, `reach` of the way thrown (down and right) and `alpha` dark: a frame
--- of its own under it, never part of it.
function Skin:ShadowUnder(reach, alpha)
    local frame = self.frame
    local shadow = self.shadow
    if not shadow then
        shadow = CreateFrame("Frame", nil, UIParent)
        shadow:EnableMouse(false)
        shadow.texture = shadow:CreateTexture(nil, "BACKGROUND")
        shadow.texture:SetAllPoints()
        self.shadow = shadow
    end
    if alpha <= 0.001 then shadow:Hide(); return end
    -- Its art and place in the window's strata once as it shows; each frame only where and how dark.
    if not shadow:IsShown() then
        shadow.texture:SetTexture(ShadowArt())
        shadow:SetFrameStrata(frame:GetFrameStrata())
        shadow:SetFrameLevel(math.max(0, frame:GetFrameLevel() - 1))
        shadow:Show()
    end
    PlaceShadow(shadow, frame, 8 * reach, -12 * reach, 18)
    shadow:SetAlpha(alpha)
end

--- This window moved `offset` (UIParent's units, up) off where it rests, and back (Skin:Rest).
function Skin:Give(state, offset)
    local frame = self.frame
    if not state.rest then
        local point, relativeTo, relativePoint, x, y = frame:GetPoint(1)
        if not point then return end
        state.rest = { point, relativeTo, relativePoint, x, y }
    end
    local rest = state.rest
    frame:ClearAllPoints()
    frame:SetPoint(rest[1], rest[2], rest[3], rest[4], rest[5] + offset / (frame:GetScale() or 1))
end

function Skin:Rest(state)
    if not state.rest then return end
    state.rest = nil
    self:PlaceHome()
end

---------------------------------------------------------------- the dialog's words fading first
-- DialogueUI's dialog and this window lay out the same line differently (title, paragraphs,
-- buttons, pages), so swapping one for the other would show all of that change at once. As the
-- dialog closes on its own line or on one it queued, its words, buttons and header fade on
-- DialogueUI's own window first, over CONTENT_OUT; then it closes and paper alone flies, this
-- window's or the queued line's page. A close with nothing to hand on is at once.
-- The dialog's frames that are its paper, not its words: the quest window's background, the book
-- view's footer (its torn foot; its divider line fades with the words).
local PAPER_FRAMES = { "BackgroundFrame", "Footer" }

--- Whether `dialog` closing now hands a line on: its own, which this window settles out of, or one
--- it queued, whose page goes behind this window (Skin:Settle).
function Skin:FadesOnClose(dialog)
    return self:IsEnabled() and self.frame ~= nil and self.frame:GetParent() == UIParent
        and PlayerFrame:Current() ~= nil and (self:Owns(dialog) or self:QueuedBy(dialog) ~= nil)
end

--- Whether the game still has the player talking to an NPC (gossip or a quest giver), as DialogueUI
--- asks before it closes its window. False where the client cannot say.
local function Interacting(manager, types)
    return manager.IsInteractingWithNpcOfType(types and types.Gossip or 3)
        or manager.IsInteractingWithNpcOfType(types and types.QuestGiver or 4)
end
local function TalkingToNPC()
    local manager = C_PlayerInteractionManager
    if not (manager and manager.IsInteractingWithNpcOfType) then return false end
    local ok, talking = pcall(Interacting, manager, Enum and Enum.PlayerInteractionType)
    return ok and talking == true
end

--- A quest page closed. Where DialogueUI expects no page to follow, its window closes now, or as
--- soon as the conversation with the NPC is over (Skin:WatchQuestClose); otherwise DialogueUI
--- closes it.
function Skin:QuestFinished(dialog)
    if self.closing or not dialog:IsShown() then return end
    local ok, fades = pcall(self.FadesOnClose, self, dialog)
    if not (ok and fades) then return end
    local known, delay = pcall(function() return dialog.GetQuestFinishedDelay and dialog:GetQuestFinishedDelay() end)
    if not (known and type(delay) == "number" and delay < FOLLOWS) then return end
    if not TalkingToNPC() then return self:FadeDialogOut(dialog, self.dialogHides[dialog]) end
    self.questClose = { dialog = dialog, time = 0 }
    self:DriveClose()
end

--- A quest page waiting for the conversation with its NPC to end, closed when it has; given up on
--- after QUEST_WAIT, or once the page is gone.
function Skin:WatchQuestClose(elapsed)
    local watch = self.questClose
    if not watch or self.closing then return end
    watch.time = watch.time + elapsed
    if not watch.dialog:IsShown() or watch.time > QUEST_WAIT then
        self.questClose = nil
    elseif not TalkingToNPC() then
        self.questClose = nil
        self:FadeDialogOut(watch.dialog, self.dialogHides[watch.dialog])
    end
end

--- The close's steps driven by a frame of no parent: DialogueUI may be hiding the interface.
function Skin:DriveClose()
    if not self.closeDriver then
        self.closeDriver = CreateFrame("Frame")
        self.closeDriver:SetScript("OnUpdate", function(_, elapsed) self:CloseStep(elapsed) end)
    end
    self.closeDriver:Show()
end

--- `dialog` closing: its words fade first, then `hide` (its own Hide) closes it.
function Skin:FadeDialogOut(dialog, hide)
    -- Another dialog still closing: closed now, its words given back.
    if self.closing then self:EndClose(true) end
    local paper = {}
    for _, key in ipairs(PAPER_FRAMES) do
        if type(dialog[key]) == "table" then paper[dialog[key]] = true end
    end
    local parts = {}
    local children = { dialog:GetChildren() }
    for index = 1, table.getn(children) do
        local child = children[index]
        if not paper[child] then table.insert(parts, { part = child, alpha = child:GetAlpha() or 1 }) end
    end
    local footer = type(dialog.Footer) == "table" and dialog.Footer.FooterDivider
    if type(footer) == "table" and footer.GetAlpha then table.insert(parts, { part = footer, alpha = footer:GetAlpha() or 1 }) end
    self.closing = { dialog = dialog, hide = hide, time = 0, parts = parts }
    self:DriveClose()
end

function Skin:CloseStep(elapsed)
    self:WatchQuestClose(elapsed)
    local closing = self.closing
    if not closing then
        if self.closeDriver and not self.questClose then self.closeDriver:Hide() end
        return
    end
    closing.time = closing.time + elapsed
    local left = 1 - Smooth(Clamp(closing.time / CONTENT_OUT, 0, 1))
    for _, entry in ipairs(closing.parts) do entry.part:SetAlpha(entry.alpha * left) end
    if closing.time >= CONTENT_OUT then self:EndClose(true) end
end

--- The dialog's words given back and, with `hide`, it closed in the same moment, so they are never
--- seen back. Given back after the close, DialogueUI hiding it again from its own OnHide would read
--- them faded.
function Skin:EndClose(hide)
    local closing = self.closing
    if not closing then return end
    self.closing = nil
    if self.closeDriver then self.closeDriver:Hide() end
    for _, entry in ipairs(closing.parts) do entry.part:SetAlpha(entry.alpha) end
    if hide then closing.hide(closing.dialog) end
end

--- DialogueUI showing the dialog again before it closed (another page, another line): it stays.
function Skin:CancelDialogFade(dialog)
    if self.questClose and self.questClose.dialog == dialog then self.questClose = nil end
    local closing = self.closing
    if closing and closing.dialog == dialog then self:EndClose(false) end
end

---------------------------------------------------------------- a dialog's line joining the queue
-- A dialog closing while another line plays (a gravestone read during a quest's line): its bare
-- page flies from where the dialog was to this window, comes down low on it with its foot showing,
-- and slides up behind it. This window gives as it goes under, and its count ripples. The page is a
-- frame of its own, never part of this window, which may be one image while it fades in
-- (Skin:Buffer).

--- A line joining the queue: when, and with which open dialog.
function Skin:Queued(clip)
    if type(clip) ~= "table" or not self.queuedAt then return end
    self.queuedAt[clip] = GetTime()
    local taken = false
    for _, dialog in ipairs(self.dialogs) do
        if dialog:IsShown() then self.sessions[dialog][clip] = true; taken = true end
    end
    -- Just after its dialog closed with nothing of its own to hand on: the dialog's after all, and
    -- it settles out of where the dialog was, or its page goes behind, as it would have.
    local closed = self.justClosed
    if taken or not closed then return end
    self.justClosed = nil
    local from = DIALOG_SOURCES[self.dialogNames[closed.dialog] or ""]
    local key = clip.source and clip.source.key
    if GetTime() - closed.at > JUST_AFTER or closed.dialog:IsShown() or not (from and key and from[key]) then return end
    self.sessions[closed.dialog] = setmetatable({ [clip] = true }, { __mode = "k" })
    self:Settle(closed.dialog)
end

--- A dialog opening: its lines are the ones queued while it is open, and those queued just before
--- it showed (JUST_BEFORE).
function Skin:StartSession(dialog)
    local lines = setmetatable({}, { __mode = "k" })
    local now = GetTime()
    for _, clip in ipairs(SoundQueue.sounds) do
        local at = self.queuedAt[clip]
        if at and now - at <= JUST_BEFORE then lines[clip] = true end
    end
    self.sessions[dialog] = lines
end

--- Whether `dialog` queued the line playing: closing on it, this window takes the dialog's place.
function Skin:Owns(dialog)
    local lines = self.sessions and self.sessions[dialog]
    local clip = PlayerFrame:Current()
    return lines ~= nil and clip ~= nil and lines[clip] == true
end

--- The page's lines kept as the quest window turns to another page.
function Skin:KeepEarlier(dialog)
    local earlier = self.earlier[dialog] or setmetatable({}, { __mode = "k" })
    for clip in pairs(self.sessions[dialog] or {}) do earlier[clip] = true end
    self.earlier[dialog] = earlier
end

--- Whether an earlier page of `dialog`, still open since, queued the line playing.
function Skin:OwnedEarlier(dialog)
    local lines = self.earlier and self.earlier[dialog]
    local clip = PlayerFrame:Current()
    return lines ~= nil and clip ~= nil and lines[clip] == true
end

--- The first line waiting behind the one playing that `dialog` queued.
function Skin:QueuedBy(dialog)
    local lines = self.sessions and self.sessions[dialog]
    if not lines then return nil end
    for index, clip in ipairs(SoundQueue.sounds) do
        if index > 1 and lines[clip] then return clip end
    end
    return nil
end

--- The page and the count's ripple: built once, out of this window.
function Skin:TuckFrames()
    if self.card then return self.card end
    local card = CreateFrame("Frame", nil, UIParent)
    card:Hide()
    card:EnableMouse(false)
    card.shadow = card:CreateTexture(nil, "BACKGROUND", nil, -8)
    card.strips = {}
    for index = 1, 3 do card.strips[index] = card:CreateTexture(nil, "BACKGROUND", nil, -1) end
    card:SetScript("OnUpdate", function(_, elapsed) self:TuckStep(elapsed) end)
    self.card = card
    local ripple = CreateFrame("Frame", nil, UIParent)
    ripple:Hide()
    ripple:EnableMouse(false)
    ripple:SetSize(1, 1)
    ripple.text = ripple:CreateFontString(nil, "OVERLAY")
    ripple.text:SetPoint("CENTER")
    self.ripple = ripple
    return card
end

--- The page as the dialog showed it, its words faded from it (Skin:FadeDialogOut): its paper alone,
--- `width` wide in UIParent's units, at `q` of DialogueUI's.
function Skin:DressCard(card, look, width, q)
    local file = PaperOf(look)
    local capWidth, capHeight = CapSize(look, width, q)
    card.capWidth, card.capHeight, card.look = capWidth, capHeight, look
    local strips = card.strips
    strips[1]:ClearAllPoints()
    strips[1]:SetPoint("CENTER", card, "TOP", 0, 0)
    strips[3]:ClearAllPoints()
    strips[3]:SetPoint("CENTER", card, "BOTTOM", 0, 0)
    DressStrips(strips, file, look, capHeight)
    card.shadow:SetTexture(ShadowArt())
end

--- What `dialog` queued goes behind this window: `clip`'s page lifted off where the dialog was.
function Skin:StartTuck(dialog, clip)
    local frame = self.frame
    local x, top, width, height, q = self:DialogPlace(dialog)
    local base = frame.spokenBaseScale or 1
    local toWidth, toHeight = frame:GetWidth() * base, (self.settledHeight or frame:GetHeight()) * base
    if not (x and top and width and toWidth > 0 and toHeight > 0) then return end
    local ui = UIParent:GetEffectiveScale()
    local left, topPx = self:Home()
    local card = self:TuckFrames()
    local look = LookOf(clip)
    self:DressCard(card, look, width, q)
    self.tuck = { time = 0, width = width, height = height,
        from = { x = x, y = top - height / 2 },
        to = { x = left / ui + toWidth / 2, y = topPx / ui - toHeight / 2, width = toWidth, height = toHeight } }
    -- Under this window, so it goes behind it.
    card:SetFrameStrata(frame:GetFrameStrata())
    card:SetFrameLevel(math.max(0, frame:GetFrameLevel() - 1))
    card:Show()
    self:DrawTuck(self.tuck)
end

function Skin:TuckStep(elapsed)
    local tuck = self.tuck
    if not tuck then
        if self.card then self.card:Hide() end
        return
    end
    tuck.time = tuck.time + elapsed
    local ok, err = pcall(self.DrawTuck, self, tuck)
    if not ok then
        self:StopTuck()
        if geterrorhandler then geterrorhandler()(err) end
    end
end

function Skin:DrawTuck(tuck)
    local card, from, to, t = self.card, tuck.from, tuck.to, tuck.time
    local landed = SETTLE_LIFT + SETTLE_TIME
    local lift = Smooth(Clamp(t / SETTLE_LIFT, 0, 1))
    local fly = EaseInOut(Clamp((t - SETTLE_LIFT) / SETTLE_TIME, 0, 1))
    local slide = EaseOutCubic(Clamp((t - landed) / TUCK_SLIDE, 0, 1))

    -- Lifted a touch, then the window's shape at TUCK_SIZE of it, so it fits behind it; bending a
    -- little across as it flies, as paper does.
    local endScale = to.width * TUCK_SIZE / tuck.width
    local scale = 1 + 0.03 * lift + (endScale - 1.03) * fly
    local endHeight = to.height * TUCK_SIZE / endScale
    local height = math.max(tuck.height + (endHeight - tuck.height) * fly, card.capHeight * 1.05)
    local bend = 1 - 0.05 * math.sin(math.pi * fly)
    local width = tuck.width * bend
    card.strips[1]:SetSize(card.capWidth * bend, card.capHeight)
    card.strips[3]:SetSize(card.capWidth * bend, card.capHeight)

    -- Up off the dialog's place, over in an arc, down low on the window, its foot showing under
    -- it, then up behind it.
    local startX, startY = from.x, from.y + 4 * lift
    local landX, landY = to.x, to.y - to.height * TUCK_LOW
    local distance = math.sqrt((landX - startX) * (landX - startX) + (landY - startY) * (landY - startY))
    local bendX, bendY = (startX + landX) / 2, math.max(startY, landY) + 0.3 * distance
    local x, y = Bend(startX, bendX, landX, fly), Bend(startY, bendY, landY, fly)
    y = y + (to.y - landY) * slide
    card:SetScale(scale)
    card:SetSize(width, height)
    card:ClearAllPoints()
    card:SetPoint("CENTER", UIParent, "BOTTOMLEFT", x / scale, y / scale)

    card:SetAlpha(1 - Smooth(Clamp((t - landed - TUCK_SLIDE * 0.3) / (TUCK_SLIDE * 0.7), 0, 1)))

    local reach = (1 - fly * 0.7) * lift
    PlaceShadow(card.shadow, card, 7 * reach, -10 * reach, 16, scale)
    card.shadow:SetAlpha(0.55 * lift * (1 - 0.45 * fly) * (1 - slide))

    -- The window giving as the page goes under it: up a little and back, settling.
    local nudge = t - (landed - 0.05)
    if nudge >= 0 and nudge <= LAND_TIME then
        self:Give(tuck, Bounce(nudge))
    elseif nudge > LAND_TIME then
        self:Rest(tuck)
    end

    local taken = t - (landed + TUCK_SLIDE * 0.45)
    if taken >= 0 then
        if not tuck.taken then
            tuck.taken = true
            self:StartRipple()
        end
        local g = Clamp(taken / TUCK_RIPPLE, 0, 1)
        local ripple = self.ripple
        if ripple:IsShown() then
            local r = EaseOutCubic(g)
            local rippleScale = 1 + 1.3 * r
            ripple:SetScale(rippleScale)
            ripple:ClearAllPoints()
            ripple:SetPoint("CENTER", UIParent, "BOTTOMLEFT", tuck.rippleX / rippleScale, tuck.rippleY / rippleScale)
            ripple:SetAlpha(0.9 * (1 - r))
        end
        if g >= 1 then self:StopTuck() end
    end
end

--- This window's count, if it shows one, about to ripple out from where it is.
function Skin:StartRipple()
    local tuck, frame, ripple = self.tuck, self.frame, self.ripple
    local scale = frame:GetScale() or 1
    local count = self.count
    local cx, cy
    if count and count:IsShown() and (self.tail.counted or 0) > 0 and count.GetCenter then cx, cy = count:GetCenter() end
    if type(cx) ~= "number" or type(cy) ~= "number" then return end
    local ui = UIParent:GetEffectiveScale()
    local pixels = frame:GetEffectiveScale()
    tuck.rippleX, tuck.rippleY = cx * pixels / ui, cy * pixels / ui
    local face, size = count:GetFont()
    local colors = self.colors or Theme:Colors((self.look or LOOKS.quest).palette)
    ripple:SetFrameStrata(frame:GetFrameStrata())
    ripple:SetFrameLevel(frame:GetFrameLevel() + 41)
    ripple.text:SetFont(face, math.max(6, Round((size or 12) * scale)), "")
    ripple.text:SetTextColor(colors.title[1], colors.title[2], colors.title[3])
    ripple.text:SetText(count:GetText() or "")
    ripple:Show()
end

--- Done, or cut short (a dialog opening, another closing): the page and the ripple gone, this
--- window where it rests.
--- Fading in from where it is, now and as itself, not one image: no wait to be still. As itself
--- the paper comes in over the first half and the rest over the second, so it takes twice as long
--- as a fade as one image, each half as long as that whole fade.
function Skin:FadeInAsItself()
    self.preparing, self.arming, self.turning = nil, nil, nil
    self.wanted = true
    self:Unbuffer()
    self:Undeafen()
    Transcript:Release()
    self.frame:Show()
    self:StartFade(true)
    self.fadeSlow = 2
end

--- Whether this window is coming in or in, and itself, not one image: a tuck may run against it.
function Skin:Settled()
    return self.wanted and self.frame:IsShown() and not self.buffered and not self.preparing and not self.arming
end

--- `clip`'s page from `dialog` goes behind this window: now if the window is itself, or once it
--- is. As one image, or still waiting to fade in, nothing may move it.
function Skin:TuckWhenShown(dialog, clip)
    self.tuckWaiting = nil
    if not self:Settled() then
        self.tuckWaiting = { dialog = dialog, clip = clip }
        return
    end
    local ok, err = pcall(self.StartTuck, self, dialog, clip)
    if not ok then
        self:StopTuck()
        if geterrorhandler then geterrorhandler()(err) end
    end
end

function Skin:StopTuck()
    local tuck = self.tuck
    self.tuck = nil
    if self.card then self.card:Hide() end
    if self.ripple then self.ripple:Hide() end
    if tuck then self:Rest(tuck) end
end

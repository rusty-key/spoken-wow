setfenv(1, SpokenEnv)

-- The speaker's round face, as every narrator style and a feature addon's page draw it: the
-- speaker in a viewport clipped round, the line's badge on a small dark disc at the lower right,
-- and, on the ring faces, the Small Window's ring. Each window keeps its own frame; filling it is
-- here, so the face, the badge and the wait for a creature the client has not cached behave alike.
Face = {}
local ART = [[Interface\AddOns\Spoken\Textures\]]
-- Portrait badges by bullet id. Quests use trimmed copies of their own glyphs; readables
-- and places take native ones, since their registered bullet (or none) is not a badge.
local BADGES = {
    ["quest-accept"] = ART .. "MinimalBulletAccept",
    ["quest-progress"] = ART .. "MinimalBulletProgress",
    ["quest-complete"] = ART .. "MinimalBulletComplete",
    gossip = ART .. "MinimalBulletGossip",
    book = [[Interface\GossipFrame\TrainerGossipIcon]],
    zone = [[Interface\WorldMap\UI-World-Icon]],
}
Face.BADGES = BADGES
-- The smallest a ring face's badge is drawn, on a face smaller than the Small Window's.
local BADGE_LEAST = 12

--- The badge for a bullet id: Spoken's own for quests, gossip, readables and places, else the texture
--- a module registered for it (Spoken:RegisterBullet), else nil.
function Face.BadgeFor(id)
    if id == nil then return nil end
    return BADGES[id] or (Bullets and Bullets[id] and Bullets[id].texture) or nil
end

--- `face`'s badge for bullet `id`, with its dark disc (`badgeBackground`) only under a badge.
function Face.SetBadge(face, id)
    -- A flat face in EllesmereUI's look has no badge: its glyphs are round.
    local texture = not face.squared and Face.BadgeFor(id) or nil
    face.badge:SetTexture(texture)
    face.badge:SetShown(texture ~= nil)
    if face.badgeBackground then face.badgeBackground:SetShown(texture ~= nil) end
end

--- The round face, `size` across: a dark backing, the speaker in a viewport clipped to it, the
--- ring, and the badge on its disc. Placed on the ring art's 71-unit grid, so it is the Small
--- Window's portrait (90) at any size. `level` is the face's frame level, set before its ring is
--- built above it; the badge is at least `least` across (BADGE_LEAST by default). Bronze Border
--- tints the ring with the round buttons'.
function Face.Build(parent, size, level, least)
    local host = CreateFrame("Frame", nil, parent)
    host:SetSize(size, size)
    if level then host:SetFrameLevel(level) end
    local function At(units) return size * units / 71 end
    local background = host:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetTexture(ART .. "MinimalPortraitBackground")

    host.viewport = CreateFrame("Frame", nil, host)
    host.viewport:SetSize(size * 78 / 90, size * 78 / 90)
    host.viewport:SetPoint("CENTER", host, "TOPLEFT", At(35), -At(34))
    if host.viewport.SetClipsChildren then host.viewport:SetClipsChildren(true) end
    local chrome = CreateFrame("Frame", nil, host)
    chrome:SetAllPoints()
    chrome:SetFrameLevel(host:GetFrameLevel() + 8)
    -- At least BADGE_LEAST: at a small face's own scale the glyph is too small to make out.
    local badge = math.max(size * 16 / 90, least or BADGE_LEAST)
    -- The badge's socket is open in the ring: without this disc the speaker's face shows through it.
    host.badgeBackground = chrome:CreateTexture(nil, "BACKGROUND")
    host.badgeBackground:SetSize(badge * 1.5, badge * 1.5)
    host.badgeBackground:SetPoint("CENTER", host, "TOPLEFT", At(56.5), -At(56.5))
    host.badgeBackground:SetTexture(ART .. "MinimalPortraitMask")
    host.badgeBackground:SetVertexColor(.04, .04, .035, 1)
    host.ring = chrome:CreateTexture(nil, "ARTWORK")
    host.ring:SetAllPoints()
    host.ring:SetTexture(ART .. "MinimalPortraitRing")
    Actions.TintWithRings(host.ring)
    host.badge = chrome:CreateTexture(nil, "OVERLAY")
    host.badge:SetSize(badge, badge)
    host.badge:SetPoint("CENTER", host, "TOPLEFT", At(56.5), -At(56.5))
    host.background, host.chrome = background, chrome
    Face.SetBadge(host, nil)
    if Ellesmere then Ellesmere:When(function(skin) Face.Square(skin, host) end) end
    return host
end

--- The face as a flat box in EllesmereUI's look: no ring, the speaker cut square in a 1 px edge on a
--- dark backing, and the badge on a small dark square in place of the ring's socket.
function Face.Square(skin, face)
    if face.squared then return end
    face.squared = true
    face.ring:SetAlpha(0)
    face.background:SetAlpha(0)
    local viewport = face.viewport
    face.box = Ellesmere:Box(skin, viewport, face.chrome, true)
    face.disc = Ellesmere:Disc(skin, face, viewport)
    local r, g, b = skin.GetPanelColor()
    local badge = face.badge:GetWidth() or 12
    face.badgeBackground:SetColorTexture(r or 0.08, g or 0.08, b or 0.08, 1)
    face.badgeBackground:SetVertexColor(1, 1, 1, 1)
    face.badgeBackground:SetSize(badge + 4, badge + 4)
    Face.SetBadge(face, nil)
    Face.Fit(face)
end

--- In EllesmereUI's look, a face round whatever it shows: a creature, an icon, the book. Only a 3D
--- model (viewport.active "model", drawn when no face could be captured), which no mask cuts, keeps
--- the square.
function Face.Fit(face)
    if not face.squared then return end
    local viewport = face.viewport
    local round = (face.still and face.still:IsShown()) or viewport.active ~= "model"
    round = round and true or false
    if face.round ~= round then
        face.round = round
        viewport.squareMask = not round
        Ellesmere.Shape(face.box, face.disc, round)
    end
    local static = viewport.active == "static" and viewport.activeFrame or nil
    -- Each one there: a face built by Face.Build has no still, and a list stopping at the first
    -- nil left a captured face unmasked after a 3D model.
    for _, texture in pairs({ face.still or false, viewport.texture or false, static or false }) do
        if texture then StaticPortrait:Mask(viewport, texture) end
    end
end

--- `clip`'s speaker in `face.viewport`: the face captured from their unit or creature, else the
--- clip's own picture (the book for a creature not cached yet), masked round, and its badge.
function Face.Show(face, clip)
    local viewport = face.viewport
    if not StaticPortrait:Configure(viewport, clip) then Portrait:Configure(viewport, clip) end
    if viewport.active == "texture" and viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    Face.SetBadge(face, clip and clip.present and clip.present.bullet)
    Face.Fit(face)
end

--------------------------------------------------------------------------------
-- A speaker's face on a page of a feature addon's (Spoken:CreateSpeakerFace)
--------------------------------------------------------------------------------

-- What a face shows where it has no face to draw, as Present gives it: the book for a creature,
-- a posted notice for an object or an item with no picture of its own.
local BOOK = ART .. "Book"
local NOTICE = [[Interface\Icons\INV_Misc_Note_01]]
local ICON_CROP = { .08, .92, .08, .92 }
local UNITS = { "npc", "target", "mouseover", "focus" }
-- How long a face drawn before the client has its creature keeps asking for it. StaticPortrait
-- stops asking the server after 5 seconds; the face keeps the book from then on.
local FACE_WAIT = 6
local Speaker = {}

-- The presentation spec for a speaker, as Present:Portrait builds it for a line.
local function SpecFor(speaker)
    if speaker.objectOrItem then
        return { kind = "texture", texture = speaker.icon or NOTICE, texCoord = speaker.iconCrop or ICON_CROP }
    end
    return { kind = "model", creatureID = speaker.creatureID, animation = 60,
        fallback = { kind = "texture", texture = BOOK } }
end

-- The speaker's unit-frame portrait, as StaticPortrait draws it: from its unit while one with its
-- GUID is about, else from its creature's appearance. Painted on the face's own texture rather
-- than StaticPortrait's cached one, which moves to whichever viewport shows it last: two faces of
-- one NPC on a page, or a page and the Small Window, would take it from each other.
local function Still(face, speaker)
    local guid = speaker.guid
    -- A quest-log GUID is made up, and names no unit.
    if guid and UnitGUID and SetPortraitTexture and not string.find(guid, "^Creature%-0%-0%-0%-0%-") then
        for _, unit in ipairs(UNITS) do
            if NotSecret(UnitGUID(unit)) == guid then
                SetPortraitTexture(face.still, unit)
                return true
            end
        end
    end
    local display = SetPortraitTextureFromCreatureDisplayID
        and (speaker.displayID or speaker.creatureID and StaticPortrait:Prime(speaker.creatureID))
    if not display then return false end
    SetPortraitTextureFromCreatureDisplayID(face.still, display)
    return true
end

--- Draws the speaker: their still where there is one, else the fallback picture (the book, or an
--- object's or item's picture), never an empty socket. A creature the client has not cached yet
--- shows the book and is asked for every frame the face is shown, until it comes.
function Speaker:Draw()
    local speaker, viewport = self.speaker, self.viewport
    local spec = SpecFor(speaker)
    self.waiting = nil
    if spec.kind == "model" and Still(self, speaker) then
        -- Whatever Portrait drew here before, put away.
        Portrait:Configure(viewport, nil)
        self.still:Show()
    else
        self.still:Hide()
        if spec.kind == "model" and speaker.creatureID and not speaker.displayID then
            self.waiting, self.since = speaker.creatureID, GetTime()
        end
        Portrait:Configure(viewport, { present = { portrait = spec.kind == "model" and spec.fallback or spec } })
        if viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    end
    Face.Fit(self)
    self:SetScript("OnUpdate", self.waiting and Speaker.Wait or nil)
end

function Speaker.Wait(self)
    if not self.waiting then
        self:SetScript("OnUpdate", nil)
    elseif StaticPortrait:Prime(self.waiting) then
        self:Draw()
    elseif GetTime() - self.since > FACE_WAIT then
        self.waiting = nil
        self:SetScript("OnUpdate", nil)
    end
end

function Speaker:SetSpeaker(speaker)
    self.speaker = speaker or {}
    Face.SetBadge(self, self.speaker.bullet)
    self:Draw()
end

--- The Small Window's portrait, `size` across, on `parent`, for a page to show who speaks: a ring
--- face with SetSpeaker.
function Face.CreateSpeaker(parent, size)
    local face = Face.Build(parent, size)
    face.still = face.viewport:CreateTexture(nil, "ARTWORK")
    face.still:SetAllPoints()
    face.still:Hide()
    StaticPortrait:Mask(face.viewport, face.still)
    face.SetSpeaker, face.Draw = Speaker.SetSpeaker, Speaker.Draw
    face:SetSpeaker(nil)
    return face
end

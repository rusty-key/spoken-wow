setfenv(1, SpokenEnv)

-- Native unit-frame portraits, captured while the speaker's unit token exists.
-- Keep the Texture region itself: generated portraits are not ordinary file IDs
-- that can safely be copied through GetTexture(). A queued line must not switch
-- to a different face just because the player changes target.
StaticPortrait = { cache = {}, count = 0, age = 0 }
local ART = [[Interface\AddOns\Spoken\Textures\]]
local UNITS = { "npc", "target", "mouseover", "focus" }
-- An object's or an item's GUID. Anything else may have a face.
local function Faceless(guid)
    return string.find(guid, "^GameObject%-") or string.find(guid, "^Item%-")
end
local function Identity(clip)
    local spec = clip and clip.present and clip.present.portrait
    if not spec or spec.kind ~= "model" then return end
    local guid = spec.unitGUID or clip.unitGUID
    -- Quest-log playback can carry a synthetic GUID rather than a world unit.
    if guid and string.find(guid, "^Creature%-0%-0%-0%-0%-") then guid = nil end
    -- Only a creature has a face to capture. The game paints a wanted poster or any other object
    -- as an empty black disc, so such a line takes its own picture (Portrait) instead.
    if guid and Faceless(guid) then return end
    return spec, guid, spec.creatureID
end
local CreatureID = Spoken.CreatureID
function StaticPortrait:InQueue(entry)
    for _, clip in ipairs(SoundQueue.sounds) do
        local spec, guid, creature = Identity(clip)
        if spec and (guid == entry.key or (not guid and creature == entry.creature)) then return true end
    end
    return false
end
function StaticPortrait:Acquire(key)
    if self.count < 32 then
        if not self.storage then
            self.storage = CreateFrame("Frame", nil, UIParent)
            self.storage:Hide()
        end
        self.count = self.count + 1
        return { texture = self.storage:CreateTexture(nil, "ARTWORK") }
    end
    local oldest
    for _, entry in pairs(self.cache) do
        if entry.texture ~= self.activeTexture and not self:InQueue(entry)
            and (not oldest or entry.age < oldest.age) then oldest = entry end
    end
    if oldest then
        self.cache[oldest.key] = nil
        oldest.texture:Hide()
        oldest.texture:SetParent(self.storage)
    end
    return oldest
end
-- Quest-log playback has no unit to photograph: the giver is wherever the player left them.
-- Its creature id is enough for the same kind of still. DressUpModel:SetCreature builds the
-- creature from the client's cache and GetDisplayInfo names its appearance in the same tick,
-- and SetPortraitTextureFromCreatureDisplayID draws that as a unit-frame portrait. A face met
-- later through a real unit is newer and wins over this one.
--
-- Creature id -> the appearance it answered with, kept so a face does not change between
-- clips. A creature the client has not cached answers a stand-in until its server replies to the
-- query SetCreature sent, so the face's window asks again every few frames (Resolved)
-- rather than waiting for a timer; one that never replies keeps the book. `asked` holds when
-- a creature was first and last asked: the watcher below captures on every mouseover, and
-- each of those must not become another SetCreature.
local displays, asked = {}, {}
local RETRY_SECONDS = 0.05
local GIVE_UP_SECONDS = 5

-- A model answers GetDisplayInfo with the creature it held before until the new one has loaded,
-- so one model asked about many creatures hands the first creature's face to the rest. Each
-- creature waiting for its appearance has a model of its own, taken from a small pool; a model
-- put back remembers what it last answered, and that answer is not believed on the first read
-- after it is given a new creature. The models are never parented and never shown: a shown model
-- draws a 3D scene every frame, and this client has hung its GPU on model rendering before.
local POOL_MOST = 16
local RESEND_SECONDS = 1
local pool, holder = {}, {}

-- A hidden model, or nil on a client that cannot make one.
local function NewModel()
    local ok, frame = pcall(CreateFrame, "DressUpModel")
    if not (ok and frame and frame.GetDisplayInfo) then return nil end
    frame:Hide()
    return frame
end

-- A model whose creature is not cached yet answers with a stand-in until the server replies: the
-- player's own appearance, or the one a model answers with when nothing is loaded in it. Neither
-- is any creature's. Both are read live, from a model of the player's and one never given anything.
local probes
local function Defaults()
    if probes == nil then
        probes = false
        local own, blank = NewModel(), NewModel()
        if own and blank and own.SetUnit then
            probes = { own = own, blank = blank }
        end
    end
    if not probes then return nil, nil end
    -- Read once a frame, however many creatures wait: the player's model is loaded again to read it.
    local now = GetTime()
    if probes.at ~= now then
        pcall(probes.own.SetUnit, probes.own, "player")
        local function Read(model)
            local display = model:GetDisplayInfo()
            return type(display) == "number" and display > 0 and display or nil
        end
        probes.at, probes.ownDisplay, probes.blankDisplay = now, Read(probes.own), Read(probes.blank)
    end
    return probes.ownDisplay, probes.blankDisplay
end

-- A model for `creature`: its own while it waits, else a free one, a new one under the pool's
-- size, or the one that has waited longest.
local function TakeModel(creature)
    local model = holder[creature]
    if model then return model end
    for _, each in ipairs(pool) do
        if not each.creature then model = each; break end
    end
    if not model and #pool < POOL_MOST then
        local frame = NewModel()
        if not (frame and frame.SetCreature) then return end
        model = frame
        pool[#pool + 1] = model
    end
    if not model then
        for _, each in ipairs(pool) do
            if not model or each.since < model.since then model = each end
        end
        holder[model.creature] = nil
    end
    if model.ClearModel then model:ClearModel() end
    model.creature, model.since, model.sent, model.fresh = creature, GetTime(), GetTime(), true
    holder[creature] = model
    model:SetCreature(creature)
    return model
end

local function Release(model)
    holder[model.creature] = nil
    model.creature = nil
end

local function DisplayFor(creature)
    if displays[creature] then return displays[creature] end
    if not (SetPortraitTextureFromCreatureDisplayID and CreateFrame) then return end
    local now = GetTime()
    local times = asked[creature]
    if times and (now - times.first > GIVE_UP_SECONDS or now - times.last < RETRY_SECONDS) then
        if now - times.first > GIVE_UP_SECONDS and holder[creature] then Release(holder[creature]) end
        return
    end
    if not times then times = { first = now }; asked[creature] = times end
    times.last = now
    local model = TakeModel(creature)
    if not model then return end
    local display = model:GetDisplayInfo()
    local answered = type(display) == "number" and display > 0
    local own, blank
    if answered then own, blank = Defaults() end
    local stale = display == own or display == blank or (model.fresh and display == model.answered)
    model.fresh = false
    if answered and not stale then
        displays[creature] = display
        model.answered = display
        Release(model)
        return display
    end
    -- Still nothing after a second: ask again, and take the answer of the moment for the old one.
    if now - model.sent >= RESEND_SECONDS then
        model.sent, model.fresh, model.answered = now, true, display
        model:SetCreature(creature)
    end
end

--- Start the client's round trip for a creature a portrait may soon be drawn from. Quest-log
--- play buttons call it (Spoken:PrimePortrait) as the log draws them, so the wait is usually
--- over by the click. Returns the creature's appearance once the client has it, else nil.
function StaticPortrait:Prime(creature)
    return DisplayFor(creature)
end

--- Whether the creature the viewport fell back to the book for has an appearance now. Asked
--- every frame by the window or the subtitle showing the face, which repaints when it does.
function StaticPortrait:Resolved()
    if self.waiting and DisplayFor(self.waiting) then
        self.waiting = nil
        return true
    end
    return false
end

function StaticPortrait:Keep(entry, key, creature)
    entry.key, entry.creature = key, creature
    self.age = self.age + 1
    entry.age = self.age
    self.cache[key] = entry
    return entry
end

function StaticPortrait:FromCreature(creature, known)
    local display = known or DisplayFor(creature)
    if not display then return end
    local key = "creature:" .. creature
    local entry = self:Acquire(key)
    if not entry then return end
    SetPortraitTextureFromCreatureDisplayID(entry.texture, display)
    entry.texture:SetTexCoord(0, 1, 0, 1)
    return self:Keep(entry, key, creature)
end
function StaticPortrait:Capture(clip, refreshGUID)
    local spec, guid, creature = Identity(clip)
    if not spec or not SetPortraitTexture or not UnitGUID then return end
    local cached = guid and self.cache[guid]
    if not guid and creature then
        for _, entry in pairs(self.cache) do
            if entry.creature == creature and (not cached or entry.age > cached.age) then cached = entry end
        end
    end
    for _, unit in ipairs(UNITS) do
        local actual = NotSecret(UnitGUID(unit))
        if actual and ((guid and actual == guid) or (not guid and creature and CreatureID(actual) == creature)) then
            local entry = self.cache[actual] or self:Acquire(actual)
            if not entry then return cached end
            -- The face in the DialogueUI window must not change while the window is one image: it is
            -- marked stale and painted once the window is itself again.
            local window = DialogueUIPlayer
            local frozen = window and window.Frozen and window.viewport and window:Frozen()
                and entry.texture:GetParent() == window.viewport
            if frozen and (entry.key ~= actual or refreshGUID == actual) then
                entry.stale = true
            elseif entry.key ~= actual or refreshGUID == actual or entry.stale then
                entry.stale = nil
                SetPortraitTexture(entry.texture, unit)
                entry.texture:SetTexCoord(0, 1, 0, 1)
                -- Drawn a moment after: the window waits for it before it is one image.
                if window and window.Touch and window.frame then window:Touch() end
            end
            return self:Keep(entry, actual, creature)
        end
    end
    if cached then self.age = self.age + 1; cached.age = self.age; return cached end
    if not guid and type(creature) == "number" then return self:FromCreature(creature, spec.displayID) end
end
function StaticPortrait:Mask(viewport, texture)
    if not texture.AddMaskTexture then return end
    if not viewport.roundMask then
        viewport.roundMask = viewport:CreateMaskTexture()
        viewport.roundMask:SetAllPoints()
        viewport.roundMask:SetTexture(ART .. "MinimalPortraitMask", "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
    end
    if texture.minimalMask ~= viewport.roundMask then
        if texture.minimalMask then texture:RemoveMaskTexture(texture.minimalMask) end
        texture:AddMaskTexture(viewport.roundMask)
        texture.minimalMask = viewport.roundMask
    end
end
function StaticPortrait:Release(viewport)
    if viewport.active == "static" then
        if viewport.activeFrame then viewport.activeFrame:Hide() end
        viewport.active, viewport.activeFrame, self.activeTexture = nil, nil, nil
    end
end
function StaticPortrait:Configure(viewport, clip)
    local spec, guid, creature = Identity(clip)
    self.waiting = nil
    if not spec then self:Release(viewport); return false end
    local entry = self:Capture(clip)
    if not entry and not guid and type(creature) == "number" then self.waiting = creature end
    if entry then
        if viewport.activeFrame ~= entry.texture then
            if viewport.active == "static" then self:Release(viewport)
            elseif viewport.activeFrame then
                local renderer = Renderers[viewport.active]
                if renderer then renderer.Release(viewport.activeFrame) end
            end
        end
        -- One texture per face, shared by the subtitle and the Small Window: the other may have
        -- taken it since, while this viewport still counts it as its own.
        if viewport.activeFrame ~= entry.texture or entry.texture:GetParent() ~= viewport then
            entry.texture:SetParent(viewport)
            entry.texture:ClearAllPoints()
            entry.texture:SetAllPoints()
            self:Mask(viewport, entry.texture)
        end
        viewport.active, viewport.activeFrame = "static", entry.texture
        self.activeTexture = entry.texture
        entry.texture:Show()
    else
        self:Release(viewport)
        local fallback = spec.fallback
        if not fallback or fallback.kind ~= "texture" then fallback = { kind = "texture", texture = ART .. "Book" } end
        Portrait:Configure(viewport, { present = { portrait = fallback } })
        if viewport.texture then self:Mask(viewport, viewport.texture) end
    end
    return true
end

Callbacks:Register("CLIP_QUEUED", function(clip) StaticPortrait:Capture(clip) end)
local watcher = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "GOSSIP_SHOW",
    "QUEST_DETAIL", "UNIT_PORTRAIT_UPDATE", "UNIT_MODEL_CHANGED" }) do watcher:RegisterEvent(event) end
watcher:SetScript("OnEvent", function(_, event, unit)
    unit = NotSecret(unit)
    local refreshGUID = (event == "UNIT_PORTRAIT_UPDATE" or event == "UNIT_MODEL_CHANGED") and unit
        and NotSecret(UnitGUID(unit))
    for _, clip in ipairs(SoundQueue.sounds) do StaticPortrait:Capture(clip, refreshGUID) end
    local skin = PlayerFrame.Skin and PlayerFrame:Skin()
    if skin and skin:HasClip() then skin:ConfigurePortrait() end
    if Subtitle.wanted and Subtitle.clip then Subtitle:ConfigurePicture(Subtitle.clip) end
end)
StaticPortrait.watcher = watcher

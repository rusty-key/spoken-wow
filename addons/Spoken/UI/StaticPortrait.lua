setfenv(1, SpokenEnv)

-- Native unit-frame portraits, captured while the speaker's unit token exists.
-- Keep the Texture region itself: generated portraits are not ordinary file IDs
-- that can safely be copied through GetTexture(). A queued line must not switch
-- to a different face just because the player changes target.
StaticPortrait = { cache = {}, count = 0, age = 0 }
local ART = [[Interface\AddOns\Spoken\Textures\]]
local UNITS = { "npc", "target", "mouseover", "focus" }
-- An object's or an item's GUID, in the modern form or the hex one of 2.4.3 to 5.4.8 (0xF11...
-- objects, 0x4... items). Anything else, a creature's hex GUID included, may have a face.
local function Faceless(guid)
    return string.find(guid, "^GameObject%-") or string.find(guid, "^Item%-")
        or string.find(guid, "^0x[Ff]11") or string.find(guid, "^0x4")
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
local function CreatureID(guid)
    if not guid then return end
    return tonumber(string.match(guid, "^Creature%-%d+%-%d+%-%d+%-%d+%-(%d+)%-"))
end
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
-- One model, never parented and never shown: a shown model draws a 3D scene every frame,
-- and this client has hung its GPU on model rendering before. nil until first asked for;
-- false on a client without what it takes, so it is never asked again.
local roller
-- Creature id -> the appearance it answered with, kept so a face does not change between
-- clips. A creature the client has not cached answers 0 until its server replies to the
-- query SetCreature sent, so MinimalPlayer's Tick asks again every few frames (Resolved)
-- rather than waiting for a timer; one that never replies keeps the book. `asked` holds when
-- a creature was first and last asked: the watcher below captures on every mouseover, and
-- each of those must not become another SetCreature.
local displays, asked = {}, {}
local RETRY_SECONDS = 0.05
local GIVE_UP_SECONDS = 5

local function Roller()
    if roller == nil then
        roller = false
        if SetPortraitTextureFromCreatureDisplayID then
            local ok, frame = pcall(CreateFrame, "DressUpModel")
            if ok and frame and frame.SetCreature and frame.GetDisplayInfo then
                frame:Hide()
                roller = frame
            end
        end
    end
    return roller or nil
end

local function DisplayFor(creature)
    if displays[creature] then return displays[creature] end
    local model = Roller()
    if not model then return end
    local now = GetTime()
    local times = asked[creature]
    if times and (now - times.first > GIVE_UP_SECONDS or now - times.last < RETRY_SECONDS) then return end
    if not times then times = { first = now }; asked[creature] = times end
    times.last = now
    model:SetCreature(creature)
    local display = model:GetDisplayInfo()
    if display and display > 0 then
        displays[creature] = display
        return display
    end
end

--- Start the client's round trip for a creature a portrait may soon be drawn from. Quest-log
--- play buttons call it (Spoken:PrimePortrait) as the log draws them, so the wait is usually
--- over by the click.
function StaticPortrait:Prime(creature)
    DisplayFor(creature)
end

--- Whether the creature the viewport fell back to the book for has an appearance now. Asked
--- every frame by MinimalPlayer, which repaints when it does.
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

function StaticPortrait:FromCreature(creature)
    local display = DisplayFor(creature)
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
        local actual = UnitGUID(unit)
        if actual and ((guid and actual == guid) or (not guid and creature and CreatureID(actual) == creature)) then
            local entry = self.cache[actual] or self:Acquire(actual)
            if not entry then return cached end
            -- The face on show in the DialogueUI window while it is one image is not painted anew: it
            -- must not change then. It is painted once the window is itself again (stale).
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
    if not guid and type(creature) == "number" then return self:FromCreature(creature) end
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

if not Version.IsAnyLegacy then
    Callbacks:Register("CLIP_QUEUED", function(clip) StaticPortrait:Capture(clip) end)
    local watcher = CreateFrame("Frame")
    for _, event in ipairs({ "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "GOSSIP_SHOW",
        "QUEST_DETAIL", "UNIT_PORTRAIT_UPDATE", "UNIT_MODEL_CHANGED" }) do watcher:RegisterEvent(event) end
    watcher:SetScript("OnEvent", function(_, event, unit)
        local refreshGUID = (event == "UNIT_PORTRAIT_UPDATE" or event == "UNIT_MODEL_CHANGED") and unit and UnitGUID(unit)
        for _, clip in ipairs(SoundQueue.sounds) do StaticPortrait:Capture(clip, refreshGUID) end
        local skin = PlayerFrame.Skin and PlayerFrame:Skin()
        if skin and skin:HasClip() then skin:ConfigurePortrait() end
        if Subtitle and Subtitle.wanted and Subtitle.clip then Subtitle:ConfigurePicture(Subtitle.clip) end
    end)
    StaticPortrait.watcher = watcher
end

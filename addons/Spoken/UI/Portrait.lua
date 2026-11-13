setfenv(1, SpokenEnv)

-- The portrait: what the frame shows beside the queue for the clip that is speaking.
--
-- A renderer per `kind`, so the player never learns what a GUID or a zone is. A clip's
-- presentation names a kind and the arguments that kind needs; three ship here, and a
-- feature addon may register its own through Spoken:RegisterPortraitRenderer.
--
--   { kind = "texture", texture = [[...]], texCoord = { l, r, t, b } }
--   { kind = "model",   creatureID = 196, animation = 60, fallback = { kind = "texture", ... } }
--   { kind = "none" }
--
-- A renderer's Update returns false when it has nothing to draw -- a model with no
-- creature, a creature the client has not cached -- and the portrait then draws the
-- spec's `fallback` instead, once.
Portrait = {}

local WAIT_FOR_ANIMATION_FINISH_BEFORE_IDLE = true

--------------------------------------------------------------------------------
-- Animation durations, by model FileDataID.
--------------------------------------------------------------------------------
local animationDurations = {
    ["Original"] = {
        [116921]  = { [60] = 4000 }, [1100258] = { [60] = 4000 }, -- bloodelf female
        [117170]  = { [60] = 2000 }, [1100087] = { [60] = 2000 }, -- bloodelf male
        [117400]  = { [60] = 2934 }, [117412]  = { [60] = 2934 }, -- broken
        [117437]  = { [60] = 3000 }, [1022598] = { [60] = 3000 }, -- draenei female
        [117721]  = { [60] = 3334 }, [1005887] = { [60] = 3334 }, -- draenei male
        [118135]  = { [60] = 2000 }, [950080]  = { [60] = 2000 }, -- dwarf female
        [118355]  = { [60] = 2000 }, [878772]  = { [60] = 2000 }, -- dwarf male
        [118652]  = { [60] = 2000 }, [118653]  = { [60] = 2000 }, [118654] = { [60] = 2000 }, [118667] = { [60] = 2000 }, -- felorc
        [118798]  = { [60] = 2500 }, -- foresttroll
        [119063]  = { [60] = 4000 }, [940356]  = { [60] = 4000 }, -- gnome female
        [119159]  = { [60] = 4000 }, [900914]  = { [60] = 4000 }, -- gnome male
        [119369]  = { [60] = 1800 }, [119376]  = { [60] = 1800 }, -- goblin
        [119563]  = { [60] = 2667 }, [1000764] = { [60] = 2667 }, -- human female
        [119940]  = { [60] = 2000 }, [1011653] = { [60] = 2000 }, -- human male
        [232863]  = { [60] = 2500 }, -- icetroll
        [120263]  = { [60] = 3000 }, [120294]  = { [60] = 3000 }, -- naga
        [120590]  = { [60] = 2100 }, [921844]  = { [60] = 2100 }, -- nightelf female
        [120791]  = { [60] = 2000 }, [974343]  = { [60] = 2000 }, -- nightelf male
        [233367]  = { [60] = 3600 }, -- northrendskeleton
        [121087]  = { [60] = 2000 }, [949470]  = { [60] = 2000 }, -- orc female
        [121287]  = { [60] = 2000 }, [917116]  = { [60] = 2000 }, -- orc male
        [121608]  = { [60] = 2000 }, [997378]  = { [60] = 2467 }, -- scourge female
        [121768]  = { [60] = 2667 }, [959310]  = { [60] = 2667 }, -- scourge male
        [121942]  = { [60] = 2667 }, -- skeleton
        [233878]  = { [60] = 2934 }, -- taunka
        [121961]  = { [60] = 2934 }, [986648]  = { [60] = 2934 }, -- tauren female
        [122055]  = { [60] = 2934 }, [968705]  = { [60] = 2934 }, -- tauren male
        [122414]  = { [60] = 2500 }, [1018060] = { [60] = 2500 }, -- troll female
        [122560]  = { [60] = 2500 }, [1022938] = { [60] = 2500 }, -- troll male
        [122738]  = { [60] = 3000 }, -- tuskarr
        [122815]  = { [60] = 3600 }, -- vrykul
    },
    -- HD overrides for model files which did not get a separate HD version
    ["HD"] = {
        [119369] = { [60] = 4667 },
        [119376] = { [60] = 4667 },
    },
}
if Version.Variant == "era" or Version.Variant == "sod" then
    -- Goblin models on vanilla lack the talk animation; 0 makes
    -- them fall back to idle.
    animationDurations["Original"][119369][60] = 0
    animationDurations["Original"][119376][60] = 0
end

--- Which model set durations are looked up in. Compat.lua overrides this for the clients
--- with HD models.
function Portrait:GetCurrentModelSet()
    return "Original"
end

--- Frame a loaded model on its head. Every client but Camelot embeds a
--- portrait camera at index 0 in the creature's M2, and selecting it is what makes the
--- portrait a portrait rather than a figure standing in a box; Compat.lua overrides this
--- for Camelot, whose engine accepts the call and ignores it.
function Portrait:FrameHead(model)
    model:SetCustomCamera(0)
end

---@return number|nil seconds  0 if the model is known to lack the animation
function Portrait:GetModelAnimationDuration(model, animation)
    if not model or model == 123 then return end
    local models = animationDurations[self:GetCurrentModelSet()] or animationDurations["Original"]
    local animations = models[model] or animationDurations["Original"][model]
    local duration = animations and animations[animation]
    return duration and duration / 1000
end

--------------------------------------------------------------------------------
-- The model frame, one per portrait.
--------------------------------------------------------------------------------

local function CreateModelFrame(portrait)
    local model = CreateFrame("DressUpModel", nil, portrait)
    model:SetAllPoints()
    model:HookScript("OnHide", function(self)
        self:ClearModel()
        self.oldCreatureID = nil
        self.animation = nil
        self.animDuration = nil
        self.animtimer = nil
    end)
    model:HookScript("OnUpdate", function(self, elapsed)
        -- If the creature was not cached, keep retrying until it is.
        if self.oldCreatureID and not self:GetModelFileID() then
            self:SetCreature(self.oldCreatureID)
            if not self:GetModelFileID() then return end
        end
        Portrait:FrameHead(self)
        if self.animation and not self.animDuration then
            self.animDuration = Portrait:GetModelAnimationDuration(self:GetModelFileID(), self.animation)
            if self.animDuration and self.animDuration == 0 then
                self.animation = 0
                self:SetAnimation(self.animation)
            end
        end
        local isPaused = not SoundQueue:IsPlaying()
        if not WAIT_FOR_ANIMATION_FINISH_BEFORE_IDLE and self.animation and self.animation ~= 0 and isPaused then
            self.animation = 0
            self.animtimer = nil
            self:SetAnimation(self.animation)
        end
        if self.animation and GetTime() - (self.animtimer or 0) >= (self.animDuration or 2) then
            if isPaused or self.animation == 0 then
                if WAIT_FOR_ANIMATION_FINISH_BEFORE_IDLE and self.animation ~= 0 then
                    self.animation = 0
                    self.animtimer = nil
                    self:SetAnimation(self.animation)
                end
            else
                self.animtimer = GetTime()
                self:SetAnimation(self.animation)
            end
        end
        self.wasPaused = isPaused
    end)
    return model
end

--------------------------------------------------------------------------------
-- The three built-in renderers
--------------------------------------------------------------------------------

Renderers["none"] = {
    Acquire = function(portrait) return nil end,
    Update = function(frame, clip, spec) return true end,
    Release = function(frame) end,
}

Renderers["texture"] = {
    Acquire = function(portrait)
        if not portrait.texture then
            portrait.texture = portrait:CreateTexture(nil, "ARTWORK")
            portrait.texture:SetAllPoints()
        end
        portrait.texture:Show()
        return portrait.texture
    end,
    Update = function(texture, clip, spec)
        if not spec.texture then return false end
        texture:SetTexture(spec.texture)
        local c = spec.texCoord or { 8 / 256, 248 / 256, 8 / 256, 248 / 256 }
        texture:SetTexCoord(c[1], c[2], c[3], c[4])
        return true
    end,
    Release = function(texture) texture:Hide() end,
}

Renderers["model"] = {
    Acquire = function(portrait, clip)
        portrait.model = portrait.model or CreateModelFrame(portrait)
        local model = portrait.model
        model:Show()
        return model
    end,
    Update = function(model, clip, spec)
        local creatureID = spec.creatureID
        if not creatureID then return false end
        if creatureID ~= model.oldCreatureID then
            model:ClearModel()
            if spec.displayID then
                model:SetDisplayInfo(spec.displayID)
            else
                model:SetCreature(creatureID)
            end
            Portrait:FrameHead(model)
            model:SetModelScale(2)
            model.animation = spec.animation or 60
            model.animDuration = nil
            model.animtimer = nil
            model.oldCreatureID = creatureID
        elseif model.wasPaused and SoundQueue:IsPlaying() then
            model.animation = spec.animation or 60
            model.animDuration = nil
        end
        -- A model the client could not load draws nothing; say so, and the fallback shows.
        return model:GetModelFileID() ~= nil
    end,
    Release = function(model)
        model:Hide()
    end,
}

--------------------------------------------------------------------------------
-- Dispatch
--------------------------------------------------------------------------------

local function Resolve(portrait, clip, spec, depth)
    local kind = spec and spec.kind or "none"
    local renderer = Renderers[kind] or Renderers["none"]
    if not Renderers[kind] then kind = "none" end

    if portrait.active ~= kind and portrait.activeFrame then
        local previous = Renderers[portrait.active]
        if previous then previous.Release(portrait.activeFrame) end
        portrait.activeFrame = nil
    end
    local frame = renderer.Acquire(portrait, clip)
    portrait.active = kind
    portrait.activeFrame = frame

    if renderer.Update(frame, clip, spec or {}) then
        return
    end
    if spec and spec.fallback and depth < 1 then
        return Resolve(portrait, clip, spec.fallback, depth + 1)
    end
    Resolve(portrait, clip, { kind = "none" }, 2)
end

--- Show the portrait for `clip`, or nothing.
function Portrait:Configure(portrait, clip)
    if not portrait:IsShown() then return end
    local spec = clip and clip.present and clip.present.portrait or { kind = "none" }
    Resolve(portrait, clip, spec, 0)
end

setfenv(1, SpokenEnv)

-- Looks other addons register for the Small and the Large Window (Spoken:RegisterLook). A look
-- describes what to draw and Spoken draws it, so the windows' frames stay Spoken's own to change.
-- The Theme row lists each look beside Spoken's; while one is chosen, its Look(clip, window) is
-- asked for every line, and nil keeps Spoken's own art for that line.
Looks = { byId = {}, order = {}, keeps = {}, pending = {} }

-- The windows by the names the API uses, and the narrator style each one is.
Looks.STYLES = { small = "minimal", large = "classic" }

-- Where each window keeps its choice. The Small Window's Theme was a background before looks came,
-- so a look's id goes in the same setting.
local SETTING = { small = "MinimalBackground", large = "ClassicLook" }
Looks.BUILT_IN = { small = { "parchment", "dark" }, large = { "default" } }
local DEFAULT = { small = "parchment", large = "default" }

function Looks:Register(id, info)
    if not self.byId[id] then table.insert(self.order, id) end
    self.byId[id] = info
    self:PlaceSettings(id)
    if Addon.enabled then
        Options:UpdateRows()
        self:Refresh()
    end
end

--- The window showing lines drawn again in the look chosen for it.
function Looks:Refresh()
    if not PlayerFrame.frame then return end
    local skin = PlayerFrame:Skin()
    if skin == MinimalPlayer then
        if MinimalPlayer.frame then MinimalPlayer:ApplyLook() end
    elseif not skin then
        PlayerFrame:ApplyLook(PlayerFrame.shown)
    end
end

--- The look `window` is set to, Spoken's own ("parchment", "dark", "default") where the look chosen
--- is not registered this session: its addon was removed, or has not loaded.
function Looks:Chosen(window)
    local value = Addon:Profile("Frame")[SETTING[window]]
    local look = self.byId[value]
    if look and look.windows[window] then return value end
    for _, own in ipairs(self.BUILT_IN[window]) do
        if own == value then return value end
    end
    return DEFAULT[window]
end

function Looks:Choose(window, value)
    Addon.db.profile.Frame[SETTING[window]] = value
end

--- What the Theme row lists for `window`: Spoken's own looks, then each registered for it.
function Looks:Values(window)
    local values = {}
    for _, own in ipairs(self.BUILT_IN[window]) do table.insert(values, own) end
    for _, id in ipairs(self.order) do
        if self.byId[id].windows[window] then table.insert(values, id) end
    end
    return values
end

function Looks:Name(value)
    local look = self.byId[value]
    if look then return look.name end
    if value == "dark" then return L.OPT_DUI_THEME_DARK end
    if value == "parchment" then return L.OPT_DUI_THEME_PARCHMENT end
    return L.OPT_LOOK_DEFAULT
end

local function Color(value, least)
    if type(value) ~= "table" then return false end
    for i = 1, least do
        if type(value[i]) ~= "number" then return false end
    end
    return true
end

-- A look's answer, or nil where it gave none Spoken can draw: the line keeps Spoken's own art.
local function Valid(look)
    if type(look) ~= "table" then return nil end
    if look.background ~= nil and type(look.background) ~= "string" then return nil end
    if look.tint ~= nil and not Color(look.tint, 4) then return nil end
    if look.ring ~= nil and not Color(look.ring, 3) then return nil end
    local border = look.border
    if border ~= nil and not (type(border) == "table" and type(border.horizontal) == "string"
        and type(border.vertical) == "string" and type(border.corner) == "string") then
        return nil
    end
    return look
end

--- How `clip` looks in `window`, or nil for Spoken's own art. A look that throws or answers in a
--- shape Spoken cannot draw costs only its own art: the line is shown either way.
function Looks:For(clip, window)
    local id = self:Chosen(window)
    local registered = self.byId[id]
    if not (registered and clip) then return nil end
    local ok, look = pcall(registered.Look, clip, window)
    if not ok then
        Developer:Log("looks", "%s failed for %s: %s", id, Developer.Describe(clip), tostring(look))
        return nil
    end
    local valid = Valid(look)
    if look ~= nil and not valid then Developer:Log("looks", "%s answered with no look Spoken can draw", id) end
    return valid
end

--------------------------------------------------------------------------------
-- The border: tiled from the middle of each side out to its corners, mirrored, so a pattern meets
-- itself in the middle and ends whole at each corner.
--------------------------------------------------------------------------------

local PIECES = {
    "topLeft", "topRight", "bottomLeft", "bottomRight", "leftTop", "leftBottom", "rightTop", "rightBottom",
    "cornerTopLeft", "cornerTopRight", "cornerBottomLeft", "cornerBottomRight",
}

--- The border's textures, drawn on `frame` under its child frames, so the words stay above it.
function Looks.Trim(frame)
    local trim = { frame = frame }
    for _, name in ipairs(PIECES) do
        trim[name] = frame:CreateTexture(nil, "OVERLAY")
        trim[name]:Hide()
    end
    return trim
end

function Looks.PaintTrim(trim, border)
    for _, name in ipairs(PIECES) do trim[name]:SetShown(border ~= nil) end
    if not border then return end
    local frame, size = trim.frame, tonumber(border.size) or 14
    -- How many `size`s long one repeat of each texture is.
    local across, down = tonumber(border.horizontalRepeat) or 8, tonumber(border.verticalRepeat) or 4
    local halfWidth = math.max(0, (frame:GetWidth() or 0) / 2 - size)
    local halfHeight = math.max(0, (frame:GetHeight() or 0) / 2 - size)
    local u0, u1 = 1 / across, 1 / across + halfWidth / (across * size)
    local v0, v1 = 1 / down, 1 / down + halfHeight / (down * size)
    local function Piece(texture, file, point, x, y, width, height, left, right, top, bottom)
        texture:SetTexture(file, "REPEAT", "REPEAT")
        texture:ClearAllPoints()
        texture:SetPoint(point, frame, point, x, y)
        texture:SetSize(width, height)
        texture:SetTexCoord(left, right, top, bottom)
    end
    local h, v, c = border.horizontal, border.vertical, border.corner
    Piece(trim.topLeft, h, "TOPLEFT", size, 0, halfWidth, size, u0, u1, 0, 1)
    Piece(trim.topRight, h, "TOPRIGHT", -size, 0, halfWidth, size, u1, u0, 0, 1)
    Piece(trim.bottomLeft, h, "BOTTOMLEFT", size, 0, halfWidth, size, u0, u1, 1, 0)
    Piece(trim.bottomRight, h, "BOTTOMRIGHT", -size, 0, halfWidth, size, u1, u0, 1, 0)
    Piece(trim.leftTop, v, "TOPLEFT", 0, -size, size, halfHeight, 0, 1, v0, v1)
    Piece(trim.leftBottom, v, "BOTTOMLEFT", 0, size, size, halfHeight, 0, 1, v1, v0)
    Piece(trim.rightTop, v, "TOPRIGHT", 0, -size, size, halfHeight, 1, 0, v0, v1)
    Piece(trim.rightBottom, v, "BOTTOMRIGHT", 0, size, size, halfHeight, 1, 0, v1, v0)
    Piece(trim.cornerTopLeft, c, "TOPLEFT", 0, 0, size, size, 0, 1, 0, 1)
    Piece(trim.cornerTopRight, c, "TOPRIGHT", 0, 0, size, size, 1, 0, 0, 1)
    Piece(trim.cornerBottomLeft, c, "BOTTOMLEFT", 0, 0, size, size, 0, 1, 1, 0)
    Piece(trim.cornerBottomRight, c, "BOTTOMRIGHT", 0, 0, size, size, 1, 0, 1, 0)
end

--- `ring` in the look's colour, or back in Bronze Border's.
function Looks.TintRing(ring, look)
    local color = look and look.ring or Actions.Bronze()
    if color then ring:SetVertexColor(color[1], color[2], color[3]) else ring:SetVertexColor(1, 1, 1) end
end

--------------------------------------------------------------------------------
-- A look's rows on Spoken's page, under Theme, shown while it is the look chosen
--------------------------------------------------------------------------------

--- Where the looks' rows go. `window()` names the window the page's rows are for now.
function Looks:Place(layout, window)
    self.layout, self.window = layout, window
    for _, id in ipairs(self.order) do self:PlaceSettings(id) end
end

function Looks:PlaceSettings(id)
    local look, layout = self.byId[id], self.layout
    if not (layout and look.settings) or self.keeps[id] then return end
    local window = self.window
    self.keeps[id] = layout:Keep(function()
        local shown = window()
        return shown ~= nil and self:Chosen(shown) == id
    end)
    local ok, err = pcall(layout.Fill, layout, self.keeps[id], look.settings)
    if not ok then table.insert(Callbacks.errors, "look " .. id .. " settings: " .. tostring(err)) end
end

--------------------------------------------------------------------------------
-- Suggesting a look, once
--------------------------------------------------------------------------------

-- A window shows the look only under its narrator style.
local function Showing(look)
    for window, style in pairs(Looks.STYLES) do
        if look.windows[window] and Addon:DisplayStyle() == style then return window end
    end
    return nil
end

--- Ask the player once, ever, whether to use the look `id`: not where it is already chosen, nor
--- under a narrator style whose window it does not draw, where the question would ask about nothing
--- they see. Before Spoken has its settings, kept until it does; with no `id`, ask those kept now.
--- Returns whether it asked.
function Looks:Suggest(id)
    if id == nil then
        local pending = self.pending
        self.pending = {}
        for _, each in ipairs(pending) do self:Suggest(each) end
        return false
    end
    if not Addon.enabled then
        table.insert(self.pending, id)
        return false
    end
    local look = self.byId[id]
    -- The looks the player was asked about, whatever they answered: account-wide, as the addon is.
    local global = Addon.db.global
    global.SuggestedLooks = global.SuggestedLooks or {}
    local asked = global.SuggestedLooks
    if not look or asked[id] then return false end
    local window = Showing(look)
    if not window or self:Chosen(window) == id then return false end
    asked[id] = true
    SpokenLayout.Confirm(format(L.LOOK_SUGGEST_FMT, look.name), L.LOOK_USE, L.LOOK_KEEP, function()
        for each in pairs(look.windows) do self:Choose(each, id) end
        PlayerFrame:RefreshConfig()
        Options:UpdateRows()
    end)
    return true
end

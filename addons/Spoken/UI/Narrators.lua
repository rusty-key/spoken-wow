setfenv(1, SpokenEnv)

-- Narrator styles other addons register (Spoken:RegisterNarrator): a card of their own among the
-- narrator styles, and a window the addon draws itself. Spoken tells the one chosen what to show,
-- through its Update, the way it tells its own windows; everything else it reads from the Public
-- API, which hands out Spoken's parts (captions, controls, portrait) but never its windows.
Narrators = { byId = {}, order = {}, keeps = {}, pending = {} }

function Narrators:Register(id, info)
    if not self.byId[id] then table.insert(self.order, id) end
    self.byId[id] = info
    self:PlaceSettings(id)
    if Addon.enabled then Options:UpdateRows() end
end

--- The narrator on screen: the one previewed, else the one chosen; nil where neither is registered.
function Narrators:Current()
    local style = Addon:DisplayStyle()
    return self.byId[style] and style or nil
end

--------------------------------------------------------------------------------
-- The chosen narrator, as PlayerFrame drives a window drawn in its place (PlayerFrame:Skin)
--------------------------------------------------------------------------------

function Narrators:IsEnabled()
    return Addon.db ~= nil and self:Current() ~= nil
end

-- The narrator's own window has no portrait of Spoken's to configure.
function Narrators:HasClip() return false end

-- A narrator that throws draws nothing; Spoken and the lines go on.
local function Tell(id, clip)
    local narrator = Narrators.byId[id]
    local ok, err = pcall(narrator.Update, clip)
    if not ok then Developer:Log("narrators", "%s failed: %s", id, tostring(err)) end
end

--- Tell the narrator on screen what to show now, and one shown before it, if another, to show nothing.
function Narrators:Update()
    local id = self:Current()
    if self.shown and self.shown ~= id then Tell(self.shown, nil) end
    self.shown = id
    if not id then return end
    local clip = PlayerFrame:Current()
    if Actions.DialogCovers() then clip = nil end
    if clip == self.told and not self.stale then return end
    self.told, self.stale = clip, nil
    Tell(id, clip)
end

function Narrators:RefreshConfig()
    self.stale = true
    self:Update()
end

function Narrators:SetVisible(visible)
    if visible then return self:RefreshConfig() end
    if self.shown then Tell(self.shown, nil) end
    self.shown, self.told = nil, nil
end

--------------------------------------------------------------------------------
-- A narrator's rows on Spoken's page, shown while it is the style
--------------------------------------------------------------------------------

function Narrators:Place(layout)
    self.layout = layout
    for _, id in ipairs(self.order) do self:PlaceSettings(id) end
end

function Narrators:PlaceSettings(id)
    local narrator, layout = self.byId[id], self.layout
    if not (layout and narrator.settings) or self.keeps[id] then return end
    self.keeps[id] = layout:Keep(function() return Addon:PlayerStyle() == id end)
    local ok, err = pcall(layout.Fill, layout, self.keeps[id], narrator.settings)
    if not ok then table.insert(Callbacks.errors, "narrator " .. id .. " settings: " .. tostring(err)) end
end

--------------------------------------------------------------------------------
-- Suggesting a narrator, once
--------------------------------------------------------------------------------

--- Ask the player once, ever, whether to switch to the narrator `id`, whatever style they have,
--- unless it is theirs already. Before Spoken has its settings, kept until it does (AskPending).
function Narrators:Suggest(id)
    if not Addon.enabled then
        table.insert(self.pending, id)
        return
    end
    local narrator = self.byId[id]
    -- The narrators the player was asked about, whatever they answered: account-wide, as the addon is.
    local global = Addon.db.global
    global.SuggestedNarrators = global.SuggestedNarrators or {}
    local asked = global.SuggestedNarrators
    if not narrator or asked[id] or Addon:PlayerStyle() == id then return end
    asked[id] = true
    SpokenLayout.Confirm(format(L.NARRATOR_SUGGEST_FMT, narrator.title), L.NARRATOR_USE, L.NARRATOR_KEEP, function()
        Addon:SetPlayerStyle(id)
        PlayerFrame:RefreshConfig()
        Options:UpdateRows()
    end)
end

--- The suggestions made before Spoken had its settings, asked now that it has them.
function Narrators:AskPending()
    local pending = self.pending
    self.pending = {}
    for _, id in ipairs(pending) do self:Suggest(id) end
end

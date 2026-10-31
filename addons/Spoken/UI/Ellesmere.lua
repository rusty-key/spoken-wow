setfenv(1, SpokenEnv)

-- Spoken's windows in EllesmereUI's own look ("EllesmereUI Style"), while that is the look the
-- player's UI wears; the DialogueUI window keeps DialogueUI's. EllesmereUI's skinning API paints
-- them (SKINNING_API.md in EllesmereUI), so none of its art or code ships here. Its API would skin
-- them under its Blizzard Style, Classic WoW UI and WoW Forever looks too; those keep Spoken's art.
-- The player turns it off in EllesmereUI, under Blizzard Skins+ > Window Skins > Third-Party Addons.
-- `waiting` holds what waits for the callback while EllesmereUI may still run it; nil once it cannot.
Ellesmere = {}

--- Whether `eui`, the EllesmereUI global, draws its own look: not a stock look, not a mix of looks
--- (false) and not no styled module loaded (nil).
function Ellesmere.OwnLook(eui)
    if type(eui) ~= "table" or type(eui.RenderedLook) ~= "function" then return false end
    local ok, look = pcall(eui.RenderedLook)
    return ok and look == "eui"
end

--- Whether the windows wear EllesmereUI's look this session.
function Ellesmere:On()
    return self.skin ~= nil
end

-- A failure is said in chat and leaves the rest of the window as it was built. Returns whether it
-- went through.
local function Run(dress, skin)
    local ok, err = pcall(dress, skin)
    if not ok then print("|cff66bbffSpoken:|r EllesmereUI's look: " .. tostring(err)) end
    return ok
end

--- EllesmereUI's font while the windows wear its look and it writes the client's language; else nil.
--- It writes Latin script only: Russian, Korean and Chinese clients keep the game's font, which has
--- their script.
function Ellesmere:Font()
    if not self.skin then return nil end
    local client = Options:ClientLanguage()
    for _, language in ipairs(LANGUAGES) do
        if language.code == client and language.script then return nil end
    end
    return (self.skin.GetFont())
end

--- `fontString` in EllesmereUI's font at its own size, and white with `white`, once the windows
--- wear its look. A line's own font for its language still wins.
function Ellesmere:Refont(fontString, white)
    self:When(function()
        local face = self:Font()
        if face then
            local _, size, flags = fontString:GetFont()
            fontString:SetFont(face, size or 12, flags or "")
        end
        if white then fontString:SetTextColor(1, 1, 1) end
    end)
end

--- Runs `dress(skin)`, with `skin` EllesmereUI's skinning API, now if the windows wear its look, or
--- as soon as they do; never if they do not. Nothing waits where EllesmereUI is not loaded or has
--- said its look is another.
function Ellesmere:When(dress)
    if self.skin then
        Run(dress, self.skin)
    elseif self.waiting then
        table.insert(self.waiting, dress)
    end
end

-- A box's edge: a dark grey, as EllesmereUI's own borders are; its API gives no border colour.
local EDGE = { 0.2, 0.2, 0.2, 1 }
-- How far over a shell's frame to draw what must show over its edge, which EllesmereUI draws 6
-- levels over it.
Ellesmere.OVER_SHELL = 7
-- The dark collar between a picture and its edge, as EllesmereUI's square button draws one round the
-- icon Spoken puts in it: 2 screen pixels in the panel's colour.
local COLLAR = 2

--- A 1 px edge of `pixel` round `frame`, `out` outside it, four textures drawn on `host`. Returns them.
function Ellesmere:Edges(host, frame, pixel, out)
    local edges = {}
    for _, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
        local edge = host:CreateTexture(nil, "OVERLAY", nil, 7)
        edge:SetColorTexture(EDGE[1], EDGE[2], EDGE[3], EDGE[4])
        local dx = (side == "LEFT" and -out) or (side == "RIGHT" and out) or 0
        local dy = (side == "TOP" and out) or (side == "BOTTOM" and -out) or 0
        if side == "TOP" or side == "BOTTOM" then
            edge:SetHeight(pixel)
            edge:SetPoint(side .. "LEFT", frame, side .. "LEFT", -out, dy)
            edge:SetPoint(side .. "RIGHT", frame, side .. "RIGHT", out, dy)
        else
            edge:SetWidth(pixel)
            edge:SetPoint("TOP" .. side, frame, "TOP" .. side, dx, out)
            edge:SetPoint("BOTTOM" .. side, frame, "BOTTOM" .. side, dx, -out)
        end
        table.insert(edges, edge)
    end
    return edges
end

--- A flat square box round `frame`, once: a backing in EllesmereUI's panel colour under it and a
--- 1 px edge, the edge drawn on `over` (a frame above what `frame` shows) where given. With `outside`
--- the edge is outside `frame`, past a dark collar, so it never covers what `frame` shows. Returns it.
function Ellesmere:Box(skin, frame, over, outside)
    if frame.spokenBox then return frame.spokenBox end
    local r, g, b, a = skin.GetPanelColor()
    local host = over or frame
    -- One screen pixel, at whatever scale the frame is drawn; outside, a collar inside the edge.
    local pixel = SpokenLayout.Pixels(host, 1, 1)
    local collar = outside and SpokenLayout.Pixels(host, COLLAR, 1) or 0
    local out = outside and (collar + pixel) or 0
    -- On `frame` itself, under what it shows, out to the edge: the collar.
    local backing = frame:CreateTexture(nil, "BACKGROUND", nil, -8)
    backing:SetColorTexture(r or 0.08, g or 0.08, b or 0.08, a or 0.92)
    backing:SetPoint("TOPLEFT", frame, "TOPLEFT", -collar, collar)
    backing:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", collar, -collar)
    frame.spokenBox = { backing = backing, edges = self:Edges(host, frame, pixel, out) }
    return frame.spokenBox
end

-- The round portrait's shape: the Small Window's own portrait mask, a disc filling its square.
local DISC = [[Interface\AddOns\Spoken\Textures\MinimalPortraitMask]]

--- A round box for `region` (a face, cut round by the same disc), once, drawn on `host`, a frame under
--- what `region` shows: a dark disc behind the face, a collar wider, and a grey disc 1 px larger all
--- round behind that, which shows as the 1 px edge round the collar. Returns it.
function Ellesmere:Disc(skin, host, region)
    if region.spokenDisc then return region.spokenDisc end
    local r, g, b = skin.GetPanelColor()
    local function Disc(colour, out, sublevel)
        local disc = host:CreateTexture(nil, "BACKGROUND", nil, sublevel)
        disc:SetColorTexture(colour[1], colour[2], colour[3], 1)
        disc:SetPoint("TOPLEFT", region, "TOPLEFT", -out, out)
        disc:SetPoint("BOTTOMRIGHT", region, "BOTTOMRIGHT", out, -out)
        if host.CreateMaskTexture and disc.AddMaskTexture then
            local mask = host:CreateMaskTexture()
            mask:SetTexture(DISC, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
            mask:SetAllPoints(disc)
            disc:AddMaskTexture(mask)
        end
        return disc
    end
    -- The dark disc a collar wider than the face, the grey one a pixel wider still.
    local pixel, collar = SpokenLayout.Pixels(host, 1, 1), SpokenLayout.Pixels(host, COLLAR, 1)
    region.spokenDisc = { edge = Disc(EDGE, collar + pixel, 6), backing = Disc({ r or 0.08, g or 0.08, b or 0.08 }, collar, 7) }
    return region.spokenDisc
end

function Ellesmere.Shape(box, disc, round)
    if box then
        box.backing:SetShown(not round)
        for _, edge in ipairs(box.edges) do edge:SetShown(not round) end
    end
    if disc then
        disc.edge:SetShown(round)
        disc.backing:SetShown(round)
    end
end

--- One of Spoken's scroll bars as EllesmereUI draws its own: no track, the thumb a thin white
--- strip. Returns the strip, for the bar to light under the pointer.
function Ellesmere:FlatBar(bar, thumb)
    for _, host in ipairs({ bar, thumb }) do
        for _, region in ipairs({ host:GetRegions() }) do
            if region.SetAlpha then region:SetAlpha(0) end
        end
    end
    local strip = thumb:CreateTexture(nil, "ARTWORK", nil, 1)
    strip:SetPoint("TOP", thumb, "TOP", 0, 0)
    strip:SetPoint("BOTTOM", thumb, "BOTTOM", 0, 0)
    strip:SetWidth(4)
    return strip
end

-- Spoken's settings' scroll bars, inside the game's settings window, which EllesmereUI draws: SpokenLayout
-- reads nothing of Spoken's, so the look is handed in.
SpokenLayout.dressScrollBar = function(bar, thumb, repaint)
    Ellesmere:When(function() repaint(Ellesmere:FlatBar(bar, thumb)) end)
end

--- Puts the Small or Large Window's `frame` in EllesmereUI's window shell, once. `frame.spokenEllesmere`
--- is true once it is, false where the shell failed: the window then keeps Spoken's own art.
function Ellesmere:Dress(frame)
    if not (self.skin and frame) or frame.spokenEllesmere ~= nil then return end
    -- No title strip: the windows' name rows are not where its 25 px would sit.
    frame.spokenEllesmere = Run(function(skin) skin.Shell(frame, { noTopBar = true }) end, self.skin)
end

--- EllesmereUI runs the callback once, at login, and only while its skinning of Spoken is on.
function Ellesmere:Register(eui)
    if type(eui) ~= "table" or type(eui.RegisterSkin) ~= "function" then return end
    self.waiting = {}
    -- With its skinning of Spoken off the callback never comes, and what waits for it would be kept
    -- all session: once the world is shown without it, nothing waits.
    local watch = CreateFrame("Frame")
    watch:RegisterEvent("PLAYER_ENTERING_WORLD")
    watch:SetScript("OnEvent", function(frame)
        frame:UnregisterAllEvents()
        C_Timer.After(0, function()
            if not Ellesmere.skin then Ellesmere.waiting = nil end
        end)
    end)
    eui.RegisterSkin("Spoken", function(skin)
        if not Ellesmere.OwnLook(eui) then
            Ellesmere.waiting = nil
            return
        end
        Ellesmere.skin = skin
        local waiting = Ellesmere.waiting or {}
        Ellesmere.waiting = nil
        for _, dress in ipairs(waiting) do Run(dress, skin) end
        if PlayerFrame.frame then PlayerFrame:RefreshConfig() end
    end)
end

Ellesmere:Register(_G.EllesmereUI)

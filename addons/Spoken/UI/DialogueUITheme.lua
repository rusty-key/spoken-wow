setfenv(1, SpokenEnv)

-- DialogueUI's theme code is private, so this is the one file that knows its saved variables,
-- window and font object names. Each is checked before use; Available answers false rather
-- than raising.
--
-- Parsed by the 1.12 client too (addon.xml is shared), so Lua 5.0 syntax throughout; the
-- stub below is all that client runs.

DialogueUITheme = {}

if Version.IsAnyLegacy then
    function DialogueUITheme:Available() return false end
    function DialogueUITheme:Problem() return L.OPT_STYLE_DUI_MISSING end
    function DialogueUITheme:Watch() end
    function DialogueUITheme:Describe() return "dialogueui: not available on this client" end
    return
end

local Theme = DialogueUITheme
local ART = "Interface/AddOns/DialogueUI/Art/"
-- DialogueUI's window as a share of the screen height, per its Frame Size setting (0-3,
-- and 4 for its mobile mode), for when its window has not measured itself yet.
local SIZE_MULTIPLIER = { [0] = 0.9, [1] = 1.0, [2] = 1.1, [3] = 1.25, [4] = 1.4 }
local HEIGHT_SHARE, WIDTH_OF_HEIGHT = 0.618, 0.85
Theme.HEIGHT_SHARE = HEIGHT_SHARE
-- Its parchment's end caps at multiplier 1: the strips are this wide whatever the window.
local PARCHMENT_WIDTH, PARCHMENT_CAP = 546.13, 136.53

-- DialogueUI's text colours per theme, as its ThemeUtil sets them. The highlight matches the
-- quests addon's marks in DialogueUI's text: gold reads on dark, deep red on parchment.
local PALETTE = {
    [1] = {
        title = { 0.19, 0.17, 0.13 }, paragraph = { 0.19, 0.17, 0.13 }, gossip = { 0.19, 0.17, 0.13 },
        disabled = { 0.50, 0.36, 0.24 }, portraitTint = { 1, 0.9, 0.78 }, highlight = "|cff9c1a1a",
    },
    [2] = {
        title = { 0.9, 0.9, 0.9 }, paragraph = { 0.7, 0.7, 0.7 }, gossip = { 0.796, 0.784, 0.584 },
        disabled = { 0.5, 0.5, 0.5 }, portraitTint = { 1, 1, 1 }, highlight = "|cffffd100",
    },
}

--- For reading only: falls back to the defaults' table when AceDB has stripped the profile.
function Theme:Config()
    return Addon:Profile("Frame").DialogueUI or Defaults.profile.Frame.DialogueUI
end
local function Config() return Theme:Config() end

--- Whether the DialogueUI addon is loaded, recognised or not.
function Theme:Installed()
    return IsAddOnLoaded ~= nil and IsAddOnLoaded("DialogueUI") and true or false
end

local function Probe()
    if not Theme:Installed() then return false end
    if type(_G.DialogueUI_DB) ~= "table" or type(_G.DUIQuestFrame) ~= "table" then return false end
    local font = _G.DUIFont_Quest_Paragraph
    return type(font) == "table" and type(font.GetFont) == "function"
end

--- Whether DialogueUI is here and still looks as this file expects.
function Theme:Available()
    local ok, found = pcall(Probe)
    return ok and found or false
end

--- Why the DialogueUI style cannot be drawn, or nil.
function Theme:Problem()
    if not self:Installed() then return L.OPT_STYLE_DUI_MISSING end
    if not self:Available() then return L.OPT_STYLE_DUI_UNKNOWN end
    return nil
end

--- 1 parchment or 2 dark: DialogueUI's own, or the setting when not following it.
function Theme:ThemeID()
    local cfg = Config()
    if cfg.FollowTheme and type(_G.DialogueUI_DB) == "table" then
        return _G.DialogueUI_DB.Theme == 2 and 2 or 1
    end
    return cfg.Theme == 2 and 2 or 1
end

--- Built from the id, not read off DialogueUI's window, so overriding its theme shows the
--- other folder.
function Theme:TexturePath()
    return ART .. (self:ThemeID() == 2 and "Theme_Dark/" or "Theme_Brown/")
end

function Theme:Colors()
    return PALETTE[self:ThemeID()]
end

--- The face DialogueUI writes its text in, whatever font it is set to.
function Theme:FontFace()
    local font = _G.DUIFont_Quest_Paragraph
    local ok, face = pcall(function() return font:GetFont() end)
    if ok and type(face) == "string" then return face end
    return GameFontNormal:GetFont()
end

local function FontOf(name, size)
    local font = _G[name]
    local ok, face, height = pcall(function() return font:GetFont() end)
    if ok and type(face) == "string" and type(height) == "number" and height > 0 then return face, height end
    return GameFontNormal:GetFont(), size
end

--- DialogueUI's paragraph, quest title and subtitle fonts; the sizes follow its Font Size setting.
function Theme:Fonts()
    local fonts = {}
    fonts.paragraph, fonts.paragraphSize = FontOf("DUIFont_Quest_Paragraph", 12)
    fonts.title, fonts.titleSize = FontOf("DUIFont_Quest_Title_18", 18)
    fonts.subtitle, fonts.subtitleSize = FontOf("DUIFont_QuestType_Left", 10)
    return fonts
end

--- How big DialogueUI's window is drawn: it has no parent, so it is not under UIParent's
--- scale. A frame that should look the same size multiplies by this over UIParent's.
function Theme:FrameScale()
    local frame = _G.DUIQuestFrame
    local ok, scale = pcall(function() return frame:GetEffectiveScale() end)
    if ok and type(scale) == "number" and scale > 0 then return scale end
    return UIParent:GetEffectiveScale()
end

local function Multiplier()
    local db = _G.DialogueUI_DB
    local size = type(db) == "table" and db.FrameSize or 2
    if type(db) == "table" and db.MobileDeviceMode then size = 4 end
    return SIZE_MULTIPLIER[size] or SIZE_MULTIPLIER[2]
end

--- DialogueUI's window, width then height: as it measured itself, or as it will from its
--- Frame Size setting before it has.
function Theme:FrameSize()
    local frame = _G.DUIQuestFrame
    local width, height = frame and frame.frameWidth, frame and frame.frameHeight
    if type(width) == "number" and type(height) == "number" and width > 0 and height > 0 then
        return width, height
    end
    height = HEIGHT_SHARE * UIParent:GetHeight() * Multiplier()
    return height * WIDTH_OF_HEIGHT, height
end

--- The parchment strips' end caps, width then height, as DialogueUI drew them.
function Theme:ParchmentSize()
    local frame = _G.DUIQuestFrame
    local cap = frame and type(frame.Parchments) == "table" and frame.Parchments[1]
    if cap and cap.GetSize then
        local width, height = cap:GetSize()
        if type(width) == "number" and width > 0 then return width, height end
    end
    return PARCHMENT_WIDTH * Multiplier(), PARCHMENT_CAP * Multiplier()
end

--- DialogueUI's window centre x and top, in UIParent's units. Read from where DialogueUI aims
--- it, since the drawn window slides and grows while opening. nil until DialogueUI places it.
function Theme:WindowPlace()
    if not self:Available() then return nil end
    local frame = _G.DUIQuestFrame
    local k = frame:GetEffectiveScale() / UIParent:GetEffectiveScale()
    local offset, height = frame.frameOffsetX, frame.frameHeight
    -- DialogueUI centres the window on the screen's centre, frameOffsetX to one side.
    if type(offset) == "number" and type(height) == "number" and height > 0 then
        return UIParent:GetWidth() / 2 + offset * k, UIParent:GetHeight() / 2 + height / 2 * k
    end
    local x, top = frame:GetCenter(), frame:GetTop()
    if type(x) == "number" and type(top) == "number" then return x * k, top * k end
    return nil
end

--- Hooks the window methods DialogueUI calls on a theme, size or side change, since it has no
--- public event for them.
function Theme:Watch(fn)
    if self.watching or not self:Available() then return end
    local frame = _G.DUIQuestFrame
    local hooked = false
    for _, name in ipairs({ "LoadTheme", "UpdateFrameSize", "UpdateFrameBaseOffset" }) do
        if type(frame[name]) == "function" and hooksecurefunc then
            hooksecurefunc(frame, name, fn)
            hooked = true
        end
    end
    self.watching = hooked
end

function Theme:Describe()
    if not self:Available() then
        return "dialogueui: " .. (self:Problem() or "unavailable")
    end
    local width, height = self:FrameSize()
    return format("dialogueui: theme=%d follow=%s size=%.0fx%.0f watching=%s", self:ThemeID(),
        tostring(Config().FollowTheme), width, height, tostring(self.watching or false))
end

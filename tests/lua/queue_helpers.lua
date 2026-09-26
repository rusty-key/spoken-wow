-- Shared by queue_test.lua and sources_test.lua: a fresh player with two registered
-- sources, a clip factory, and a recorder for the player's callbacks.
local M = {}

local ZONES = (debug.getinfo(1, "S").source:match("^@(.*)/[^/]*$") or ".") .. "/../../addons/SpokenZones/"

function M.Fresh(stub, spokenDir)
    stub.SetClient("11509")
    stub.ResetSound()
    stub.ResetTimers()
    local env = stub.LoadSpoken(spokenDir)
    env.Addon.db.char.IsPaused = false
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "SpokenQuests", order = 1 })
    local zones = env.Sources:Register("zones", { title = "Zones", addon = "SpokenZones", order = 2,
        queueLimit = 3, interClipGap = 0.25 })
    return env, quests, zones
end

local n = 0
--- A clip with a unique key unless one is given. `length` defaults to 1.
function M.Clip(fields)
    n = n + 1
    local clip = { key = "k" .. n, path = "clip" .. n .. ".ogg", length = 1,
        present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }
    for k, v in pairs(fields or {}) do clip[k] = v end
    return clip
end

--- Records every callback the player fires as "EVENT key[ extra]".
function M.Recorder(env)
    local log = {}
    for _, event in ipairs({ "CLIP_QUEUED", "CLIP_STARTED", "CLIP_STOPPED", "CLIP_DROPPED", "QUEUE_EMPTY", "AUDIO_CHANGED" }) do
        env.Callbacks:Register(event, function(clip, extra)
            local line = event
            if type(clip) == "table" then line = line .. " " .. clip.key end
            if extra ~= nil then line = line .. " " .. tostring(extra) end
            table.insert(log, line)
        end)
    end
    local rec = { log = log }
    function rec:Has(line)
        for _, l in ipairs(log) do if l == line then return true end end
        return false
    end
    function rec:Count(prefix)
        local c = 0
        for _, l in ipairs(log) do if l:sub(1, #prefix) == prefix then c = c + 1 end end
        return c
    end
    return rec
end

function M.Expecter(print)
    local failures = 0
    local function Expect(scenario, actual, expected)
        if actual == expected then
            print(string.format("ok   %s", scenario))
        else
            failures = failures + 1
            print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
                tostring(expected), tostring(actual)))
        end
    end
    return Expect, function() return failures end
end

--- The zones addon loaded for real, Core.lua included -- unlike wow_client_stub.LoadZones,
--- which loads only Audio/ReportButton/Autoplay against a hand-built fake table for playback
--- tests. Contribute.lua needs the real GetPlayerMapID, GetLoreWithFallback, GetSubzoneLore,
--- GetLore and IsPending, all of which live in Core.lua, so this loads that too, and the
--- language and pack answers it sends, from Language.lua and Audio.lua.
--- `seed` is the addon table as it stands before Language.lua runs, for what the
--- generated data would have put there first (SpokenZones.Languages).
function M.LoadZones(addonDirectory, seed)
    local SpokenZones = seed or {}
    for _, file in ipairs({ "Language", "Core", "Audio", "Contribute" }) do
        local chunk = assert(loadfile(addonDirectory .. file .. ".lua"))
        chunk("SpokenZones", SpokenZones)
    end
    return SpokenZones
end

--- The language codes SpokenZones.LOCALES lists, in order, read off its source. The other
--- addons each keep a copy of the list and are tested against this one.
function M.ZonesLocaleCodes(here)
    local codes = {}
    local file = assert(io.open(here .. "/../../addons/SpokenZones/Language.lua"))
    for code in file:read("*a"):gmatch('{ code = "(%a+)"') do table.insert(codes, code) end
    file:close()
    return table.concat(codes, " ")
end

--- The parts of the zones addon's Core.lua that its playback files read, as a fake.
function M.NewZoneLore()
    local cfg = { voiceEnabled = true, autoplay = true, autoplaySubzones = true,
        autoplayExplored = false, debug = false,
        -- What the options panel reads, as well as what the playback files do.
        showMapPanel = true, showHoverPreview = true, panelSide = "RIGHT",
        panelWidth = 320, fontSize = 12, showMinimapButton = true }
    local Z = { printed = {}, heard = {}, zoneChanged = {}, clientLocale = "enUS" }
    -- The addon's real English strings, so a label a file reads (a minimap entry, a button,
    -- a settings row) is the one the client would show rather than nil. Language.lua is what
    -- normally takes the table, and it is not loaded here.
    local english
    Z.RegisterStrings = function(_, _, strings) english = strings end
    assert(loadfile(ZONES .. "Locale/enUS.lua"))("SpokenZones", Z)
    Z.RegisterStrings = nil
    Z.L = english
    Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials" } } }
    function Z:Get(key) return cfg[key] end
    function Z:Set(key, value) cfg[key] = value end
    function Z:GetMapName(id) return ({ [1411] = "Durotar", [1426] = "Dun Morogh" })[id] end
    function Z:GetLanguage() return "enUS" end
    function Z:Print(fmt, ...) table.insert(self.printed, select("#", ...) > 0 and string.format(fmt, ...) or fmt) end
    function Z:ReportURL(mapID, areaKey) return "https://spoken.test/r/" .. mapID .. "/" .. tostring(areaKey) end
    function Z:ShowLoreFor(mapID, areaKey) self.shown = { mapID, areaKey } end
    function Z:ShowCopyLink(url) self.copied = url end
    function Z:MarkHeard(mapID, areaKey) table.insert(self.heard, tostring(mapID) .. "/" .. tostring(areaKey)) end
    function Z:OnZoneChanged(fn) table.insert(self.zoneChanged, fn) end
    function Z:ToggleLoreWindow() self.toggled = true end
    function Z:OpenOptions() self.opened = true end
    -- What UI/Options.lua asks the rest of the addon. The panel is the one part that
    -- reports what is installed, so the answers live here rather than in each test.
    Z.SITE_URL = "https://spoken.test"
    function Z:GetAudioPacks() return {} end
    function Z:GetActiveAudioPack() return nil end
    function Z:GetAudioPackLabel() return "none" end
    function Z:GetSelectableLanguages() return { { code = "enUS", name = "English" } } end
    function Z:GetLanguagePreference() return nil end
    function Z:GetAutoLanguage() return "enUS" end
    function Z:GetLocaleInfo() return { name = "English" } end
    function Z:GetLanguageName(code) return code and Z.L["LANG_" .. code] or "Automatic" end
    function Z:RedrawPanel() end
    return Z
end

return M

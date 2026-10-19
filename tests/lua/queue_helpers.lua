-- Shared by queue_test.lua and sources_test.lua: a fresh player with two registered
-- sources, a clip factory, and a recorder for the player's callbacks.
local M = {}

local ZONES = (debug.getinfo(1, "S").source:match("^@(.*)/[^/]*$") or ".") .. "/../../addons/Spoken_Places/"

function M.Fresh(stub, spokenDir)
    stub.SetClient("11509")
    stub.ResetSound()
    stub.ResetTimers()
    local env = stub.LoadSpoken(spokenDir)
    env.Addon.db.char.IsPaused = false
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
    local zones = env.Sources:Register("zones", { title = "Zones", addon = "Spoken_Places", order = 2,
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

--- Under `make contribute-fixtures`, keep an envelope the addon captured in a test as one of
--- the fixtures the site's reader is tested against (tests/fixtures/contributions). Written
--- as bytes, so a Windows run writes the LF the checksum was taken over.
function M.WriteCapturedFixture(here, name, envelope)
    if not os.getenv("SPOKEN_WRITE_FIXTURES") then return end
    local file = assert(io.open(here .. "/../fixtures/contributions/captured-" .. name .. ".txt", "wb"))
    assert(envelope, "no envelope captured for " .. name)
    file:write(envelope)
    file:close()
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
--- which loads only Audio/ContributeButton/Autoplay against a hand-built fake table for playback
--- tests. Contribute.lua needs the real GetPlayerMapID, GetLoreWithFallback, GetSubzoneLore,
--- GetLore and IsPending, all of which live in Core.lua, so this loads that too, and the
--- language and pack answers it sends, from Language.lua and Audio.lua. Spoken's UI/Compendium.lua
--- too where Spoken has not loaded it: a clip's header is the place above, from its tree.
--- `seed` is the addon table as it stands before Language.lua runs, for what the
--- generated data would have put there first (SpokenZones.Languages).
function M.LoadZones(addonDirectory, seed)
    local SpokenZones = seed or {}
    if not _G.SpokenCompendium then dofile(addonDirectory .. "../Spoken/UI/Compendium.lua") end
    for _, file in ipairs({ "Language", "Core", "Audio", "Contribute" }) do
        local chunk = assert(loadfile(addonDirectory .. file .. ".lua"))
        chunk("Spoken_Places", SpokenZones)
    end
    return SpokenZones
end

--- The language codes SpokenZones.LOCALES lists, in order, read off its source. The other
--- addons each keep a copy of the list and are tested against this one.
function M.ZonesLocaleCodes(here)
    local codes = {}
    local file = assert(io.open(here .. "/../../addons/Spoken_Places/Language.lua"))
    for code in file:read("*a"):gmatch('{ code = "(%a+)"') do table.insert(codes, code) end
    file:close()
    return table.concat(codes, " ")
end

--- The parts of the zones addon's Core.lua that its playback files read, as a fake.
function M.NewZoneLore()
    local cfg = { voiceEnabled = true, autoplay = true, autoplaySubzones = true,
        autoplayExplored = false, flightLore = true, debug = false,
        -- What the options panel reads, as well as what the playback files do.
        showMapPanel = true, panelSide = "RIGHT",
        panelWidth = 320, fontSize = 12, highlightOpacity = 0.35 }
    local Z = { printed = {}, heard = {}, zoneChanged = {}, clientLocale = "enUS" }
    -- The addon's real English strings, so a label a file reads (a minimap entry, a button,
    -- a settings row) is the one the client would show rather than nil. Language.lua is what
    -- normally takes the table, and it is not loaded here.
    -- The client's own language over English, the way Language.lua resolves them, when the
    -- stub's GetLocale names one: each translation file returns early for any other.
    local registered = {}
    Z.RegisterStrings = function(_, code, strings) registered[code] = strings end
    for _, code in ipairs({ "enUS", "deDE", "esES", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW" }) do
        assert(loadfile(ZONES .. "Locale/" .. code .. ".lua"))("Spoken_Places", Z)
    end
    Z.RegisterStrings = nil
    local english = registered.enUS
    for code, strings in pairs(registered) do
        if code ~= "enUS" then
            for key, value in pairs(strings) do english[key] = value end
        end
    end
    Z.L = english
    Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials" } } }
    function Z:Get(key) return cfg[key] end
    function Z:Set(key, value) cfg[key] = value end
    function Z:RefreshMapHighlight() end
    function Z:SetMapPanelShown(shown)
        cfg.showMapPanel = shown
        if shown then cfg.mapPanelCollapsed = false end
    end
    function Z:IsPartOn() return not (Spoken and Spoken.IsPartOn) or Spoken:IsPartOn("zones") end
    function Z:GetMapName(id) return ({ [1411] = "Durotar", [1426] = "Dun Morogh" })[id] end
    function Z:GetLanguage() return "enUS" end
    function Z:Print(fmt, ...) table.insert(self.printed, select("#", ...) > 0 and string.format(fmt, ...) or fmt) end
    function Z:ReportURL(mapID, areaKey) return "https://spoken.test/r/" .. mapID .. "/" .. tostring(areaKey) end
    function Z:ShowLoreFor(mapID, areaKey) self.shown = { mapID, areaKey } end
    function Z:StoryPlace(mapID, key) return mapID, key end
    function Z:AreaZone(mapID) return mapID end
    function Z:FoundOn() return {} end
    function Z:AreasIn(zone)
        local list = {}
        for key in pairs(self.Subzones[zone] or {}) do table.insert(list, { mapID = zone, key = key }) end
        return list
    end
    function Z:ShowCopyLink(url) self.copied = url end
    function Z:ShowReport(mapID, areaKey, language) self.copied = self:ReportURL(mapID, areaKey, language) end
    function Z:MarkHeard(mapID, areaKey) table.insert(self.heard, tostring(mapID) .. "/" .. tostring(areaKey)) end
    function Z:OnZoneChanged(fn) table.insert(self.zoneChanged, fn) end
    function Z:ToggleLoreWindow() self.toggled = true end
    function Z:OpenOptions() self.opened = true end
    -- What UI/Options.lua asks the rest of the addon. The panel is the one part that
    -- reports what is installed, so the answers live here rather than in each test.
    function Z:SiteURL() return "https://spoken.test" end
    function Z:GetAudioPacks() return {} end
    function Z:GetActiveAudioPack() return nil end
    -- The voice is Spoken's Voice Language and its fallback, as Audio.lua reads them.
    function Z:GetVoiceLanguage() return Spoken and Spoken.VoiceLanguage and Spoken:VoiceLanguage() or "enUS" end
    function Z:GetFallbackLanguage() return "enUS" end
    function Z:GetAudioPackLabel() return "none" end
    function Z:GetSelectableLanguages() return { { code = "enUS", name = "English" } } end
    function Z:GetLanguagePreference() return nil end
    function Z:IsPreviewingLanguage() return cfg.languagePreview == true end
    function Z:SetLanguagePreview(on) cfg.languagePreview = on and true or false end
    function Z:GetAutoLanguage() return "enUS" end
    function Z:GetLocaleInfo() return { name = "English" } end
    function Z:GetLanguageName(code) return code and Z.L["LANG_" .. code] or "Automatic" end
    function Z:RedrawPanel() end
    return Z
end

--- A report link split into its address and the envelope its #e1= fragment carries, decoded
--- independently of Contribute.lua as contribute_envelope_test.lua decodes it. Nil envelope
--- when the link has no fragment.
--- A #e1= payload back to its envelope, undoing the base64url here (standard alphabet, then
--- padded to a multiple of 4) so a test does not depend on Encode's own inverse existing.
function M.DecodeFragment(fragment)
    local std = fragment:gsub("-", "+"):gsub("_", "/")
    std = std .. string.rep("=", (4 - (#std % 4)) % 4)
    local decoded = require("base64_decode")(std)
    return LibStub:GetLibrary("LibDeflate"):DecompressDeflate(decoded)
end

function M.SplitReportLink(link)
    local address, fragment = tostring(link):match("^(.-)#e1=(.+)$")
    if not address then
        return link, nil
    end
    return address, M.DecodeFragment(fragment)
end

return M

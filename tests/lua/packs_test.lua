-- Where a player is sent for a voice pack: Spoken's list of every module's pack in every language
-- (Spoken:VoicePack) matches the store pages under publishers/, and a module's page offers the
-- packs to get: the voice language's, or the fallback's where the voice language has none of its
-- own. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local PUBLISHERS = here .. "/../../publishers/"
local CR = string.char(13)

---------------------------------------------------------------- the list against the store pages
local function Page(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local text = file:read("*a"):gsub(CR, "")
    file:close()
    local head = text:match("^%-%-%-\n(.-)\n%-%-%-")
    if not head then return nil end
    local meta = {}
    for key, value in head:gmatch("\n?([%w_]+): ?([^\n]*)") do meta[key] = value end
    return meta
end
local CODES = { "deDE", "esES", "esMX", "frFR", "itIT", "koKR", "ptBR", "ruRU", "zhCN", "zhTW" }
local PAGES = {
    quests = function(code) return "quests/audio-" .. code:lower() .. ".md" end,
    zones = function(code) return "zones/spoken-zones-audio-" .. code:lower() .. ".md" end,
    books = function(code) return "books/spoken-books-audio-" .. code:lower() .. ".md" end,
}
local FOLDERS = { quests = "SpokenQuestsAudio", zones = "SpokenZonesAudio", books = "SpokenBooksAudio" }

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.LoadSpoken(SPOKEN)
for module, page in pairs(PAGES) do
    for _, code in ipairs(CODES) do
        local meta = Page(PUBLISHERS .. page(code))
        local folder, url = _G.Spoken:VoicePack(module, code)
        if meta and meta.section == module then
            local want = meta.curseforge and ("https://www.curseforge.com/wow/addons/" .. meta.slug)
                or ("https://github.com/rusty-key/spoken-wow/releases?q=" .. meta.release)
            Expect(module .. " in " .. code .. ": the page's address", url, want)
            Expect("...and the folder it installs as", folder, FOLDERS[module] .. "_" .. code)
        else
            Expect(module .. " in " .. code .. ": no page, no pack", folder, nil)
        end
    end
end

---------------------------------------------------------------- the Quests page
local function Shown(locale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    stub.world.questID = 0; stub.ShowPanel(nil)
    stub.SetLocale(locale)
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    _G.SpokenEnv.Addon:Enable()
    local panel = stub.LoadQuestsPanel(QUESTS, VO)
    panel:Setup()
    local layout = panel.panel.layout
    layout:Refresh()
    local names = {}
    for _, item in ipairs(layout.items) do
        if item.kind == "section" and item.text == VO.L.OPT_SECTION_PACKS then
            for _, row in ipairs(item.rows) do
                local caption = row.regions and row.regions[4]
                if row.shown and caption and caption.text then table.insert(names, caption.text) end
            end
        end
    end
    stub.SetLocale("enUS")
    return names, VO.L
end

local function Name(L, label) return (L.OPT_PACK_NAME_FMT:gsub("%%1%$s", label)) end
local english, L = Shown("enUS")
Expect("an English client is offered English's packs, then one it has that the list does not know",
    table.concat(english, "|"), table.concat({ Name(L, L.OPT_PACK_ALL), Name(L, L.OPT_PACK_ALLIANCE), Name(L, L.OPT_PACK_HORDE),
        Name(L, L.OPT_PACK_SHARED), Name(L, L.OPT_PACK_GOSSIP), Name(L, "TestPack") }, "|"))
local spanish, ES = Shown("esES")
Expect("a Spanish client is offered the Spanish pack first", spanish[1], Name(ES, "Español (España)"))
-- Not English's to get, though English is what it falls back on: on an esMX client its five rows
-- buried the one that mattered. A pack installed is listed whatever its language.
Expect("...then only the pack it has installed, not English's to get", table.concat(spanish, "|", 2),
    Name(ES, "TestPack"))
-- But a language with no pack of its own is heard in English, the fallback: that is the pack to get.
local chinese, CN = Shown("zhCN")
Expect("a Chinese client, with no Chinese pack, is offered English's packs, its fallback",
    table.concat(chinese, "|"), table.concat({ Name(CN, CN.OPT_PACK_ALL), Name(CN, CN.OPT_PACK_ALLIANCE),
        Name(CN, CN.OPT_PACK_HORDE), Name(CN, CN.OPT_PACK_SHARED), Name(CN, CN.OPT_PACK_GOSSIP), Name(CN, "TestPack") }, "|"))

if Failures() > 0 then stub.print(string.format("\n%d failure(s)", Failures())); os.exit(1) end

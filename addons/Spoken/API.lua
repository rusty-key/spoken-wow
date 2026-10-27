setfenv(1, SpokenEnv)

-- The public surface. Everything a feature addon may rely on is defined in this file;
-- nothing else on `Spoken` is a contract, and nothing here writes anywhere but `Spoken`.
--
-- API_VERSION moves only on a breaking change. A feature addon's entire hard requirement
-- is `_G.Spoken and Spoken:IsCompatible(1)`.
Spoken.API_VERSION = 1
Spoken.ADDON_VERSION = AddonVersion

-- The site every module's report, contribute and help links point at. The old hosts
-- (voiceover.rusty.one, lore.rusty.one) keep redirecting, so changing this breaks no copy
-- already installed.
Spoken.SITE_URL = "https://spoken.rusty.one"

--- The page for reporting one line: `section` is "quests", "places" or "readables", `path` the
--- line's address under it, `language` the language the line was read in. English goes
--- unprefixed, the address the site serves it at; any other language keeps its prefix, so the
--- report lands beside that language's line. tests/lua/report_url_contract_test.lua holds
--- these addresses to the site's routes.
---@param section string
---@param path string
---@param language? string
---@return string url
function Spoken:ReportURL(section, path, language)
    if language and language ~= "enUS" then
        return ("%s/%s/%s/r/%s"):format(self.SITE_URL, language, section, path)
    end
    return ("%s/%s/r/%s"):format(self.SITE_URL, section, path)
end

---@param required number The API_VERSION the caller was written against.
function Spoken:IsCompatible(required)
    return type(required) == "number" and required <= self.API_VERSION
end

--------------------------------------------------------------------------------
-- Sources: how a feature addon joins the player. See Sources.lua for the info shape.
--------------------------------------------------------------------------------

---@param key string  "quests" | "places" | "readables"
---@param info SpokenSourceInfo
---@return table source  Carries Enqueue, Continue, PlayNow, Remove, StopAll, AddGate, RecheckGates,
---                      Retry, CanPlay, SetQueueLimit and SetInterClipGap.
function Spoken:RegisterSource(key, info)
    return Sources:Register(key, info)
end

--- Whether the narrator would show a line of the source `key`: a narrator style that shows words,
--- Show Narrator on, and not off for that source. A text-only line is worth queueing only then.
function Spoken:ShowsNarratorFor(key)
    return Addon:PlayerStyle() ~= "none" and Addon:ShowsNarrator({ source = { key = key } }) and true or false
end

function Spoken:GetSource(key)
    return Sources:Get(key)
end

--- Iterates `key, source` in menu order.
function Spoken:IterateSources()
    return Sources:Iterate()
end

--------------------------------------------------------------------------------
-- Clips and presentation
--------------------------------------------------------------------------------
--
-- A clip is what a source enqueues. The caller owns the file and the duration; the player
-- never resolves a path.
--
--   clip = {
--     key      = "q:33:accept",               -- caller-unique; the dedup key
--     path     = [[Interface\AddOns\...\x.ogg]],
--     length   = 3.4,                         -- seconds; the client cannot report this
--     textOnly = true,                        -- optional, as every line of a textOnly source; no path: shown in the narrator for `length`
--     priority = "normal" | "low",            -- low yields at the door; gossip is low
--     group    = "book:123",                  -- optional; clips of one item, no pause or cue between
--     continues = true,                       -- optional; its next part follows (source:Continue), no pause or cue
--     span     = { before = 12, total = 40 }, -- optional; seconds of its item before it and in all, for the progress bar
--     present  = {
--       header   = "Eagan Peltskinner",       -- NPC name | place above | book title;
--                                             -- nil over the world's own lore
--       label    = "Wolves Across the Border",-- quest title | subzone | page label
--       transcript = "Full dialogue text",   -- optional; falls back to clip.text
--       font     = [[Interface\AddOns\...\x.ttf]], -- optional; draws this clip's header, label
--                                             -- and text, for a script the game's font has no
--                                             -- glyphs for; the player's size stays
--       timings  = { 0, .42, .61, ... },      -- optional; when each word of the transcript starts,
--                                             -- in seconds, one per Spoken:CaptionWords(transcript)
--       bullet   = "quest-accept",            -- a RegisterBullet id
--       tint     = { r, g, b },               -- optional row tint
--       portrait = { kind = "model", creatureID = 196 }
--                | { kind = "texture", texture = [[...]], texCoord = { l, r, t, b } }
--                | { kind = "none" },
--       actions  = { { id, text, tooltip, visible, onClick, create }, ... },
--     },
--     addedCallback = fun(clip), startCallback = fun(clip),
--     stopCallback  = fun(clip, finishedPlaying),
--   }
--
-- The player sets id, handle, source and nextSoundTimer; a caller never does.

--- Declare an action switchable, and what the player's settings should call it. Report has
--- its own row; the modules still declare it for an older player, which has no such row.
---@param id string the action id, as it appears in a clip's presentation
---@param label string what to call it, e.g. "Report"
function Spoken:RegisterOptionalAction(id, label)
    return Actions:RegisterOptional(id, label)
end

--- A row bullet, registered once by a feature addon so SpokenReadables needs no change to
--- the player to have one of its own.
function Spoken:RegisterBullet(id, texture, size)
    Bullets[id] = { texture = texture, size = size }
end

function Spoken:GetBullet(id)
    return Bullets[id]
end

--- A portrait renderer: { Acquire(portrait, parent) -> frame, Update(frame, clip) -> bool,
--- Release(frame) }. "texture", "model" and "none" ship with the player.
function Spoken:RegisterPortraitRenderer(kind, renderer)
    Renderers[kind] = renderer
end

function Spoken:GetPortraitRenderer(kind)
    return Renderers[kind]
end

--- Ask the client about a creature whose portrait may soon be drawn, so the subtitles and the
--- small and DialogueUI windows show its face, not the book. A no-op with the large window (a
--- 3D model) and with Voice Only.
function Spoken:PrimePortrait(creatureID)
    local style = Addon.db and Addon:DisplayStyle()
    if style and style ~= "classic" and style ~= "none" and StaticPortrait then StaticPortrait:Prime(creatureID) end
end

--- Play, Skip and, with `report`, Report in a row on one of DialogueUI's dialogs (`dialog`, its
--- quest window or its book view), for a feature addon to put its line's controls there.
--- `tooltip()` returns the tooltip the dialog uses. The row has `frame`, `play`, `skip` and
--- `report`; `row:SetTip(button, fill)`, `row:ShowTip(button)`, `row:RefreshTip(button)`,
--- `row:HideTips()`, and `row:Place(buttons, anchor, force)`, right to left from `anchor`. Additive:
--- guard on the field.
function Spoken:CreateDialogueUIRow(dialog, tooltip, report)
    return Actions.DialogRow(dialog, tooltip, report)
end

--- The Small Window's round portrait, `size` across, on `parent`: the speaker masked round in its
--- ring, with a line's badge at the lower right, for a page of a feature addon's to show who says
--- a line. Anchor it yourself. Additive: guard on the field.
---
---   face:SetSpeaker({
---     creatureID   = 197,             -- the creature to draw, or nil
---     displayID    = 4259,            -- optional; its appearance where the caller knows it, else asked of the client
---     guid         = "Creature-...",  -- optional; drawn from its unit while one is about
---     objectOrItem = false,           -- an object or an item: its `icon`, else a posted notice
---     icon         = [[...]],         -- optional; an object's or item's picture
---     iconCrop     = { l, r, t, b },  -- optional; the part of `icon` drawn
---     bullet       = "quest-accept",  -- optional; the badge, a RegisterBullet id or a quest moment's
---   })
---
--- A creature the client has not cached yet shows the book and turns into its face once the client
--- has it; one with no face to draw keeps the book, as the Small Window does.
---@param parent table a frame
---@param size number
---@return table face  a Frame, with SetSpeaker
function Spoken:CreateSpeakerFace(parent, size)
    return Face.CreateSpeaker(parent, size)
end

--- How lines are shown: "subtitle", "none", "minimal", "classic" or "dialogueui".
--- Additive: guard on the field.
function Spoken:GetPlayerStyle()
    return Addon:PlayerStyle()
end

--------------------------------------------------------------------------------
-- Contributions: sending text the corpus does not have
--------------------------------------------------------------------------------
--
-- Additive, so API_VERSION does not move. A feature addon guards on the field rather than the
-- version: `if Spoken.Contribute and Spoken.ShowContribution then`. A player older than the
-- addon beside it should mean no contribute button, not an error.
--
-- The same goes for the setting that hides those buttons: guard on the method, and an older
-- player without it simply means the buttons are shown.

--- Whether the player turned every Contribute button off in the Spoken settings.
--- A feature addon asks this in its gap check, and re-asks on CONTRIBUTE_SETTINGS_CHANGED.
function Spoken:AreContributeButtonsHidden()
    return Addon.db and Addon.db.profile.Contribute.HideButtons and true or false
end

--- Whether the player turned every Report button off in Spoken's settings, the player's and
--- those feature addons draw. Ask before showing one, and again on REPORT_SETTINGS_CHANGED.
function Spoken:AreReportButtonsHidden()
    local hidden = Addon:Profile("Frame").HiddenActions
    return hidden and hidden.report and true or false
end

--------------------------------------------------------------------------------
-- The frame, the minimap button, the settings
--------------------------------------------------------------------------------

--- The player window, for a feature addon that must anchor something to it.
function Spoken:GetPlayerFrame()
    local skin = PlayerFrame:Skin()
    return skin and skin.frame or PlayerFrame.frame
end

--- Show the player over another frame, or back where it was with nil. For a host that hides
--- UIParent, as DialogueUI does: the windows and subtitles keep their place on screen and stay
--- draggable, and the subtitles pass clicks through to the host. Additive: guard on the field.
function Spoken:SetPlayerHost(frame)
    Addon:SetPlayerHost(frame)
end

--- Add a feature addon's rows to Spoken's page, after the narrator style's. build(layout) runs once,
--- when the page is built or at once if it is: it adds a section and rows to the SpokenLayout, and
--- may return a function that resets them, which Spoken's Reset Spoken Settings runs. Never called without
--- DialogueUI. Additive: guard on the field; without it, keep the rows on the addon's own page,
--- still only with DialogueUI installed.
function Spoken:AddDialogueUISettings(build)
    DialogueUIOptions:Add(build)
end

--- The Settings category, so a feature addon can nest its panel under it with
--- Settings.RegisterCanvasLayoutSubcategory. Nil until Spoken has registered its page.
function Spoken:GetSettingsCategory()
    return Options.category
end

function Spoken:OpenSettings()
    Options:Open()
end

--- Re-read the speaking clip's presentation -- after a setting changed an action's
--- label, say. Cheap; the frame rebuilds from the queue every time anyway.
function Spoken:RefreshPlayer()
    PlayerFrame:Update()
end

--- A feature addon's settings page, shown under Spoken's own in the game's settings as `name`,
--- listed in `order` (Quests 1, Gossip 2, Places 3, Readables 4, Bosses 5). Pass the page's SpokenLayout and its
--- scroller to make its rows searchable from Home. Returns a table whose `category` is
--- filled in once the page is registered, for Settings.OpenToCategory.
function Spoken:AddSettingsPage(panel, name, order, layout, scroller)
    return Options:AddPage(panel, name, order, layout, scroller)
end

--- Whether a part of Spoken is switched on in the settings (Sources:IsTurnedOff), for the
--- switch each feature addon puts at the top of its own page. `key` is its source key.
function Spoken:IsPartOn(key)
    return not Sources:IsTurnedOff(key)
end

--- How a part stands, as a state ("ok", "warn", "off") and the words for it: not installed,
--- switched off, or how many voice packs it found. For the line at the top of its own page.
function Spoken:PartStatus(key)
    return Options:PartStatus(key)
end

--- A module's voice packs, as its card shows them: how many of them it has, "Voice Pack ... 2/4".
--- Returns a kind, the words and the value.
function Spoken:PartVoice(key)
    return Options:PartVoice(key)
end

--- How Spoken's settings are laid out: "pages", each page an entry nested under Spoken in the
--- game's settings list.
function Spoken:SettingsStyle()
    return "pages"
end

-- Each module's voice pack in each language but English, by its store page under publishers/:
-- the CurseForge project where it has one, its GitHub releases where it has not. English's packs
-- are each module's own to list. tests/lua/packs_test.lua keeps this in step with the pages.
local CURSEFORGE = "https://www.curseforge.com/wow/addons/"
local RELEASES = "https://github.com/rusty-key/spoken-wow/releases?q="
local PACK_FOLDERS = { quests = "SpokenQuestsAudio", places = "SpokenPlacesAudio", readables = "SpokenReadablesAudio" }
local PACK_PAGES = {
    -- Quests in one folder per language is a GitHub download: on CurseForge a language's quests
    -- are split into packs under other folders.
    quests = { deDE = { github = "quests-audio-deDE" }, esES = { github = "quests-audio-esES" },
        esMX = { github = "quests-audio-esMX" }, frFR = { github = "quests-audio-frFR" },
        itIT = { github = "quests-audio-itIT" }, koKR = { github = "quests-audio-koKR" },
        ptBR = { github = "quests-audio-ptBR" }, ruRU = { github = "quests-audio-ruRU" },
        zhCN = { github = "quests-audio-zhCN" }, zhTW = { github = "quests-audio-zhTW" } },
    places = { deDE = "spoken-german-audio-places", esES = "spoken-spanish-eu-audio-places", esMX = "spoken-spanish-al-audio-places",
        frFR = "spoken-french-audio-places", koKR = "spoken-korean-audio-places", ptBR = "spoken-portuguese-audio-places",
        ruRU = "spoken-russian-audio-places", zhCN = "spoken-chinese-simplified-audio-places", zhTW = "spoken-chinese-traditional-audio-places" },
    readables = { deDE = "spoken-german-audio-readables", esES = "spoken-spanish-eu-audio-readables", esMX = "spoken-spanish-al-audio-readables",
        frFR = "spoken-french-audio-readables", koKR = "spoken-korean-audio-readables", ptBR = "spoken-portuguese-audio-readables",
        ruRU = "spoken-russian-audio-readables", zhCN = "spoken-chinese-simplified-audio-readables", zhTW = "spoken-chinese-traditional-audio-readables" },
}

--- The voice pack `module` ("quests", "places" or "readables") has in `lang`, English's aside: the folder
--- it installs as and the address to get it, or nil where that language has none.
function Spoken:VoicePack(module, lang)
    local page = PACK_PAGES[module] and PACK_PAGES[module][lang]
    if not page then return nil end
    local url = type(page) == "table" and (RELEASES .. page.github) or (CURSEFORGE .. page)
    return PACK_FOLDERS[module] .. "_" .. lang, url
end

-- Zone icons by uiMapID, copied into Textures/Zones so every client has them. A city has an icon
-- drawn for it; a map not listed takes its parent's.
local ZONE_ART = [[Interface\AddOns\Spoken\Textures\Zones\]]
local ZONE_ICONS = {
    [947] = "Azeroth", [1414] = "Kalimdor", [1415] = "EasternKingdoms",
    [1411] = "Durotar", [1412] = "Mulgore", [1413] = "Barrens", [1416] = "AlteracMountains",
    [1417] = "ArathiHighlands", [1418] = "Badlands", [1419] = "BlastedLands", [1420] = "TirisfalGlades",
    [1421] = "Silverpine", [1422] = "WesternPlaguelands", [1423] = "EasternPlaguelands",
    [1424] = "HillsbradFoothills", [1425] = "Hinterlands", [1426] = "DunMorogh", [1427] = "SearingGorge",
    [1428] = "BurningSteppes", [1429] = "ElwynnForest", [1430] = "DeadwindPass", [1431] = "Duskwood",
    [1432] = "LochModan", [1433] = "RedridgeMountains", [1434] = "Stranglethorn", [1435] = "SwampOfSorrows",
    [1436] = "Westfall", [1437] = "Wetlands", [1439] = "Darkshore", [1440] = "Ashenvale",
    [1441] = "ThousandNeedles", [1442] = "Stonetalon", [1443] = "Desolace", [1444] = "Feralas",
    [1445] = "DustwallowMarsh", [1446] = "Tanaris", [1447] = "Azshara", [1448] = "Felwood",
    [1449] = "UngoroCrater", [1451] = "Silithus", [1452] = "Winterspring", [1438] = "Teldrassil",
    [2482] = "MountHyjal",
    [1450] = "Moonglade", [1459] = "AlteracValley", [1460] = "WarsongGulch", [1461] = "ArathiBasin",
    [1453] = "Stormwind", [1454] = "Orgrimmar", [1455] = "Ironforge", [1456] = "ThunderBluff",
    [1457] = "Darnassus", [1458] = "Undercity",
    -- Forever's own zones, drawn for Spoken.
    [2521] = "ZephrasIsle", [2524] = "DarkspearIslands", [2548] = "Riverglades", [2652] = "Shendralas",
}
-- Trims the icons' bevelled border, as the game does in a round frame. The globe needs none.
local ICON_CROP = { 0.08, 0.92, 0.08, 0.92 }
local WHOLE = { 0, 1, 0, 1 }
Spoken.ZONE_ICONS = ZONE_ICONS

--- The icon for `mapID` or its nearest ancestor that has one, with its crop.
function Spoken:ZoneIcon(mapID)
    local depth = 0
    while mapID and depth < 6 do
        local icon = ZONE_ICONS[mapID]
        if icon then return ZONE_ART .. icon, icon == "Azeroth" and WHOLE or ICON_CROP end
        local info = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID)
        mapID = info and info.parentMapID
        depth = depth + 1
    end
    return nil
end

-- A dungeon's or a raid's badge on every tab of the Compendium, by instance map: its Dungeon Finder
-- icon from the retail game, copied into Textures/Dungeons so every client has it. Where the Finder
-- has none (the Hall of Thanes, Forever's own), the zone's icon, or one drawn for it (Dalaran).
local DUNGEON_ART = [[Interface\AddOns\Spoken\Textures\Dungeons\]]
local DUNGEON_ICONS = {
    [33] = "ShadowfangKeep", [34] = "StormwindStockades", [36] = "Deadmines", [43] = "WailingCaverns",
    [47] = "RazorfenKraul", [48] = "BlackfathomDeeps", [70] = "Uldaman", [90] = "Gnomeregan",
    [109] = "SunkenTemple", [129] = "RazorfenDowns", [189] = "ScarletMonastery", [209] = "ZulFarak",
    [229] = "BlackrockSpire", [230] = "BlackrockDepths", [249] = "OnyxiaEncounter", [289] = "Scholomance",
    [309] = "ZulGurub", [329] = "Stratholme", [349] = "Maraudon", [389] = "RagefireChasm",
    [409] = "MoltenCore", [429] = "DireMaul", [469] = "BlackwingLair", [509] = "AQRuins",
    [531] = "AQTemple", [533] = "Naxxramas", [2959] = "Dalaran", [2999] = "RuinsOfLordaeron",
    [3065] = "HallOfThanes",
    -- Forever's own, which the Finder has no icon for: the zone's.
    [2784] = "DemonFallCanyon", [2856] = "ScarletEnclave", [2875] = "KarazhanCrypts", [2998] = "ExcavationSite",
}
local DUNGEON_ICON_FALLBACK = [[Interface\Icons\INV_Misc_QuestionMark]]

--- The icon for the dungeon or raid whose instance map is `map`, with its crop.
function Spoken:DungeonIcon(map)
    local icon = DUNGEON_ICONS[map]
    return icon and (DUNGEON_ART .. icon) or DUNGEON_ICON_FALLBACK, ICON_CROP
end

-- C_Container where the client has it, else the old bag functions.
local function BagSlots(bag)
    if C_Container and C_Container.GetContainerNumSlots then return C_Container.GetContainerNumSlots(bag) or 0 end
    return GetContainerNumSlots and GetContainerNumSlots(bag) or 0
end
local function SlotItem(bag, slot)
    if C_Container and C_Container.GetContainerItemInfo then
        local info = C_Container.GetContainerItemInfo(bag, slot)
        if info then return info.iconFileID, info.hyperlink end
        return nil
    end
    if GetContainerItemInfo then
        local texture, _, _, _, _, _, link = GetContainerItemInfo(bag, slot)
        return texture, link
    end
end
local function SlotQuest(bag, slot)
    if C_Container and C_Container.GetContainerItemQuestInfo then
        local info = C_Container.GetContainerItemQuestInfo(bag, slot)
        return info and info.questID
    end
    if GetContainerItemQuestInfo then
        local _, questID = GetContainerItemQuestInfo(bag, slot)
        return questID
    end
end
local function BagIcon(test)
    for bag = 0, NUM_BAG_SLOTS or 4 do
        for slot = 1, BagSlots(bag) do
            if test(bag, slot) then
                local icon = SlotItem(bag, slot)
                if icon then return icon, ICON_CROP end
            end
        end
    end
    return nil
end

--- The icon of the bag item that starts `questID`, with its crop.
function Spoken:QuestItemIcon(questID)
    if not questID then return nil end
    return BagIcon(function(bag, slot) return SlotQuest(bag, slot) == questID end)
end

--- The id and name of the bag item that starts `questID`, read from its link: an item's GUID
--- carries no item id, so the bags are the only place a quest panel's item can be named.
function Spoken:QuestItem(questID)
    if not questID then return nil end
    for bag = 0, NUM_BAG_SLOTS or 4 do
        for slot = 1, BagSlots(bag) do
            if SlotQuest(bag, slot) == questID then
                local _, link = SlotItem(bag, slot)
                local id = link and tonumber(string.match(link, "item:(%d+)"))
                if id then return id, string.match(link, "%[(.-)%]") end
            end
        end
    end
    return nil
end

--- The icon of the bag item named `name`, with its crop.
function Spoken:BagItemIcon(name)
    if not name or name == "" then return nil end
    local bracketed = "[" .. name .. "]"
    return BagIcon(function(bag, slot)
        local _, link = SlotItem(bag, slot)
        return link ~= nil and string.find(link, bracketed, 1, true) ~= nil
    end)
end

--- The voice language and the fallback the player chose for every module, as stored: "auto"
--- or a language code, and a language code or "none". Either is nil while the player has not
--- chosen it here, and the module then keeps its own.
function Spoken:GetLanguageChoice()
    local language = Addon.db and Addon.db.profile.Language
    if not language then return nil, nil end
    return language.Voice, language.Fallback
end

--- Spoken's words in the player's language, for what every module's settings page shares and
--- names the same way: MODULE_SWITCH, MODULE_WHEN, PART_VOICE, MODULE_TEST_LINE, TEST_LINE_TEXT, MODULE_HISTORY,
--- MODULE_DOWNLOAD, MODULE_INSTALLED, MODULE_NOT_LOADED, MODULE_NO_PACK, MODULE_RESET,
--- REASON_PART_OFF, OPT_RESET_ALL_TIP and CANCEL. Read, never written.
function Spoken:Words()
    return L
end

--- A language's name as the lists show it, the same in every module: its own, or in English where
--- this client's font cannot draw it.
function Spoken:LanguageName(code)
    return Options:LanguageName(code)
end

--- Whether a font draws the language `code`, as the lists test it before they name it natively:
--- the settings' font object, or the font file `path`.
function Spoken:LanguageDraws(code, path)
    return Options:LanguageDraws(code, path)
end

--- The voice language as it plays: the one chosen on Spoken's page, "auto" being the client's.
function Spoken:VoiceLanguage()
    local voice = self:GetLanguageChoice()
    if voice == nil or voice == "auto" then return Options:ClientLanguage() end
    return voice
end

--- What a module's page says under its voice packs when nothing can be heard: no pack in the voice
--- language exists for `module` ("quests", "places" or "readables"), and If a Voice Is Missing is Stay
--- Silent. Nil otherwise.
function Spoken:SilentNote(module)
    local voice = self:VoiceLanguage()
    local _, fallback = self:GetLanguageChoice()
    if voice == "enUS" or fallback ~= "none" or self:VoicePack(module, voice) then return nil end
    return format(L.MODULE_NO_VOICE_FMT, Options:LanguageName(voice))
end

function Spoken:SetPartOn(key, on)
    Sources:SetTurnedOff(key, not on)
    -- Home lists the same switch.
    Options:UpdateRows()
end

--- Where a feature addon keeps its settings: a table inside Spoken's profile, so one profile holds
--- them all. See Addon:BindModuleSettings. Returns false where Spoken has no profile yet, and the
--- addon goes on with the table it keeps itself.
function Spoken:BindModuleSettings(name, legacy, bind, skip)
    return Addon:BindModuleSettings(name, legacy, bind, skip)
end

--- The profile chosen for new characters, when Spoken started this character on it at this login;
--- else nil. A feature addon passes it as its own AceDB default profile, so both start on it.
function Spoken:NewCharacterStartProfile()
    return Addon.newCharacterProfile
end

--- Whether Spoken's page and minimap menu open Azeroth's Compendium and hold its Unlock switches,
--- so the parts leave theirs off their own pages.
function Spoken:ShowsCompendium()
    return true
end

--- The Text Size of the words of stories, books and quests in Azeroth's Compendium and beside the
--- map, from the Compendium section of Spoken's page. Until the player sets it there, the size
--- they set on the Places page, where it was before; 12 with neither.
function Spoken:CompendiumFontSize()
    local size = Addon.db and Addon.db.profile.CompendiumFontSize
    if size == nil and type(SpokenPlacesSettings) == "table" then size = SpokenPlacesSettings.fontSize end
    return tonumber(size) or 12
end

--- Set the Compendium's Text Size, and tell the parts that draw its words.
function Spoken:SetCompendiumFontSize(size)
    if not Addon.db then return end
    Addon.db.profile.CompendiumFontSize = size
    Callbacks:Fire("COMPENDIUM_FONT_CHANGED")
end

--- Menu entries for the one minimap button. entry = { id, text, icon, order, onClick,
--- tooltip, visible }.
Spoken.Minimap = {}
function Spoken.Minimap:AddEntry(sourceKey, entry)
    Minimap:AddEntry(sourceKey, entry)
end
function Spoken.Minimap:RemoveEntry(sourceKey, id)
    Minimap:RemoveEntry(sourceKey, id)
end

--------------------------------------------------------------------------------
-- The queue, player-wide. Source-scoped operations live on the source.
--------------------------------------------------------------------------------

--- The head: speaking, paused, or held by a gate. Queue rows read this.
function Spoken:GetCurrent()
    return SoundQueue:GetCurrentSound()
end

--- The head only if it is speaking or paused mid-clip. Controls read this: a held clip
--- sits at the head making no sound, and offering Pause over silence lies.
function Spoken:GetNowPlaying()
    return SoundQueue:GetNowPlaying()
end

--- A shallow copy.
function Spoken:GetQueue()
    return SoundQueue:GetQueue()
end

function Spoken:GetQueueSize()
    return SoundQueue:GetQueueSize()
end

--- Excludes the speaking head.
function Spoken:GetWaitingCount()
    return SoundQueue:GetWaitingCount()
end

function Spoken:IsPlaying(clip)
    return SoundQueue:IsPlaying(clip)
end

function Spoken:IsPaused()
    return SoundQueue:IsPaused()
end

function Spoken:GetHeldReason(clip)
    return SoundQueue:GetHeldReason(clip)
end

--- Pause is stop, and resume replays from the start: the client has no seek.
function Spoken:Pause()
    return SoundQueue:PauseQueue()
end

function Spoken:Resume()
    return SoundQueue:ResumeQueue()
end

function Spoken:TogglePause()
    return SoundQueue:TogglePauseQueue()
end

--- The player's round button, the same one its subtitle shows, for a feature addon's own
--- window: `kind` "play" (Play's glyph; `button:SetPlaying(on)` shows Stop while a line
--- speaks), "skip" (Skip's glyph; a click skips the line speaking, so it needs no OnClick),
--- "report" (the bug), or "icon" (the texture `icon`, cut round). Anchor it and give it OnClick
--- yourself. Play and Skip grey out while disabled.
function Spoken:CreateRoundButton(parent, kind, name, icon)
    return Actions.NewRound(parent, kind, name, icon)
end

--- `button`, a Button the caller made, dressed as a square Play button with the game's checkbox for
--- its border (`button:SetState("play" | "stop")`, `button:MatchBox(checkbox)`): the quest log's rows.
function Spoken:DressBoxButton(button)
    return Actions.BoxPlay(button)
end

--- End the head; the backlog runs.
function Spoken:Skip()
    return SoundQueue:Skip()
end

--- Everything, every source, and the paused flag with it.
function Spoken:StopAll()
    SoundQueue:RemoveAllSoundsFromQueue()
end

--- Switch a channel off on a source's behalf, e.g. Dialog while a quest line speaks.
--- Unlike a channel the user disabled, clips on it are still admitted, and the mute is
--- lifted before one plays. A channel the user already has off is left alone: nothing is
--- held, so nothing switches it back on.
function Spoken:MuteChannel(channel, muted)
    SoundUtils:MuteChannel(channel, muted)
end

--- The source is about to queue a line: silence the game's NPC dialogue now rather than
--- when the line starts, so an NPC's greeting is never heard instead of being cut short.
--- Honours the player's "mute game dialogue" setting, and lifts itself if nothing comes.
---@return boolean? muted whether the dialogue was muted now; additive, guard on the field
function Spoken:MuteGameDialogueAhead(source)
    -- Where Read in Battlegrounds keeps Spoken quiet no line follows, so the greeting is left alone.
    if not Addon:ReadsHere() then
        return false
    end
    return SoundQueue:MuteGameDialogueAhead(source:GetChannel())
end

--- The read that MuteGameDialogueAhead was taken for found no line: the game's dialogue comes
--- back at once, unless a line is speaking.
function Spoken:EndMuteGameDialogueAhead()
    SoundQueue:EndMuteGameDialogueAhead()
end

--- Whether the mute MuteGameDialogueAhead took still holds for a line to come: false once its
--- deadline passed or a read gave the game's dialogue back.
---@return boolean
function Spoken:IsMutingGameDialogueAhead()
    return SoundQueue:IsMutingGameDialogueAhead()
end

--- A gate that applies to every source: fn(clip) -> reason | nil.
function Spoken:AddGate(fn)
    SoundQueue:AddGate(fn)
end

--- False in a battleground or arena with Read in Battlegrounds off, where a source's Enqueue
--- refuses every line the player did not ask for (`source:Enqueue(clip, true)` is one they did):
--- a module can skip the work of finding one. Additive: guard on the field.
function Spoken:ReadsHere()
    return Addon:ReadsHere()
end

--------------------------------------------------------------------------------
-- Captions, for an addon that shows the line being read somewhere else
--------------------------------------------------------------------------------
--
-- Additive, so guard on the field: `if Spoken.GetCaption then`. The timing is the captions' own: the clip's present.timings when it
-- brings them, an estimate otherwise, so another view marks the same word they would.

local caption = {}

--- The speaking clip's caption, kept current even while the captions are hidden or off:
---   { clip, words, totalWeight, progress, speaking, activeWord, highlight, typewriter,
---     typewriterBy, timed }
--- words[i] = { text, start, finish, first, last, joined }: start/finish are the word's share
--- of the recording, in units of totalWeight; first/last its bytes in the clip's text. timed is
--- true when they come from the clip's present.timings, and totalWeight is then its length.
--- progress is nil for a clip with no length; activeWord is set only while speaking.
--- highlight and typewriter are the player's Highlight Words and Type Words Out (false with
--- Show Words off); typewriterBy is "letter" or "word". Read-only, and the same table on
--- every call. nil without a clip.
function Spoken:GetCaption()
    if not Transcript.clip or not Transcript.words then return nil end
    -- Not read from what the captions last drew: they update only while shown, and
    -- DialogueUI hides them with UIParent.
    local progress = Transcript:GetProgress()
    caption.clip, caption.words, caption.totalWeight = Transcript.clip, Transcript.words, Transcript.totalWeight
    caption.progress = progress
    caption.speaking = Transcript:IsSpeaking(progress) and true or false
    caption.activeWord = caption.speaking and Transcript:WordAt(progress) or nil
    caption.timed = Transcript.timed
    caption.highlight, caption.typewriter, caption.typewriterBy = self:GetCaptionOptions()
    return caption
end

--- Highlight Words and Type Words Out as GetCaption gives them, with or without a clip, for a
--- view that prepares a line before it plays. Both false with Show Words off.
function Spoken:GetCaptionOptions()
    local cfg = Addon:Profile("Transcript")
    local by = cfg.TypewriterBy == "word" and "word" or "letter"
    if not cfg.Enabled then return false, false, by end
    return cfg.HighlightWord and true or false, cfg.Typewriter and true or false, by
end

--- Finding the line being read in another window's text and marking it there, as the captions
--- do: Align a caption's words to the window's paragraphs, Pick the pair to light, Cut how far
--- to type, Want what a paragraph shows.
function Spoken:WordMarks()
    return WordMarks
end

--- Split text into words as the captions do (a Chinese character is a word), each with its
--- bytes in text as first/last, so the caller can find GetCaption's word in its own copy of
--- the line. Escape sequences are not removed.
function Spoken:SplitCaption(text)
    if type(text) ~= "string" then return nil end
    return Transcript:Split(text)
end

--- The words the captions show for `transcript`, escape sequences removed: what
--- present.timings lists, one time per word.
function Spoken:CaptionWords(transcript)
    if type(transcript) ~= "string" then return nil end
    return Transcript:Split(Transcript:CleanText(transcript))
end

--------------------------------------------------------------------------------
-- Callbacks
--------------------------------------------------------------------------------
--
--   AUDIO_CHANGED      ()                  coarse; after every mutation
--   CLIP_QUEUED        (clip)
--   CLIP_STARTED       (clip)
--   CLIP_STOPPED       (clip, finishedPlaying)
--   CLIP_DROPPED       (clip, reason)      queue-limit | outranked | missing | an admit reason
--   QUEUE_EMPTY        ()
--   SOURCE_REGISTERED  (source)
--   CONTRIBUTE_SETTINGS_CHANGED ()          the hide-Contribute-buttons setting was toggled
--   REPORT_SETTINGS_CHANGED     ()          the hide-Report-buttons setting was toggled
--   VOICE_PACKS_LOADED          ()          the quest and gossip voice packs found at login have loaded
--   COMPENDIUM_FONT_CHANGED     ()          the Compendium's Text Size changed (Spoken:CompendiumFontSize)

function Spoken:RegisterCallback(event, fn)
    return Callbacks:Register(event, fn)
end

function Spoken:UnregisterCallback(handle)
    Callbacks:Unregister(handle)
end

--------------------------------------------------------------------------------
-- Packs
--------------------------------------------------------------------------------
--
-- A registry convention, not a resolver: each feature addon owns discovering and
-- resolving its own packs, and the player only ever sees a clip's path. This gives new
-- packs one place to register and one shared utility for the TOC-key scan.

Spoken.Packs = { bySource = {} }

function Spoken.Packs:Register(sourceKey, folderName, pack)
    self.bySource[sourceKey] = self.bySource[sourceKey] or {}
    self.bySource[sourceKey][folderName] = pack
end

--- Unsorted; the source ranks them.
function Spoken.Packs:Get(sourceKey)
    local list = {}
    for _, pack in pairs(self.bySource[sourceKey] or {}) do
        table.insert(list, pack)
    end
    return list
end

--- Every installed addon whose TOC carries `tocKey`, as an iterator over
--- `index, folderName, value`. The reusable half of the quests addon's DataModules
--- scan, wrapping the GetAddOnMetadata / C_AddOns split.
function Spoken:EnumerateAddonsWithKey(tocKey)
    local numAddons = C_AddOns and C_AddOns.GetNumAddOns and C_AddOns.GetNumAddOns() or GetNumAddOns()
    local getInfo = C_AddOns and C_AddOns.GetAddOnInfo or GetAddOnInfo
    local getMeta = C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
    local i = 0
    return function()
        while i < numAddons do
            i = i + 1
            local value = getMeta(i, tocKey)
            if value and value ~= "" then
                local folder = getInfo(i)
                return i, folder, value
            end
        end
    end
end

--------------------------------------------------------------------------------
-- Developer tools: the Spoken_Developer module (Developer.lua)
--------------------------------------------------------------------------------
--
-- Spoken keeps no log and draws no Developer page: the Spoken_Developer module does, and
-- registers here. Without it, every call below does nothing and answers nil or false. Additive,
-- so API_VERSION does not move: guard on the field.

--- For the module: hand Spoken the functions it calls (see Developer.lua).
function Spoken:RegisterDeveloper(provider)
    Developer:Register(provider)
end

--- Whether the module is installed, and with it the debug log.
function Spoken:HasLog()
    return Developer.provider ~= nil
end

--- One line in the debug log, while it is on. `message` is a format string when arguments
--- follow (four at most: format a longer line yourself); `category` a short word of your own.
function Spoken:Log(category, message, a, b, c, d)
    Developer:Log(category, message, a, b, c, d)
end

function Spoken:IsLogOn()
    return Developer:IsLogOn()
end

function Spoken:SetLogOn(on)
    Developer:Call("SetLogOn", on and true or false)
end

--- The last `count` lines, oldest first; all of them without a count. A copy; empty without the
--- module.
function Spoken:LogLines(count)
    return Developer:Call("Lines", count) or {}
end

--- Empty the log and every log handed in, then start it again with a session line; `how` says why.
function Spoken:ClearLog(how)
    Developer:Call("Clear", how)
end

--- The log and the logs handed in, merged on one timeline in a box to copy from. Returns how
--- many lines it shows; `count` keeps the newest.
function Spoken:ShowLog(count)
    return Developer:Call("Show", count)
end

--- Logs to read beside this one, such as other computers' that an addon collected. `list()`
--- returns { { name, lines, offset }, ... }: lines as the log writes them, on their own clock,
--- `offset` the seconds that put them on this one. `clear()`, optional, drops them when the log
--- is cleared.
function Spoken:AddLogSource(list, clear)
    Developer:Call("AddSource", list, clear)
end

--- The debug log's menu (copy it, copy it for an AI agent), where a Report button is
--- right-clicked. Spoken's own Report buttons, and every one made with CreateRoundButton, open it
--- by themselves.
function Spoken:ShowLogMenu(anchor)
    return Developer:ShowMenu(anchor)
end

--- The line a Report button's tooltip adds about its right-click, or nil without the module.
function Spoken:LogMenuHint()
    return Developer:MenuHint()
end

--- Rows of a feature addon's own on the Developer page (Spoken > Developer): tools for trying it
--- out, which a player never needs. build(layout) is called once, when the page is built, with
--- the page's SpokenLayout, and may return a function that puts its rows back to their defaults
--- for the page's Defaults button. Kept until the module builds its page; nothing shows without it.
--- `group`, "chat" (switches for messages in chat) or "testing", puts the rows build adds under
--- that group's title, with every other module's, in `order` (the module's page order: Quests 1,
--- Gossip 2, Places 3, Readables 4); without it, build adds a section of its own.
function Spoken:AddDeveloperSettings(build, group, order)
    Developer:AddSettings(build, group, order)
end

--- The group and order a section handed in was given, or nil.
function Spoken:GetDeveloperGroup(build)
    return Developer.groups[build], Developer.orders[build]
end

--- For the module: every section handed in so far, in order.
function Spoken:GetDeveloperSettings()
    local list = {}
    for _, build in ipairs(Developer.settings) do table.insert(list, build) end
    return list
end

--- A feature addon's diagnostics, for the debug log and its copies: fn(detailed) returns a list of
--- lines, what its own diagnostics command says, and with `detailed` what an AI agent reading the
--- log needs besides.
function Spoken:AddDiagnostics(name, fn)
    Developer:AddDiagnostics(name, fn)
end

--- What `/spoken diagnostics` says, then each feature addon's diagnostics, as lines; with
--- `detailed`, the state of the client, the narrator, the sound settings and the queue too.
function Spoken:Diagnostics(detailed)
    return Developer:Diagnostics(detailed)
end

-- The public surface of the player, as the plan's section 3.1 wrote it out. Every symbol a
-- feature addon may rely on exists here with its documented arity, and the ones with
-- observable behaviour are exercised once through the public seam rather than the
-- internals. Cheap, and it is what stops a refactor from silently deleting a function a
-- feature addon depends on. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
stub.LoadSpoken(SPOKEN)
local Spoken = _G.Spoken

---------------------------------------------------------------- version
Expect("API_VERSION is 1", Spoken.API_VERSION, 1)
-- Read out of the .toc rather than written here, which is the whole claim this makes: the
-- literal in Environment.lua loads before the addon has any metadata API, so nothing in the
-- game checks the two agree. A hardcoded expectation only asserts that a version bump touched
-- three files instead of two.
local toc = assert(io.open(SPOKEN .. "Spoken.toc")):read("*a")
Expect("ADDON_VERSION matches the TOC", Spoken.ADDON_VERSION, toc:match("## Version:%s*([^\r\n]+)"))
Expect("IsCompatible(1)", Spoken:IsCompatible(1), true)
Expect("not IsCompatible(2)", Spoken:IsCompatible(2), false)

---------------------------------------------------------------- the Public tier
-- The functions any addon may rely on, read from API.lua's "Public." doc comments and held to
-- this list both ways: one gone or renamed breaks every addon that calls it, and one marked
-- Public by accident is a promise nobody meant to make. Never take a name off this list; a
-- deprecated function stays, behind a shim (docs/spoken/API.md).
local PUBLIC = {
    "API_VERSION", "ADDON_VERSION", "IsCompatible",
    "HasStory", "PlayStory", "IsPlayingStory", "StopStory",
    "GetCaption", "GetCaptionOptions", "SplitCaption", "CaptionWords",
    "GetNowPlaying", "GetQueueSize", "IsPlaying", "IsPaused",
    "Pause", "Resume", "Skip", "StopAll",
    "IsPartOn", "Supports",
    "RegisterCallback", "UnregisterCallback",
    "RegisterText", "RegisterInterfaceStrings",
    "HasLog", "Log", "IsLogOn", "AddLogSource", "AddDiagnostics",
}
do
    local marked, pending = {}, false
    for line in io.lines(SPOKEN .. "API.lua") do
        if line:match("^%-%-%- Public[%.:]") then
            pending = true
        elseif not line:match("^%-%-%-") then
            local name = pending and (line:match("^function Spoken:([%w_]+)") or line:match("^Spoken%.([%w_]+) ="))
            if name then marked[#marked + 1] = name end
            pending = false
        end
    end
    local sorted = {}
    for i, name in ipairs(PUBLIC) do sorted[i] = name end
    table.sort(sorted); table.sort(marked)
    Expect("API.lua marks exactly the Public set", table.concat(marked, " "), table.concat(sorted, " "))
    for _, name in ipairs(PUBLIC) do
        Expect("Public " .. name .. " exists", Spoken[name] ~= nil, true)
    end
end

---------------------------------------------------------------- every documented method exists
-- Module tier, and Public names listed before the tiers: a module of Spoken's calls these, and
-- one lost in a refactor fails only in the game.
local METHODS = {
    -- sources
    "RegisterSource", "GetSource", "IterateSources",
    -- presentation registries
    "RegisterOptionalAction", "RegisterBullet", "RegisterPortraitRenderer",
    -- player-wide queue
    "GetCurrent", "GetNowPlaying", "GetQueue", "GetQueueSize", "GetWaitingCount",
    "IsPlaying", "IsPaused", "IsMuted", "GetHeldReason",
    "Pause", "Resume", "TogglePause", "Mute", "Unmute", "ToggleMute", "Skip", "StopAll", "AddGate", "MuteChannel", "MuteGameDialogueAhead",
    "EndMuteGameDialogueAhead",
    -- Read in Battlegrounds
    "ReadsHere",
    -- callbacks
    "RegisterCallback", "UnregisterCallback",
    -- packs
    "EnumerateAddonsWithKey",
    -- frame, settings
    "GetPlayerFrame", "GetSettingsCategory", "OpenSettings", "RefreshPlayer",
    "GetPlayerStyle", "SetPlayerHost", "AddDialogueUISettings",
    -- Azeroth's Compendium's Text Size, which Places, Readables and Quests draw their words at
    "CompendiumFontSize", "SetCompendiumFontSize",
    -- the profile a feature addon's own AceDB settings start a new character on
    "NewCharacterStartProfile",
    -- captions
    "GetCaption", "GetCaptionOptions", "SplitCaption", "CaptionWords",
    -- developer tools: the Spoken_Developer module's
    "RegisterDeveloper", "HasLog", "Log", "IsLogOn", "SetLogOn", "LogLines", "ClearLog", "ShowLog",
    "AddLogSource", "ShowLogMenu", "LogMenuHint", "AddDeveloperSettings", "GetDeveloperSettings",
    "AddDiagnostics", "Diagnostics",
    -- contributions
    "ShowContribution", "ShowReport", "SetContributeHost", "AreContributeButtonsHidden",
    -- a speaker's face on a feature addon's page
    "CreateSpeakerFace", "ItemIcon",
    -- Play, Skip and Report on DialogueUI's quest window and book view
    "CreateDialogueUIRow",
    -- a dungeon's or a boss's story, for another addon's Play button
    "RegisterStoryTeller", "HasStory", "PlayStory", "IsPlayingStory", "StopStory",
    -- the voices the player hears, in order, and the voice a pack is in
    "GetLanguageChoice", "GetVoiceOrder", "SetVoiceOrder", "VoiceOf", "SplitVoice", "VoiceName",
    -- the controls the modules' windows draw
    "PlayState", "Previous", "CanPrevious", "CreateRoundButton", "DressBoxButton",
    -- the parts' switches and pages
    "SetPartOn", "PartStatus", "PartVoice", "AddSettingsPage", "ShowsNarratorFor",
    -- text packs and interface packs
    "TextIn", "TextSection", "TextLanguage", "TextLanguageChoice", "SetTextLanguage",
    "ApplyInterfaceStrings", "InterfaceIn", "InterfaceLanguage", "InterfaceBase",
    "DeclareLanguage", "Language", "KnownLanguages", "InstalledLanguages", "BuiltinLanguages",
    -- captions marked in another window
    "WordMarks",
    -- contributions and reports
    "ShowGatherInstructions", "ShowGatheredText", "RefreshGatheredText", "AreReportButtonsHidden",
    "ReportURL",
}
for _, name in ipairs(METHODS) do
    Expect("Spoken:" .. name .. " exists", type(Spoken[name]), "function")
end
Expect("CaptionWords counts the words the captions show, escapes removed",
    #Spoken:CaptionWords("aaaa |cffff0000bbbb|r |T x:0|tcccc|ndddd"), 4)
Expect("Spoken.Packs.Register exists", type(Spoken.Packs and Spoken.Packs.Register), "function")
Expect("Spoken.Packs.Get exists", type(Spoken.Packs and Spoken.Packs.Get), "function")
Expect("Spoken.Minimap.AddEntry exists", type(Spoken.Minimap and Spoken.Minimap.AddEntry), "function")
Expect("Spoken.Minimap.RemoveEntry exists", type(Spoken.Minimap and Spoken.Minimap.RemoveEntry), "function")
Expect("Spoken.NotSecret exists", type(Spoken.NotSecret), "function")
Expect("Spoken.CreatureID exists", type(Spoken.CreatureID), "function")
Expect("Spoken.Contribute exists", type(Spoken.Contribute), "table")

local SOURCE_METHODS = { "Enqueue", "Continue", "Retry", "PlayNow", "Remove", "StopAll", "AddGate", "RecheckGates", "CanPlay", "SetQueueLimit", "SetInterClipGap" }
local src = Spoken:RegisterSource("contract", { title = "Contract", addon = "X", order = 1 })
for _, name in ipairs(SOURCE_METHODS) do
    Expect("source:" .. name .. " exists", type(src[name]), "function")
end

---------------------------------------------------------------- behaviour through the seam
Expect("GetSource finds it", Spoken:GetSource("contract"), src)
local keys = {}
for key in Spoken:IterateSources() do table.insert(keys, key) end
Expect("IterateSources yields it", keys[1], "contract")

local started
local handle = Spoken:RegisterCallback("CLIP_STARTED", function(clip) started = clip end)
local clip = H.Clip()
src:Enqueue(clip)
Expect("a callback registered through the API fires", started, clip)
Expect("GetCurrent is the head", Spoken:GetCurrent(), clip)
Expect("GetNowPlaying is the speaking head", Spoken:GetNowPlaying(), clip)
Expect("IsPlaying", Spoken:IsPlaying(), true)
Expect("GetQueueSize", Spoken:GetQueueSize(), 1)
Expect("GetWaitingCount", Spoken:GetWaitingCount(), 0)
Expect("GetQueue is a copy", Spoken:GetQueue()[1] == clip and Spoken:GetQueue() ~= Spoken:GetQueue(), true)
Expect("GetHeldReason is nil when free", Spoken:GetHeldReason(clip), nil)

Spoken:UnregisterCallback(handle)
started = nil
src:Enqueue(H.Clip())
Spoken:Skip()
Expect("an unregistered callback stays quiet", started, nil)

Spoken:Pause()
Expect("Pause", Spoken:IsPaused(), true)
Spoken:Resume()
Expect("Resume", Spoken:IsPaused(), false)
Spoken:TogglePause()
Expect("TogglePause", Spoken:IsPaused(), true)
Spoken:Mute()
Expect("Mute", Spoken:IsMuted(), true)
Spoken:Unmute()
Expect("Unmute", Spoken:IsMuted(), false)
Spoken:ToggleMute()
Expect("ToggleMute", Spoken:IsMuted(), true)
Spoken:StopAll()
Expect("StopAll empties", Spoken:GetQueueSize(), 0)
Expect("...and unpauses", Spoken:IsPaused(), false)
Spoken:Unmute()

---------------------------------------------------------------- stories
-- No teller for a kind, or no id: every answer is false.
Expect("a kind no module tells has no story", tostring(Spoken:HasStory("contract", 1)) .. " "
    .. tostring(Spoken:PlayStory("contract", 1)) .. " " .. tostring(Spoken:IsPlayingStory("contract", 1)) .. " "
    .. tostring(Spoken:StopStory("contract", 1)), "false false false false")
do
    -- Story 7 has two parts, a locked "story:7a" and a playable "story:7b"; story 8 none playable.
    local tellerSource = Spoken:RegisterSource("story-contract", { title = "Stories", addon = "X", order = 9 })
    Spoken:RegisterStoryTeller("contract", {
        source = tellerSource,
        Keys = function(id) return { "story:" .. id .. "a", "story:" .. id .. "b" } end,
        Clip = function(id, key)
            if key == "story:7b" then local clip = H.Clip(); clip.key = key; return clip end
        end,
    })
    Spoken:StopAll()
    Expect("HasStory: a story with a playable part", tostring(Spoken:HasStory("contract", 7)) .. " "
        .. tostring(Spoken:HasStory("contract", 8)) .. " " .. tostring(Spoken:HasStory("contract", nil)), "true false false")
    Expect("PlayStory plays only a story with one", tostring(Spoken:PlayStory("contract", 8)) .. " "
        .. tostring(Spoken:PlayStory("contract", 7)), "false true")
    Expect("...the playable part, through the teller's source", Spoken:GetNowPlaying().key .. " "
        .. tostring(Spoken:GetNowPlaying().source == tellerSource), "story:7b true")
    SpokenEnv.Addon:Enable() -- the captions GetCaption reads
    local story = Spoken:GetCaption().story
    Expect("...which GetCaption names as PlayStory was asked", story.kind .. " " .. story.id, "contract 7")
    Expect("IsPlayingStory: its own story only", tostring(Spoken:IsPlayingStory("contract", 7)) .. " "
        .. tostring(Spoken:IsPlayingStory("contract", 8)), "true false")
    Spoken:Pause()
    Expect("...and not while paused", Spoken:IsPlayingStory("contract", 7), false)
    Spoken:Resume()
    Expect("StopStory takes it out", tostring(Spoken:StopStory("contract", 7)) .. " " .. Spoken:GetQueueSize(), "true 0")
    Expect("...and a second stop finds nothing", Spoken:StopStory("contract", 7), false)
end

---------------------------------------------------------------- the Public events' payloads and the caption's shape
do
    local seen = {}
    local handles = {}
    for _, event in ipairs({ "CLIP_QUEUED", "CLIP_STARTED", "CLIP_STOPPED", "CLIP_DROPPED", "QUEUE_EMPTY", "PART_SWITCHED" }) do
        handles[#handles + 1] = Spoken:RegisterCallback(event, function(a, b)
            seen[#seen + 1] = event .. " " .. (type(a) == "table" and a.key or tostring(a)) .. " " .. tostring(b)
        end)
    end
    local source = Spoken:RegisterSource("payloads", { title = "Payloads", addon = "X", order = 10 })
    source:SetQueueLimit(1)
    local spoken = H.Clip({ key = "p1", present = { header = "Who", label = "What", transcript = "one two three" } })
    source:Enqueue(spoken)
    source:Enqueue(H.Clip({ key = "p2" }))
    source:Enqueue(H.Clip({ key = "p3" }))

    local caption = Spoken:GetCaption()
    local word = caption and caption.words[1]
    Expect("a caption has its clip and its words", tostring(caption.clip == spoken) .. " " .. #caption.words
        .. " " .. type(caption.totalWeight) .. " " .. type(caption.progress) .. " " .. type(caption.speaking)
        .. " " .. tostring(caption.timed), "true 3 number number boolean false")
    Expect("...each word with its text, its span and its bytes", word.text .. " " .. type(word.start) .. " "
        .. type(word.finish) .. " " .. word.first .. "-" .. word.last .. " " .. tostring(word.joined), "one number number 1-3 false")
    Expect("...and the player's options", type(caption.highlight) .. " " .. type(caption.typewriter) .. " "
        .. caption.typewriterBy, "boolean boolean letter")
    Expect("GetCaption hands back the same table each call", Spoken:GetCaption() == caption, true)

    Spoken:Skip()
    Spoken:StopAll()
    Spoken:SetPartOn("payloads", false)
    Spoken:SetPartOn("payloads", true)
    for _, h in ipairs(handles) do Spoken:UnregisterCallback(h) end
    Expect("the Public events carry their documented payloads", table.concat(seen, ", "),
        "CLIP_QUEUED p1 nil, CLIP_STARTED p1 nil, CLIP_QUEUED p2 nil, CLIP_DROPPED p2 queue-limit, CLIP_QUEUED p3 nil, "
        .. "CLIP_STOPPED p1 false, CLIP_STARTED p3 nil, CLIP_STOPPED p3 false, QUEUE_EMPTY nil nil, "
        .. "PART_SWITCHED payloads false, PART_SWITCHED payloads true")
end

Spoken:AddGate(function() return "held by the player" end)
local held = H.Clip()
src:Enqueue(held)
Expect("a player-wide gate holds every source", Spoken:GetHeldReason(held), "held by the player")

---------------------------------------------------------------- registries
Spoken:RegisterBullet("contract-bullet", "Interface\\X", 12)
Expect("a registered bullet is retrievable", Spoken:GetBullet("contract-bullet").texture, "Interface\\X")
Spoken:RegisterPortraitRenderer("contract", { Acquire = function() end, Update = function() end, Release = function() end })
Expect("a registered renderer is retrievable", type(Spoken:GetPortraitRenderer("contract")), "table")

Spoken.Packs:Register("contract", "SomePackFolder", { version = 1 })
Expect("Packs.Get returns what was registered", Spoken.Packs:Get("contract")[1].version, 1)
Expect("Packs.Get for an unknown source is empty", getn(Spoken.Packs:Get("nothing")), 0)

---------------------------------------------------------------- a speaker's face
-- The Small Window's portrait on a page of the caller's: the creature's still where the client
-- has its appearance, else the book; an object's picture; the line's badge on its disc.
do
    local E = SpokenEnv
    local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]
    local page = CreateFrame("Frame", nil, UIParent)
    local face = Spoken:CreateSpeakerFace(page, 44)
    local function Drawn()
        if face.still:IsShown() then return "still " .. tostring(face.still.display) end
        local texture = face.viewport.texture
        return texture and texture:IsShown() and texture:GetTexture() or "nothing"
    end
    Expect("a face is the size asked for, on the page", face:GetWidth() .. " " .. tostring(face:GetParent() == page), "44 true")
    Expect("...in the Small Window's ring", face.ring:GetTexture(), [[Interface\AddOns\Spoken\Textures\MinimalPortraitRing]])
    Expect("...with no speaker, the book, never an empty socket", Drawn(), BOOK)
    Expect("...and no badge", tostring(face.badge:IsShown()) .. " " .. tostring(face.badgeBackground:IsShown()), "false false")

    world.creatureDisplays[197] = { 3258 }
    face:SetSpeaker({ creatureID = 197, bullet = "quest-accept" })
    Expect("a creature the client has: its still", Drawn(), "still 3258")
    Expect("...with the bullet's badge on its disc", face.badge:IsShown() and face.badgeBackground:IsShown()
        and face.badge:GetTexture(), E.Face.BADGES["quest-accept"])
    Expect("...at least 12 across on a small face", face.badge:GetWidth(), 12)

    world.creatureDisplays[240] = { 1990 }
    world.displaysUncached = true
    face:SetSpeaker({ creatureID = 240, bullet = "quest-complete" })
    Expect("a creature the client has not cached: the book meanwhile", Drawn(), BOOK)
    Expect("...asking for it while shown", type(face.scripts.OnUpdate), "function")
    world.displaysUncached = false
    world.time = world.time + 1
    face.scripts.OnUpdate(face, 1)
    Expect("...and its still once the client has it", Drawn(), "still 1990")
    Expect("...then asking no more", face.scripts.OnUpdate, nil)

    -- A model answers with the creature it held until the new one loads: each creature's face is its own.
    world.modelLags = true
    world.creatureDisplays[301], world.creatureDisplays[302], world.creatureDisplays[303] = { 4001 }, { 4002 }, { 4003 }
    local primed = {}
    for _, id in ipairs({ 301, 302, 303 }) do primed[#primed + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.time = world.time + 1
    for _, id in ipairs({ 301, 302, 303 }) do primed[#primed + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.modelLags = false
    Expect("creatures asked together keep their own appearances while the client loads them",
        table.concat(primed, " "), "nil nil nil 4001 4002 4003")

    -- A creature the client has not cached shows a stand-in face until the server replies: not a face.
    world.blankDisplay = 5555
    world.time = world.time + 0.1 -- the stand-ins are read once a frame
    world.creatureDisplays[311], world.creatureDisplays[312] = { 4011 }, { 4012 }
    world.unloaded = { [311] = true }
    local own = {}
    for _, id in ipairs({ 311, 312 }) do own[#own + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.time = world.time + 0.1
    own[#own + 1] = tostring((E.StaticPortrait:Prime(311)))
    world.unloaded = nil
    world.time = world.time + 1.1
    own[#own + 1] = tostring((E.StaticPortrait:Prime(311)))
    world.blankDisplay, world.unloaded = 5555, { [321] = true }
    local shipped = E.StaticPortrait:FromCreature(321, 4321)
    world.blankDisplay, world.unloaded = nil, nil
    Expect("a creature with a shipped appearance is drawn from it, whatever the client has cached",
        shipped and shipped.texture.display, 4321)
    Expect("an uncached creature takes the default face for no creature's, and its own once cached",
        table.concat(own, " "), "nil 4012 nil 4011")

    world.displaysUncached = true
    face:SetSpeaker({ creatureID = 6 })
    world.time = world.time + 10
    face.scripts.OnUpdate(face, 10)
    Expect("one the client never answers for keeps the book, and is no longer asked for",
        Drawn() .. " " .. tostring(face.scripts.OnUpdate), BOOK .. " nil")
    world.displaysUncached = false

    face:SetSpeaker({ objectOrItem = true, icon = [[Interface\Icons\INV_Misc_Book_08]] })
    Expect("an object or an item: its picture", Drawn(), [[Interface\Icons\INV_Misc_Book_08]])
    face:SetSpeaker({ objectOrItem = true })
    Expect("...else a posted notice", Drawn(), [[Interface\Icons\INV_Misc_Note_01]])

    -- Two faces of one NPC both show it: neither takes the other's texture.
    local other = Spoken:CreateSpeakerFace(page, 44)
    face:SetSpeaker({ creatureID = 197 })
    other:SetSpeaker({ creatureID = 197 })
    Expect("two faces of one creature each draw it", Drawn() .. " " .. tostring(other.still:IsShown()), "still 3258 true")
end

---------------------------------------------------------------- the voice list
do
    local language = SpokenEnv.Addon.db.profile.Language
    local function Order() local list = Spoken:GetVoiceOrder(); return list and table.concat(list, ",") or nil end
    Expect("no list yet: no order, and each module keeps its own", Order(), nil)
    Expect("a list is stored", Spoken:SetVoiceOrder({ "deDE_stimmen", "deDE", "enUS" }), true)
    Expect("...and read back", Order(), "deDE_stimmen,deDE,enUS")
    Expect("...keeping the old voice language as the first entry's language", language.Voice, "deDE")
    Expect("...and the fallback as the second's", language.Fallback, "deDE")
    Expect("...so GetLanguageChoice still answers in languages", select(2, Spoken:GetLanguageChoice()), "deDE")
    Spoken:SetVoiceOrder({ "deDE_stimmen" })
    Expect("one entry: the fallback is Stay Silent", language.Fallback, "none")
    Expect("an empty list is refused", Spoken:SetVoiceOrder({}), false)
    Expect("a repeated voice is refused", Spoken:SetVoiceOrder({ "deDE", "deDE" }), false)
    Expect("a value that is no voice is refused", Spoken:SetVoiceOrder({ "deDE", "Stimmen!" }), false)
    Expect("...and the list stays as it was", Order(), "deDE_stimmen")
    Spoken:SetVoiceOrder({ "auto", "frFR", "enUS" })
    Expect("Auto is kept as Auto in the old voice language", language.Voice, "auto")
    stub.SetLocale("frFR")
    Expect("Auto resolves to the client's language, and a later repeat of it is dropped", Order(), "frFR,enUS")
    stub.SetLocale("enUS")
    Expect("the stored list keeps Auto", table.concat(language.Voices, ","), "auto,frFR,enUS")
    Spoken:SetVoiceOrder({ "deDE", "auto" })
    Expect("Auto second is the client's language as the old fallback", language.Fallback, "enUS")
    language.Voices, language.Voice, language.Fallback = nil, nil, nil
end

---------------------------------------------------------------- the boundary
-- A wrong registration fails at the caller's line, where its author can see it, rather than
-- inside the queue later. A query with the wrong input answers false or nil and never throws.
do
    local function Raises(fn, ...)
        local ok, err = pcall(fn, ...)
        return not ok and tostring(err):find("api_contract_test", 1, true) ~= nil
    end
    local function Handler() end
    Expect("RegisterCallback refuses a handler that is not a function, at the caller's line",
        Raises(function() Spoken:RegisterCallback("AUDIO_CHANGED", nil) end), true)
    Expect("...and an event that is not a string", Raises(function() Spoken:RegisterCallback(nil, Handler) end), true)
    Expect("UnregisterCallback ignores what is no handle", tostring(pcall(Spoken.UnregisterCallback, Spoken, 5)) .. " "
        .. tostring(pcall(Spoken.UnregisterCallback, Spoken, nil)), "true true")
    Expect("AddDiagnostics refuses a fn that is not a function", Raises(function() Spoken:AddDiagnostics("x", nil) end), true)
    Expect("AddLogSource refuses a list that is not a function", Raises(function() Spoken:AddLogSource({}) end), true)

    local teller = { source = src, Keys = function() return {} end, Clip = function() end }
    Expect("RegisterStoryTeller refuses a teller without Keys and Clip",
        Raises(function() Spoken:RegisterStoryTeller("boundary", { source = src }) end), true)
    Spoken:RegisterStoryTeller("boundary", teller)
    -- Another addon may take a name first; a module registering it later must still load.
    local other = { source = src, Keys = function() return {} end, Clip = function() end }
    Expect("a second teller of one kind replaces the first, without raising",
        tostring(pcall(Spoken.RegisterStoryTeller, Spoken, "boundary", other)), "true")
    Expect("a bullet id taken again is replaced, without raising",
        tostring(pcall(Spoken.RegisterBullet, Spoken, "contract-bullet", "Interface\\Y", 12)) .. " "
        .. Spoken:GetBullet("contract-bullet").texture, "true Interface\\Y")
    local renderer = {}
    Expect("a portrait renderer's kind taken again is replaced, without raising",
        tostring(pcall(Spoken.RegisterPortraitRenderer, Spoken, "contract", renderer)) .. " "
        .. tostring(Spoken:GetPortraitRenderer("contract") == renderer), "true true")

    local ran = {}
    local first
    first = Spoken:RegisterCallback("QUEUE_EMPTY", function() ran[#ran + 1] = "first"; Spoken:UnregisterCallback(first) end)
    local second = Spoken:RegisterCallback("QUEUE_EMPTY", function() ran[#ran + 1] = "second" end)
    SpokenEnv.Callbacks:Fire("QUEUE_EMPTY")
    Spoken:UnregisterCallback(second)
    Expect("a handler that unregisters itself leaves the next one to run", table.concat(ran, " "), "first second")

    Expect("IsPartOn answers false for what is no part's key", tostring(Spoken:IsPartOn(nil)) .. " "
        .. tostring(Spoken:IsPartOn(5)) .. " " .. tostring(Spoken:IsPartOn("quests")), "false false true")
    Expect("the story calls take any id without throwing", tostring(Spoken:HasStory("boundary", "x")) .. " "
        .. tostring(Spoken:PlayStory({}, {})) .. " " .. tostring(Spoken:StopStory(nil, nil)), "false false false")

    Expect("Supports names a story kind once its teller registers", tostring(Spoken:Supports("story:boundary")) .. " "
        .. tostring(Spoken:Supports("story:nothing")), "true false")
    Expect("...and the API's features", tostring(Spoken:Supports("captions")) .. " " .. tostring(Spoken:Supports("log")),
        "true true")
    Expect("...and false for anything else", tostring(Spoken:Supports(nil)) .. " " .. tostring(Spoken:Supports(7)) .. " "
        .. tostring(Spoken:Supports("teleport")), "false false false")
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll API contract tests passed")

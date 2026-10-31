-- The profile for new characters: a character logging in with Spoken for the first time starts on
-- the profile chosen on Spoken's page, in Spoken's settings and in the quests module's, and every
-- character that has logged in before keeps its profile and every value in it. Runs the real
-- AceDB, since which profile a character gets is AceDB's profileKeys, which the stub's AceDB does
-- not have. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local Expect, Failures = H.Expecter(print)
local Copy = stub.DeepCopy

_G.UnitFactionGroup = _G.UnitFactionGroup or function() return "Alliance", "Alliance" end
_G.GetCurrentRegion = _G.GetCurrentRegion or function() return 3 end
_G.GetCurrentRegionName = _G.GetCurrentRegionName or function() return "EU" end
_G.UNKNOWNOBJECT = "Unknown"

-- The real libraries over the stub's: LibStub hands back the stub's table, emptied here so the file
-- fills it as a first load would. AceDB reads the character's name as its file loads, so each login
-- loads it again under that name.
local function RealLibraries(name)
    stub.world.playerName = name
    for _, lib in ipairs({ "CallbackHandler-1.0", "AceDB-3.0" }) do
        local made = _G.LibStub:NewLibrary(lib, 1)
        for key in pairs(made) do made[key] = nil end
        dofile(SPOKEN .. "Libs/" .. lib .. "/" .. lib .. ".lua")
    end
end

local function Same(a, b)
    if type(a) ~= "table" or type(b) ~= "table" then return a == b end
    for key, value in pairs(a) do if not Same(value, rawget(b, key)) then return false end end
    for key in pairs(b) do if rawget(a, key) == nil then return false end end
    return true
end

-- The test harness writes Style and LineGap into the profile a character is on (LoadSpoken), and
-- the first login on a profile places the minimap button: each saved profile has them already, as a
-- profile that has been played on has, so a write here is a change to what the player had.
local function Profile(fontSize)
    return { Transcript = { FontSize = fontSize }, Frame = { Style = "classic" }, Audio = { LineGap = 0 },
        Minimap = { LibDBIcon = { minimapPos = 204 } } }
end

--- What a player has saved: Alice on a profile of her own, Bob on Shared, in both addons.
local function Seed(newCharacters)
    _G.SpokenSettings = {
        profileKeys = { ["Alice - Realm"] = "Alice - Realm", ["Bob - Realm"] = "Shared" },
        profiles = { ["Alice - Realm"] = Profile(20), Shared = Profile(12) },
        global = { NewCharacterProfile = newCharacters },
        -- Both have logged in since the voice language moved from the quests page to Spoken's.
        char = { ["Alice - Realm"] = { voiceLanguageFromQuests = true }, ["Bob - Realm"] = { voiceLanguageFromQuests = true } },
    }
    _G.SpokenQuestsSettings = {
        profileKeys = { ["Alice - Realm"] = "Alice - Realm", ["Bob - Realm"] = "Shared" },
        profiles = {
            ["Alice - Realm"] = { Audio = { Autoplay = false } },
            -- Left from before the voice language was Spoken's, which Shared has never set.
            Shared = { Audio = { GreetingFirst = true, VoiceLanguage = "deDE" } },
        },
    }
end

local env, VO
--- A login of `name` with Spoken and its quests module, then a logout, which is when AceDB strips
--- what it filled in and the game writes the saved variables.
local function Play(name)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.ldbObjects = {}; stub.dbIcons = {}
    RealLibraries(name)
    VO, env = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    env.Addon:TakeVoiceLanguageFromQuests()
    local spoken, quests = env.Addon.db:GetCurrentProfile(), VO.Addon.db:GetCurrentProfile()
    local fontSize = env.Addon.db.profile.Transcript.FontSize
    local autoplay = VO.Addon.db.profile.Audio.Autoplay
    local AceDB = _G.LibStub("AceDB-3.0")
    AceDB.frame.scripts.OnEvent(AceDB.frame, "PLAYER_LOGOUT")
    return spoken, quests, fontSize, autoplay
end

local function Voice(profile)
    local language = SpokenSettings.profiles[profile] and SpokenSettings.profiles[profile].Language
    return language and language.Voice
end

---------------------------------------------------------------- a profile chosen for new characters
Seed("Shared")
local spokenBefore, questsBefore = Copy(SpokenSettings), Copy(SpokenQuestsSettings)

local spoken, quests, fontSize, autoplay = Play("Alice")
Expect("a character with a profile of its own keeps it in Spoken", spoken, "Alice - Realm")
Expect("...and in the quests module", quests, "Alice - Realm")
Expect("...with its settings", fontSize, 20)
Expect("...and the quests module's", autoplay, false)

spoken, quests = Play("Bob")
Expect("a character on another profile keeps it in Spoken", spoken, "Shared")
Expect("...and in the quests module", quests, "Shared")
Expect("after both log in, Spoken's saved profiles are as they were", Same(SpokenSettings.profiles, spokenBefore.profiles), true)
Expect("...and which character is on which", Same(SpokenSettings.profileKeys, spokenBefore.profileKeys), true)
Expect("...and the quests module's profiles", Same(SpokenQuestsSettings.profiles, questsBefore.profiles), true)
Expect("...and which character is on which there", Same(SpokenQuestsSettings.profileKeys, questsBefore.profileKeys), true)

spoken, quests, fontSize = Play("Carol")
Expect("a new character starts on the profile chosen for new characters", spoken, "Shared")
Expect("...in the quests module too", quests, "Shared")
Expect("...with that profile's settings", fontSize, 12)
Expect("...and stays on it", SpokenSettings.profileKeys["Carol - Realm"], "Shared")
Expect("no profile is made for the new character", SpokenSettings.profiles["Carol - Realm"], nil)
Expect("...in the quests module either", SpokenQuestsSettings.profiles["Carol - Realm"], nil)
Expect("the shared profile is as it was, the quests page's language not copied into it",
    Same(SpokenSettings.profiles.Shared, spokenBefore.profiles.Shared), true)
Expect("...and its quests settings", Same(SpokenQuestsSettings.profiles.Shared, questsBefore.profiles.Shared), true)
Expect("Alice's profile is as it was", Same(SpokenSettings.profiles["Alice - Realm"], spokenBefore.profiles["Alice - Realm"]), true)

---------------------------------------------------------------- none chosen
Seed(nil)
spokenBefore = Copy(SpokenSettings)
spoken, quests, fontSize = Play("Dave")
Expect("with none chosen, a new character gets a profile of its own", spoken, "Dave - Realm")
Expect("...in the quests module too", quests, "Dave - Realm")
Expect("...starting from the defaults", fontSize, 16)
Expect("...and the shared profile is as it was", Same(SpokenSettings.profiles.Shared, spokenBefore.profiles.Shared), true)
spoken = Play("Bob")
Expect("...and a character on another profile keeps it", spoken, "Shared")

---------------------------------------------------------------- the chosen profile deleted
Seed("Gone")
spoken, quests = Play("Erin")
Expect("a chosen profile that no longer exists gives a new character a profile of its own", spoken, "Erin - Realm")
Expect("...in the quests module too", quests, "Erin - Realm")
Expect("...and is not made again", SpokenSettings.profiles.Gone, nil)

---------------------------------------------------------------- a character's profile deleted
-- Bob is on Raid, with nothing of his own saved, and Alice deletes Raid. AceDB clears the profile
-- of every character on it, which would make Bob look new.
Seed("Shared")
SpokenSettings.profileKeys["Bob - Realm"], SpokenQuestsSettings.profileKeys["Bob - Realm"] = "Raid", "Raid"
SpokenSettings.profiles.Raid, SpokenQuestsSettings.profiles.Raid = Profile(14), { Audio = { Autoplay = false } }
SpokenSettings.char["Bob - Realm"] = nil
spokenBefore = Copy(SpokenSettings)
Play("Alice")
env.Options:DeleteProfile("Raid")
Expect("deleting a profile puts its characters back on their own", SpokenSettings.profileKeys["Bob - Realm"], "Bob - Realm")
spoken, quests, fontSize = Play("Bob")
Expect("...so a character whose profile was deleted gets its own, not the one for new characters", spoken, "Bob - Realm")
Expect("...in the quests module too", quests, "Bob - Realm")
Expect("...starting from the defaults", fontSize, 16)
Expect("...and Shared is as it was", Same(SpokenSettings.profiles.Shared, spokenBefore.profiles.Shared), true)

-- A deletion before this version cleared the key and left it cleared: settings of its own saved
-- show the character has been here.
Seed("Shared")
SpokenSettings.profileKeys["Bob - Realm"] = nil
spoken = Play("Bob")
Expect("a character with no profile but saved settings of its own gets its own profile", spoken, "Bob - Realm")
Expect("...and keeps it", SpokenSettings.profileKeys["Bob - Realm"], "Bob - Realm")

-- Settings of its own, with no profile chosen and no per-character table, show it too.
Seed("Shared")
SpokenSettings.profileKeys["Alice - Realm"] = nil
SpokenSettings.char["Alice - Realm"] = nil
spoken = Play("Alice")
Expect("a character with no profile but a profile named for it gets that profile", spoken, "Alice - Realm")

---------------------------------------------------------------- "Unknown" logins
-- The Forever client answers "Unknown" for the player's name on some logins, so AceDB keys any
-- character that logs in then as "Unknown - Realm".
Seed("Shared")
spoken, quests = Play("Unknown")
Expect("a login AceDB keys as Unknown is not taken for a new character", spoken, "Unknown - Realm")
Expect("...in the quests module either", quests, "Unknown - Realm")
Expect("...and is not tied to the profile for new characters", SpokenSettings.profileKeys["Unknown - Realm"], "Unknown - Realm")

---------------------------------------------------------------- the voice language from the quests page
-- Bob has played on Shared, but not with the quests module on, so it has no profile for him and
-- he has not had the voice language copied yet. Others on Shared in the quests module left deDE.
Seed("Shared")
SpokenQuestsSettings.profileKeys["Bob - Realm"] = nil
SpokenSettings.char["Bob - Realm"] = nil
SpokenSettings.profileKeys["Frank - Realm"] = "Shared"
SpokenSettings.char["Frank - Realm"] = { voiceLanguageFromQuests = true }
spoken, quests = Play("Bob")
Expect("a character the quests module has not seen keeps Spoken's profile", spoken, "Shared")
Expect("...and gets a profile of its own there, not the one Spoken is on", quests, "Bob - Realm")
Expect("...and no voice language is copied into the profile others are on", Voice("Shared"), nil)
Expect("...and the copy is done with", SpokenSettings.char["Bob - Realm"].voiceLanguageFromQuests, true)

-- Shared by name in both addons, as the page keeps them, and another character on it has had its
-- copy: it hears what Shared says, which a copy now would change.
Seed(nil)
SpokenSettings.char["Bob - Realm"] = nil
SpokenSettings.profileKeys["Frank - Realm"] = "Shared"
SpokenSettings.char["Frank - Realm"] = { voiceLanguageFromQuests = true }
Play("Bob")
Expect("a character on a profile another has had its copy on does not copy the quests page's language into it",
    Voice("Shared"), nil)

-- Where no character on it has had the copy, the first to log in makes it.
Seed(nil)
SpokenSettings.char["Bob - Realm"] = nil
SpokenSettings.profileKeys["Frank - Realm"] = "Shared"
Play("Bob")
Expect("a character first on a shared profile since the move takes the quests page's language", Voice("Shared"), "deDE")

-- Alone on its own profile, the copy is made.
Seed(nil)
SpokenSettings.char["Alice - Realm"] = nil
SpokenQuestsSettings.profiles["Alice - Realm"].Audio.VoiceLanguage = "frFR"
Play("Alice")
Expect("a character alone on its profile takes the voice language from the quests page", Voice("Alice - Realm"), "frFR")

---------------------------------------------------------------- the choice on Spoken's page
Seed(nil)
Play("Alice")
local Options, L = env.Options, env.L
Expect("with none chosen, the page shows a profile of their own", Options:NewCharacterProfile(), false)
Options:SetNewCharacterProfile("Shared")
Expect("choosing a profile keeps it for every character", SpokenSettings.global.NewCharacterProfile, "Shared")
Expect("...and the page shows it", Options:NewCharacterProfile(), "Shared")
Expect("...and the character choosing stays on its own", env.Addon.db:GetCurrentProfile(), "Alice - Realm")
Options:DeleteProfile("Shared")
Expect("deleting the chosen profile shows a profile of their own", Options:NewCharacterProfile(), false)
Expect("...and forgets the choice", SpokenSettings.global.NewCharacterProfile, nil)
SpokenSettings.profiles.Shared = Profile(12)
Expect("...so a profile made later under its name is not the one for new characters", Options:NewCharacterProfile(), false)
spoken = Play("Gina")
Expect("...and gives the next new character one", spoken, "Gina - Realm")
Options = env.Options
Options:SetNewCharacterProfile("Alice - Realm")
Options:SetNewCharacterProfile(false)
Expect("choosing a profile of their own clears the choice", SpokenSettings.global.NewCharacterProfile, nil)

-- The dropdown: Spoken's saved profiles, and each entry told apart from the others by what it is.
Seed(nil)
SpokenSettings.profiles[L.OPT_PROFILE_OWN] = Profile(12)
SpokenQuestsSettings.profiles.QuestsOnly = { Audio = {} }
Play("Alice")
local menu
for _, entry in ipairs(_G.SpokenOptionsPanel.layout.entries) do
    if entry.label == env.L.OPT_NEW_CHARACTER_PROFILE then menu = entry.frame end
end
local entries, offered, checked = menu and stub.OpenDropdown(menu) or {}, {}, 0
for _, entry in ipairs(entries) do
    table.insert(offered, entry.text)
    if entry.checked then checked = checked + 1 end
end
Expect("the dropdown offers a profile of their own and Spoken's saved profiles", table.concat(offered, ", "),
    table.concat({ env.L.OPT_PROFILE_OWN, "Alice - Realm", "Shared", env.L.OPT_PROFILE_OWN }, ", "))
Expect("...with only one checked, though a profile has the same name as the first", checked, 1)
Expect("...and that one the first", entries[1] and entries[1].checked, true)

-- A list of tables built afresh on each look is checked by what its entries say.
local made = _G.SpokenOptionsPanel.layout:Dropdown("Tables", nil,
    function() return { { name = "one" }, { name = "two" } } end, function() return { name = "two" } end,
    function() end, nil, function(value) return value.name end)
local tables = stub.OpenDropdown(made)
Expect("a dropdown of tables checks the entry that reads as the current one", (tables[1] and tables[1].checked or false) == false
    and (tables[2] and tables[2].checked) == true, true)

stub.world.playerName = nil
if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end

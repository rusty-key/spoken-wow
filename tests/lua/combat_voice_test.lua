local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local env, quests = H.Fresh(stub, here .. "/../../addons/Spoken/")
local context = { instance = "none", group = false, raid = false }
_G.IsInInstance = function() return context.instance ~= "none", context.instance end
_G.IsInGroup = function() return context.group end
_G.IsInRaid = function() return context.raid end
stub.world.playerRaceFile, stub.world.unitSex = "NightElf", 3
local C = H.LoadCombat(stub, here .. "/../../addons/Spoken_Combat/")
C:Setup()

local pack
local function Install(voice)
    pack = { version = 1, addon = "SpokenCombatAudio", voice = voice or "nightelf-female-player", language = "enUS", clips = {} }
    for i = 1, 8 do table.insert(pack.clips, { key = string.format("%02d", i), length = 2, format = "mp3" }) end
    _G.SpokenCombatAudioPacks = { SpokenCombatAudio = pack }
    C.bag = {}
end
local function Enter()
    stub.FireEvent("PLAYER_REGEN_ENABLED")
    stub.FireEvent("PLAYER_REGEN_DISABLED")
end

assert(loadfile(here .. "/../../addons/SpokenCombatAudio/Data/Sounds.lua"))("SpokenCombatAudio")
Expect("an empty source pack is not advertised as playable", #C:GetAudioPacks(), 0)
Expect("on on a new character", C:IsEnabled(), true)
Expect("parties default to enabled", C.settings.AllowInParty, true)
Expect("dungeons default to enabled", C.settings.AllowInDungeon, true)
Expect("raids default to disabled", C.settings.AllowInRaid, false)
local function ReloadSettings(settings)
    C.frame:UnregisterAllEvents()
    C.frame = nil
    env, quests = H.Fresh(stub, here .. "/../../addons/Spoken/")
    _G.SpokenCombatCharacter = settings
    C:Setup()
end
ReloadSettings({ SpeakOnEnteringCombat = false })
Expect("the development installation adopts the enabled default", C:IsEnabled(), true)
C:SetEnabled(false)
C:SetContextEnabled("AllowInParty", false)
C:SetContextEnabled("AllowInDungeon", false)
C:SetContextEnabled("AllowInRaid", true)
ReloadSettings(C.settings)
Expect("the removed character switch is discarded", C.settings.SpeakOnEnteringCombat, nil)
Expect("a disabled party preference survives reload", C.settings.AllowInParty, false)
Expect("a disabled dungeon preference survives reload", C.settings.AllowInDungeon, false)
Expect("an enabled raid preference survives reload", C.settings.AllowInRaid, true)
ReloadSettings({})
local Q = env.SoundQueue
local events = H.Recorder(env)
C:SetEnabled(true)
Expect("an incomplete voice cannot play", C:Play(), false)
Expect("a missing recording spends no cooldown", C.lastPlayed, nil)
local combinations = {
    { "Human", "human" }, { "Dwarf", "dwarf" }, { "NightElf", "nightelf" }, { "Gnome", "gnome" },
    { "Orc", "orc" }, { "Scourge", "undead" }, { "Tauren", "tauren" }, { "Troll", "troll" },
}
Expect("Classic Era defines sixteen voice sets", #C.voices, 16)
for _, race in ipairs(combinations) do
    for sex, suffix in pairs({ [2] = "male", [3] = "female" }) do
        stub.world.playerRace, stub.world.playerRaceFile, stub.world.unitSex = "Localized race", race[1], sex
        local id = race[2] .. "-" .. suffix .. "-player"
        Install(id)
        Expect(id .. " matches independently of client language", C:GetCharacterVoice().id, id)
        Expect(id .. " selects its installed recordings", C:GetVoicePack(), pack)
        Expect(id .. " previews the matching recording", C:Preview(), true)
        Expect(id .. " resolves its own filename", string.find(stub.world.played[#stub.world.played], id .. "-", 1, true) ~= nil, true)
        C:Stop()
    end
end
stub.world.playerRaceFile, stub.world.unitSex = "Dwarf", 3
Install()
Expect("a dwarf cannot use night elf recordings", C:IsReady(), false)
Expect("preview also refuses another race's recordings", C:Preview(), false)
Expect("missing guidance names the character's voice", string.find(C:VoiceStatus(), "Dwarf Female", 1, true) ~= nil, true)
local nightelf = pack
Install("dwarf-female-player")
local dwarf = pack
_G.SpokenCombatAudioPacks = { nightelf = nightelf, dwarf = dwarf }
Expect("multiple sets coexist in the same addon", #C:GetAudioPacks(), 2)
Expect("selection finds the matching set", C:GetVoicePack(), dwarf)
Install("dwarf-male-player")
Expect("the other sex cannot supply the voice", C:IsReady(), false)
stub.world.unitSex = 1
Expect("unknown sex has no voice", C:GetCharacterVoice(), nil)
Expect("unknown sex cannot play", C:Preview(), false)
stub.world.playerRaceFile, stub.world.unitSex = "Draenei", 3
Expect("races outside Classic Era have no fallback", C:IsReady(), false)
stub.world.playerRaceFile = "NightElf"
Install("../../bad")
Expect("unknown voice identifiers cannot supply filenames", #C:GetAudioPacks(), 0)
Install("nightelf-female-standard")
Expect("development packs need repackaging with player identifiers", C:IsReady(), false)
Install()
Expect("all eight recordings installed", C:IsReady(), true)
Expect("the module reports the actual audio pack", C:GetAudioPacks()[1].addon, "SpokenCombatAudio")
local function CheckContext(label, instance, group, raid, allowed)
    C:Stop()
    stub.Advance(50)
    context.instance, context.group, context.raid = instance, group, raid
    local played, cooldown, lastKey = #stub.world.played, C.lastPlayed, C.lastKey
    Enter()
    Expect(label, #stub.world.played, played + (allowed and 1 or 0))
    if not allowed then
        Expect(label .. " preserves cooldown", C.lastPlayed, cooldown)
        Expect(label .. " preserves the last draw", C.lastKey, lastKey)
        Expect(label .. " permits preview", C:Preview(), true)
    end
    C:Stop()
end
CheckContext("solo combat is allowed", "none", false, false, true)
CheckContext("party combat is allowed by default", "none", true, false, true)
C:SetContextEnabled("AllowInParty", false)
CheckContext("party combat can be disabled", "none", true, false, false)
CheckContext("solo combat ignores the party switch", "none", false, false, true)
CheckContext("dungeons use their own enabled switch", "party", true, false, true)
C:SetContextEnabled("AllowInDungeon", false)
C:SetContextEnabled("AllowInParty", true)
CheckContext("party permission cannot bypass dungeon restrictions", "party", true, false, false)
CheckContext("solo dungeons respect dungeon restrictions", "party", false, false, false)
C:SetContextEnabled("AllowInDungeon", true)
CheckContext("solo dungeons can be enabled", "party", false, false, true)
CheckContext("raid groups are disabled by default", "none", true, true, false)
CheckContext("raid instances are disabled even without a group", "raid", false, false, false)
CheckContext("raid groups take precedence inside dungeons", "party", true, true, false)
C:SetContextEnabled("AllowInRaid", true)
CheckContext("raid groups can be enabled", "none", true, true, true)
CheckContext("raid instances can be enabled", "raid", true, true, true)
C:Preview()
C:SetContextEnabled("AllowInRaid", false)
Expect("disabling the current context stops speech", env.Reactions.clip, nil)
context.instance, context.group, context.raid = "none", false, false
local isInRaid = _G.IsInRaid
_G.IsInRaid = nil
CheckContext("clients missing context APIs stay silent", "none", false, false, false)
_G.IsInRaid = isInRaid
C.lastPlayed, C.lastKey, C.bag = nil, nil, {}
stub.ResetSound()
pack.version = 2
Expect("an unknown pack format cannot play", C:Preview(), false)
pack.version = 1
pack.language = "deDE"
Expect("another language cannot silently supply the English voice", C:Preview(), false)
pack.language = "enUS"
Enter()
Expect("combat entry plays", #stub.world.played, 1)
Expect("combat audio is resolved inside the separate sound pack",
    string.find(stub.world.played[1], [[Interface\AddOns\SpokenCombatAudio\Sounds\Combat\]], 1, true), 1)
Expect("the selected sound channel is used", stub.world.playedChannels[1], "Master")
Expect("combat speech stays out of the queue", Q:GetQueueSize(), 0)
Expect("combat speech emits no narrator callbacks", #events.log, 0)
stub.FireEvent("PLAYER_REGEN_DISABLED")
Expect("duplicate entry events do not play twice", #stub.world.played, 1)
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("leaving combat lets the line finish", env.Reactions.clip ~= nil, true)
stub.Advance(2)
Enter()
Expect("rapid re-entry respects cooldown", #stub.world.played, 1)
stub.Advance(43)
stub.world.time = C.lastPlayed + 45
Enter()
Expect("45 seconds allows another line", #stub.world.played, 2)

local played = #stub.world.played
C:SetEnabled(false)
Expect("disabling stops the voice", env.Reactions.clip, nil)
stub.Advance(50); Enter()
Expect("disabled characters stay silent", #stub.world.played, played)
Expect("disabling the module blocks preview", C:Preview(), false)
C:SetEnabled(true)
C.lastPlayed = GetTime()
Expect("preview ignores cooldown while the module is enabled", C:Preview(), true)
C:Stop()
local seen, last = {}, C.lastKey
for i = 1, 30 do
    C:Preview()
    Expect("draw " .. i .. " does not repeat the last line", C.lastKey ~= last, true)
    last = C.lastKey
    C:Stop()
end
C.bag = {}
for i = 1, 8 do C:Preview(); seen[C.lastKey] = true; C:Stop() end
local count = 0
for _ in pairs(seen) do count = count + 1 end
Expect("each shuffled pool plays every line exactly once", count, 8)

C:SetEnabled(true)
stub.Advance(50)
quests:Enqueue(H.Clip({ length = 10 }))
played = #stub.world.played
local before = C.lastPlayed
Enter()
Expect("narration suppresses combat speech", #stub.world.played, played)
Expect("suppression does not consume cooldown", C.lastPlayed, before)
Q:RemoveAllSoundsFromQueue()
Enter()
Expect("combat speech can play after narration", env.Reactions.clip ~= nil, true)
quests:Enqueue(H.Clip({ length = 10 }))
Expect("narration starting later stops combat speech", env.Reactions.clip, nil)
Q:RemoveAllSoundsFromQueue()

env.Addon.db.profile.Audio.SoundChannel = "SFX"
stub.world.cvars.Sound_EnableSFX = "0"
before = C.lastPlayed
Expect("muted audio is not played", C:Preview(), false)
Expect("muted audio spends no cooldown", C.lastPlayed, before)
stub.world.cvars.Sound_EnableSFX = "1"
local missing = C:Next()
local path = string.format([[Interface\AddOns\SpokenCombatAudio\Sounds\Combat\nightelf-female-player-%s.mp3]], missing.key)
stub.world.missing[path] = true
Expect("a missing file does not block a healthy recording", C:Preview(), true)
Expect("a failed draw is skipped", C:Next() ~= missing, true)
C:Stop()
stub.world.missing[path] = nil
_G.UnitIsDeadOrGhost = function() return true end
Expect("dead characters stay silent", C:Preview(), false)
_G.UnitIsDeadOrGhost = function() return false end

for _, style in ipairs({ "none", "subtitle", "minimal", "classic", "queue", "dialogueui" }) do
    env.Addon.db.profile.Frame.Style = style
    C:Preview()
    Expect(style .. " has no combat queue entry", Q:GetQueueSize(), 0)
    C:Stop()
end
env.Version.IsAnyLegacy = true
Expect("legacy clients cannot use the independent voice", C:Preview(), false)
env.Version.IsAnyLegacy = false
pack.clips[1].key = "../../bad"
Expect("invalid manifests are refused", C:IsReady(), false)
Install()
for _, clip in ipairs(pack.clips) do clip.format = "wav" end
C.bag = { pack.clips[1] }
C:Preview()
Expect("supplied WAV recordings use their own extension", string.sub(stub.world.played[#stub.world.played], -4), ".wav")
C:Stop()
for _, clip in ipairs(pack.clips) do clip.format = "ogg" end
C.bag = { pack.clips[1] }
C:Preview()
Expect("supplied OGG recordings use their own extension", string.sub(stub.world.played[#stub.world.played], -4), ".ogg")
C:Stop()
pack.clips[1].format = "../../bad"
Expect("recording extensions cannot escape their folder", C:IsReady(), false)
Install()
C:Preview(); stub.FireEvent("PLAYER_DEAD")
Expect("death stops a playing combat reaction", env.Reactions.clip, nil)
Expect("no separate character enable switch is stored", SpokenCombatCharacter.SpeakOnEnteringCombat, nil)
Expect("combat setting is absent from the profile", env.Addon.db.profile.CombatVoice, nil)
C:Stop()
C:SetEnabled(true)
C:Preview()
Spoken:SetPartOn("combat", false)
Expect("switching off the module stops its reaction", env.Reactions.clip, nil)
Expect("the module switch blocks preview", C:Preview(), false)
Expect("the module switch controls combat enablement", C:IsEnabled(), false)
Expect("the module switch preserves context preferences", C.settings.AllowInParty, true)
Spoken:SetPartOn("combat", true)
Expect("switching the module back on permits preview", C:Preview(), true)
Spoken:StopAll()
Expect("the public stop command stops reactions", env.Reactions.clip, nil)

env.Addon.db.profile.Frame.Style = "classic"
env.Addon:Enable()
C:SetupOptions()
local labels = {}
for _, text in ipairs(stub.LabelsUnder(C.optionsPage.frame)) do labels[text] = true end
Expect("Combat is nested under Spoken", C.optionsPage.category.parent.name, "Spoken")
Expect("the nested page is named Combat", C.optionsPage.category.name, "Combat")
Expect("the page offers Enable Module", labels["Enable Module"], true)
Expect("the redundant combat-entry switch is absent", labels["Speak on Entering Combat"], nil)
Expect("the page offers Speak in Parties", labels["Speak in Parties"], true)
Expect("the page offers Speak in Dungeons", labels["Speak in Dungeons"], true)
Expect("the page offers Speak in Raids", labels["Speak in Raids"], true)
local controls = {}
for _, item in ipairs(C.optionsLayout.items) do
    if item.control and type(item.control.text) == "table" then
        controls[item.control.text.text] = item.control
    end
end
for _, option in ipairs({
    { "Speak in Parties", "AllowInParty" },
    { "Speak in Dungeons", "AllowInDungeon" },
    { "Speak in Raids", "AllowInRaid" },
}) do
    local control, key = controls[option[1]], option[2]
    local before = C.settings[key]
    control:SetChecked(not before)
    control.scripts.OnClick(control)
    Expect(option[1] .. " writes its own preference", C.settings[key], not before)
    control:SetChecked(before)
    control.scripts.OnClick(control)
end
C:SetEnabled(false)
C.optionsLayout:Refresh()
Expect("context controls are disabled with the module off", controls["Speak in Parties"]:IsEnabled(), false)
C:SetEnabled(true)
C.optionsLayout:Refresh()
Expect("context controls re-enable with the module", controls["Speak in Parties"]:IsEnabled(), true)
Expect("the page offers Preview Combat Voice", labels["Preview Combat Voice"], true)
SlashCmdList.SPOKEN("combat off")
Expect("the combat slash command is dispatched to the module", C:IsEnabled(), false)
SlashCmdList.SPOKEN("combat test")
Expect("slash off disables the profile module", env.Addon.db.profile.Parts.combat, false)
Expect("slash preview respects the disabled module", env.Reactions.clip, nil)
SlashCmdList.SPOKEN("combat on")
Expect("slash on enables the same module switch", C:IsEnabled(), true)
SlashCmdList.SPOKEN("combat test")
Expect("slash preview works with the module on", env.Reactions.clip ~= nil, true)
SlashCmdList.SPOKEN("stop")
Expect("slash stop stops the module's reaction", env.Reactions.clip, nil)
Spoken:SetPartOn("combat", false)
Expect("disabling the module leaves its settings page available", C.optionsPage.Open(), true)
Expect("nothing failed in a module callback", #env.Callbacks.errors, 0)

C:SetEnabled(true)
C:Stop()
Install()
C.lastPlayed = nil
local originalPlay, originalPrint = Spoken.PlayReaction, _G.print
local attempts, messages, forcedReason = {}, {}, nil
local function StatusContains(wanted)
    for _, text in ipairs(stub.LabelsUnder(C.optionsPage.frame)) do
        if type(text) == "string" and text:find(wanted, 1, true) then return true end
    end
    return false
end
Spoken.PlayReaction = function(self, source, clip)
    attempts[clip.path] = (attempts[clip.path] or 0) + 1
    if forcedReason then return false, forcedReason end
    return originalPlay(self, source, clip)
end
_G.print = function(message) table.insert(messages, message) end

local first = C:Next()
for _, reason in ipairs({ "busy", "off", "unsupported", "the SFX sound channel is disabled" }) do
    forcedReason = reason
    Expect(reason .. " does not play", C:Play(true), false)
    Expect(reason .. " preserves the pending draw", C:Next(), first)
    Expect(reason .. " does not mark the file broken", C:IsClipFailed(pack, first) == true, false)
end
forcedReason = nil
local brokenPath = C:ClipPath(pack, first)
stub.world.missing[brokenPath] = true
attempts = {}
Expect("preview recovers from a rejected file immediately", C:Preview(), true)
Expect("preview reports a skipped file despite successful fallback", #messages, 1)
Expect("preview feedback explains failed playback", messages[1]:find("failed playback", 1, true) ~= nil, true)
Expect("partial failure keeps the voice usable", C:IsReady(), true)
Expect("partial failure updates settings immediately", StatusContains("failed playback"), true)
Expect("preview recovery spends no combat cooldown", C.lastPlayed, nil)
C:Stop()
for i = 1, 20 do
    Expect("healthy playback survives reshuffle " .. i, C:Play(true), true)
    C:Stop()
end
Expect("a broken clip is attempted only once per session", attempts[brokenPath], 1)
stub.world.missing[brokenPath] = nil

Install()
attempts, messages = {}, {}
for _, clip in ipairs(pack.clips) do stub.world.missing[C:ClipPath(pack, clip)] = true end
Expect("all rejected files leave combat silent", C:Play(false), false)
local attempted = 0
for _, count in pairs(attempts) do attempted = attempted + count end
Expect("an all-broken set is attempted at most eight times", attempted, 8)
Expect("all-broken combat spends no cooldown", C.lastPlayed, nil)
Expect("automatic playback failures do not print chat warnings", #messages, 0)
Expect("all-broken playback creates no reaction", env.Reactions.clip, nil)
Expect("all-broken playback creates no reaction timer", env.Reactions.timer, nil)
Expect("all-broken recordings make preview unavailable", C:IsReady(), false)
Expect("settings explain all files failed", StatusContains("All files failed playback"), true)
Expect("later combat entry stays silent", C:Play(false), false)
local retried = 0
for _, count in pairs(attempts) do retried = retried + count end
Expect("later combat entry does not retry broken files", retried, 8)
Expect("slash preview explains an all-broken set", C:Preview(), false)
Expect("all-broken preview prints one explanation", #messages, 1)
for _, clip in ipairs(pack.clips) do stub.world.missing[C:ClipPath(pack, clip)] = nil end

Install()
Expect("a reloaded pack can retry previously failed files", C:IsReady(), true)
C:Next()
C.bag = {}
for _, clip in ipairs(pack.clips) do
    table.insert(C.bag, clip)
    if clip.key ~= "01" then stub.world.missing[C:ClipPath(pack, clip)] = true end
end
Expect("one healthy file survives seven rejected files", C:Play(false), true)
Expect("only successful recovery starts the combat cooldown", C.lastPlayed, GetTime())
Expect("recovery plays the healthy file", C.lastKey, "01")
C:Stop()
Expect("successful recovery preserves the combat cooldown", C:Play(false), false)
for i = 1, 3 do
    Expect("a single surviving clip can reshuffle safely " .. i, C:Play(true), true)
    C:Stop()
end
for _, clip in ipairs(pack.clips) do stub.world.missing[C:ClipPath(pack, clip)] = nil end
Spoken.PlayReaction, _G.print = originalPlay, originalPrint

Install()
local primary = pack
primary.addon = "ACombatAudio"
Install()
local alternate = pack
alternate.addon = "ZCombatAudio"
_G.SpokenCombatAudioPacks = { registryA = alternate, registryZ = primary }
Expect("duplicate selection uses the addon folder rather than registry order", C:GetVoicePack(), primary)
Expect("duplicate selection counts matching sets", #C:GetMatchingPacks(), 2)
Expect("pack status names the selected supplier", C:PackStatus():find("Audio addon: ACombatAudio.", 1, true) ~= nil, true)
Expect("pack status warns about duplicate voices", C:PackStatus():find("Multiple matching audio packs", 1, true) ~= nil, true)
C.optionsLayout:Refresh()
Expect("settings show the selected supplier", StatusContains("Audio addon: ACombatAudio."), true)
Expect("settings show the duplicate warning", StatusContains("Multiple matching audio packs"), true)
_G.SpokenCombatAudioPacks = { registryA = primary, registryZ = alternate }
Expect("reordering registry entries does not change the supplier", C:GetVoicePack(), primary)
for _, clip in ipairs(primary.clips) do stub.world.missing[C:ClipPath(primary, clip)] = true end
Expect("broken selected recordings do not switch to another supplier", C:Play(true), false)
Expect("the selected supplier remains visible after failure", C:GetVoicePack(), primary)
Expect("a healthy duplicate does not hide a broken selected pack", C:IsReady(), false)
for _, clip in ipairs(primary.clips) do stub.world.missing[C:ClipPath(primary, clip)] = nil end
Install("dwarf-female-player")
_G.SpokenCombatAudioPacks = { selected = primary, anotherVoice = pack }
Expect("another race does not count as a duplicate", #C:GetMatchingPacks(), 1)
Expect("another race does not show a duplicate warning", C:PackStatus():find("Multiple matching audio packs", 1, true), nil)
Install("nightelf-male-player")
_G.SpokenCombatAudioPacks = { selected = primary, anotherSex = pack }
Expect("another sex does not count as a duplicate", #C:GetMatchingPacks(), 1)
primary.version = 2
Expect("invalid and mismatched packs leave no matching supplier", #C:GetMatchingPacks(), 0)
Expect("a missing supplier has no pack status", C:PackStatus(), "")
os.exit(Failures() == 0 and 0 or 1)

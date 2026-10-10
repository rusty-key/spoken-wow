-- What a first install starts with: the defaults as written in each addon's own table, before
-- any suite sets the player up for what it tests. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
local D = env.Defaults.profile

---------------------------------------------------------------- the player
Expect("every module on", next(D.Parts), nil)
Expect("Subtitles Only", D.Frame.Style, "subtitle")
Expect("...listed first among the narrator styles", env.Options:Styles()[1], "subtitle")
Expect("Show Words on", D.Transcript.Enabled, true)
Expect("Highlight Word off", D.Transcript.HighlightWord, false)
Expect("Type Words Out on", D.Transcript.Typewriter, true)
Expect("...letter by letter", D.Transcript.TypewriterBy, "letter")
Expect("no action hidden: Report shows", next(D.Frame.HiddenActions), nil)
Expect("subtitle size 100%", D.Transcript.SubtitleScale, 1)
Expect("background darkness 60%", D.Transcript.SubtitleShadow, 0.6)
Expect("there is no setting for the voices' channel: they play on Master", D.Audio.SoundChannel, nil)
Expect("NPC voices silenced while a line plays", D.Audio.AutoToggleDialog, true)
Expect("other sounds turned down", D.Audio.LowerOthers.Enabled, true)
Expect("...music to 30%, ambience 40%, effects 60%",
    D.Audio.LowerOthers.Music .. " " .. D.Audio.LowerOthers.Ambience .. " " .. D.Audio.LowerOthers.SFX, "0.3 0.4 0.6")
Expect("Contribute buttons shown", D.Contribute.HideButtons, false)
Expect("missing lines collected", env.Gather:IsEnabled(), true)
Expect("the minimap button shown and free to move", D.Minimap.LibDBIcon.hide == nil and D.Minimap.LibDBIcon.lock == nil, true)
Expect("...and listed in the AddOns menu", D.Minimap.LibDBIcon.showInCompartment, true)

---------------------------------------------------------------- the language, before one is chosen
Expect("the voice follows the game's language", VO.Addon.db.profile.Audio.VoiceLanguage, "auto")
Expect("...with English for a line it has not got", VO.Addon.db.profile.Audio.FallbackLanguage, "enUS")

---------------------------------------------------------------- no keys bound
local bindings = io.open(SPOKEN .. "Bindings.xml"):read("*a")
Expect("Bindings.xml binds no key itself", string.find(bindings, "default=", 1, true), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll first-install default tests passed")

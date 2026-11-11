-- The Forever Discord voice integration is a provider/channel signal, not merely a linked
-- account. Spoken should hold new lines, stop an active line for replay, and resume afterward.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local world = stub.world

stub.SetClient("16001")
stub.ResetSound()
stub.ResetTimers()
stub.voice.provider, stub.voice.connected, stub.voice.channel = nil, false, nil
local env = stub.LoadSpoken(SPOKEN)
local Spoken, DiscordVoice = env.Spoken, env.DiscordVoice
local source = env.Sources:Register("discord-test", { title = "Discord test", addon = "Test", order = 1 })

Expect("Forever exposes the Discord voice state", DiscordVoice:IsAvailable(), true)
Expect("a Discord provider that is not connected is not an active voice session",
    Spoken:IsDiscordVoiceActive(), false)

stub.voice.provider, stub.voice.connected, stub.voice.channel = 2, true, nil
stub.FireEvent("VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED", 2)
Expect("a connected Discord provider is detected without a channel ID", Spoken:IsDiscordVoiceActive(), true)

local held = H.Clip()
source:Enqueue(held)
Expect("new lines wait while Discord voice is active", world.played[1], nil)
Expect("the queue explains why", Spoken:GetHeldReason(held), env.L.QUEUE_HELD_DISCORD)

stub.voice.provider = 1
stub.FireEvent("VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED", 1)
Expect("the held line starts when Discord voice ends", world.played[1], held.path)
stub.Advance(1.1)

local speaking = H.Clip()
source:Enqueue(speaking)
stub.voice.provider, stub.voice.connected, stub.voice.channel = 2, true, 8
stub.FireEvent("VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED", 2)
Expect("an active line is stopped when Discord voice starts", world.stopped[1] ~= nil, true)
Expect("the stopped line stays at the head", env.SoundQueue:GetCurrentSound(), speaking)
Expect("the active line is not repeated during voice", world.played[3], nil)

stub.voice.provider = 1
stub.FireEvent("VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED", 1)
Expect("the interrupted line replays after Discord voice ends", world.played[3], speaking.path)

env.Addon.db.profile.Audio.MuteWhileDiscordVoice = false
Spoken:StopAll()
stub.voice.provider, stub.voice.connected, stub.voice.channel = 2, true, 9
stub.FireEvent("VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED", 2)
local optedOut = H.Clip()
source:Enqueue(optedOut)
Expect("the setting can opt out of automatic muting", world.played[4], optedOut.path)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Discord voice tests passed")

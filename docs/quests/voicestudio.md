# VoiceStudio generation

VoiceStudio is an optional third generator for Spoken. It does not replace ElevenLabs or
fish.audio: the selected provider is stored per collaborator and language, and every generated
take records `voicestudio` as its provider.

## Deployment setup

Run VoiceStudio on the same host as the web app, or expose it through a private network such as
Tailscale. Set these variables in the web app environment:

```dotenv
VOICESTUDIO_BASE_URL=http://127.0.0.1:3900
VOICESTUDIO_MODEL=omnivoice
VOICESTUDIO_MAX_CONCURRENCY=1
```

For a non-loopback backend, set `OMNIVOICE_API_KEY` to the VoiceStudio service key. Keep the
service private; this key is sent only from the server to VoiceStudio and is never exposed to a
browser or stored in Postgres.

## Voice profile names

Create or clone profiles in VoiceStudio from the reference clips shown on Spoken’s Voices page.
The profile name must be the Spoken voice slot name for English, for example
`dwarf-male-grim`, and must include the locale suffix for translated voices, for example
`dwarf-male-grim@esMX`. The Voices page lists the matching profiles returned by
`GET /v1/audio/voices` and explains the expected name for each slot.

## Generation flow

1. A collaborator opens Voices, selects VoiceStudio, and activates it for the language.
2. Spoken resolves profile names to VoiceStudio profile IDs.
3. The queue sends each turn to `POST /v1/audio/speech` with the configured model, profile ID,
   text, and `response_format: "mp3"`. Before sending, Spoken applies the active pronunciation
   lexicon for that locale: respelling entries work for every locale, and English IPA entries
   are lowered to OmniVoice CMU phoneme brackets. A version of the applied rules is recorded
   with the take.
4. Lines containing narration or voice markers are generated turn-by-turn and stitched into one
   MP3 before the take is committed.

The existing ElevenLabs and fish.audio paths, credentials, references, and take history remain
unchanged.

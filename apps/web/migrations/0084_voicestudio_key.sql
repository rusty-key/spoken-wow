-- One VoiceStudio connection per person, sealed, beside the ElevenLabs and fish.audio keys.
--
-- A collaborator runs their own VoiceStudio and puts it behind https; what they store here is
-- where it is, its optional key, the model and how many lines it takes at once, sealed as one
-- JSON value by src/lib/secrets.ts (see src/lib/generation/voicestudio-connection.ts). The URL
-- is sealed with the key because it names somebody's private machine.
--
-- 0040's columns, so lib/api-key.ts reads and writes it with the same statements. "hint" is
-- the service's host rather than a key's last four characters; "tier" stays NULL.
create table "voicestudio_key" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "ciphertext" text not null,
  "iv" text not null,
  "tag" text not null,
  "hint" text not null,
  -- When the service last answered its voice list, which is when it was saved.
  "verifiedAt" timestamptz,
  "tier" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

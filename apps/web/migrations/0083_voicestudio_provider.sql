-- VoiceStudio is a third generation provider. Its service is configured by the deployment,
-- unlike the per-user ElevenLabs and fish.audio credentials, but its generated takes still
-- need the provider recorded so history, filters and staleness use the right contract.

alter table "take" drop constraint if exists "take_provider_check";
alter table "take" add constraint "take_provider_check"
  check ("provider" in ('elevenlabs', 'fish', 'voicestudio'));

alter table "regeneration_job" drop constraint if exists "regeneration_job_provider_check";
alter table "regeneration_job" add constraint "regeneration_job_provider_check"
  check ("provider" in ('elevenlabs', 'fish', 'voicestudio'));

alter table "generation_preference" drop constraint if exists "generation_preference_provider_check";
alter table "generation_preference" add constraint "generation_preference_provider_check"
  check ("provider" in ('elevenlabs', 'fish', 'voicestudio'));

alter table "generation_preference_locale" drop constraint if exists "generation_preference_locale_provider_check";
alter table "generation_preference_locale" add constraint "generation_preference_locale_provider_check"
  check ("provider" in ('elevenlabs', 'fish', 'voicestudio'));

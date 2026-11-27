-- Players' notes a reviewer picks on /voices/design to act on, kept with the verdict as they read
-- then, so Generate and Remix from review hand them to Gemini. Additive: nothing before reads it.
alter table "voice_design_review" add column "players" jsonb not null default '[]';

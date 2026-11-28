-- The signed-in user's Anthropic key, for Claude's opinion in What's different on /voices/design.
-- Its own table for the reason gemini_key has one (0134).
create table "anthropic_key" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "ciphertext" text not null,
  "iv" text not null,
  "tag" text not null,
  "hint" text not null,
  "verifiedAt" timestamptz,
  "tier" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

-- What's different's findings a reviewer added to a verdict. They say how the version sounds next
-- to the live take, not what the reviewer wants, so revise reads them apart from the note.
-- Additive: nothing before reads it.
alter table "voice_design_review" add column "observations" jsonb not null default '[]';

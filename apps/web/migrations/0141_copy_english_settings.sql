-- English keeps a team's model settings and lexicon in generation_setting and
-- pronunciation_lexicon, not in the _locale tables, so a team joining English with "copy" got
-- neither and voiced with the file defaults and no pronunciations. The dictionary locator is not
-- copied: the new team's first save uploads its own.
create or replace function "copy_team_settings"(p_from uuid, p_to uuid, p_lang text) returns void
language plpgsql security invoker as $$
begin
  perform copy_team_roster(p_from, p_to);
  insert into "generation_setting_locale"
    ("teamId", "lang", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
  select p_to, "lang", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
    from "generation_setting_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
  insert into "pronunciation_lexicon_locale" ("teamId", "lang", "entries", "updatedBy")
  select p_to, "lang", "entries", "updatedBy"
    from "pronunciation_lexicon_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
  insert into "npc_direction_locale" ("teamId", "lang", "npcKind", "npcId", "direction", "updatedBy")
  select p_to, "lang", "npcKind", "npcId", "direction", "updatedBy"
    from "npc_direction_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
  if p_lang = 'enUS' then
    insert into "generation_setting" ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
    select p_to, "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
      from "generation_setting" where "teamId" = p_from
    on conflict do nothing;
    insert into "pronunciation_lexicon" ("teamId", "entries", "updatedBy")
    select p_to, "entries", "updatedBy"
      from "pronunciation_lexicon" where "teamId" = p_from
    on conflict do nothing;
  end if;
end
$$;

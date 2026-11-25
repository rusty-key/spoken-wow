-- A take's clip cut into sentence pieces, so a paused line resumes from its sentence
-- (lib/takes/pieces.ts). Each piece is encoded as take_encoding's whole clip is, and kept under
-- `encodings/` like it. Keyed by the master's bytes, as take_encoding is.
-- `method` says how the cuts were found: "times" from the take's word times, "pauses" from its
-- measured pauses, "whole" where neither found a cut, so the line ships as one file and the
-- backfill does not try it again. The arrays are one entry per piece, in order, empty for "whole".
-- `source` is denormalised so scripts/db/sync-section.sh carries these rows with the takes.
create table if not exists "take_pieces" (
  "id"             bigserial   primary key,
  "source"         text        not null,
  "sha256"         text        not null,
  "profile"        text        not null,
  "method"         text        not null check ("method" in ('times', 'pauses', 'whole')),
  "encodedSha256s" text[]      not null default '{}',
  "bytes"          integer[]   not null default '{}',
  "lengthsSec"     numeric[]   not null default '{}',
  "createdAt"      timestamptz not null default now(),
  unique ("source", "sha256", "profile"),
  check (cardinality("encodedSha256s") = cardinality("bytes")
     and cardinality("bytes") = cardinality("lengthsSec")
     and (("method" = 'whole') = (cardinality("lengthsSec") = 0)))
);

-- Additive. Why a reviewer rejected a contribution, in their words or one of the review page's
-- reasons ("Not German", "Cut off", ...). Null for every row rejected before this, for rows not
-- rejected, and for a reject that gave none. The previous release never reads or writes it.

alter table "contribution" add column "rejectReason" text;

-- NOT VALID: no scan of the whole table under its lock; 0118 validates the existing rows separately.
alter table "contribution" add constraint "contribution_reject_reason_length" check (char_length("rejectReason") <= 200) not valid;

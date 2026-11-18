-- Validates 0117's length check on the rows that were already there, without blocking writes.

alter table "contribution" validate constraint "contribution_reject_reason_length";

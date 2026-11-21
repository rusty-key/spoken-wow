-- Any member may submit a community pack now; the admin's review is the gate, so the
-- pack_author role goes and its holders become members.
--
-- Rolling back past this leaves them unable to submit until the role is handed out again.
update "user" set "role" = 'member' where "role" = 'pack_author';

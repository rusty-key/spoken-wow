-- A signed-in reporter's rate limit counts their own reports, not their address's, so a shared
-- network cannot spend their allowance. Partial: anonymous reports are counted by report_ip_idx.
create index "report_user_idx" on "report" ("userId", "createdAt" desc) where "userId" is not null;

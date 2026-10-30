CREATE INDEX IF NOT EXISTS "Lead_updatedAt_idx" ON "Lead"("updatedAt");
CREATE INDEX IF NOT EXISTS "Lead_status_updatedAt_idx" ON "Lead"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Lead_name_idx" ON "Lead"("name");

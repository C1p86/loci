-- Phase 13 D-35 / D-43: badge slugs migration
-- Adds tasks.slug (unique within org), tasks.expose_badge, and backfills slugs from name.
-- orgs.slug already shipped (Phase 7 0000 migration) — defensive backfill only.

-- 1. Add tasks.slug + expose_badge with safe defaults (empty slug allows backfill before index)
ALTER TABLE "tasks" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "expose_badge" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 2. Backfill tasks.slug from name (kebab-case, uniqueness enforced via dup-rank suffix)
WITH slug_candidates AS (
  SELECT id, org_id,
    lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g')) AS base_slug,
    row_number() OVER (
      PARTITION BY org_id, lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))
      ORDER BY created_at
    ) AS dup_rank
  FROM tasks
)
UPDATE tasks t
   SET slug = CASE
     WHEN sc.dup_rank = 1 THEN trim(both '-' from sc.base_slug)
     ELSE trim(both '-' from sc.base_slug) || '-' || substring(t.id from length(t.id)-5)
   END
  FROM slug_candidates sc
 WHERE sc.id = t.id;--> statement-breakpoint

-- 3. Defensive backfill for orgs.slug (should already be populated since Phase 7, but safe guard)
UPDATE orgs SET slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))
 WHERE slug IS NULL OR slug = '';--> statement-breakpoint

-- 4. Unique index on (org_id, slug) now that all slugs are populated
CREATE UNIQUE INDEX "tasks_org_slug_unique" ON "tasks" USING btree ("org_id","slug");

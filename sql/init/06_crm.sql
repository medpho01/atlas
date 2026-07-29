-- ============================================================================
-- Network CRM — schema.
--
-- Concepts:
--   funnel     a named, ordered set of stages (customisable). Threads pick one.
--   thread     a campaign: "Onboard 50 labs in Pune Q3" — has a funnel, a
--              target count, and providers being worked.
--   provider   a prospect being onboarded (may or may not exist in the source
--              DB yet). Network team can add these manually.
--   thread_provider  a provider inside a thread: current stage + assignee.
--   activity   the journey log: notes, stage changes, assignments, doc uploads.
--   checklist  document requirements; docs upload against provider+item.
--
-- All CRM state lives in atlas.* (our own DB) — never touches the source.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

CREATE TABLE IF NOT EXISTS atlas.crm_funnels (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  -- Ordered stages: [{"key":"identified","label":"Identified"}, ...]
  stages      jsonb NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  int REFERENCES atlas.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas.crm_threads (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  description   text,
  funnel_id     int NOT NULL REFERENCES atlas.crm_funnels(id),
  target_count  int NOT NULL DEFAULT 0,
  provider_kind text,                  -- e.g. 'LAB', 'HOSPITAL', 'PHLEBO', 'DOCTOR' — informational
  region        text,                  -- informational: "Pune", "South", ...
  status        text NOT NULL DEFAULT 'active',   -- active | paused | done
  created_by    int REFERENCES atlas.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas.crm_providers (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'LAB',    -- LAB | HOSPITAL | DOCTOR | PHLEBO | OTHER
  city           text,
  state          text,
  pincode        text,
  phone          text,
  email          text,
  contact_person text,
  notes          text,
  source         text NOT NULL DEFAULT 'manual', -- manual | import | atlas
  source_lab_id  int,                            -- link to source Lab.id once known
  created_by     int REFERENCES atlas.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_providers_name ON atlas.crm_providers (lower(name));
CREATE INDEX IF NOT EXISTS idx_crm_providers_city ON atlas.crm_providers (lower(city));

CREATE TABLE IF NOT EXISTS atlas.crm_thread_providers (
  id           serial PRIMARY KEY,
  thread_id    int NOT NULL REFERENCES atlas.crm_threads(id) ON DELETE CASCADE,
  provider_id  int NOT NULL REFERENCES atlas.crm_providers(id) ON DELETE CASCADE,
  stage_key    text NOT NULL,
  assignee_id  int REFERENCES atlas.users(id),
  added_by     int REFERENCES atlas.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_tp_thread ON atlas.crm_thread_providers (thread_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_crm_tp_assignee ON atlas.crm_thread_providers (assignee_id);

CREATE TABLE IF NOT EXISTS atlas.crm_activities (
  id           serial PRIMARY KEY,
  thread_id    int REFERENCES atlas.crm_threads(id) ON DELETE CASCADE,
  provider_id  int NOT NULL REFERENCES atlas.crm_providers(id) ON DELETE CASCADE,
  author_id    int REFERENCES atlas.users(id),
  type         text NOT NULL,          -- note | stage_change | assignment | doc_upload | provider_created
  body         text,
  meta         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_act_provider ON atlas.crm_activities (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_thread ON atlas.crm_activities (thread_id, created_at DESC);

-- Document checklist. thread_id NULL = the global default checklist.
CREATE TABLE IF NOT EXISTS atlas.crm_checklist_items (
  id          serial PRIMARY KEY,
  thread_id   int REFERENCES atlas.crm_threads(id) ON DELETE CASCADE,
  label       text NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS atlas.crm_provider_docs (
  id                serial PRIMARY KEY,
  provider_id       int NOT NULL REFERENCES atlas.crm_providers(id) ON DELETE CASCADE,
  checklist_item_id int REFERENCES atlas.crm_checklist_items(id) ON DELETE SET NULL,
  filename          text NOT NULL,
  mime              text,
  size_bytes        bigint,
  storage_path      text NOT NULL,     -- relative to UPLOADS_DIR
  uploaded_by       int REFERENCES atlas.users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_docs_provider ON atlas.crm_provider_docs (provider_id);

-- ---- Seeds (idempotent) ----------------------------------------------------
INSERT INTO atlas.crm_funnels (name, stages, is_default)
SELECT 'Default onboarding',
  '[{"key":"identified","label":"Identified"},
    {"key":"contacted","label":"Contacted"},
    {"key":"negotiating","label":"Negotiating"},
    {"key":"docs","label":"Docs collection"},
    {"key":"ready","label":"Ready to onboard"},
    {"key":"onboarded","label":"Onboarded"},
    {"key":"dropped","label":"Dropped"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM atlas.crm_funnels);

INSERT INTO atlas.crm_checklist_items (thread_id, label, required, sort)
SELECT NULL, x.label, x.required, x.sort
FROM (VALUES
  ('MOU / agreement signed',        true,  1),
  ('GST certificate',               true,  2),
  ('PAN card',                      true,  3),
  ('NABL certificate',              false, 4),
  ('Rate list (B2B)',               true,  5),
  ('Bank details / cancelled cheque', true, 6),
  ('Lab photos',                    false, 7)
) AS x(label, required, sort)
WHERE NOT EXISTS (SELECT 1 FROM atlas.crm_checklist_items WHERE thread_id IS NULL);

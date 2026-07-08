-- Tara Rose Content Approval — Supabase schema
-- Run once in the Supabase SQL Editor for project qyojrknmgwkfjrdhtxhk.
-- Access is gated by Google Sign-In (Supabase Auth) — only the 4 allowlisted
-- @tararosesalon.com accounts below can read or write anything, even via direct
-- API calls. Keep this list in sync with ALLOWED_REVIEWERS in ../view/app.js
-- and ../upload/upload.js if the team ever changes.

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  category text not null,
  format text not null,
  created_at timestamptz not null default now()
);

create table if not exists revisions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  revision_number int not null default 1,
  media_type text not null,
  media_url text,
  media jsonb,
  caption text,
  smm_notes text,
  moved_from_batch_id uuid references batches(id),
  moved_to_batch_id uuid references batches(id),
  created_at timestamptz not null default now()
);

-- Run this block once against the existing live table to add the new columns
-- without dropping data (safe to re-run, no-ops if columns already exist):
alter table revisions add column if not exists smm_notes text;
alter table revisions add column if not exists moved_from_batch_id uuid references batches(id);
alter table revisions add column if not exists moved_to_batch_id uuid references batches(id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions(id) on delete cascade,
  reviewer text not null,
  decision text not null check (decision in ('approved','revision')),
  comment text,
  voice_note_url text,
  voice_note_transcript text,
  created_at timestamptz not null default now()
);

alter table batches enable row level security;
alter table content_items enable row level security;
alter table revisions enable row level security;
alter table reviews enable row level security;

-- ============================================================================
-- MIGRATION — run this block now, in your existing live database.
-- (Your tables/RLS are already live from the original setup; this just swaps
-- the old wide-open policies for ones that require an allowlisted Google login.)
-- ============================================================================
drop policy if exists "anon read/write batches" on batches;
drop policy if exists "anon read/write content_items" on content_items;
drop policy if exists "anon read/write revisions" on revisions;
drop policy if exists "anon read/write reviews" on reviews;

create policy "allowlisted users read/write batches" on batches
  for all
  using (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'))
  with check (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'));
create policy "allowlisted users read/write content_items" on content_items
  for all
  using (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'))
  with check (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'));
create policy "allowlisted users read/write revisions" on revisions
  for all
  using (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'))
  with check (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'));
create policy "allowlisted users read/write reviews" on reviews
  for all
  using (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'))
  with check (auth.jwt() ->> 'email' in ('kate@tararosesalon.com','socials@tararosesalon.com','tara@tararosesalon.com','emma-louise@tararosesalon.com'));

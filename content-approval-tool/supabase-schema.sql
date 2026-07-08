-- Tara Rose Content Approval — Supabase schema
-- Run once in the Supabase SQL Editor for project qyojrknmgwkfjrdhtxhk.
-- Matches the shared-anon-key / no-login model already decided for this 4-person tool.

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
  created_at timestamptz not null default now()
);

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

-- Single shared publishable key, no per-user login (4-person trusted team).
create policy "anon read/write batches" on batches for all using (true) with check (true);
create policy "anon read/write content_items" on content_items for all using (true) with check (true);
create policy "anon read/write revisions" on revisions for all using (true) with check (true);
create policy "anon read/write reviews" on reviews for all using (true) with check (true);

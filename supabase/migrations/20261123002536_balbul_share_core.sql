-- BalBul Share: isolated schema + private storage bucket.
-- Limits: 25 MiB per file, maximum 24-hour share lifetime.
-- Existing application tables (profiles/messages/friendships/tasks/push_*) are untouched.

create table if not exists public.balbul_share_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null default 'application/octet-stream' check (char_length(mime_type) <= 255),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  storage_path text not null unique,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'qr_ready'
    check (status in ('preparing','uploading','qr_ready','sent_to_friend','waiting_for_scan','downloading','downloaded','expired','failed','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  first_download_at timestamptz,
  downloaded_at timestamptz,
  constraint balbul_share_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '24 hours'
  )
);

create index if not exists balbul_share_sessions_owner_created_idx
  on public.balbul_share_sessions (owner_id, created_at desc);
create index if not exists balbul_share_sessions_expiry_idx
  on public.balbul_share_sessions (expires_at)
  where status not in ('downloaded','expired','cancelled','failed');

alter table public.balbul_share_sessions enable row level security;

create policy "share sessions: owner can read"
  on public.balbul_share_sessions for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "share sessions: owner can create"
  on public.balbul_share_sessions for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "share sessions: owner can cancel"
  on public.balbul_share_sessions for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.balbul_share_sessions from anon;
grant select, insert, delete on public.balbul_share_sessions to authenticated;

create table if not exists public.balbul_share_deliveries (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.balbul_share_sessions(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  mime_type text not null default 'application/octet-stream' check (char_length(mime_type) <= 255),
  -- AES-GCM ciphertext only; plaintext download token is never persisted.
  encrypted_download_token text not null,
  status text not null default 'sent' check (status in ('sent','seen','downloaded','expired','cancelled')),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  downloaded_at timestamptz,
  constraint balbul_share_no_self_delivery check (sender_id <> recipient_id),
  constraint balbul_share_delivery_unique unique (share_id, recipient_id)
);

create index if not exists balbul_share_deliveries_recipient_created_idx
  on public.balbul_share_deliveries (recipient_id, created_at desc);
create index if not exists balbul_share_deliveries_sender_created_idx
  on public.balbul_share_deliveries (sender_id, created_at desc);

alter table public.balbul_share_deliveries enable row level security;

create policy "share deliveries: sender and recipient can read"
  on public.balbul_share_deliveries for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

create policy "share deliveries: sender can deliver to an existing friend"
  on public.balbul_share_deliveries for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1
      from public.balbul_share_sessions s
      where s.id = share_id and s.owner_id = (select auth.uid())
        and s.expires_at > now()
        and s.status not in ('expired','cancelled','failed')
    )
    and exists (
      select 1
      from public.friendships f
      where f.user_low = least((select auth.uid()), recipient_id)
        and f.user_high = greatest((select auth.uid()), recipient_id)
    )
  );

revoke all on public.balbul_share_deliveries from anon;
grant select, insert on public.balbul_share_deliveries to authenticated;

-- Private bucket. Files are stored under {auth.uid()}/{share_id}/{safe_file_name}.
insert into storage.buckets (id, name, public, file_size_limit)
values ('balbul-share-private', 'balbul-share-private', false, 26214400)
on conflict (id) do nothing;

create policy "share files: owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'balbul-share-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "share files: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'balbul-share-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "share files: owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'balbul-share-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Realtime is used only for the new delivery queue. Do not touch existing publications/tables.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'balbul_share_deliveries'
     ) then
    alter publication supabase_realtime add table public.balbul_share_deliveries;
  end if;
end
$$;

-- 1) Desktop dan web berlangganan perubahan warna di tabel profiles lewat Realtime,
--    tetapi profiles belum ada di publication. Akibatnya channel gagal subscribe
--    (CHANNEL_ERROR), status desktop macet di "Connecting" dan warna tidak ikut berubah live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- 2) Pengingat kini disimpan di reminder_at (due_at kosong), padahal Web Push ke iPhone/browser
--    hanya membaca due_at. Isi due_at otomatis dari reminder_at untuk jenis 'reminder'
--    supaya notifikasi push tetap jalan, siapa pun klien yang menulisnya (desktop atau web).
create or replace function public.sync_reminder_due_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'reminder' and new.reminder_at is not null then
    new.due_at := new.reminder_at;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_sync_reminder_due_at on public.tasks;
create trigger tasks_sync_reminder_due_at before insert or update on public.tasks
  for each row execute function public.sync_reminder_due_at();

-- pengingat lama yang sudah terlanjur tanpa due_at
update public.tasks set reminder_at = reminder_at
  where kind = 'reminder' and reminder_at is not null and due_at is distinct from reminder_at;

-- Sinkron desktop <-> web lewat akun.
-- 1) Tugas pribadi: desktop punya jenis (tugas/pengingat), pengulangan, dan jam pengingat.
-- 2) Warna balBul: simpan kapan terakhir diganti supaya versi yang lebih baru yang menang.
-- Semua perubahan bersifat menambah (tidak menghapus/mengubah data lama), aman diulang.

alter table public.tasks add column if not exists kind text not null default 'task';
alter table public.tasks add column if not exists repeat text not null default 'none';
alter table public.tasks add column if not exists reminder_at timestamptz;

alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('task', 'reminder'));
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (repeat in ('none', 'daily', 'weekdays', 'weekly'));

-- tabel tasks memakai izin per kolom, jadi kolom baru harus diberi izin
grant select (kind, repeat, reminder_at) on public.tasks to authenticated;
grant insert (kind, repeat, reminder_at) on public.tasks to authenticated;
grant update (kind, repeat, reminder_at) on public.tasks to authenticated;

-- warna: null = belum pernah diganti sejak fitur ini ada
alter table public.profiles add column if not exists color_updated_at timestamptz;
grant select (color_updated_at) on public.profiles to authenticated;

create or replace function public.touch_profile_color()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.color is distinct from old.color then
    new.color_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch_color on public.profiles;
create trigger profiles_touch_color before update of color on public.profiles
  for each row execute function public.touch_profile_color();

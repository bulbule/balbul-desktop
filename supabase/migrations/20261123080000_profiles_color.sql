-- Warna balBul per user, terlihat oleh teman (avatar).
alter table public.profiles add column if not exists color text not null default '#35e0ff';
alter table public.profiles drop constraint if exists profiles_color_hex;
alter table public.profiles add constraint profiles_color_hex check (color ~ '^#[0-9a-fA-F]{6}$');
grant update (color) on public.profiles to authenticated;

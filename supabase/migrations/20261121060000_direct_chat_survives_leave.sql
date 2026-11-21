-- Perbaikan "Hapus chat": sebelumnya, setelah satu orang menghapus chat dari daftarnya,
-- jumlah anggota tinggal 1 sehingga tombol Chat membuat percakapan BARU dan temannya
-- ditinggal di percakapan lama (yatim). Sekarang tiap chat langsung punya kunci pasangan
-- (direct_key) sehingga percakapan yang sama dipakai lagi dan riwayatnya kembali muncul.
--
-- ROLLBACK: jalankan ulang isi 20261121040000_open_direct_conversation_idempotent.sql
-- (mengembalikan fungsi lama). Kolom direct_key boleh dibiarkan.

alter table public.conversations add column if not exists direct_key text;

-- Isi kunci untuk chat langsung yang masih punya tepat 2 anggota.
update public.conversations c
set direct_key = k.key
from (
  select cm.conversation_id,
         min(cm.user_id::text) || ':' || max(cm.user_id::text) as key
  from public.conversation_members cm
  group by cm.conversation_id
  having count(*) = 2
) k
where c.id = k.conversation_id and c.kind = 'direct' and c.direct_key is null;

create index if not exists conversations_direct_key_idx
on public.conversations(direct_key) where kind = 'direct';

create or replace function public.open_direct_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_key text;
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Kamu harus login terlebih dahulu.'; end if;
  if p_friend_id is null or p_friend_id = v_user_id then raise exception 'Teman tidak valid.'; end if;
  if not exists (
    select 1 from public.friendships f
    where (f.user_low = v_user_id and f.user_high = p_friend_id)
       or (f.user_high = v_user_id and f.user_low = p_friend_id)
  ) then raise exception 'Kamu hanya bisa chat dengan teman yang sudah diterima.'; end if;

  v_key := least(v_user_id::text, p_friend_id::text) || ':' || greatest(v_user_id::text, p_friend_id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- 1) percakapan yang sudah bertanda pasangan ini (termasuk yang pernah dihapus salah satu pihak)
  select c.id into v_conversation_id
  from public.conversations c
  where c.kind = 'direct' and c.direct_key = v_key
  order by c.created_at asc limit 1;

  -- 2) percakapan lama tanpa kunci yang masih memuat kedua orang
  if v_conversation_id is null then
    select c.id into v_conversation_id
    from public.conversations c
    where c.kind = 'direct'
      and exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = v_user_id)
      and exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = p_friend_id)
    order by c.created_at asc limit 1;
    if v_conversation_id is not null then
      update public.conversations set direct_key = v_key where id = v_conversation_id and direct_key is null;
    end if;
  end if;

  if v_conversation_id is null then
    insert into public.conversations(kind, created_by, direct_key)
    values ('direct', v_user_id, v_key)
    returning id into v_conversation_id;
    insert into public.conversation_members(conversation_id, user_id)
    values (v_conversation_id, v_user_id), (v_conversation_id, p_friend_id);
  else
    -- masuk kembali ke percakapan yang sama jika tadi sudah dihapus dari daftar
    insert into public.conversation_members(conversation_id, user_id)
    select v_conversation_id, v_user_id
    where not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_conversation_id and cm.user_id = v_user_id
    );
  end if;
  return v_conversation_id;
end;
$$;
revoke all on function public.open_direct_conversation(uuid) from public, anon;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

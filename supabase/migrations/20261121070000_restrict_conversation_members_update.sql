-- Anggota percakapan hanya boleh mengubah last_read_at miliknya sendiri.
-- Sebelumnya conversation_id/user_id juga bisa diubah (bisa memindahkan keanggotaan ke percakapan lain).
revoke update on table public.conversation_members from authenticated;
grant update (last_read_at) on table public.conversation_members to authenticated;

-- Prevent duplicate direct chats when users double-click or open from two clients.
create or replace function public.open_direct_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Kamu harus login terlebih dahulu.'; end if;
  if p_friend_id is null or p_friend_id = v_user_id then raise exception 'Teman tidak valid.'; end if;
  if not exists (
    select 1 from public.friendships f
    where (f.user_low = v_user_id and f.user_high = p_friend_id)
       or (f.user_high = v_user_id and f.user_low = p_friend_id)
  ) then raise exception 'Kamu hanya bisa chat dengan teman yang sudah diterima.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    least(v_user_id::text,p_friend_id::text)||':'||
    greatest(v_user_id::text,p_friend_id::text),0
  ));

  select c.id into v_conversation_id
  from public.conversations c
  where c.kind='direct'
    and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=v_user_id)
    and exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p_friend_id)
    and (select count(*) from public.conversation_members cm where cm.conversation_id=c.id)=2
  order by c.created_at asc limit 1;
  if v_conversation_id is not null then return v_conversation_id; end if;

  insert into public.conversations(kind,created_by) values('direct',v_user_id)
  returning id into v_conversation_id;
  insert into public.conversation_members(conversation_id,user_id)
  values(v_conversation_id,v_user_id),(v_conversation_id,p_friend_id);
  return v_conversation_id;
end;
$$;
revoke all on function public.open_direct_conversation(uuid) from public,anon;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

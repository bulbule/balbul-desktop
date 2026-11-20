-- Shared tasks: allow task members to read and update shared tasks,
-- while only task owners can invite friends and delete tasks.
drop policy if exists "Task owners and members view tasks" on public.tasks;
create policy "Task owners and members view tasks"
on public.tasks for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.task_members tm
    where tm.task_id = tasks.id and tm.user_id = (select auth.uid())
  )
);

drop policy if exists "Owners update tasks" on public.tasks;
drop policy if exists "Owners and members update shared tasks" on public.tasks;
create policy "Owners and members update shared tasks"
on public.tasks for update to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.task_members tm
    where tm.task_id = tasks.id and tm.user_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.task_members tm
    where tm.task_id = tasks.id and tm.user_id = (select auth.uid())
  )
);

drop policy if exists "Users view their task memberships" on public.task_members;
drop policy if exists "Owners and members view task memberships" on public.task_members;
create policy "Owners and members view task memberships"
on public.task_members for select to authenticated
using (user_id = (select auth.uid()) or added_by = (select auth.uid()));

drop policy if exists "Task owners add members" on public.task_members;
drop policy if exists "Task owners add friends as members" on public.task_members;
create policy "Task owners add friends as members"
on public.task_members for insert to authenticated
with check (
  added_by = (select auth.uid())
  and exists (
    select 1 from public.tasks t
    where t.id = task_members.task_id
      and t.owner_id = (select auth.uid())
      and t.visibility = 'shared'
  )
  and exists (
    select 1 from public.friendships f
    where (f.user_low = (select auth.uid()) and f.user_high = task_members.user_id)
       or (f.user_high = (select auth.uid()) and f.user_low = task_members.user_id)
  )
);

create index if not exists task_members_user_task_idx
on public.task_members(user_id, task_id);

-- Prevent shared members from transferring ownership or changing visibility.
-- Only collaboration fields can be updated by authenticated users.
revoke update on table public.tasks from authenticated;
grant update (title, description, status, priority, due_at, completed_at, updated_at)
on table public.tasks to authenticated;

-- Let any member of a shared task view its complete member list without
-- recursive RLS evaluation.
create or replace function private.is_task_member(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.task_members tm
    where tm.task_id = p_task_id and tm.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_task_member(uuid) from public, anon;
grant execute on function private.is_task_member(uuid) to authenticated;

drop policy if exists "Owners and members view task memberships" on public.task_members;
create policy "Owners and members view task memberships"
on public.task_members for select to authenticated
using (private.is_task_member(task_id));

-- Create the task and add its invited friend in one transaction.
create or replace function public.create_shared_task(
  p_friend_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'medium',
  p_due_at timestamptz default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_task public.tasks;
begin
  if v_user_id is null then
    raise exception 'Kamu harus login terlebih dahulu.';
  end if;
  if p_friend_id is null or p_friend_id = v_user_id then
    raise exception 'Pilih teman yang valid.';
  end if;
  if length(trim(coalesce(p_title,''))) < 1 or length(trim(p_title)) > 200 then
    raise exception 'Judul tugas harus 1 sampai 200 karakter.';
  end if;
  insert into public.tasks(owner_id,created_by,title,description,priority,due_at,visibility)
  values(v_user_id,v_user_id,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_priority,p_due_at,'shared')
  returning * into v_task;
  insert into public.task_members(task_id,user_id,added_by)
  values(v_task.id,p_friend_id,v_user_id);
  return v_task;
end;
$$;
revoke all on function public.create_shared_task(uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.create_shared_task(uuid,text,text,text,timestamptz) to authenticated;

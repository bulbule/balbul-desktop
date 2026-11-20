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

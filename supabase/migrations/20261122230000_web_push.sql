-- Web Push (iPhone Home Screen web app + browsers): chat + reminder notifications.
-- VAPID keys live in public.push_config (service role only), NOT per-subscription.
alter table public.push_config add column if not exists vapid_public text, add column if not exists vapid_private text;
alter table public.push_subscriptions drop column if exists vapid_public_key, drop column if exists vapid_private_key;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists push_sub_own_select on public.push_subscriptions;
drop policy if exists push_sub_own_insert on public.push_subscriptions;
drop policy if exists push_sub_own_update on public.push_subscriptions;
drop policy if exists push_sub_own_delete on public.push_subscriptions;
create policy push_sub_own_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_sub_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_sub_own_update on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_sub_own_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create unique index if not exists push_deliveries_unique on public.push_deliveries(task_id, endpoint, due_at);

create or replace function public.push_call(payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions, net as $$
declare s text;
begin
  select cron_secret into s from public.push_config limit 1;
  perform net.http_post(
    url := 'https://okdckmorwoihndvzmhsx.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', s),
    body := payload);
exception when others then null;
end $$;
revoke all on function public.push_call(jsonb) from public, anon, authenticated;

create or replace function public.push_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_call(jsonb_build_object('type','message','message_id',new.id));
  return new;
end $$;
revoke all on function public.push_on_message() from public, anon, authenticated;
drop trigger if exists push_on_message on public.messages;
create trigger push_on_message after insert on public.messages for each row execute function public.push_on_message();

create or replace function public.push_cron() returns void
language sql security definer set search_path = public as $$ select public.push_call('{"type":"reminders"}'::jsonb); $$;
revoke all on function public.push_cron() from public, anon, authenticated;
select cron.unschedule('balbul-push-reminders') where exists (select 1 from cron.job where jobname='balbul-push-reminders');
select cron.schedule('balbul-push-reminders', '* * * * *', 'select public.push_cron()');

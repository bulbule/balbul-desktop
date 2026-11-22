-- Edge function 'push' runs as service_role and must read these tables to find recipients.
grant select on public.messages, public.conversation_members, public.profiles, public.tasks, public.task_members to service_role;

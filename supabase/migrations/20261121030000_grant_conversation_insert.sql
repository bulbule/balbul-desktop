-- The conversations INSERT policy limits creation to the signed-in creator.
-- Grant the SQL privilege required for that RLS policy to be evaluated.
grant insert on table public.conversations to authenticated;

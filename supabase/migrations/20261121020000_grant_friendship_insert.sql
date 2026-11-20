-- The accept_friend_request RPC runs as SECURITY INVOKER.
-- Authenticated users need INSERT privilege; RLS still limits rows to
-- accepted requests involving the current user.
grant insert on table public.friendships to authenticated;

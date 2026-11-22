-- friendships harus ada di publication realtime, kalau tidak channel "friends" di app
-- selalu CHANNEL_ERROR dan status nyangkut "Connecting".
alter publication supabase_realtime add table public.friendships;

-- The only duplicate pair currently present: merge the newer thread into the
-- earliest conversation, preserving every message and its original timestamp.
update public.messages
set conversation_id='a09d1559-6daf-4981-a156-8539339263cc'
where conversation_id='0ca3b9b2-a9b6-463d-acc8-d521ec925b86';

delete from public.conversations
where id='0ca3b9b2-a9b6-463d-acc8-d521ec925b86';

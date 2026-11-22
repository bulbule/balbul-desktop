// Sends Web Push for new chat messages and due reminders. Called only by the DB (pg_net / pg_cron)
// with the shared secret stored in public.push_config. verify_jwt is OFF; auth = x-cron-secret.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SITE = 'https://bulbule.github.io/balbul-desktop/';
const errors: string[] = [];

async function subsFor(userIds: string[]) {
  if (!userIds.length) return [];
  const { data } = await sb.from('push_subscriptions').select('id,user_id,endpoint,subscription').in('user_id', userIds);
  return data || [];
}
async function send(sub: any, payload: unknown) {
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', sub.id);
    else console.error('push failed', e?.statusCode, e?.body);
    errors.push('send:' + e?.statusCode);
    return false;
  }
}

Deno.serve(async (req) => {
  const { data: cfg } = await sb.from('push_config').select('cron_secret,vapid_public,vapid_private').single();
  if (!cfg || req.headers.get('x-cron-secret') !== cfg.cron_secret) return new Response('unauthorized', { status: 401 });
  webpush.setVapidDetails(SITE, cfg.vapid_public, cfg.vapid_private);
  const body = await req.json().catch(() => ({}));
  let sent = 0;

  if (body.type === 'message') {
    const { data: m } = await sb.from('messages').select('id,conversation_id,sender_id,body').eq('id', body.message_id).single();
    if (!m) return Response.json({ sent });
    const [{ data: members }, { data: sender }] = await Promise.all([
      sb.from('conversation_members').select('user_id').eq('conversation_id', m.conversation_id).neq('user_id', m.sender_id),
      sb.from('profiles').select('display_name').eq('id', m.sender_id).single(),
    ]);
    const subs = await subsFor((members || []).map((x) => x.user_id));
    const payload = {
      title: sender?.display_name || 'Pesan baru',
      body: String(m.body).slice(0, 140),
      tag: 'chat-' + m.conversation_id,
      data: { url: './?chat=' + m.conversation_id, chat: m.conversation_id },
    };
    for (const s of subs) if (await send(s, payload)) sent++;
  }

  if (body.type === 'reminders') {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const { data: tasks } = await sb.from('tasks').select('id,owner_id,title,due_at')
      .in('status', ['pending', 'in_progress']).lte('due_at', now.toISOString()).gte('due_at', since).limit(200);
    for (const t of tasks || []) {
      const { data: tm } = await sb.from('task_members').select('user_id').eq('task_id', t.id);
      const ids = [...new Set([t.owner_id, ...(tm || []).map((x) => x.user_id)])];
      for (const s of await subsFor(ids)) {
        const { error } = await sb.from('push_deliveries').insert({ task_id: t.id, endpoint: s.endpoint, due_at: t.due_at });
        if (error) continue; // already delivered (unique index)
        if (await send(s, { title: 'Reminder balBul', body: t.title, tag: 'task-' + t.id, data: { url: './?panel=tasks', panel: 'tasks' } })) sent++;
      }
    }
  }
  return Response.json({ sent, errors });
});

import { supabase } from './supabase';

/**
 * Insert a notification for a single member.
 */
export async function createNotification({ profileId, gymId, type, title, body = null, data = {} }) {
  await supabase.from('notifications').insert({
    profile_id: profileId,
    gym_id:     gymId,
    type,
    title,
    body,
    data,
  });
}

/**
 * Insert the same notification for every member in a gym (used for announcements).
 */
export async function broadcastNotification({ gymId, type, title, body = null, data = {} }) {
  const { data: members } = await supabase
    .from('profiles')
    .select('id')
    .eq('gym_id', gymId)
    .eq('role', 'member');

  if (!members?.length) return;

  await supabase.from('notifications').insert(
    members.map(m => ({ profile_id: m.id, gym_id: gymId, type, title, body, data }))
  );
}

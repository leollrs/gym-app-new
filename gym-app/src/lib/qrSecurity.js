/**
 * QR code signing — delegates to server-side Edge Functions so the
 * HMAC secret (SERVICE_ROLE_KEY) is never exposed to the client.
 */
import { supabase } from './supabase';

export async function signQRPayload(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase.functions.invoke('sign-qr', {
    body: { payload },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  // Use the timestamped payload returned by the server (not the original)
  // so that verify-qr can check both signature and expiry.
  return `${data.payload}|${data.signature}`;
}

export async function verifyQRPayload(signedPayload) {
  const lastPipe = signedPayload.lastIndexOf('|');
  if (lastPipe === -1) return { valid: false, payload: null };

  const payload = signedPayload.substring(0, lastPipe);
  const signature = signedPayload.substring(lastPipe + 1);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { valid: false, payload };

  const { data, error } = await supabase.functions.invoke('verify-qr', {
    body: { payload, signature },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) return { valid: false, payload };

  return { valid: !!data?.valid, payload };
}

/**
 * Message encryption for direct messages.
 * Uses AES-GCM with a key derived from the conversation ID + a per-conversation
 * encryption seed stored in the `conversations.encryption_seed` column.
 * This provides at-rest encryption in the DB — messages are stored as ciphertext.
 *
 * The `seed` parameter must be fetched from the conversations table by the caller.
 * It is a random UUID string unique to each conversation, readable only by
 * conversation participants (enforced by RLS).
 *
 * NOTE: This is not true E2E encryption (server could derive the key).
 * For true E2E, you'd need per-user key pairs with key exchange.
 */

async function deriveKey(conversationId, seed) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(seed + conversationId),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(conversationId), iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(text, conversationId, seed) {
  try {
    const key = await deriveKey(conversationId, seed);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text)
    );
    // Encode as base64: iv (12 bytes) + ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return 'enc:' + btoa(String.fromCharCode(...combined));
  } catch (e) {
    // Do NOT silently fall back to plaintext - this hides encryption failures
    console.error('Message encryption failed:', e?.message);
    throw new Error('Message encryption unavailable');
  }
}

export async function decryptMessage(ciphertext, conversationId, seed) {
  try {
    if (!ciphertext?.startsWith('enc:')) return ciphertext; // Not encrypted, return as-is
    const data = Uint8Array.from(atob(ciphertext.slice(4)), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const key = await deriveKey(conversationId, seed);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Return fallback text if decryption fails (may be a pre-encryption message)
    // Mark it so the UI can indicate this
    return '[Unable to decrypt]';
  }
}

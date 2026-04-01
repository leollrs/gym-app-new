/**
 * Message encryption for direct messages.
 * Uses AES-GCM with a key derived from the conversation ID + a static app secret.
 * This provides at-rest encryption in the DB — messages are stored as ciphertext.
 * NOTE: This is not true E2E encryption (server could derive the key).
 * For true E2E, you'd need per-user key pairs with key exchange.
 */

const APP_SECRET = 'tugympr-msg-v1'; // Static app-level secret component

async function deriveKey(conversationId) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET + conversationId),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(conversationId), iterations: 10000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(text, conversationId) {
  try {
    const key = await deriveKey(conversationId);
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
  } catch {
    // Fallback: return plaintext if encryption fails (older browsers)
    return text;
  }
}

export async function decryptMessage(ciphertext, conversationId) {
  try {
    if (!ciphertext?.startsWith('enc:')) return ciphertext; // Not encrypted, return as-is
    const data = Uint8Array.from(atob(ciphertext.slice(4)), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const key = await deriveKey(conversationId);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return '[Unable to decrypt]';
  }
}

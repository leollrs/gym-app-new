// confirmWord.js
// The "type this word to confirm" gate on destructive admin actions.
//
// WHY THIS IS SHARED: the prompt lived in the translation files and the check
// lived in the component as a hardcoded `!== 'DELETE'`. In Spanish the modal
// said «Escribe ELIMINAR para confirmar» and then refused ELIMINAR — the only
// string that worked was the English word the UI never mentioned. A Spanish
// admin could not delete a member at all. Keeping the word and the comparison in
// one module is what stops the two from drifting apart again.
//
// BOTH words are accepted regardless of locale. The gate exists to prove intent,
// not vocabulary: an admin running the app in Spanish who types DELETE (because
// that is what every other tool asks for) has demonstrated exactly as much
// deliberation as one who types ELIMINAR.

const ACCEPTED = ['DELETE', 'ELIMINAR'];

/** The word to SHOW, in the admin's language. */
export function confirmWordFor(lang) {
  return String(lang || '').toLowerCase().startsWith('es') ? 'ELIMINAR' : 'DELETE';
}

/** Whether what they typed unlocks the action. Case- and whitespace-forgiving. */
export function matchesConfirmWord(input) {
  return ACCEPTED.includes(String(input || '').trim().toUpperCase());
}

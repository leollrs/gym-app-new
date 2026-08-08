import { PROD_WEB_URL } from './appUrls';

/**
 * El enlace que un miembro manda por WhatsApp para que se le unan al equipo.
 *
 * Cuelga de `/challenge/:id`, que `App.jsx` ya traduce a
 * `/challenges?challenge=…` arrastrando el resto de la query — así que `?team=`
 * llega solo, sin ruta nueva, sin App Link nuevo y sin tocar el manifiesto de
 * Android.
 */
export const teamShareUrl = (challengeId, teamId) =>
  `${PROD_WEB_URL}/challenge/${challengeId}?team=${teamId}`;

/** El equipo que venía en un enlace, si venía alguno. */
export function teamFromSearch(search) {
  try {
    const q = new URLSearchParams(search);
    const challenge = q.get('challenge');
    const team = q.get('team');
    return challenge && team ? { challenge, team } : null;
  } catch {
    return null;
  }
}

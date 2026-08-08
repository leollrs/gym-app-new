// Por dónde se puede entregar una invitación, derivado de lo que la invitación
// TIENE. Un botón de correo en una invitación sin correo es un botón que
// miente: aquí sencillamente no sale.
//
// Vive aparte de los botones para que la fila de la tabla pueda preguntar
// «¿hay algún canal?» sin montar el componente.

// WhatsApp ya no está en lucide (quitaron las marcas). El verde va fijo a
// propósito: es la marca de otro, no la del gimnasio, y es lo que hace que el
// botón se reconozca sin leerlo.
export const WHATSAPP_GREEN = '#25D366';

/** Los canales por los que ESTA invitación se puede reenviar, en orden. */
export function inviteChannels(invite) {
  const out = [];
  if (invite?.email) out.push('email');
  if (invite?.phone) out.push('sms', 'whatsapp');
  return out;
}

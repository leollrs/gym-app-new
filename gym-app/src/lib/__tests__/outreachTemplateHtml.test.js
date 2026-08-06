import { describe, it, expect } from 'vitest';
import { emailDoc } from '../admin/emailEngine';
import { templateToCfg } from '../admin/emailCfg';

/**
 * El contrato del que depende el selector del compositor.
 *
 * Antes, escoger una plantilla en Outreach la APLANABA a asunto + texto plano:
 * se leía `header.text` y `hero.headline + body.text` y se tiraba todo lo demás.
 * La plantilla que habías diseñado llegaba al buzón desvestida, reenvuelta en la
 * plantilla genérica de send-admin-email — y no se notaba salvo comparando con
 * la vista previa del editor.
 */
const tpl = {
  name: 'Vuelve esta semana',
  preset: 'contundente',
  header: { enabled: true, showLogo: true, text: 'Recuperación' },
  hero: { enabled: true, headline: 'Te extrañamos', subtitle: 'Llevas {{days_inactive}} días fuera.', imageUrl: '' },
  body: { text: 'Hola {{member_name}},\n\n--Tu regalo--\n- Un batido gratis' },
  reward: { enabled: true, label: 'Tu recompensa', title: 'Batido gratis', description: 'En recepción', code: '', expiry: '' },
  cta: { enabled: true, text: 'Volver hoy', url: 'https://app.tugympr.com/invite/go/workout', color: '' },
  footer: { enabled: true, text: '© 2026', unsubscribeText: 'Cancelar suscripción' },
};

// Exactamente lo que hace el compositor. `keepTokens` es el contrato: el HTML
// se monta UNA vez y `outreachSender` sustituye por destinatario justo antes de
// enviar. Sin la bandera, el motor rellenaría con sus valores de MUESTRA y a
// toda la lista le llegaría el mismo «Hola José Rivera».
const asOutreach = (over = {}) => emailDoc({
  ...templateToCfg({ ...tpl, ...over }, { lang: 'es', gymName: 'Fuerza 787', gymLogoUrl: '', accent: '#D8542F' }),
  keepTokens: true,
});

describe('una plantilla de bloques sale ENTERA por Outreach', () => {
  it('carries the layout, not just the words', () => {
    const h = asOutreach();
    expect(h).toContain('<!doctype html>');
    // La maqueta elegida, no una genérica: `contundente` monta sobre papel oscuro.
    expect(h).toContain('#0E1316');
  });

  it('keeps the button, the reward block and the footer', () => {
    const h = asOutreach();
    expect(h).toContain('Volver hoy');
    expect(h).toContain('Batido gratis');
    expect(h).toContain('Tu recompensa');
    expect(h).toContain('© 2026');
  });

  it('keeps the section rule and the numbered list', () => {
    const h = asOutreach();
    expect(h).toContain('Tu regalo');
    expect(h).toContain('Un batido gratis');
  });

  // Lo que aplanar se llevaba por delante y nadie echaba de menos hasta abrir
  // el correo recibido al lado de la vista previa.
  it('is not the plain-text shadow the old prefill produced', () => {
    const h = asOutreach();
    const flattened = `${tpl.hero.headline}\n\n${tpl.body.text}`;
    expect(h.length).toBeGreaterThan(flattened.length * 20);
  });
});

describe('nada del editor se cuela en un buzón real', () => {
  // El código de muestra y su QR existen SOLO para que la vista previa enseñe el
  // bloque completo. Si salieran de verdad, recepción escanearía un código sin
  // fila en `earned_rewards` y devolvería "recompensa no encontrada".
  it('never ships the editor sample code or its QR', () => {
    const h = asOutreach();
    expect(h).not.toContain('A1B2C3D4E5');
    expect(h).not.toContain('api.qrserver.com');
  });

  // El marcador a rayas de la portada es un andamio del editor.
  it('never ships the striped cover placeholder', () => {
    const h = asOutreach({ hero: { ...tpl.hero, enabled: true, imageUrl: '' } });
    expect(h).not.toContain('repeating-linear-gradient');
  });

  // Los merge tags tienen que llegar LITERALES: outreachSender los sustituye
  // por destinatario justo antes de enviar. Rellenarlos aquí con los valores de
  // muestra mandaría «Llevas 7 días fuera» a todo el mundo por igual.
  it('leaves merge tags intact for the per-recipient pass', () => {
    const h = asOutreach();
    expect(h).toContain('{{days_inactive}}');
    expect(h).toContain('{{member_name}}');
    expect(h).not.toContain('José');
  });
});

describe('la recompensa: código por miembro, no uno fijo', () => {
  // El HTML se monta UNA vez para toda la campaña y el código es de cada
  // miembro, así que viaja como token y lo sustituye el enviador tras conceder.
  const asCampaign = () => emailDoc({
    ...templateToCfg(tpl, { lang: 'es', gymName: 'Fuerza 787', accent: '#D8542F', codeToken: true }),
    keepTokens: true,
  });

  it('ships the code as a token, never a fixed one', () => {
    const h = asCampaign();
    expect(h).toContain('{{reward_code}}');
    expect(h).not.toContain('A1B2C3D4E5');
  });

  // LA PARTE FINA: dentro de la URL del QR el token tiene que sobrevivir.
  // `encodeURIComponent` lo convertiría en %7B%7Breward_code%7D%7D y la
  // sustitución ya no encontraría nada — el miembro recibiría un QR que apunta
  // al texto literal del token.
  it('keeps the token substitutable inside the QR url', () => {
    const h = asCampaign();
    expect(h).toContain('api.qrserver.com');
    expect(h).toContain('data=earned-reward%3A{{reward_code}}');
    expect(h).not.toContain('%7B%7Breward_code');
  });

  // Y una vez sustituido, la URL tiene que quedar válida: el prefijo codificado
  // y el código —alfanumérico en mayúsculas— tal cual.
  it('produces a scannable url once the code is substituted', () => {
    const h = asCampaign().replace(/\{\{reward_code\}\}/g, 'A1B2C3D4E5');
    expect(h).toContain('data=earned-reward%3AA1B2C3D4E5');
    expect(decodeURIComponent('earned-reward%3AA1B2C3D4E5')).toBe('earned-reward:A1B2C3D4E5');
  });

  // La vista previa del editor NO usa este camino: ahí sale el código de
  // muestra, con su QR codificado del modo normal.
  it('leaves the editor preview alone', () => {
    const h = emailDoc(templateToCfg(tpl, { lang: 'es', gymName: 'F', sampleCode: true }));
    expect(h).toContain('A1B2C3D4E5');
    expect(h).not.toContain('{{reward_code}}');
  });
});

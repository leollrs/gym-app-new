import { describe, it, expect } from 'vitest';
import { buildEmail, emailDoc, PRESET_IDS, PRESETS, safeUrl, onColor } from '../admin/emailEngine';

const base = {
  lang: 'es',
  preset: 'editorial',
  density: 'comodo',
  fontScale: 15,
  brand: { name: 'Fuerza 787', monogram: 'F7', accent: '#D8542F', logoUrl: '' },
  subject: 'Asunto',
  preheader: '',
  header: { on: true, showLogo: true, text: 'Agosto 2026' },
  hero: { on: true, imageUrl: '', imagePlaceholder: false, eyebrow: 'Bienvenida', title: 'Empezamos', subtitle: 'Hola {{first_name}}' },
  body: { on: true, text: 'Párrafo uno.\n\n--Sección--\n- Primera\n- Segunda' },
  reward: { on: true, label: 'Tu recompensa', title: 'Batido gratis', desc: 'En recepción.', code: 'A1B2C3D4E5', scannable: true, expires: '2026-08-31' },
  cta: { on: true, label: '', dest: 'app', url: 'https://app.tugympr.com/invite/go/home', color: '' },
  footer: { on: true, text: '© 2026', address: 'Ave. Roosevelt 1025', unsub: 'Cancelar suscripción', unsubUrl: 'https://app.tugympr.com/u/tok' },
};

describe('reward block', () => {
  // El QR es lo que recepción escanea. Se sirve alojado como PNG porque
  // Gmail/Yahoo/Outlook web arrancan los `data:` de un <img> — mismo camino y
  // misma razón que el voucher de send-admin-email.
  it('emits a hosted PNG QR, not a data URI', () => {
    const h = buildEmail(base);
    expect(h).toContain('api.qrserver.com');
    expect(h).not.toMatch(/<img[^>]+src="data:/);
  });

  // Sin el prefijo `earned-reward:` el escáner de recepción no enruta al
  // canje (scanRouter.js:154) y escanearlo no hace absolutamente nada.
  it('encodes the earned-reward prefix so the front desk scanner routes it', () => {
    const h = buildEmail(base);
    const m = h.match(/api\.qrserver\.com[^"]*data=([^"&]*)/);
    expect(m).toBeTruthy();
    expect(decodeURIComponent(m[1])).toBe('earned-reward:A1B2C3D4E5');
  });

  // Si las imágenes están bloqueadas, el código impreso es lo único que queda.
  it('always prints the code as text alongside the QR', () => {
    expect(buildEmail(base)).toContain('A1B2C3D4E5');
  });

  it('renders nothing when the reward has no title', () => {
    const h = buildEmail({ ...base, reward: { ...base.reward, title: '' } });
    expect(h).not.toContain('api.qrserver.com');
  });

  // Un QR solo vale si recepción puede escanearlo. El escáner busca el código
  // en `earned_rewards`, y un código escrito a mano en la plantilla no tiene
  // fila ahí — el escaneo devolvería "recompensa no encontrada". El código en
  // texto sí se mantiene: eso el mostrador lo puede teclear y comprobar.
  it('omits the QR when the code is not a granted, redeemable one', () => {
    const h = buildEmail({ ...base, reward: { ...base.reward, scannable: false } });
    expect(h).not.toContain('api.qrserver.com');
    expect(h).toContain('A1B2C3D4E5');
  });
});

describe('cta', () => {
  // La queja: una píldora de color sin nada dentro. Pasaba porque el
  // renderizador viejo solo miraba `enabled`, nunca el texto.
  it('never renders an empty button — falls back to the destination label', () => {
    const h = buildEmail(base);
    expect(h).toContain('Abrir la app');
  });

  it('hides the button entirely when the url is not usable', () => {
    expect(buildEmail({ ...base, cta: { ...base.cta, url: '' } })).not.toContain('&rarr;');
    expect(buildEmail({ ...base, cta: { ...base.cta, url: 'javascript:alert(1)' } })).not.toContain('&rarr;');
  });

  // Es lo que hace honesto mandarle esto a un prospecto que aún no tiene app.
  it('carries the app/web fallback note', () => {
    expect(buildEmail(base)).toContain('Abre la app si la tienes');
  });

  // El botón es una celda con `border-radius`. Bajo `border-collapse:collapse`
  // la especificación dice que el radio NO aplica al borde de una celda: el
  // fondo salía redondo, el borde cuadrado, y entre los dos asomaban las cuatro
  // esquinas del papel. En el buzón se veía como una caja alrededor del botón.
  it('lays the button on a separated table so the pill radius survives', () => {
    const h = buildEmail(base);
    const pill = h.indexOf('border-radius:999px');
    expect(pill).toBeGreaterThan(-1);
    // La tabla que ENVUELVE la píldora, no las de fuera: esas sí usan
    // `collapse` con razón, porque no llevan ni borde ni radio.
    const openTag = h.slice(0, pill).lastIndexOf('<table');
    const own = h.slice(openTag, h.indexOf('>', openTag));
    expect(own).toContain('border-collapse:separate');
    expect(own).not.toContain('border-collapse:collapse');
  });
});

describe('tokens', () => {
  it('fills sample values in preview and in the preheader', () => {
    const doc = emailDoc({ ...base, preheader: 'Hola {{first_name}}, llevas {{streak_count}}' });
    expect(doc).not.toMatch(/\{\{[a-z_]+\}\}/i);
    expect(doc).toContain('José');
  });

  it('uses real values when the sender supplies them', () => {
    const doc = emailDoc({ ...base, values: { first_name: 'Marisol' } });
    expect(doc).toContain('Marisol');
    expect(doc).not.toContain('José');
  });

  it('resolves gym_name from the brand, not the sample map', () => {
    const doc = emailDoc({ ...base, hero: { ...base.hero, subtitle: 'en {{gym_name}}' } });
    expect(doc).toContain('Fuerza 787');
  });
});

describe('líneas que se quedarían cojas', () => {
  const cls = {
    ...base,
    body: {
      on: true,
      text: '--Detalles--\n📋 Clase: {{next_class_name}}\n👤 Instructor: {{next_class_instructor}}\n🕒 Hora: {{next_class_time}}\n\nLlega unos minutos antes.',
    },
  };

  // El caso real: `member_email_context` devuelve NULL en `next_class_*` cuando
  // no hay reserva, y NULL en el instructor aunque SÍ haya clase si el horario
  // no tiene entrenador. «Instructor:» colgando es peor que no decirlo.
  it('drops the whole line when its token has no value', () => {
    const h = buildEmail({ ...cls, values: { next_class_name: 'Spinning', next_class_time: '18:00' } });
    expect(h).toContain('Spinning');
    expect(h).toContain('18:00');
    expect(h).not.toContain('Instructor');
    expect(h).not.toMatch(/\{\{/);
  });

  it('keeps lines that carry no token at all', () => {
    const h = buildEmail({ ...cls, values: {} });
    expect(h).toContain('Llega unos minutos antes');
  });

  // Un antetítulo con su regla y NADA detrás se lee como que el correo se
  // rompió a la mitad. Con algo detrás no: una línea en blanco separa párrafos
  // dentro de la sección, no la cierra.
  it('drops a section heading left with nothing at all under it', () => {
    const h = buildEmail({
      ...base,
      body: { on: true, text: 'Hola.\n\n--Detalles--\n📋 Clase: {{next_class_name}}' },
      values: {},
    });
    expect(h).not.toContain('Detalles');
    expect(h).toContain('Hola.');
  });

  it('keeps a heading whose section still has a paragraph under it', () => {
    const h = buildEmail({ ...cls, values: {} });
    expect(h).toContain('Detalles');
    expect(h).toContain('Llega unos minutos antes');
  });

  it('keeps a section heading that still has its own lines', () => {
    const h = buildEmail({ ...cls, values: { next_class_name: 'Spinning' } });
    expect(h).toContain('Detalles');
  });

  // En el EDITOR los tokens son parte de lo que estás escribiendo: si aquí se
  // cayeran las líneas, escribir {{next_class_name}} haría desaparecer el
  // renglón bajo los dedos.
  it('never drops anything in the preview, where there are no real values', () => {
    const h = buildEmail(cls);
    expect(h).toContain('{{next_class_name}}');
    expect(h).toContain('Instructor');
  });

  // Lo mismo para un campo de una sola línea: se vacía entero.
  it('blanks a single-line hero field rather than shipping half a sentence', () => {
    const h = buildEmail({
      ...base,
      hero: { ...base.hero, subtitle: 'Tu próxima clase es {{next_class_name}}' },
      values: { first_name: 'Marisol' },
    });
    expect(h).not.toContain('Tu próxima clase es');
    expect(h).not.toMatch(/\{\{/);
  });

  it('resolves gym_name from the brand even at send time', () => {
    const h = buildEmail({
      ...cls,
      body: { on: true, text: '📍 Dónde: {{gym_name}}' },
      values: {},
    });
    expect(h).toContain('Fuerza 787');
  });
});

describe('presets', () => {
  it('every preset renders and they are genuinely different layouts', () => {
    const outs = PRESET_IDS.map((id) => buildEmail({ ...base, preset: id }));
    outs.forEach((h) => expect(h.length).toBeGreaterThan(500));
    // Seis maquetas distintas, no seis paletas sobre la misma.
    expect(new Set(outs).size).toBe(PRESET_IDS.length);
  });

  it('the dark preset keeps body text light enough to read on its paper', () => {
    const p = PRESETS.contundente;
    expect(p.onDark).toBe(true);
    // onColor devuelve la tinta legible: sobre #0E1316 tiene que ser clara.
    expect(onColor(p.paper)).toBe('#FFFFFF');
  });
});

describe('email hygiene', () => {
  it('ships a hidden preheader', () => {
    expect(emailDoc(base)).toContain('mso-hide:all');
  });

  it('omits the unsubscribe link rather than emitting a dead href', () => {
    const h = buildEmail({ ...base, footer: { ...base.footer, unsubUrl: '' } });
    expect(h).not.toContain('Cancelar suscripción');
    expect(h).not.toContain('href="#"');
  });

  it('escapes admin-authored text', () => {
    const h = buildEmail({ ...base, hero: { ...base.hero, title: '<img onerror=x>' } });
    expect(h).not.toContain('<img onerror');
    expect(h).toContain('&lt;img onerror');
  });
});

describe('geometría de la envoltura', () => {
  // La miniatura de la galería (EmailPresetGallery) dibuja el correo a tamaño
  // real dentro de un iframe y lo encoge. Para que quede centrado, el iframe
  // tiene que medir lo que mide la ENVOLTURA, no la columna: 600 + 16 de aire a
  // cada lado. Asumir 600 fue exactamente el fallo — el correo salía corrido a
  // la izquierda y con el borde derecho cortado.
  //
  // Si este test cambia, `TH_W` en EmailPresetGallery.jsx cambia con él.
  it('pads the 600px column with 16px a side, so the wrapper is 632', () => {
    const h = buildEmail(base);
    const m = h.match(/padding:(\d+)px (\d+)px/);
    expect(m).toBeTruthy();
    expect(Number(m[2])).toBe(16);
    expect(h).toContain('width:600px');
  });
});

describe('safeUrl', () => {
  it('rejects non-https, userinfo and junk', () => {
    expect(safeUrl('http://x.com')).toBe('');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    // El truco clásico: el lector ve el dominio bueno, el navegador va al malo.
    expect(safeUrl('https://app.tugympr.com@evil.example/')).toBe('');
    expect(safeUrl('/relative')).toBe('');
    expect(safeUrl('https://ok.example/x')).toBe('https://ok.example/x');
  });
});

import { describe, it, expect } from 'vitest';
import { renderOutreachTokens, KNOWN_TOKENS } from '../admin/outreachTokens';

const ctx = (over = {}) => ({
  fullName: 'José Rivera',
  gymName: 'Fuerza 787',
  stats: { streak_count: 12, workout_count: 34 },
  ...over,
});

describe('sustitución', () => {
  it('fills the names, the gym and the stats', () => {
    const out = renderOutreachTokens('Hola {{first_name}}, llevas {{streak_count}} días en {{gym_name}}.', ctx());
    expect(out).toBe('Hola José, llevas 12 días en Fuerza 787.');
  });

  // Los valores que trae el servidor (member_email_context) además de los tres
  // de siempre: sin esto `{{next_class_name}}` no resolvía nunca.
  it('resolves anything the server supplied, not just a hardcoded nine', () => {
    const out = renderOutreachTokens('Clase: {{next_class_name}} a las {{next_class_time}}',
      ctx({ stats: { next_class_name: 'Spinning', next_class_time: '18:00' } }));
    expect(out).toBe('Clase: Spinning a las 18:00');
  });

  it('escapes only on the HTML path', () => {
    const c = ctx({ fullName: '<img onerror=x>' });
    expect(renderOutreachTokens('{{member_name}}', { ...c, escape: true })).toContain('&lt;img');
    // En push/SMS escapar dejaría `&lt;` visible al miembro.
    expect(renderOutreachTokens('{{member_name}}', c)).toBe('<img onerror=x>');
  });
});

describe('líneas que se caen — solo en texto plano', () => {
  const noClass = ctx({ stats: {} });

  it('drops a line whose known token has no value', () => {
    const out = renderOutreachTokens('Hola.\nClase: {{next_class_name}}\nNos vemos.', noClass);
    expect(out).toBe('Hola.\nNos vemos.');
  });

  // El razonamiento que la versión anterior usaba para NO filtrar nada seguía
  // siendo válido para esto: unas llaves que escribió el admin no son un token.
  it('never touches braces the admin wrote himself', () => {
    const out = renderOutreachTokens('Trae {{tu toalla}} y agua.', noClass);
    expect(out).toBe('Trae {{tu toalla}} y agua.');
  });

  it('keeps a line whose tokens all resolve', () => {
    const out = renderOutreachTokens('Clase: {{next_class_name}}', ctx({ stats: { next_class_name: 'Yoga' } }));
    expect(out).toBe('Clase: Yoga');
  });

  // EL CASO QUE CASI SE ME ESCAPA. `emailDoc` emite el documento entero sin un
  // solo salto de línea, así que filtrar sobre el HTML borra el correo completo.
  // Medido: cero `\n` en la salida del motor.
  it('NEVER drops anything on the HTML path — the doc is a single line', () => {
    const html = `<html><body><p>Clase: {{next_class_name}}</p><p>Hola {{first_name}}</p></body></html>`;
    const out = renderOutreachTokens(html, { ...noClass, escape: true });
    expect(out).toContain('José');
    expect(out).toContain('{{next_class_name}}');   // literal, pero el correo sobrevive
    expect(out.length).toBeGreaterThan(50);
  });
});

describe('KNOWN_TOKENS', () => {
  it('covers the auto-only tokens the prebuilt class reminder now uses', () => {
    ['next_class_name', 'next_class_date', 'next_class_time', 'next_class_instructor']
      .forEach((k) => expect(KNOWN_TOKENS).toContain(k));
  });

  it('has no duplicates', () => {
    expect(new Set(KNOWN_TOKENS).size).toBe(KNOWN_TOKENS.length);
  });
});

import { describe, it, expect } from 'vitest';
import { templateExcerpt } from '../admin/emailExcerpt';

const winback = {
  header: { enabled: true, showLogo: true, text: '' },
  hero: { enabled: true, headline: 'We miss you', subtitle: 'It’s been {{days_inactive}} days.' },
  body: {
    text: 'Hey {{member_name}},\n\nYour {{streak_count}}-day streak is still on the books — waiting to be reignited.\n\nWe know life gets in the way. No guilt, no pressure.',
  },
};

describe('templateExcerpt', () => {
  it('leads with the email headline', () => {
    expect(templateExcerpt(winback).title).toBe('We miss you');
  });

  // El saludo es la primera línea de casi todas las plantillas y no dice NADA
  // de qué va el correo. Si se deja, las doce tarjetas empiezan igual.
  it('drops the greeting line so the excerpt starts with the point', () => {
    const { body } = templateExcerpt(winback);
    expect(body).not.toContain('Hey');
    expect(body.startsWith('Your 12-day streak')).toBe(true);
  });

  // Enseñar «Llevas {{streak_count}} días» en una tarjeta no se lee de un
  // vistazo y encima delata la maquinaria. Mismos valores que la vista previa.
  it('fills merge tags with the sample values', () => {
    const { body } = templateExcerpt(winback);
    expect(body).not.toMatch(/\{\{/);
    expect(body).toContain('12-day');
  });

  it('resolves gym_name from the gym, not the sample table', () => {
    const t = { hero: { headline: 'Bienvenido a {{gym_name}}' }, body: { text: '' } };
    expect(templateExcerpt(t, { gymName: 'Fuerza 787' }).title).toBe('Bienvenido a Fuerza 787');
  });

  it('strips section rules and bullet dashes', () => {
    const t = { body: { text: 'Hola,\n\n--Esta semana--\n- Entrenos: 4\n- Racha: 9' } };
    const { body } = templateExcerpt(t);
    expect(body).not.toContain('--');
    expect(body).toBe('Entrenos: 4 Racha: 9');
  });

  it('falls back to the header label when there is no headline', () => {
    const t = { header: { text: 'Tu Resumen Semanal' }, hero: { headline: '' }, body: { text: 'Cuerpo.' } };
    expect(templateExcerpt(t).title).toBe('Tu Resumen Semanal');
  });

  // Un diseño de la galería no tiene bloques. Sin esta rama su tarjeta salía
  // muda, que es justo el problema que esto viene a resolver.
  it('reads a gallery design from its saved subject and preview', () => {
    const t = {
      designer_id: 'aurora',
      designer_subject: 'Vuelve esta semana',
      designer_preview: 'Te guardamos el sitio',
      body: { text: 'no se usa' },
    };
    expect(templateExcerpt(t)).toEqual({ title: 'Vuelve esta semana', body: 'Te guardamos el sitio' });
  });

  it('cuts on a word boundary and never mid-word', () => {
    const t = { body: { text: 'palabra '.repeat(40) } };
    const { body } = templateExcerpt(t);
    expect(body.length).toBeLessThanOrEqual(121);
    expect(body.endsWith('…')).toBe(true);
    expect(body).not.toMatch(/palab…$/);
  });

  // Una plantilla recién creada no dice nada todavía, y la tarjeta tiene que
  // poder no pintar nada en vez de dos líneas en blanco.
  it('returns empty strings for a blank template', () => {
    expect(templateExcerpt({})).toEqual({ title: '', body: '' });
    expect(templateExcerpt(null)).toEqual({ title: '', body: '' });
  });
});

describe('sin repetir el nombre de la tarjeta', () => {
  // «Recordatorio de Clase» se llama igual que su titular. La tarjeta ya pinta
  // el nombre justo encima, así que repetirlo gasta el hueco del cuerpo.
  it('drops the headline when it just repeats the template name', () => {
    const t = { hero: { headline: 'Class Reminder' }, body: { text: 'Nos vemos el jueves.' } };
    const x = templateExcerpt(t, { name: 'Class Reminder' });
    expect(x.title).toBe('');
    expect(x.body).toBe('Nos vemos el jueves.');
  });

  it('ignores case, accents and punctuation when comparing', () => {
    const t = { hero: { headline: '¡Recordatorio de clase!' }, body: { text: 'x' } };
    expect(templateExcerpt(t, { name: 'Recordatorio de Clase' }).title).toBe('');
  });

  it('keeps a headline that genuinely says something else', () => {
    const t = { hero: { headline: 'We miss you' }, body: { text: 'x' } };
    expect(templateExcerpt(t, { name: 'Win-Back' }).title).toBe('We miss you');
  });
});

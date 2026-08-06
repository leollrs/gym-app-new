import { describe, it, expect } from 'vitest';
import {
  TEXT_PATHS, baseLang, otherLang, pathFor, pickVariant, seedVariantFromBase, variantProgress,
} from '../admin/emailVariants';

const tpl = () => ({
  lang: 'es',
  preset: 'editorial',
  header: { enabled: true, showLogo: true, text: 'Boletín' },
  hero: { enabled: false, imageUrl: 'https://cdn.example/x.png', eyebrow: 'Esta semana', headline: 'Te esperamos', subtitle: 'Tu sitio sigue ahí' },
  body: { text: 'Llevas {{streak_count}} días.' },
  cta: { enabled: true, text: 'Abrir la app', url: 'https://app.tugympr.com/invite/go/home', color: '#D8542F' },
  reward: { enabled: true, label: 'Tu recompensa', title: 'Batido gratis', description: 'En recepción', code: 'VUELVE20', expiry: '2026-08-31' },
  footer: { enabled: true, text: '© 2026', unsubscribeText: 'Cancelar suscripción' },
  i18n: {
    en: { hero: { headline: 'We saved your spot' }, body: { text: 'You are on a {{streak_count}}-day streak.' } },
  },
});

describe('pickVariant', () => {
  it('leaves the base language untouched — same object, no copy', () => {
    const t = tpl();
    expect(pickVariant(t, 'es')).toBe(t);
  });

  it('overlays the translated text', () => {
    const en = pickVariant(tpl(), 'en');
    expect(en.hero.headline).toBe('We saved your spot');
    expect(en.body.text).toBe('You are on a {{streak_count}}-day streak.');
  });

  // ESTE es el caso que importa. Una traducción a medias tiene que salir a
  // medias, no medio en blanco: un titular vacío no se lee como "pendiente de
  // traducir", se lee como un correo roto.
  it('falls back to the base for anything not translated', () => {
    const en = pickVariant(tpl(), 'en');
    expect(en.hero.subtitle).toBe('Tu sitio sigue ahí');
    expect(en.reward.title).toBe('Batido gratis');
    expect(en.footer.text).toBe('© 2026');
  });

  it('treats a whitespace-only translation as missing', () => {
    const t = tpl();
    t.i18n.en.footer = { text: '   ' };
    expect(pickVariant(t, 'en').footer.text).toBe('© 2026');
  });

  // Duplicar la maqueta o los enlaces por idioma es una fuente de bugs, no una
  // función: dos URLs por plantilla significa que una de las dos se queda vieja.
  it('never forks layout, links, colours, image or reward code', () => {
    const en = pickVariant(tpl(), 'en');
    expect(en.preset).toBe('editorial');
    expect(en.cta.url).toBe('https://app.tugympr.com/invite/go/home');
    expect(en.cta.color).toBe('#D8542F');
    expect(en.hero.imageUrl).toBe('https://cdn.example/x.png');
    expect(en.reward.code).toBe('VUELVE20');
    expect(en.reward.expiry).toBe('2026-08-31');
    expect(en.hero.enabled).toBe(false);
  });

  it('does not mutate the template it was given', () => {
    const t = tpl();
    pickVariant(t, 'en');
    expect(t.hero.headline).toBe('Te esperamos');
  });

  // Toda plantilla guardada antes de esto. Sin `lang` ni `i18n` es español base
  // sin traducir, que es exactamente lo que es.
  it('is a no-op on templates saved before variants existed', () => {
    const old = { header: { text: 'Hola' }, body: { text: 'Cuerpo' } };
    expect(pickVariant(old, 'es')).toBe(old);
    expect(pickVariant(old, 'en')).toBe(old);
  });
});

describe('pathFor', () => {
  it('routes text to the variant and structure to the base', () => {
    const t = tpl();
    expect(pathFor(t, 'en', 'hero.headline')).toBe('i18n.en.hero.headline');
    expect(pathFor(t, 'es', 'hero.headline')).toBe('hero.headline');
    // Lo que NO se traduce va siempre al base, se edite en el idioma que se edite.
    expect(pathFor(t, 'en', 'cta.url')).toBe('cta.url');
    expect(pathFor(t, 'en', 'hero.enabled')).toBe('hero.enabled');
    expect(pathFor(t, 'en', 'reward.code')).toBe('reward.code');
    expect(pathFor(t, 'en', 'name')).toBe('name');
  });

  it('covers every translatable path and nothing else', () => {
    expect(TEXT_PATHS).toContain('body.text');
    expect(TEXT_PATHS).not.toContain('cta.url');
    expect(TEXT_PATHS).not.toContain('reward.code');
  });
});

describe('variantProgress', () => {
  // Los campos vacíos en el base no cuentan: no hay nada que traducir ahí, y
  // contarlos dejaría toda plantilla corta en "a medias" para siempre.
  it('counts only the base fields that actually have text', () => {
    const p = variantProgress(tpl(), 'en');
    expect(p.total).toBe(11);   // los 11 campos con texto de esta plantilla
    expect(p.filled).toBe(2);
    expect(p.done).toBe(false);
  });

  it('is done when every non-empty base field is translated', () => {
    const seeded = seedVariantFromBase(tpl(), 'en');
    expect(variantProgress(seeded, 'en').done).toBe(true);
  });
});

describe('seedVariantFromBase', () => {
  it('never overwrites what is already translated', () => {
    const seeded = seedVariantFromBase(tpl(), 'en');
    expect(seeded.i18n.en.hero.headline).toBe('We saved your spot');
    expect(seeded.i18n.en.hero.subtitle).toBe('Tu sitio sigue ahí');
  });

  it('leaves the base language alone', () => {
    const t = tpl();
    expect(seedVariantFromBase(t, 'es')).toBe(t);
  });
});

describe('baseLang / otherLang', () => {
  it('defaults to Spanish and flips cleanly', () => {
    expect(baseLang({})).toBe('es');
    expect(baseLang({ lang: 'en' })).toBe('en');
    expect(baseLang(null)).toBe('es');
    expect(otherLang('es')).toBe('en');
    expect(otherLang('en')).toBe('es');
  });
});

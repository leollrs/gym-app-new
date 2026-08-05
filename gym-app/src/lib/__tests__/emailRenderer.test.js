import { describe, it, expect } from 'vitest';
import {
  applyTokens, applyTokensInline, renderEmailHtml, escHtml, safeColor,
} from '../../../supabase/functions/_shared/emailRenderer.ts';
import { dbRowToTemplate } from '../admin/emailTemplateRenderer';

// The Deno renderer is plain TS with no Deno APIs, so vitest imports it
// directly. That's deliberate: the token logic below is the most bug-prone
// thing in the email pipeline and it gets tested where it actually runs,
// instead of against a copy that can drift.

const VALUES = {
  first_name: 'Luisa',
  member_name: 'Luisa Niño',
  gym_name: 'Iron House',
  streak_count: '14',
  next_class_name: 'Spinning',
  next_class_day: 'jueves',
  today_plan_name: '',        // empty on purpose — a rest day
  next_class_time: null,      // missing on purpose
};

describe('applyTokens — the rule that kills generic email', () => {
  it('substitutes what it has', () => {
    expect(applyTokens('Hola {{first_name}}, bienvenida a {{gym_name}}.', VALUES))
      .toBe('Hola Luisa, bienvenida a Iron House.');
  });

  // THE ONE THAT MATTERS. Without this the member reads "Tu próxima clase es
  // el ." — which is worse than never mentioning the class at all.
  it('drops a whole line when any of its tokens is missing', () => {
    const body = [
      'Hola {{first_name}},',
      'Tu próxima clase es {{next_class_name}} el {{next_class_day}} a las {{next_class_time}}.',
      'Nos vemos.',
    ].join('\n');
    expect(applyTokens(body, VALUES)).toBe('Hola Luisa,\nNos vemos.');
  });

  it('treats an empty string as missing, not as a valid value', () => {
    expect(applyTokens('Hoy toca {{today_plan_name}}.', VALUES)).toBe('');
  });

  it('keeps a line whose tokens all resolve', () => {
    expect(applyTokens('Tu próxima clase es {{next_class_name}} el {{next_class_day}}.', VALUES))
      .toBe('Tu próxima clase es Spinning el jueves.');
  });

  it('never drops a line that has no tokens', () => {
    expect(applyTokens('Sin variables aquí.\nNi aquí.', {}))
      .toBe('Sin variables aquí.\nNi aquí.');
  });

  it('is whitespace- and case-tolerant inside the braces', () => {
    expect(applyTokens('Hola {{ First_Name }}.', VALUES)).toBe('Hola Luisa.');
  });

  it('survives empty and missing input', () => {
    expect(applyTokens('', VALUES)).toBe('');
    expect(applyTokens(null, VALUES)).toBe('');
    expect(applyTokens(undefined, VALUES)).toBe('');
  });
});

describe('applyTokensInline — single-line fields blank entirely', () => {
  it('returns the substituted string when everything resolves', () => {
    expect(applyTokensInline('Te esperamos, {{first_name}}', VALUES)).toBe('Te esperamos, Luisa');
  });

  // A subject line or CTA label is all-or-nothing: "Tu clase de  te espera"
  // in someone's inbox subject is worse than a generic subject.
  it('returns empty when any token is unresolved', () => {
    expect(applyTokensInline('Tu clase de {{next_class_time}} te espera', VALUES)).toBe('');
  });
});

describe('renderEmailHtml', () => {
  const base = {
    header: { enabled: true, showLogo: false, text: '{{gym_name}}' },
    hero: { enabled: false, imageUrl: '', headline: '', subtitle: '' },
    body: { text: 'Hola {{first_name}}.' },
    cta: { enabled: true, text: 'Abrir mi plan', url: 'https://app.tugympr.com/invite/go/workout', color: '#D4AF37' },
    footer: { enabled: true, text: '© Iron House', unsubscribeText: 'Cancelar suscripción' },
    colors: { primary: '#D4AF37', background: '#ffffff', text: '#333333' },
  };
  const opts = {
    gymName: 'Iron House',
    values: VALUES,
    unsubscribeUrl: 'https://app.tugympr.com/u/abc-123',
    postalAddress: 'Calle 1, San Juan PR',
  };

  it('renders real values, never the preview placeholders', () => {
    const html = renderEmailHtml(base, opts);
    expect(html).toContain('Hola Luisa.');
    expect(html).not.toContain('John Doe');
    expect(html).not.toContain('{{');
  });

  // The reason Phase 0 exists. A dead unsubscribe is a CAN-SPAM problem and a
  // deliverability problem for the shared noreply@ sender.
  it('renders a real unsubscribe href, never "#"', () => {
    const html = renderEmailHtml(base, opts);
    expect(html).toContain('href="https://app.tugympr.com/u/abc-123"');
    expect(html).not.toContain('href="#"');
    expect(html).toContain('Calle 1, San Juan PR');
  });

  it('omits the unsubscribe link entirely rather than emitting a dead one', () => {
    const html = renderEmailHtml(base, { ...opts, unsubscribeUrl: null });
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain('Cancelar suscripción');
  });

  it('drops the CTA when its label depends on a token that did not resolve', () => {
    const html = renderEmailHtml(
      { ...base, cta: { ...base.cta, text: 'Ver {{next_class_time}}' } }, opts);
    expect(html).not.toContain('border-radius:50px');
  });

  it('drops the hero block instead of painting an empty slab', () => {
    const withHero = renderEmailHtml(
      { ...base, hero: { enabled: true, imageUrl: '', headline: 'Hola {{first_name}}', subtitle: '' } },
      opts);
    const withoutHero = renderEmailHtml(
      { ...base, hero: { enabled: true, imageUrl: '', headline: 'A las {{next_class_time}}', subtitle: '' } },
      opts);
    // `hero-pad` lives in the <style> block too, so asserting on the class name
    // alone can never fail. The <h2> only exists when the hero actually paints.
    expect(withHero).toContain('<h2');
    expect(withoutHero).not.toContain('<h2');
  });

  it('escapes injected markup at every boundary', () => {
    const html = renderEmailHtml(base, {
      ...opts,
      values: { ...VALUES, first_name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects a non-https hero image rather than embedding it', () => {
    const html = renderEmailHtml(
      { ...base, hero: { enabled: true, imageUrl: 'http://evil.test/x.png', headline: 'Hola', subtitle: '' } },
      opts);
    expect(html).not.toContain('evil.test');
  });
});

// If the editor's block shape and the server renderer's expectations diverge,
// automated mail silently loses whole sections. Pin them together.
describe('block contract: editor shape ↔ server renderer', () => {
  it('dbRowToTemplate produces every block renderEmailHtml consumes', () => {
    const tpl = dbRowToTemplate({ id: 'x', name: 'n', template_type: 'winback', template_data: {} });
    for (const key of ['header', 'hero', 'body', 'cta', 'reward', 'footer', 'colors']) {
      expect(tpl).toHaveProperty(key);
    }
    // Rendering the editor's own defaults must not throw or emit placeholders.
    const html = renderEmailHtml(tpl, { gymName: 'G', values: {} });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('{{');
  });
});

describe('escHtml / safeColor', () => {
  it('escapes the five dangerous characters', () => {
    expect(escHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    expect(escHtml('')).toBe('');
    expect(escHtml(null)).toBe('');
  });

  it('falls back to black on anything that is not a hex colour', () => {
    expect(safeColor('#D4AF37')).toBe('#D4AF37');
    expect(safeColor('red')).toBe('#000000');
    expect(safeColor('expression(alert(1))')).toBe('#000000');
    expect(safeColor(null)).toBe('#000000');
  });
});

import { describe, it, expect } from 'vitest';
import { emailDoc } from '../admin/emailEngine';
import { templateToCfg } from '../admin/emailCfg';

/**
 * El panel "Avanzado" era decorativo.
 *
 * Sus controles se guardaban perfectamente y no los leía NADIE: `templateToCfg`
 * no mapeaba `typography.borderRadius` ni `typography.padding`, así que el motor
 * caía siempre al radio y al espaciado del preset. El admin escogía "Esquinas →
 * Rectas", la vista previa no se movía, guardaba, recargaba, el valor seguía
 * ahí, y el correo salía igual. La misma clase de bug que `preset`, girada:
 * antes se editaba y no se guardaba; esto se guardaba y no se leía.
 *
 * Estos tests existen para que "no pinta nada" vuelva a ser detectable.
 */
const base = {
  name: 'X',
  preset: 'editorial',
  header: { enabled: true, showLogo: true, text: 'Hola' },
  hero: { enabled: true, headline: 'Titular', subtitle: 'Bajada' },
  body: { text: 'Una línea.' },
  cta: { enabled: false },
  reward: { enabled: false },
  footer: { enabled: true, text: '© 2026' },
};
const render = (over) => emailDoc(templateToCfg({ ...base, ...over }, { lang: 'es', gymName: 'Fuerza 787' }));

describe('las esquinas', () => {
  it('actually change the rendered email', () => {
    expect(render({ typography: { borderRadius: '0' } }))
      .not.toBe(render({ typography: { borderRadius: '20' } }));
  });

  it('reach the engine as the radius it was given', () => {
    expect(render({ typography: { borderRadius: '20' } })).toContain('border-radius:20px');
    expect(render({ typography: { borderRadius: '0' } })).toContain('border-radius:0px');
  });

  // Sin valor manda el preset, que es lo que hace que escoger maqueta se note.
  it('fall back to the preset when the admin never touched them', () => {
    expect(render({})).toContain('border-radius:4px');   // editorial
  });
});

describe('el espaciado', () => {
  it('actually changes the rendered email', () => {
    expect(render({ density: 'compacto' })).not.toBe(render({ density: 'espacioso' }));
  });

  // Lo guardado por el editor viejo eran píxeles ('24'|'32'|'40'|'48'). Se
  // siguen entendiendo o toda plantilla anterior perdería su espaciado.
  it('still understands the pixel values the old panel saved', () => {
    expect(render({ typography: { padding: '24' } })).toBe(render({ density: 'compacto' }));
    expect(render({ typography: { padding: '48' } })).toBe(render({ density: 'espacioso' }));
    expect(render({ typography: { padding: '32' } })).toBe(render({ density: 'comodo' }));
  });

  it('prefers the explicit density over the legacy pixels', () => {
    expect(render({ density: 'espacioso', typography: { padding: '24' } }))
      .toBe(render({ density: 'espacioso' }));
  });
});

describe('el tamaño de letra, que era el único que ya funcionaba', () => {
  it('keeps working', () => {
    expect(render({ typography: { fontSize: '13' } })).not.toBe(render({ typography: { fontSize: '17' } }));
  });
});

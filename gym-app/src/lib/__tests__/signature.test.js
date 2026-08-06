import { describe, it, expect } from 'vitest';
import {
  strokeToPath, strokesAreValid, hasSignature, signatureSvgDocument, cropToInk,
} from '../admin/signature';

const line = (n) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 20 }));

describe('puntos → camino', () => {
  it('un trazo normal sale con curvas, no con rectas', () => {
    const d = strokeToPath(line(6));
    expect(d.startsWith('M')).toBe(true);
    // Si saliera con `L` entre todos los puntos, la firma se vería angulosa.
    expect(d).toContain('Q');
  });

  // Un `M` suelto no pinta NADA — ni en pantalla ni en la Cricut. Quien pone el
  // punto de una «i» de un toque no vería nada aparecer.
  it('un solo punto produce tinta, no un camino vacío', () => {
    const d = strokeToPath([{ x: 5, y: 5 }]);
    expect(d).toBe('M5 5l0.01 0');
    expect(d).not.toBe('M5 5');
  });

  it('dos puntos son un segmento', () => {
    expect(strokeToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0L10 10');
  });

  it('sin puntos no hay camino', () => {
    expect(strokeToPath([])).toBe('');
    expect(strokeToPath(null)).toBe('');
  });

  it('descarta coordenadas no finitas en vez de escribir NaN en el camino', () => {
    const d = strokeToPath([{ x: 0, y: 0 }, { x: NaN, y: 3 }, { x: 10, y: 10 }]);
    expect(d).not.toContain('NaN');
    expect(d.length).toBeGreaterThan(0);
  });

  it('redondea, para no guardar quince decimales por punto', () => {
    const d = strokeToPath([{ x: 1.23456, y: 2.34567 }, { x: 9.87654, y: 8.76543 }]);
    expect(d).toBe('M1.23 2.35L9.88 8.77');
  });
});

describe('la reja del contenido (espeja el CHECK de la 0702)', () => {
  it('acepta gramática de camino', () => {
    expect(strokesAreValid(['M10 40 C20 10, 40 10, 50 40'])).toBe(true);
    expect(strokesAreValid(null)).toBe(true);
    expect(strokesAreValid([])).toBe(true);
  });

  // Lo que la base rechaza, la pantalla tiene que rechazar ANTES — o el usuario
  // se come un 23514 crudo en vez de un aviso.
  it('rechaza cualquier cosa que no sea un camino', () => {
    expect(strokesAreValid(['<script>alert(1)</script>'])).toBe(false);
    expect(strokesAreValid(['M0 0" onload="x'])).toBe(false);
    expect(strokesAreValid(['url(#x)'])).toBe(false);
    expect(strokesAreValid([''])).toBe(false);
    expect(strokesAreValid(['   '])).toBe(false);
    expect(strokesAreValid([123])).toBe(false);
  });

  it('rechaza lo que pasa de los topes de la 0702', () => {
    expect(strokesAreValid(Array(201).fill('M0 0L1 1'))).toBe(false);
    expect(strokesAreValid(['M' + '0'.repeat(8000)])).toBe(false);
  });

  it('todo camino que genera strokeToPath pasa la reja', () => {
    expect(strokesAreValid([strokeToPath(line(12))])).toBe(true);
    expect(strokesAreValid([strokeToPath([{ x: 5, y: 5 }])])).toBe(true);
    expect(strokesAreValid([strokeToPath([{ x: -3.5, y: 0.25 }, { x: 4, y: 9 }])])).toBe(true);
  });
});

describe('¿hay firma?', () => {
  it('distingue sin firma de firma vacía', () => {
    expect(hasSignature(null)).toBe(false);
    expect(hasSignature({ strokes: [] })).toBe(false);
    expect(hasSignature({ strokes: ['M0 0L1 1'] })).toBe(true);
  });
});

describe('el SVG para la Cricut', () => {
  const svg = signatureSvgDocument({ strokes: ['M0 0L10 10'], width: 400, height: 140 });

  // Relleno = la máquina RECORTA la silueta. Contorno sin relleno = la DIBUJA.
  // Es la diferencia entre una firma y un agujero con forma de firma.
  it('sale con contorno y SIN relleno, o la Cricut recorta en vez de dibujar', () => {
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#000000"');
  });

  // Design Space importa un SVG sin unidades a un tamaño arbitrario.
  it('lleva medidas en milímetros y conserva la proporción', () => {
    expect(svg).toContain('width="60mm"');
    expect(svg).toContain('height="21mm"');   // 60 × 140/400
    expect(svg).toContain('viewBox="0 0 400 140"');
  });

  it('un trazo por <path>, para que el bolígrafo se levante entre ellos', () => {
    const two = signatureSvgDocument({ strokes: ['M0 0L1 1', 'M5 5L6 6'], width: 100, height: 50 });
    expect(two.match(/<path /g)).toHaveLength(2);
  });

  it('descarta trazos vacíos en vez de emitir un path sin d', () => {
    const s = signatureSvgDocument({ strokes: ['M0 0L1 1', '', '   '], width: 100, height: 50 });
    expect(s.match(/<path /g)).toHaveLength(1);
  });

  it('sobrevive a medidas ausentes', () => {
    const s = signatureSvgDocument({ strokes: ['M0 0L1 1'] });
    expect(s).toContain('viewBox="0 0 400 140"');
  });
});

describe('recortar al trazo', () => {
  // Sin esto, una firma hecha en una esquina se guarda con todo el lienzo
  // vacío alrededor y en la tarjeta sale minúscula en un rincón.
  it('mueve el dibujo al origen y ajusta la caja', () => {
    const out = cropToInk([[{ x: 100, y: 200 }, { x: 140, y: 220 }]], 10);
    expect(out.width).toBe(60);    // 40 de ancho + 10 de aire a cada lado
    expect(out.height).toBe(40);   // 20 de alto + 10 y 10
    expect(out.strokes[0]).toBe('M10 10L50 30');
  });

  it('sin tinta devuelve null, no una caja vacía', () => {
    expect(cropToInk([])).toBeNull();
    expect(cropToInk([[]])).toBeNull();
    expect(cropToInk(null)).toBeNull();
  });

  // Una firma de un solo toque tiene ancho cero antes del margen: sin el
  // mínimo, calcular la proporción sería una división por cero.
  it('nunca produce una caja de tamaño cero', () => {
    const out = cropToInk([[{ x: 50, y: 50 }]], 0);
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it('descarta trazos vacíos y conserva los demás', () => {
    const out = cropToInk([[{ x: 0, y: 0 }, { x: 10, y: 10 }], [], [{ x: 20, y: 20 }, { x: 30, y: 30 }]], 0);
    expect(out.strokes).toHaveLength(2);
  });

  it('lo que sale del recorte también pasa la reja', () => {
    const out = cropToInk([line(10).map((p) => ({ x: p.x + 300, y: p.y + 400 }))]);
    expect(strokesAreValid(out.strokes)).toBe(true);
  });
});

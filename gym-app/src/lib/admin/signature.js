/**
 * La firma del gimnasio: de puntos a trazos, y de trazos a un SVG.
 *
 * TODO ESTO ES PURO Y VIVE FUERA DEL COMPONENTE por dos razones. Una, el
 * entorno de pruebas del repo es `node` —sin jsdom— así que lo único que se
 * puede blindar de verdad es una función. Y dos, la más importante: el SVG que
 * se descarga para la Cricut y el que se pinta en la tarjeta TIENEN que salir
 * del mismo sitio. Si fueran dos implementaciones, la firma que la máquina
 * dibuja dejaría de ser la que el dueño vio en pantalla, y nadie lo notaría
 * hasta tener cien tarjetas hechas.
 */

/** Mismo alfabeto que el CHECK de la 0702. Duplicado a propósito: aquí avisa antes de guardar. */
const PATH_CHARS = /^[MmLlCcQqZzHhVvSsTt0-9eE.,+\- ]+$/;

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Puntos → un camino SVG con curvas.
 *
 * NO se unen los puntos con rectas. Una firma trazada con `L` sale angulosa —
 * se ve como un gráfico, no como una rúbrica— y encima pesa más, porque hacen
 * falta muchos más puntos para disimular las esquinas.
 *
 * El truco es el de siempre: la curva pasa POR LOS PUNTOS MEDIOS y usa cada
 * punto capturado como tirador de control. Eso suaviza el temblor del ratón sin
 * recortar el trazo, y da un camino continuo — que es justo lo que la Cricut
 * necesita para no levantar el bolígrafo a media letra.
 */
export function strokeToPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';

  const p = points.filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
  if (p.length === 0) return '';

  // Un solo punto es un toque: un punto de tinta, no una línea. Se dibuja como
  // un segmento mínimo porque un `M` suelto no pinta NADA — ni en pantalla ni
  // en la máquina — y el usuario que puso el punto de una «i» no vería nada.
  if (p.length === 1) return `M${r2(p[0].x)} ${r2(p[0].y)}l0.01 0`;
  if (p.length === 2) return `M${r2(p[0].x)} ${r2(p[0].y)}L${r2(p[1].x)} ${r2(p[1].y)}`;

  let d = `M${r2(p[0].x)} ${r2(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i].x + p[i + 1].x) / 2;
    const my = (p[i].y + p[i + 1].y) / 2;
    d += `Q${r2(p[i].x)} ${r2(p[i].y)} ${r2(mx)} ${r2(my)}`;
  }
  const last = p[p.length - 1];
  d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}

/** Espeja el CHECK de la 0702, para poder avisar en pantalla en vez de comerse un 23514. */
export function strokesAreValid(strokes) {
  if (strokes == null) return true;
  if (!Array.isArray(strokes) || strokes.length > 200) return false;
  return strokes.every(
    (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 8000 && PATH_CHARS.test(s),
  );
}

/** ¿Hay algo que enseñar? Un array vacío es «sin firma», no «firma vacía». */
export const hasSignature = (sig) =>
  !!sig && Array.isArray(sig.strokes) && sig.strokes.length > 0;

/**
 * El documento SVG que se descarga para Cricut Design Space.
 *
 * `fill="none"` y `stroke` NO son decoración: son la diferencia entre que la
 * máquina DIBUJE la firma y que RECORTE su silueta. Un camino relleno se
 * interpreta como una forma a cortar; uno con contorno y sin relleno es una
 * línea que el bolígrafo recorre.
 *
 * Y las medidas van en MILÍMETROS, no en píxeles: Design Space importa un SVG
 * sin unidades a un tamaño arbitrario, y una firma que entra midiendo veinte
 * centímetros hay que reescalarla a mano en cada proyecto.
 */
export function signatureSvgDocument({ strokes, width, height, widthMm = 60, strokeWidth = 2 }) {
  const list = Array.isArray(strokes) ? strokes.filter((s) => typeof s === 'string' && s.trim()) : [];
  const w = Number(width) > 0 ? Number(width) : 400;
  const h = Number(height) > 0 ? Number(height) : 140;
  const heightMm = r2((widthMm * h) / w);

  const paths = list
    .map((d) => `    <path d="${d}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${widthMm}mm" height="${heightMm}mm"
     viewBox="0 0 ${w} ${h}">
  <!-- Firma TuGymPR. Trazos abiertos para dibujar con bolígrafo, NO siluetas
       para recortar: en Cricut Design Space elige "Draw"/"Pen", no "Cut". -->
  <g fill="none" stroke="#000000" stroke-width="${strokeWidth}"
     stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>
</svg>
`;
}

/**
 * Recorta el lienzo a lo que se dibujó de verdad.
 *
 * Sin esto, una firma trazada en la esquina superior izquierda de un lienzo
 * ancho se guarda con todo el aire alrededor, y al pintarla en la tarjeta sale
 * diminuta en una esquina — parece un error de maquetación cuando en realidad
 * es el encuadre.
 *
 * Trabaja sobre los PUNTOS, no sobre las cadenas ya generadas: volver a leer un
 * camino para sacar su caja sería analizar SVG a mano, y aquí los puntos
 * todavía están a mano.
 */
export function cropToInk(strokePoints, pad = 8) {
  const all = (strokePoints || []).flat().filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (all.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const ox = minX - pad;
  const oy = minY - pad;
  // Un mínimo de 1 evita una caja de ancho cero en una firma de un solo toque,
  // que daría una división por cero al calcular la proporción.
  const width = Math.max(1, r2(maxX - minX + pad * 2));
  const height = Math.max(1, r2(maxY - minY + pad * 2));

  const moved = strokePoints
    .map((pts) => (pts || []).map((p) => ({ x: r2(p.x - ox), y: r2(p.y - oy) })))
    .filter((pts) => pts.length > 0);

  return { strokes: moved.map(strokeToPath).filter(Boolean), width, height };
}

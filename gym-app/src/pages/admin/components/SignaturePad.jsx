/**
 * SignaturePad — el dueño firma con el dedo o el ratón, una vez.
 *
 * Se dibuja sobre un <svg> y NO sobre un <canvas>, y eso es la decisión de todo
 * el componente: un canvas da PÍXELES, y de píxeles no sale una firma que la
 * Cricut pueda dibujar — habría que vectorizarla, y el autotrazado de una firma
 * devuelve el CONTORNO relleno de cada letra, así que la máquina dibujaría el
 * borde en hueco en vez del trazo. Dibujando en SVG los caminos ya existen.
 *
 * Todo lo que se puede probar vive en `lib/admin/signature.js`; aquí solo queda
 * el gesto.
 */
import { useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2, Trash2, Download, PenLine } from 'lucide-react';
import { strokeToPath, cropToInk, signatureSvgDocument, hasSignature } from '../../../lib/admin/signature';

const BOX_W = 620;
const BOX_H = 200;

export default function SignaturePad({ value, onChange, label }) {
  const { t } = useTranslation('pages');
  const svgRef = useRef(null);
  // Los puntos crudos, por trazo. Se conservan APARTE de los caminos ya
  // generados porque recortar al trazo necesita coordenadas, y sacarlas de
  // vuelta de una cadena `d` sería analizar SVG a mano.
  const [points, setPoints] = useState([]);
  // REF y no estado. `drawing` no pinta nada, y como estado introduce una
  // carrera: los `pointermove` que llegan ANTES de que React vuelva a
  // renderizar leen el valor viejo en la clausura del manejador y se descartan.
  // Con la mano lenta no se nota; con un trazo rápido se pierde el principio de
  // la rúbrica, que es justo la parte que la identifica.
  const drawingRef = useRef(false);

  // Lo que ya estaba guardado, para poder enseñarlo antes de que toque nada.
  const saved = hasSignature(value) ? value : null;
  const livePaths = useMemo(() => points.map(strokeToPath).filter(Boolean), [points]);
  const showingLive = points.length > 0;

  const toLocal = useCallback((e) => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Se escala del tamaño en pantalla al del viewBox: el recuadro es elástico
    // y sin esto la firma saldría desplazada en cuanto la ventana no midiera
    // exactamente BOX_W.
    return {
      x: ((e.clientX - r.left) / r.width) * BOX_W,
      y: ((e.clientY - r.top) / r.height) * BOX_H,
    };
  }, []);

  const emit = useCallback((allPoints) => {
    const cropped = cropToInk(allPoints);
    onChange(cropped ? { strokes: cropped.strokes, width: cropped.width, height: cropped.height } : null);
  }, [onChange]);

  const start = (e) => {
    const p = toLocal(e);
    if (!p) return;
    // Captura del puntero: sin esto, salirse del recuadro a media rúbrica corta
    // el trazo, y una firma es justamente un gesto que se sale.
    //
    // En try/catch porque `setPointerCapture` LANZA (NotFoundError) si el
    // puntero ya no está activo — pasa con un lápiz que se levanta entre el
    // evento y su manejo. Sin capturar, el trazo se corta al salir del
    // recuadro; con la excepción suelta, no se dibuja NADA.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* se firma igual, solo sin captura */ }
    drawingRef.current = true;
    setPoints((prev) => [...prev, [p]]);
  };

  const move = (e) => {
    if (!drawingRef.current) return;
    const p = toLocal(e);
    if (!p) return;
    setPoints((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      const cur = next[next.length - 1];
      const last = cur[cur.length - 1];
      // Se descartan los puntos que casi no se han movido. El puntero emite
      // decenas de eventos por segundo aunque la mano esté quieta, y guardarlos
      // todos engorda el camino sin cambiar la forma ni un pelo.
      if (last && Math.abs(p.x - last.x) < 1 && Math.abs(p.y - last.y) < 1) return prev;
      next[next.length - 1] = [...cur, p];
      return next;
    });
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setPoints((prev) => { emit(prev); return prev; });
  };

  const undo = () => {
    setPoints((prev) => { const next = prev.slice(0, -1); emit(next); return next; });
  };

  const clear = () => { setPoints([]); onChange(null); };

  const download = () => {
    const sig = showingLive
      ? { ...cropToInk(points), strokes: cropToInk(points)?.strokes || [] }
      : saved;
    if (!hasSignature(sig)) return;
    const svg = signatureSvgDocument({ strokes: sig.strokes, width: sig.width, height: sig.height });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'firma-tugympr.svg';
    a.click();
    // Sin el revoke, cada descarga se queda en memoria hasta recargar.
    URL.revokeObjectURL(url);
  };

  const canDownload = showingLive || hasSignature(saved);

  return (
    <div>
      {label && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--color-admin-text-muted)' }}>
          <PenLine size={12} /> {label}
        </p>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${BOX_W} ${BOX_H}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        // `touch-action: none` NO es opcional en móvil: sin él, arrastrar el
        // dedo hace scroll de la página y la firma sale como un garabato de dos
        // píxeles.
        style={{
          width: '100%', height: 'auto', display: 'block', touchAction: 'none', cursor: 'crosshair',
          background: 'var(--color-admin-panel)',
          border: '1px solid var(--color-admin-border)',
          borderRadius: 14,
        }}
      >
        {/* La raya de referencia, para que la firma no salga flotando */}
        <line x1={40} y1={BOX_H - 52} x2={BOX_W - 40} y2={BOX_H - 52}
          stroke="var(--color-admin-border)" strokeWidth={1} strokeDasharray="4 4" />

        <g fill="none" stroke="var(--color-admin-text)" strokeWidth={2.6}
          strokeLinecap="round" strokeLinejoin="round">
          {showingLive
            ? livePaths.map((d, i) => <path key={i} d={d} />)
            : saved && (
              // Lo guardado se pinta dentro de su PROPIA caja y centrado, o una
              // firma estrecha se estiraría a lo ancho del recuadro.
              <g transform={fitTransform(saved, BOX_W, BOX_H)}>
                {saved.strokes.map((d, i) => <path key={i} d={d} />)}
              </g>
            )}
        </g>

        {!showingLive && !saved && (
          <text x={BOX_W / 2} y={BOX_H / 2} textAnchor="middle"
            fill="var(--color-admin-text-muted)" fontSize={13} fontFamily="system-ui">
            {t('admin.settings.signatureHint', { defaultValue: 'Sign here with your finger or mouse' })}
          </text>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap gap-2">
        <PadBtn onClick={undo} disabled={points.length === 0} icon={<Undo2 size={13} />}
          text={t('admin.settings.signatureUndo', { defaultValue: 'Undo stroke' })} />
        <PadBtn onClick={clear} disabled={!showingLive && !saved} icon={<Trash2 size={13} />}
          text={t('admin.settings.signatureClear', { defaultValue: 'Clear' })} />
        <PadBtn onClick={download} disabled={!canDownload} icon={<Download size={13} />}
          text={t('admin.settings.signatureDownload', { defaultValue: 'Download SVG for Cricut' })} />
      </div>
    </div>
  );
}

/** Encaja la firma guardada en el recuadro sin deformarla. */
function fitTransform(sig, boxW, boxH) {
  const w = Number(sig.width) || 1;
  const h = Number(sig.height) || 1;
  // El menor de los dos factores: escalar por el mayor recortaría el trazo.
  const s = Math.min((boxW * 0.86) / w, (boxH * 0.7) / h);
  const tx = (boxW - w * s) / 2;
  const ty = (boxH - h * s) / 2;
  return `translate(${tx} ${ty}) scale(${s})`;
}

function PadBtn({ onClick, disabled, icon, text }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition"
      style={{
        background: 'var(--color-admin-panel)',
        border: '1px solid var(--color-admin-border)',
        color: disabled ? 'var(--color-admin-text-muted)' : 'var(--color-admin-text)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon} {text}
    </button>
  );
}

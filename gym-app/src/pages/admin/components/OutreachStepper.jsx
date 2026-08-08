// El compositor deja de ser un formulario largo y pasa a ser tres preguntas.
//
// Antes las tres decisiones —a quién, por dónde, qué— tenían el mismo peso
// visual, una debajo de otra, sin nada que dijera por dónde empezar ni cuánto
// faltaba. Se podía pulsar Enviar con el cuerpo vacío y enterarte por un aviso.
// Aquí cada paso enseña su respuesta actual y el pie dice qué falta ANTES de
// dejarte seguir.
import { Check, ChevronRight, ChevronLeft } from 'lucide-react';

export function OutreachStepper({ steps, step, furthest, onGo }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
      {steps.map((s) => {
        const now = step === s.n;
        const done = furthest >= s.n && !now;
        const reachable = s.n <= furthest;
        return (
          <button
            key={s.n}
            type="button"
            onClick={() => reachable && onGo(s.n)}
            disabled={!reachable}
            className="text-left px-3 py-2.5 rounded-xl transition-colors disabled:cursor-default"
            style={{
              background: now ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-deep)',
              border: `1px solid ${now ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              opacity: reachable ? 1 : 0.55,
            }}
          >
            <span className="flex items-center gap-2">
              <span
                className="w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0"
                style={{
                  background: now || done ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: now || done ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
                }}
              >
                {done ? <Check size={10} strokeWidth={3} /> : s.n}
              </span>
              <span className="text-[12.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{s.q}</span>
            </span>
            <span className="block text-[11.5px] mt-1 truncate pl-[26px]" style={{ color: now ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
              {s.answer}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pie de paso: atrás · el motivo por el que no puedes seguir · siguiente.
 * `block` es el texto de lo que falta; su sola presencia apaga el botón, así
 * que no hay forma de que digan cosas distintas.
 */
export function StepFooter({ step, block, nextLabel, nextIcon, hint, onBack, onNext }) {
  const NextIcon = nextIcon || ChevronRight;
  return (
    <div className="flex items-center gap-3 flex-wrap mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
      {step > 1 && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 h-[40px] rounded-xl text-[12.5px] font-semibold"
          style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
        >
          <ChevronLeft size={14} />
        </button>
      )}
      <span className="flex-1 min-w-[140px] text-[11.5px] leading-snug" style={{ color: block ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
        {block ? <b>{block}</b> : hint}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!!block}
        className="inline-flex items-center gap-2 px-4 h-[44px] rounded-xl text-[13.5px] font-bold transition-all disabled:cursor-not-allowed"
        style={{
          background: block ? 'var(--color-bg-hover)' : 'var(--color-accent)',
          color: block ? 'var(--color-text-muted)' : 'var(--color-text-on-accent)',
          boxShadow: block ? 'none' : '0 2px 10px color-mix(in srgb, var(--color-accent) 30%, transparent)',
        }}
      >
        {nextLabel} <NextIcon size={15} />
      </button>
    </div>
  );
}

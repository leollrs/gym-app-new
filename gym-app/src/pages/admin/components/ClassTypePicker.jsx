// «¿Qué clase es?» — el primer paso, y el que ahorra el resto.
//
// Antes el formulario abría con un campo de texto vacío y el admin tecleaba
// «Spinning», luego 45, luego 24, y luego bajaba a escoger la misma portada de
// spinning. Escoger el tipo hace las cuatro cosas de una vez.
//
// Reusa CLASS_COVERS, que ya era la lista de tipos con su icono y su degradado
// — no una lista paralela. Una sola definición de «qué tipos de clase existen».
import { CLASS_COVERS } from './CoverPreview';

export default function ClassTypePicker({ value, onPick, t }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      {CLASS_COVERS.map((c) => {
        const Icon = c.icon;
        const on = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick(on ? null : c)}
            aria-pressed={on}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl transition-all"
            style={{
              background: on ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-bg-deep)',
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
            }}
          >
            <span className="w-[30px] h-[30px] rounded-[9px] grid place-items-center flex-shrink-0" style={{ background: c.gradient }}>
              <Icon size={15} className="text-white/90" />
            </span>
            <span className="text-[10.5px] font-bold text-center leading-tight"
              style={{ color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
              {t(c.labelKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

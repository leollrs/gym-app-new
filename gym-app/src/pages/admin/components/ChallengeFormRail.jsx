// El panel derecho: cómo le llega el reto al socio, y qué estás repartiendo.
//
// El formulario viejo pedía puntos por puesto sin decir en ningún momento
// cuántos puntos salían del gimnasio en total. 500 + 300 + 150 son 950 puntos
// que alguien va a gastar en la tienda, y eso no aparecía por ninguna parte.
import { Calendar, Clock, Gift, Trophy, Check } from 'lucide-react';
import { endFromStart, typeMeta, isCompletion, metricUnit } from '../../../lib/admin/challengeConfig';

const MEDALS = [
  { bg: 'rgba(253,169,4,.16)', c: '#FDA904' },
  { bg: 'rgba(200,205,215,.14)', c: '#C8CDD7' },
  { bg: 'rgba(196,124,74,.16)', c: '#C47C4A' },
];

export default function ChallengeFormRail({
  form, cover, exerciseLabel, participantsLabel, rewards, t, lang,
}) {
  const meta = typeMeta(form.type);
  const completion = isCompletion(form);
  const end = endFromStart(form.start_date, form.days);
  const name = form.name.trim();
  // En competitivo el total es la suma de los tres puestos. En cumplimiento no
  // hay total: es lo que cobra CADA persona que llegue, y cuántas lleguen no se
  // sabe. Decir «500 puntos en juego» ahí sería mentir por lo bajo.
  const totalPoints = form.enableRewards ? rewards.reduce((a, r) => a + (Number(r.points) || 0), 0) : 0;
  const physical = form.enableRewards ? rewards.filter(r => r.prizeType !== 'none').length : 0;
  const fdate = (d) => (d ? d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

  // Cómo se gana, en una frase, con lo que hay puesto ahora mismo.
  const winLine = () => {
    if (!meta) return null;
    // En cumplimiento la frase la manda la META, no la métrica: es la condición
    // de victoria entera.
    if (isCompletion(form)) {
      return t('admin.challenges.railWinCompletion', {
        n: form.milestone_target || '—',
        unit: t(`admin.challenges.unit_${metricUnit(form)}`),
        defaultValue: 'Gana todo el que llegue a {{n}} {{unit}}.',
      });
    }
    if (form.type === 'milestone') {
      return t('admin.challenges.railWinClubCompetitive', 'Gana quien más sume entre esos levantamientos.');
    }
    if (form.type === 'specific_lift') {
      return t('admin.challenges.railWinLift', {
        ex: exerciseLabel || '—',
        defaultValue: 'Gana quien más acumule en {{ex}}.',
      });
    }
    if (form.type === 'team') {
      return t('admin.challenges.railWinTeam', {
        n: form.team_size || '—',
        defaultValue: 'Gana el equipo (de hasta {{n}}) que más sume entre sus miembros.',
      });
    }
    return t('admin.challenges.railWinSimple', {
      metric: t(`admin.challengeTypes.${form.type}`),
      defaultValue: 'Gana quien más acumule en {{metric}}.',
    });
  };

  const Icon = cover?.icon || Trophy;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '.1em' }}>
          {t('admin.challenges.railPreview', 'Así lo ven los miembros')}
        </p>
        <div className="rounded-2xl overflow-hidden" style={{
          border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)',
          opacity: name && meta ? 1 : 0.62,
        }}>
          <div className="relative grid place-items-center" style={{ height: 92, background: cover?.gradient || 'var(--color-admin-panel)' }}>
            <Icon size={26} style={{ color: 'rgba(255,255,255,.9)' }} />
            <span className="absolute bottom-2 left-3 text-[9.5px] font-extrabold uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,.85)', letterSpacing: '.09em' }}>
              {meta ? t(`admin.challengeTypes.${form.type}`) : t('admin.challenges.railPickType', 'Escoge un tipo')}
            </span>
          </div>
          <div className="p-3">
            <p className="text-[13.5px] font-extrabold leading-tight" style={{ color: name ? 'var(--color-admin-text)' : 'var(--color-admin-text-muted)' }}>
              {name || t('admin.challenges.railNamePlaceholder', 'Nombre del reto')}
            </p>
            {form.description.trim() && (
              <p className="text-[11.5px] mt-1 leading-snug line-clamp-2" style={{ color: 'var(--color-admin-text-muted)' }}>{form.description.trim()}</p>
            )}
            <div className="flex items-center gap-3.5 mt-2 text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
              <span className="inline-flex items-center gap-1.5"><Calendar size={12} /> {t('admin.challenges.railDays', { n: form.days, defaultValue: '{{n}} días' })}</span>
              <span className="inline-flex items-center gap-1.5"><Clock size={12} /> {fdate(end)}</span>
            </div>
            {meta && (
              <p className="text-[11.5px] mt-2 pt-2 leading-snug" style={{ borderTop: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
                {winLine()}
              </p>
            )}
            {form.enableRewards && rewards.length > 0 && (
              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                {rewards.map((r, i) => {
                  const hasPrize = r.prizeType !== 'none';
                  const pts = Number(r.points) || 0;
                  // Lo que se lleva, dicho como se lleva. Antes un puesto con
                  // premio físico y cero puntos salía «Solo puntos … 0 🎁»: las
                  // tres cosas a la vez y contradiciéndose. Manda el regalo; los
                  // puntos solo aparecen si de verdad hay puntos.
                  const label = hasPrize
                    ? (r.prizeLabel || t('admin.challenges.railPrizeTBD', 'Premio por definir'))
                    : t('admin.challenges.railPointsOnly', 'Solo puntos');
                  return (
                    <div key={r.place} className="flex items-center gap-2">
                      <span className="w-[18px] h-[18px] rounded-md grid place-items-center text-[9.5px] font-extrabold flex-shrink-0"
                        style={completion
                          ? { background: 'color-mix(in srgb, var(--color-success) 16%, transparent)', color: 'var(--color-success)' }
                          : { background: MEDALS[i]?.bg, color: MEDALS[i]?.c }}>
                        {completion ? <Check size={11} /> : i + 1}
                      </span>
                      {hasPrize && <Gift size={11} className="flex-shrink-0" style={{ color: 'var(--color-accent)' }} />}
                      <span className="text-[11.5px] truncate"
                        style={{ color: hasPrize ? 'var(--color-admin-text-sub)' : 'var(--color-admin-text-muted)' }}>
                        {label}
                      </span>
                      {pts > 0 && (
                        <span className="ml-auto text-[11.5px] font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--color-admin-text)' }}>
                          {hasPrize ? `+${pts}` : pts}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '.1em' }}>
          {t('admin.challenges.railSummary', 'Resumen')}
        </p>
        <div className="rounded-xl p-3" style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-admin-panel)' }}>
          <div className="flex items-end gap-2.5">
            <span className="text-[30px] font-extrabold leading-none tabular-nums"
              style={{ color: totalPoints ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }}>
              {totalPoints.toLocaleString(lang)}
            </span>
            <span className="text-[11.5px] leading-snug pb-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
              {completion
                ? t('admin.challenges.railPointsEach', 'puntos a cada uno que cumpla')
                : t('admin.challenges.railPointsAtStake', 'puntos máximos a repartir')}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            {[
              [t('admin.challenges.railWhoCan', 'Pueden participar'), participantsLabel],
              [t('admin.challenges.railPhysical', 'Premios físicos'), String(physical)],
              [t('admin.challenges.railStarts', 'Empieza'), fdate(form.start_date ? new Date(`${form.start_date}T12:00:00`) : null)],
              [t('admin.challenges.railEnds', 'Termina'), fdate(end)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span style={{ color: 'var(--color-admin-text-muted)' }}>{k}</span>
                <span className="font-bold text-right" style={{ color: 'var(--color-admin-text)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

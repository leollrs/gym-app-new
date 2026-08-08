// «¿Sirve de algo escribir?» — la pregunta que el A/B no puede contestar.
//
// El A/B compara MENSAJE A contra MENSAJE B, así que dice cuál de los dos
// funciona mejor. No dice si mandar alguno es mejor que no mandar ninguno,
// porque no hay nadie con quien comparar el silencio.
//
// El grupo de control (mig 0705) sí: a un % de los socios en riesgo no se les
// escribe, se registra igual la fila, y la detección de «volvió» —que mira
// actividad posterior sin importarle el brazo— hace la medición sola.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { AdminCard } from '../../../components/admin';
import { abSignificance } from '../../../lib/admin/abTestingHelpers';

const rate = (n, d) => (d > 0 ? (n / d) * 100 : 0);

function Arm({ label, stat, pct, tone, t }) {
  return (
    <div className="flex-1 min-w-[130px]">
      <p className="text-[11px] mb-1" style={{ color: 'var(--color-admin-text-faint)' }}>{label}</p>
      <p className="text-[26px] font-extrabold leading-none tabular-nums" style={{ color: tone }}>
        {pct.toFixed(0)}%
      </p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>
        {t('admin.holdout.ofN', { returned: stat.returned, total: stat.sent, defaultValue: '{{returned}} de {{total}} volvieron' })}
      </p>
    </div>
  );
}

export default function HoldoutCard({ attempts = [] }) {
  const { t } = useTranslation('pages');

  const stats = useMemo(() => {
    const held = attempts.filter((a) => a.variant === 'holdout');
    if (held.length === 0) return null;
    const sent = attempts.filter((a) => a.variant !== 'holdout');
    const mk = (rows) => ({
      sent: rows.length,
      responded: rows.filter((a) => a.responded_at != null).length,
      returned: rows.filter((a) => a.outcome === 'returned').length,
    });
    return { held: mk(held), sent: mk(sent) };
  }, [attempts]);

  // Sin control configurado no hay tarjeta. Un cero no dice nada; la ausencia
  // de la tarjeta la explica el ajuste de seguimiento, que es donde se enciende.
  if (!stats) return null;

  const rHeld = rate(stats.held.returned, stats.held.sent);
  const rSent = rate(stats.sent.returned, stats.sent.sent);
  const lift = rSent - rHeld;

  // Mismo test de dos proporciones que usa el A/B — «A» = contactados.
  const sig = abSignificance(stats.sent, stats.held, 'return');

  return (
    <AdminCard padding="p-4" className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical size={14} style={{ color: 'var(--color-accent)' }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.holdout.title', '¿Sirve escribirles?')}
        </span>
      </div>

      <div className="flex flex-wrap gap-5">
        <Arm t={t}
          label={t('admin.holdout.contacted', 'Se les escribió')}
          stat={stats.sent} pct={rSent} tone="var(--color-accent)"
        />
        <Arm t={t}
          label={t('admin.holdout.silent', 'No se les escribió')}
          stat={stats.held} pct={rHeld} tone="var(--color-admin-text-muted)"
        />
      </div>

      <p className="text-[12px] mt-3 pt-3 leading-relaxed" style={{ borderTop: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-muted)' }}>
        {sig.requiresMoreData
          ? t('admin.holdout.needMore', {
            n: sig.perArmSize,
            defaultValue: 'Todavía no se puede concluir nada: hacen falta al menos 30 socios en cada grupo y el más pequeño va por {{n}}.',
          })
          : sig.significant || sig.marginal
            ? t('admin.holdout.verdict', {
              lift: Math.abs(lift).toFixed(0),
              dir: lift >= 0 ? t('admin.holdout.more', 'más') : t('admin.holdout.less', 'menos'),
              defaultValue: 'Los que reciben el seguimiento vuelven un {{lift}}% {{dir}}. La diferencia es real, no ruido.',
            })
            : t('admin.holdout.noDiff', 'Con los datos de ahora, escribir y no escribir dan lo mismo. O el mensaje no mueve la aguja, o hace falta más muestra.')}
      </p>
    </AdminCard>
  );
}

// «¡TE GANASTE ESTOS PUNTOS!»
//
// Hasta ahora un reto terminaba, el cron lo cerraba, se notificaba a todo el
// mundo… y el que ganaba se enteraba —si acaso— por un push que quizá tenía
// apagado. Los puntos aparecían en su saldo sin ceremonia ninguna.
//
// El orgullo es la mitad del producto: si ganar no se siente, el reto siguiente
// no lo juega nadie. Esto es lo primero que ve al abrir Retos después de que se
// reparta.
//
// Se apoya solo en `challenge_prizes`, que es la fila que el servidor escribe al
// repartir (migración 0707). No hace falta ninguna columna de «visto»: lo visto
// se guarda aquí, en el dispositivo, porque es una celebración y no un recibo —
// el recibo vive en Recompensas con su QR.
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Trophy, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Confetti from './Confetti';

const SEEN_KEY = 'challengePrizesCelebrated';

const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); }
};
const markSeen = (ids) => {
  try {
    const all = [...readSeen(), ...ids];
    // Se recorta para que la lista no crezca sin fin en un socio de años.
    localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-60)));
  } catch { /* modo privado */ }
};

export default function ChallengePrizeCelebration({ userId, t, lang }) {
  const [prize, setPrize] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;

    (async () => {
      const { data } = await supabase
        .from('challenge_prizes')
        .select('id, placement, reward_type, reward_label, points_awarded, qr_code, created_at, challenge:challenges(name)')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!alive || !data?.length) return;

      const seen = readSeen();
      // Solo lo reciente: reaparecer con un premio de hace tres meses porque
      // alguien limpió el almacenamiento no es una celebración, es un susto.
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const fresh = data.find(p =>
        !seen.has(p.id) && new Date(p.created_at).getTime() > cutoff);
      if (fresh) setPrize(fresh);
    })();

    return () => { alive = false; };
  }, [userId]);

  const close = useCallback(() => {
    if (prize) markSeen([prize.id]);
    setPrize(null);
  }, [prize]);

  useEffect(() => {
    if (!prize) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [prize, close]);

  if (!prize) return null;

  const pts = Number(prize.points_awarded) || 0;
  const physical = prize.reward_type !== 'points' && prize.qr_code;

  return createPortal(
    <>
      <Confetti />
      <div className="fixed inset-0 z-[130] flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
        role="dialog" aria-modal="true" onClick={close}>
        <div className="relative w-full max-w-[380px] rounded-3xl overflow-hidden text-center"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
          onClick={e => e.stopPropagation()}>
          <button type="button" onClick={close} aria-label={t('common:close', 'Cerrar')}
            className="absolute top-4 right-4 p-2 rounded-full"
            style={{ color: 'var(--color-text-muted)' }}><X size={18} /></button>

          <div className="pt-8 pb-6 px-6">
            <div className="w-16 h-16 rounded-full grid place-items-center mx-auto mb-4"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}>
              <Trophy size={30} style={{ color: 'var(--color-accent)' }} />
            </div>

            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] mb-1.5"
              style={{ color: 'var(--color-accent)' }}>
              {prize.placement
                ? t('challenges.prize.placed', { n: prize.placement, defaultValue: 'Quedaste #{{n}}' })
                : t('challenges.prize.youDidIt', 'Lo lograste')}
            </p>

            <h2 className="text-[22px] font-extrabold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
              {prize.challenge?.name || t('challenges.prize.aChallenge', 'Reto completado')}
            </h2>

            {pts > 0 && (
              <div className="mt-5">
                <p className="text-[44px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--color-accent)' }}>
                  +{pts.toLocaleString(lang)}
                </p>
                <p className="text-[12.5px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('challenges.prize.pointsEarned', 'puntos para gastar en la tienda')}
                </p>
              </div>
            )}

            {physical && (
              <div className="mt-5">
                <p className="text-[13px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {prize.reward_label}
                </p>
                <div className="bg-white rounded-2xl p-4 inline-block">
                  <QRCodeSVG value={prize.qr_code} size={124} level="M" />
                </div>
                <p className="text-[11.5px] mt-2 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                  {t('challenges.prize.showAtDesk', 'Enséñalo en el mostrador para reclamarlo.')}
                </p>
              </div>
            )}
          </div>

          <div className="px-6 pb-6">
            <button type="button" onClick={close}
              className="w-full py-3.5 rounded-xl text-[14px] font-extrabold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}>
              {t('challenges.prize.nice', '¡Vamos!')}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

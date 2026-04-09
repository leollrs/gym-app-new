import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, CheckCircle, QrCode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { addPoints } from '../lib/rewardsEngine';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import QRCodeModal from '../components/QRCodeModal';

const getMethodLabels = (t) => ({ manual: t('checkIn.manual'), qr: t('checkIn.qrScan'), gps: t('checkIn.gps') });
const METHOD_COLORS = { manual: 'var(--color-text-muted)', qr: 'var(--color-accent)', gps: 'var(--color-success)' };

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CheckIn() {
  const navigate  = useNavigate();
  const { user, profile, gymName, gymConfig } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  const [checkins,  setCheckins]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showQR,    setShowQR]    = useState(false);

  const qrPayload = profile?.qr_code_payload || null;

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('check_ins')
      .select('id, checked_in_at, method')
      .eq('profile_id', user.id)
      .order('checked_in_at', { ascending: false })
      .limit(50);
    setCheckins(data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.title = `${t('checkIn.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Already checked in today?
  const todayCheckIn = checkins.find(c => isToday(new Date(c.checked_in_at)));

  // ── Streak (from streak_cache — same source as Navigation) ──────────────────
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    if (!user) return;
    supabase
      .from('streak_cache')
      .select('current_streak_days')
      .eq('profile_id', user.id)
      .maybeSingle()
      .then(({ data }) => setStreak(data?.current_streak_days || 0));
  }, [user]);

  // ── Group history by date label ──────────────────────────────────────────────
  const grouped = useMemo(() => checkins.reduce((acc, c) => {
    const d   = new Date(c.checked_in_at);
    const key = isToday(d) ? t('checkIn.today') : isYesterday(d) ? t('checkIn.yesterday') : format(d, 'MMMM d, yyyy');
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {}), [checkins, t]);

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div>
          <h1 className="text-[22px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('checkIn.title')}</h1>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('checkIn.subtitle')}</p>
        </div>
      </div>

      {/* ── QR Check-in ──────────────────────────────────────────────────── */}
      <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden p-5 mb-5 flex flex-col items-center text-center">

        {todayCheckIn ? (
          <>
            <div
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5"
              style={{ background: 'rgba(16,185,129,0.12)', border: '3px solid rgba(16,185,129,0.4)' }}
            >
              <CheckCircle size={44} style={{ color: 'var(--color-success)' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold text-[#10B981]">{t('checkIn.checkedIn')}</p>
            </div>
            <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>{t('checkIn.youreIn')}</p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              Checked in at {format(new Date(todayCheckIn.checked_in_at), 'h:mm a')}
            </p>
          </>
        ) : (
          <>
            {/* QR Code button */}
            <button
              onClick={() => setShowQR(true)}
              aria-label="Show QR code for check-in"
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5 transition-all duration-300 active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '3px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              }}
            >
              <QrCode size={44} style={{ color: 'var(--color-accent)' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold text-[#D4AF37]">{t('checkIn.showQR')}</p>
            </button>
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('checkIn.showQRInstruction')}
            </p>
          </>
        )}

        {/* Streak */}
        <div
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
        >
          <span className="text-[22px] font-black text-[#D4AF37] tabular-nums">{streak}</span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {streak !== 1 ? t('checkIn.daysStreak') : t('checkIn.dayStreak')}
          </span>
        </div>
      </div>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : checkins.length === 0 ? (
        <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] py-12 text-center">
          <MapPin size={28} style={{ color: 'var(--color-text-muted)', margin: '0 auto 12px' }} strokeWidth={1.5} />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('checkIn.noCheckInsYet')}</p>
        </div>
      ) : (
        <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden">
          <p className="text-[14px] font-semibold px-5 pt-4 pb-2" style={{ color: 'var(--color-text-muted)' }}>{t('checkIn.history')}</p>
          <div className="divide-y divide-white/[0.06]">
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-bold uppercase tracking-widest px-5 py-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {label}
                </p>
                {items.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.06] transition-colors duration-200">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${METHOD_COLORS[c.method] ?? 'var(--color-text-muted)'}18` }}
                    >
                      <MapPin size={14} style={{ color: METHOD_COLORS[c.method] ?? 'var(--color-text-muted)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {format(new Date(c.checked_in_at), 'h:mm a')}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {t(`checkIn.methods.${c.method}`) ?? c.method}
                      </p>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                      {formatDistanceToNow(new Date(c.checked_in_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QR Code Modal — portaled to body so fixed positioning isn't broken by parent transforms */}
      {showQR && createPortal(
        <QRCodeModal
          payload={qrPayload}
          memberName={profile?.full_name}
          displayFormat={gymConfig?.qrDisplayFormat}
          gymName={gymName}
          onClose={() => setShowQR(false)}
        />,
        document.body
      )}
    </div>
  );
}

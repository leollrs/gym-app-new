import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, CheckCircle, QrCode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { addPoints } from '../lib/rewardsEngine';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import QRCodeModal from '../components/QRCodeModal';

const METHOD_LABELS = { manual: 'Manual', qr: 'QR Scan', gps: 'GPS' };
const METHOD_COLORS = { manual: '#9CA3AF', qr: '#D4AF37', gps: '#10B981' };

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CheckIn() {
  const navigate  = useNavigate();
  const { user, profile, gymName, gymConfig } = useAuth();
  const { showToast } = useToast();

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

  // Already checked in today?
  const todayCheckIn = checkins.find(c => isToday(new Date(c.checked_in_at)));

  // ── Streak ──────────────────────────────────────────────────────────────────
  const streak = (() => {
    const dateSets = new Set(checkins.map(c => format(new Date(c.checked_in_at), 'yyyy-MM-dd')));
    let s = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = format(d, 'yyyy-MM-dd');
      if (dateSets.has(key)) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  // ── Group history by date label ──────────────────────────────────────────────
  const grouped = checkins.reduce((acc, c) => {
    const d   = new Date(c.checked_in_at);
    const key = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  return (
    <div className="mx-auto w-full max-w-[680px] md:max-w-4xl px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06]"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div>
          <h1 className="text-[28px] font-bold text-[#E5E7EB]">Check In</h1>
          <p className="text-[12px] text-[#9CA3AF]">Scan your QR code at the gym</p>
        </div>
      </div>

      {/* ── QR Check-in ──────────────────────────────────────────────────── */}
      <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] p-5 mb-5 flex flex-col items-center text-center">

        {todayCheckIn ? (
          <>
            <div
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5"
              style={{ background: 'rgba(16,185,129,0.12)', border: '3px solid rgba(16,185,129,0.4)' }}
            >
              <CheckCircle size={44} style={{ color: '#10B981' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold text-[#10B981]">Checked In</p>
            </div>
            <p className="text-[15px] font-bold text-[#E5E7EB] mb-1">You're in!</p>
            <p className="text-[12px] text-[#9CA3AF]">
              Checked in at {format(new Date(todayCheckIn.checked_in_at), 'h:mm a')}
            </p>
          </>
        ) : (
          <>
            {/* QR Code button */}
            <button
              onClick={() => setShowQR(true)}
              className="w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 mb-5 transition-all duration-300 active:scale-95"
              style={{
                background: 'rgba(212,175,55,0.1)',
                border: '3px solid rgba(212,175,55,0.3)',
              }}
            >
              <QrCode size={44} style={{ color: '#D4AF37' }} strokeWidth={1.5} />
              <p className="text-[13px] font-bold text-[#D4AF37]">Show QR</p>
            </button>
            <p className="text-[13px] text-[#9CA3AF]">
              Show your QR code to check in at the gym
            </p>
          </>
        )}

        {/* Streak */}
        <div
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full"
          style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.15)' }}
        >
          <span className="text-[22px] font-black text-[#D4AF37] tabular-nums">{streak}</span>
          <span className="text-[13px] font-semibold text-[#9CA3AF]">
            day{streak !== 1 ? 's' : ''} streak
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
          <MapPin size={28} style={{ color: '#4B5563', margin: '0 auto 12px' }} strokeWidth={1.5} />
          <p className="text-[13px] text-[#9CA3AF]">No check-ins yet</p>
        </div>
      ) : (
        <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden">
          <p className="text-[14px] font-semibold px-5 pt-4 pb-2 text-[#9CA3AF]">History</p>
          <div className="divide-y divide-white/[0.06]">
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-bold uppercase tracking-widest px-5 py-2 text-[#6B7280]">
                  {label}
                </p>
                {items.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.06] transition-colors duration-200">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${METHOD_COLORS[c.method] ?? '#9CA3AF'}18` }}
                    >
                      <MapPin size={14} style={{ color: METHOD_COLORS[c.method] ?? '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">
                        {format(new Date(c.checked_in_at), 'h:mm a')}
                      </p>
                      <p className="text-[11px] text-[#9CA3AF]">
                        {METHOD_LABELS[c.method] ?? c.method}
                      </p>
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {formatDistanceToNow(new Date(c.checked_in_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQR && (
        <QRCodeModal
          payload={qrPayload}
          memberName={profile?.full_name}
          displayFormat={gymConfig?.qrDisplayFormat}
          gymName={gymName}
          onClose={() => setShowQR(false)}
        />
      )}
    </div>
  );
}

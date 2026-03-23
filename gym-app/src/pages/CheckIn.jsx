import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, CheckCircle, Clock, Navigation, QrCode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { addPoints } from '../lib/rewardsEngine';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import QRCodeModal from '../components/QRCodeModal';

const METHOD_LABELS = { manual: 'Manual', qr: 'QR Scan', gps: 'GPS' };
const METHOD_COLORS = { manual: '#9CA3AF', qr: '#D4AF37', gps: '#10B981' };

const GPS_RADIUS_METERS = 200;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CheckIn() {
  const navigate  = useNavigate();
  const { user, profile, gymName, gymConfig } = useAuth();
  const { showToast } = useToast();

  const [checkins,  setCheckins]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [checking,  setChecking]  = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error,     setError]     = useState('');
  const [gpsStatus, setGpsStatus] = useState(''); // '', 'locating', 'success', 'error'
  const [showQR,    setShowQR]    = useState(false);

  const qrPayload = gymConfig?.qrEnabled ? profile?.qr_code_payload : null;

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

  const handleCheckIn = async () => {
    if (todayCheckIn) return;
    setChecking(true);
    setError('');
    const { error: err } = await supabase.from('check_ins').insert({
      profile_id:    user.id,
      gym_id:        profile.gym_id,
      method:        'manual',
      checked_in_at: new Date().toISOString(),
    });
    if (err) { setError(err.message); setChecking(false); showToast(err.message, 'error'); return; }
    addPoints(user.id, profile.gym_id, 'check_in', 20, 'Gym check-in').catch(() => {});
    supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', user.id);
    setConfirmed(true);
    showToast('Checked in — +20 pts!', 'success');
    await load();
    setChecking(false);
    setTimeout(() => setConfirmed(false), 3000);
  };

  const handleGPSCheckIn = async () => {
    if (todayCheckIn) return;
    setGpsStatus('locating');
    setError('');
    try {
      let position;
      if (Capacitor.isNativePlatform()) {
        position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      } else {
        position = await getBrowserPosition();
      }
      const userLat = position.coords.latitude;
      const userLon = position.coords.longitude;

      // Gym location: prefer gym record coords, fall back to profile, then null
      const gymLat = profile?.gym?.latitude ?? profile?.gym?.lat ?? null;
      const gymLon = profile?.gym?.longitude ?? profile?.gym?.lng ?? profile?.gym?.lon ?? null;

      if (gymLat == null || gymLon == null) {
        setGpsStatus('error');
        setError('Gym location is not configured. Please use manual check-in.');
        showToast('Gym location not configured', 'error');
        return;
      }

      const distance = haversineMeters(userLat, userLon, gymLat, gymLon);

      if (distance > GPS_RADIUS_METERS) {
        setGpsStatus('error');
        setError("You don't appear to be at the gym");
        showToast("You don't appear to be at the gym", 'error');
        return;
      }

      // Within radius — perform check-in
      setChecking(true);
      const { error: err } = await supabase.from('check_ins').insert({
        profile_id:    user.id,
        gym_id:        profile.gym_id,
        method:        'gps',
        checked_in_at: new Date().toISOString(),
      });
      if (err) { setError(err.message); setChecking(false); setGpsStatus('error'); showToast(err.message, 'error'); return; }
      addPoints(user.id, profile.gym_id, 'check_in', 20, 'Gym check-in').catch(() => {});
      supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', user.id);
      setGpsStatus('success');
      setConfirmed(true);
      showToast('GPS check-in — +20 pts!', 'success');
      await load();
      setChecking(false);
      setTimeout(() => { setConfirmed(false); setGpsStatus(''); }, 3000);
    } catch (err) {
      setGpsStatus('error');
      const msg = err?.message || 'Unable to get your location';
      setError(msg);
      showToast(msg, 'error');
    }
  };

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
    <div className="mx-auto w-full max-w-[600px] md:max-w-3xl px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-[#0F172A] border border-white/6"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold text-[#E5E7EB]">Check In</h1>
          <p className="text-[12px] text-[#9CA3AF]">Log your gym visit</p>
        </div>
      </div>

      {/* ── Check-in button ──────────────────────────────────────────────────── */}
      <div className="bg-[#0F172A] rounded-2xl border border-white/8 p-6 mb-5 flex flex-col items-center text-center">
        {/* Big check-in button */}
        <button
          onClick={handleCheckIn}
          disabled={checking || !!todayCheckIn}
          className="relative w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 transition-all duration-300 mb-5 active:scale-95"
          style={
            todayCheckIn
              ? { background: 'rgba(16,185,129,0.12)', border: '3px solid rgba(16,185,129,0.4)', cursor: 'default' }
              : confirmed
              ? { background: 'rgba(212,175,55,0.2)', border: '3px solid rgba(212,175,55,0.6)', boxShadow: '0 0 40px rgba(212,175,55,0.3)' }
              : { background: 'rgba(212,175,55,0.1)', border: '3px solid rgba(212,175,55,0.3)' }
          }
        >
          {checking ? (
            <div className="w-10 h-10 border-3 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          ) : todayCheckIn ? (
            <CheckCircle size={44} style={{ color: '#10B981' }} strokeWidth={1.5} />
          ) : (
            <MapPin size={44} style={{ color: '#D4AF37' }} strokeWidth={1.5} />
          )}
          <p
            className="text-[13px] font-bold"
            style={{ color: todayCheckIn ? '#10B981' : '#D4AF37' }}
          >
            {todayCheckIn ? 'Checked In' : 'Check In'}
          </p>
        </button>

        {todayCheckIn ? (
          <div>
            <p className="text-[15px] font-bold text-[#E5E7EB] mb-1">You're in!</p>
            <p className="text-[12px] text-[#9CA3AF]">
              Checked in at {format(new Date(todayCheckIn.checked_in_at), 'h:mm a')}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[#9CA3AF]">
            Tap to log today's gym visit
          </p>
        )}

        {/* Alternative check-in methods */}
        {!todayCheckIn && (
          <>
            <div className="flex items-center gap-3 w-full my-4">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-[12px] text-[#6B7280] font-medium">or</span>
              <div className="flex-1 h-px bg-white/8" />
            </div>
            <div className="flex gap-2 w-full">
              {/* QR Code button */}
              {qrPayload && (
                <button
                  onClick={() => setShowQR(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full transition-all duration-200 active:scale-95"
                  style={{
                    border: '1.5px solid rgba(212,175,55,0.4)',
                    background: 'rgba(212,175,55,0.06)',
                  }}
                >
                  <QrCode size={16} style={{ color: '#D4AF37' }} />
                  <span className="text-[13px] font-semibold text-[#D4AF37]">Show QR</span>
                </button>
              )}
              {/* GPS button */}
              <button
                onClick={handleGPSCheckIn}
                disabled={checking || gpsStatus === 'locating'}
                className={`${qrPayload ? 'flex-1' : ''} flex items-center justify-center gap-2 px-4 py-2.5 rounded-full transition-all duration-200 active:scale-95`}
                style={{
                  border: '1.5px solid rgba(212,175,55,0.4)',
                  background: gpsStatus === 'locating' ? 'rgba(212,175,55,0.08)' : 'transparent',
                  opacity: checking ? 0.5 : 1,
                }}
              >
                {gpsStatus === 'locating' ? (
                  <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                ) : (
                  <Navigation size={16} style={{ color: '#D4AF37' }} />
                )}
                <span className="text-[13px] font-semibold text-[#D4AF37]">
                  {gpsStatus === 'locating' ? 'Locating...' : 'GPS'}
                </span>
              </button>
            </div>
          </>
        )}

        {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}

        {/* Streak */}
        <div
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full"
          style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.15)' }}
        >
          <span className="text-[22px] font-black text-[#D4AF37]">{streak}</span>
          <span className="text-[13px] font-semibold text-[#9CA3AF]">
            day{streak !== 1 ? 's' : ''} streak
          </span>
        </div>
      </div>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : checkins.length === 0 ? (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 py-12 text-center">
          <MapPin size={28} style={{ color: '#4B5563', margin: '0 auto 12px' }} strokeWidth={1.5} />
          <p className="text-[13px] text-[#9CA3AF]">No check-ins yet</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 overflow-hidden">
          <p className="text-[13px] font-semibold px-5 pt-4 pb-2 text-[#9CA3AF]">History</p>
          <div className="divide-y divide-white/4">
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-bold uppercase tracking-widest px-5 py-2 text-[#6B7280]">
                  {label}
                </p>
                {items.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.03] transition-all">
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

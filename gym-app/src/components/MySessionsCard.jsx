import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Compact "Training sessions" entry card for the member Profile — shows the
 * total prepaid sessions the member has left with their trainer and taps
 * through to /sessions (the full wallet). Renders null unless there's at least
 * one non-expired active pack with sessions remaining. Self-contained: reads the
 * member's own session_packs (RLS: client_id = auth.uid()).
 */
export default function MySessionsCard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const id = profile?.id;
    if (!id) return;
    let alive = true;
    (async () => {
      // select('*') so it survives before/after 0642 (expires_at may not exist).
      const { data, error } = await supabase
        .from('session_packs')
        .select('*')
        .eq('client_id', id)
        .eq('is_active', true);
      if (!alive) return;
      if (error) {
        if (error.code !== '42P01' && error.code !== 'PGRST205') logger.error('MySessionsCard: load failed', error);
        return;
      }
      const today = localToday();
      let l = 0;
      (data || []).forEach((p) => {
        if (p.expires_at && p.expires_at < today) return; // expired → not counted
        l += Math.max(0, (Number(p.sessions_total) || 0) - Math.max(0, Number(p.sessions_used) || 0));
      });
      setLeft(l);
    })();
    return () => { alive = false; };
  }, [profile?.id]);

  if (left <= 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/sessions')}
      className="w-full flex items-center gap-3.5 p-4 mb-4 rounded-2xl border border-[var(--color-accent)]/25 bg-gradient-to-r from-[var(--color-accent)]/10 to-[var(--color-accent)]/5 active:scale-[0.98] transition-all duration-200"
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}>
        <Package size={20} style={{ color: 'var(--color-accent)' }} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {t('sessions.title', 'Training Sessions')}
        </p>
        <p className="text-[12px] mt-0.5 font-semibold" style={{ color: 'var(--color-accent)' }}>
          {t('sessions.leftCount', '{{count}} session left', { count: left })}
        </p>
      </div>
      <ChevronRight size={18} className="flex-shrink-0" style={{ color: 'color-mix(in srgb, var(--color-accent) 55%, transparent)' }} />
    </button>
  );
}

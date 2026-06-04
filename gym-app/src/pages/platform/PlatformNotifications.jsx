import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import {
  Bell, AlertTriangle, Bug, Megaphone, Server, CheckCheck, X, Inbox,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications, useInvalidate } from '../../hooks/useSupabaseQuery';
import logger from '../../lib/logger';
import { sanitize } from '../../lib/sanitize';
import PlatformSpinner from '../../components/platform/PlatformSpinner';
import AdminPagination from '../../components/admin/AdminPagination';

const PAGE_SIZE = 6;

// Platform notifications are mostly crash alerts (type 'system_alert'). Map the
// handful of types that can land here to an icon + accent colour.
const TYPE_META = {
  system_alert: { icon: AlertTriangle, color: '#EF4444' },
  system:       { icon: Server,        color: '#9CA3AF' },
  announcement: { icon: Megaphone,     color: '#D4AF37' },
  daily_digest: { icon: Bug,           color: '#D4AF37' },
};
const metaFor = (type) => TYPE_META[type] || { icon: Bell, color: '#9CA3AF' };

export default function PlatformNotifications() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user, refreshAdminNotifications } = useAuth();
  const { data: queryItems, isLoading } = useNotifications(user?.id, 'admin');
  const { invalidateNotifications } = useInvalidate();

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [marking, setMarking] = useState(false);

  useEffect(() => { document.title = `${t('platform.notifications.title', 'Alerts')} | TuGymPR`; }, [t]);
  useEffect(() => { if (queryItems) setItems(queryItems); }, [queryItems]);

  // Live-append new alerts targeted at this super admin.
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel('platform-notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${user.id}`,
      }, (payload) => {
        const aud = payload.new?.audience;
        if (aud === 'super_admin' || aud === 'admin') {
          setItems(prev => [payload.new, ...prev].slice(0, 200));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const unreadCount = items.filter(n => !n.read_at).length;

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [items, safePage],
  );
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [page, pageCount]);

  const afterMutation = useCallback(() => {
    if (user?.id) invalidateNotifications(user.id);
    refreshAdminNotifications?.();
  }, [user?.id, invalidateNotifications, refreshAdminNotifications]);

  const markRead = useCallback(async (id) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n));
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (error) {
      logger.error('PlatformNotifications: markRead failed:', error);
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: null } : n));
    }
    afterMutation();
  }, [afterMutation]);

  const markAllRead = useCallback(async () => {
    if (!unreadCount || !user?.id) return;
    setMarking(true);
    const now = new Date().toISOString();
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id);
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('profile_id', user.id)
      .in('audience', ['admin', 'super_admin'])
      .is('read_at', null);
    if (error) {
      logger.error('PlatformNotifications: markAllRead failed:', error);
      setItems(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: null } : n));
    }
    afterMutation();
    setMarking(false);
  }, [unreadCount, user?.id, items, afterMutation]);

  const dismiss = useCallback(async (id) => {
    const snapshot = items;
    setItems(prev => prev.filter(n => n.id !== id));
    let { error } = await supabase
      .from('notifications')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id);
    if (error && /dismissed_at/i.test(error.message || '')) {
      ({ error } = await supabase.from('notifications').delete().eq('id', id));
    }
    if (error) {
      logger.error('PlatformNotifications: dismiss failed:', error);
      setItems(snapshot);
    }
    afterMutation();
  }, [items, afterMutation]);

  const handleTap = (n) => {
    if (!n.read_at) markRead(n.id);
    const route = n.data?.route;
    if (route) navigate(route);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-[22px] md:text-[26px] font-bold text-[#E5E7EB] leading-tight">
            {t('platform.notifications.title', 'Alerts')}
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            {t('platform.notifications.subtitle', 'App crashes and platform alerts.')}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors disabled:opacity-50"
            style={{ background: '#D4AF37', color: '#000' }}
          >
            <CheckCheck size={13} />
            {t('platform.notifications.markAllRead', 'Mark all read')}
          </button>
        )}
      </div>

      {/* List */}
      {isLoading && items.length === 0 ? (
        <div className="py-16 flex justify-center">
          <PlatformSpinner />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center bg-white/[0.04]">
            <Inbox size={20} className="text-[#6B7280]" />
          </div>
          <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">
            {t('platform.notifications.empty', 'No alerts')}
          </p>
          <p className="text-[13px] text-[#6B7280]">
            {t('platform.notifications.emptyBody', 'Crash reports and platform alerts will appear here.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(n => {
            const meta = metaFor(n.type);
            const Icon = meta.icon;
            const isUnread = !n.read_at;
            return (
              <div
                key={n.id}
                onClick={() => handleTap(n)}
                className="flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-colors"
                style={{
                  background: isUnread ? 'rgba(212,175,55,0.04)' : 'rgba(255,255,255,0.02)',
                  borderColor: isUnread ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.06)',
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
                >
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isUnread && (
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                    )}
                    <span className="text-[11px] text-[#6B7280]">
                      {(() => { try { return formatDistanceToNow(new Date(n.created_at), { addSuffix: true }); } catch { return ''; } })()}
                    </span>
                  </div>
                  <p
                    className="text-[14px] font-semibold mt-1 leading-snug"
                    style={{ color: isUnread ? '#E5E7EB' : '#9CA3AF' }}
                  >
                    {sanitize(n.title)}
                  </p>
                  {n.body && (
                    <p className="text-[12.5px] mt-1 leading-relaxed text-[#6B7280] break-words">
                      {sanitize(n.body)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                  aria-label={t('platform.notifications.dismiss', 'Dismiss')}
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[#6B7280] hover:text-[#EF4444] hover:bg-white/[0.04] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}

          <AdminPagination
            page={safePage + 1}
            pageSize={PAGE_SIZE}
            total={items.length}
            onPageChange={(n) => setPage(n - 1)}
            colors={{ border: 'rgba(255,255,255,0.10)', muted: '#9CA3AF', secondary: '#C9D1D9', faint: '#6B7280', accent: '#D4AF37', onAccent: '#000' }}
          />
        </div>
      )}
    </div>
  );
}

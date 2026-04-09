import { useEffect, useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';

export default function SmsUsageCard({ gymId }) {
  const { t } = useTranslation('pages');
  const [usage, setUsage] = useState(null);
  const [recentSms, setRecentSms] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const SMS_CAP = 200;

  useEffect(() => {
    if (!gymId) return;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Fetch current month usage
    supabase.from('sms_usage_monthly')
      .select('month, count')
      .eq('gym_id', gymId)
      .order('month', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (data) setUsage(data);
      });

    // Fetch recent SMS sends
    supabase.from('sms_log')
      .select('id, phone_number, body, status, source, created_at')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setRecentSms(data);
      });
  }, [gymId]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentUsage = usage?.find(u => u.month === currentMonth)?.count || 0;
  const pct = Math.min(100, (currentUsage / SMS_CAP) * 100);

  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center">
            <Globe size={14} className="text-[#F59E0B]" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.smsUsage', 'SMS Usage')}</p>
            <p className="text-[10px] text-[#6B7280]">{currentMonth}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold text-[#E5E7EB]">{currentUsage}<span className="text-[13px] font-normal text-[#6B7280]">/{SMS_CAP}</span></p>
          <p className="text-[10px] text-[#6B7280]">{'\u2248'} ${(currentUsage * 0.054).toFixed(2)} cost</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/6 rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 90 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981',
          }}
        />
      </div>

      {/* History */}
      {usage && usage.length > 1 && (
        <div className="flex gap-3 mb-3">
          {usage.filter(u => u.month !== currentMonth).map(u => (
            <div key={u.month} className="text-[10px] text-[#6B7280]">
              {u.month}: <span className="text-[#9CA3AF] font-medium">{u.count}</span> SMS
            </div>
          ))}
        </div>
      )}

      {/* Recent sends */}
      {recentSms.length > 0 && (
        <div>
          <button onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors mb-2">
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {t('platform.gymDetail.recentSends', 'Recent sends')} ({recentSms.length})
          </button>
          {expanded && (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {recentSms.map(sms => (
                <div key={sms.id} className="flex items-start gap-2 text-[10px] p-2 bg-white/[0.02] rounded-lg">
                  <span className={`flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${sms.status === 'sent' ? 'bg-emerald-400' : sms.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#9CA3AF] font-mono truncate">{sms.phone_number}</span>
                      <span className="text-[#4B5563] flex-shrink-0">{formatDistanceToNow(new Date(sms.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-[#6B7280] truncate mt-0.5">{sms.body}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${sms.source === 'automated' ? 'bg-purple-500/10 text-purple-400' : sms.source === 'win_back' ? 'bg-red-500/10 text-red-400' : 'bg-white/6 text-[#6B7280]'}`}>
                      {sms.source}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!usage?.length && !recentSms.length && (
        <p className="text-[11px] text-[#4B5563] text-center py-2">{t('platform.gymDetail.noSmsActivity', 'No SMS activity yet')}</p>
      )}
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { AdminCard, Avatar } from '../../../components/admin';
import { getRiskTier } from '../../../lib/churnScore';

export default function AtRiskPreview({ atRisk = [] }) {
  const navigate = useNavigate();

  return (
    <AdminCard hover>
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[13px] font-semibold text-[#E5E7EB]">At-Risk Members</p>
        <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
          View all <ChevronRight size={12} />
        </button>
      </div>
      {atRisk.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-28 text-center">
          <p className="text-[12px] text-[#6B7280]">No at-risk members</p>
          <p className="text-[11px] text-[#4B5563] mt-1">Everyone is active</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {atRisk.map(m => {
            const tier = getRiskTier(m.score);
            const keySignal = m.key_signals?.[0] ?? null;
            return (
              <div key={m.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => navigate('/admin/churn')}>
                <Avatar name={m.full_name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#E5E7EB] truncate">{m.full_name}</p>
                  <p className="text-[10px] text-[#6B7280] truncate">
                    {m.daysInactive}d inactive{m.neverActive ? ' (never logged)' : ''}
                    {keySignal && <span className="text-[#4B5563]"> · {keySignal}</span>}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: tier.color, background: tier.bg }}>
                  {m.score}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </AdminCard>
  );
}

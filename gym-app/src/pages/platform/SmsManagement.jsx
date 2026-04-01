import { useEffect, useState, useMemo } from 'react';
import {
  MessageSquare, Phone, DollarSign, Settings, ToggleLeft, ToggleRight,
  Save, Plus, Edit3, Trash2, CheckCircle, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { format, subMonths, startOfMonth } from 'date-fns';
import { supabase } from '../../lib/supabase';

// ── Data fetcher ──────────────────────────────────────────
async function fetchSmsData() {
  const now = new Date();
  const sixMonthsAgo = format(startOfMonth(subMonths(now, 5)), 'yyyy-MM-dd');

  const [gymsRes, configRes, usageRes, ratesRes] = await Promise.all([
    supabase.from('gyms').select('id, name, has_number_bundle').order('name'),
    supabase.from('gym_twilio_config').select('gym_id, twilio_phone_number, twilio_account_sid, is_enabled, updated_at'),
    supabase.from('sms_usage_monthly').select('*').gte('month', sixMonthsAgo).order('month', { ascending: false }),
    supabase.from('platform_sms_rates').select('*').order('effective_from', { ascending: false }).limit(1),
  ]);

  const configMap = {};
  (configRes.data || []).forEach(c => { configMap[c.gym_id] = c; });

  const usageByGym = {};
  (usageRes.data || []).forEach(u => {
    if (!usageByGym[u.gym_id]) usageByGym[u.gym_id] = [];
    usageByGym[u.gym_id].push(u);
  });

  return {
    gyms: gymsRes.data || [],
    configMap,
    usageByGym,
    rates: ratesRes.data?.[0] || { cost_per_sms_segment: 0.0079, cost_per_mms: 0.02, cost_per_number_monthly: 1.15, markup_percentage: 20 },
    allUsage: usageRes.data || [],
  };
}

// ── Twilio Config Modal ──────────────────────────────────
function TwilioConfigModal({ gym, existing, onClose, onSaved }) {
  const [phone, setPhone] = useState(existing?.twilio_phone_number || '');
  const [sid, setSid] = useState(existing?.twilio_account_sid || '');
  const [changingToken, setChangingToken] = useState(!existing);
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(existing?.is_enabled ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const row = {
      gym_id: gym.id,
      twilio_phone_number: phone.trim(),
      twilio_account_sid: sid.trim(),
      is_enabled: enabled,
      updated_at: new Date().toISOString(),
    };

    if (changingToken && token.trim()) {
      row.twilio_auth_token = token.trim();
    }

    if (existing) {
      await supabase.from('gym_twilio_config').update(row).eq('gym_id', gym.id);
    } else {
      await supabase.from('gym_twilio_config').insert(row);
    }

    await supabase.from('gyms').update({ has_number_bundle: true }).eq('id', gym.id);
    setSaving(false);
    onSaved();
  };

  const canSave = phone.trim() && sid.trim() && (!changingToken || token.trim()) && (existing || token.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-[14px] w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-bold text-[#E5E7EB]">Twilio Configuration</p>
            <p className="text-[11px] text-[#6B7280]">{gym.name}</p>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors text-[18px]">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Twilio Phone Number</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15551234567"
              className="mt-1 w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Account SID</label>
            <input type="text" value={sid} onChange={e => setSid(e.target.value)} placeholder="AC..."
              className="mt-1 w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Auth Token</label>
            {existing && !changingToken ? (
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#6B7280] tracking-widest">
                  ••••••••••••••••
                </div>
                <button onClick={() => setChangingToken(true)}
                  className="px-3 py-2.5 rounded-xl text-[11px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
                  Change token
                </button>
              </div>
            ) : (
              <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={existing ? 'Enter new token' : 'Enter auth token'}
                autoFocus={existing && changingToken}
                className="mt-1 w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[#9CA3AF]">Enabled</p>
            <button onClick={() => setEnabled(!enabled)} className="text-[#D4AF37]">
              {enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-[#4B5563]" />}
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SmsManagement() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('gyms');
  const [configModal, setConfigModal] = useState(null);

  // Rate editing
  const [editingRates, setEditingRates] = useState(false);
  const [rateForm, setRateForm] = useState({});
  const [rateSaving, setRateSaving] = useState(false);

  useEffect(() => { document.title = 'Platform - SMS Management'; loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const d = await fetchSmsData();
    setData(d);
    setRateForm(d.rates);
    setLoading(false);
  };

  const handleToggleBundle = async (gym) => {
    const newVal = !gym.has_number_bundle;
    await supabase.from('gyms').update({ has_number_bundle: newVal }).eq('id', gym.id);
    if (!newVal && data.configMap[gym.id]) {
      await supabase.from('gym_twilio_config').update({ is_enabled: false }).eq('gym_id', gym.id);
    }
    loadData();
  };

  const handleRemoveConfig = async (gymId) => {
    await supabase.from('gym_twilio_config').delete().eq('gym_id', gymId);
    await supabase.from('gyms').update({ has_number_bundle: false }).eq('id', gymId);
    loadData();
  };

  const handleSaveRates = async () => {
    setRateSaving(true);
    await supabase.from('platform_sms_rates').insert({
      cost_per_sms_segment: parseFloat(rateForm.cost_per_sms_segment),
      cost_per_mms: parseFloat(rateForm.cost_per_mms),
      cost_per_number_monthly: parseFloat(rateForm.cost_per_number_monthly),
      markup_percentage: parseFloat(rateForm.markup_percentage),
      effective_from: new Date().toISOString().split('T')[0],
    });
    setRateSaving(false);
    setEditingRates(false);
    loadData();
  };

  const currentMonth = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const gymStats = useMemo(() => {
    if (!data) return [];
    return data.gyms.map(g => {
      const config = data.configMap[g.id];
      const usage = (data.usageByGym[g.id] || []).find(u => u.month === currentMonth);
      const sent = usage?.messages_sent || 0;
      const segments = usage?.segments_sent || 0;
      const cost = segments * data.rates.cost_per_sms_segment * (1 + data.rates.markup_percentage / 100)
        + (g.has_number_bundle ? data.rates.cost_per_number_monthly : 0);
      return { ...g, config, sent, segments, received: usage?.messages_received || 0, cost };
    });
  }, [data, currentMonth]);

  const totalCost = gymStats.reduce((s, g) => s + g.cost, 0);
  const totalSent = gymStats.reduce((s, g) => s + g.sent, 0);
  const activeGyms = gymStats.filter(g => g.has_number_bundle).length;

  if (loading) return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <div className="h-7 bg-white/6 rounded-lg w-52 animate-pulse mb-6" />
      <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-xl animate-pulse" />)}</div>
    </div>
  );

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">SMS Management</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">{activeGyms} gym{activeGyms !== 1 ? 's' : ''} with number bundle · {totalSent} messages this month</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Active Bundles', value: activeGyms, icon: Phone, color: '#D4AF37' },
          { label: 'Messages Sent', value: totalSent, icon: MessageSquare, color: '#60A5FA' },
          { label: 'Revenue (mo)', value: `$${totalCost.toFixed(2)}`, icon: DollarSign, color: '#10B981' },
          { label: 'Avg per Gym', value: activeGyms > 0 ? `$${(totalCost / activeGyms).toFixed(2)}` : '$0', icon: TrendingUp, color: '#F59E0B' },
        ].map(card => (
          <div key={card.label} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={14} style={{ color: card.color }} className="flex-shrink-0" />
              <p className="text-[11px] text-[#6B7280] font-medium truncate">{card.label}</p>
            </div>
            <p className="text-[24px] font-bold text-[#E5E7EB] truncate">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/6 pb-3">
        {[
          { key: 'gyms', label: 'Gym Bundles' },
          { key: 'rates', label: 'Cost Config' },
          { key: 'usage', label: 'Usage History' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
              tab === t.key ? 'bg-[#D4AF37]/12 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* GYM BUNDLES TAB */}
      {tab === 'gyms' && (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-white/6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider truncate">Gym</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Bundle</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden md:block">Phone</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Sent (mo)</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Cost (mo)</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Config</p>
          </div>
          <div className="divide-y divide-white/4">
            {gymStats.map(g => (
              <div key={g.id} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 items-center px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{g.name}</p>
                <button onClick={() => handleToggleBundle(g)}
                  className={`${g.has_number_bundle ? 'text-[#10B981]' : 'text-[#4B5563]'}`}>
                  {g.has_number_bundle ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                </button>
                <p className="text-[12px] text-[#9CA3AF] hidden md:block font-mono">
                  {g.config?.twilio_phone_number || '—'}
                </p>
                <p className="text-[12px] font-semibold text-[#9CA3AF] hidden sm:block">{g.sent}</p>
                <p className="text-[12px] font-semibold text-[#9CA3AF] hidden sm:block">${g.cost.toFixed(2)}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => setConfigModal(g)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors">
                    <Settings size={12} />
                  </button>
                  {g.config && (
                    <button onClick={() => handleRemoveConfig(g.id)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COST CONFIG TAB */}
      {tab === 'rates' && (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5 max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[14px] font-semibold text-[#E5E7EB]">SMS Rate Configuration</p>
            {!editingRates && (
              <button onClick={() => setEditingRates(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors">
                <Edit3 size={12} /> Edit
              </button>
            )}
          </div>
          <div className="space-y-4">
            {[
              { key: 'cost_per_sms_segment', label: 'Cost per SMS Segment', prefix: '$', step: '0.0001' },
              { key: 'cost_per_mms', label: 'Cost per MMS', prefix: '$', step: '0.0001' },
              { key: 'cost_per_number_monthly', label: 'Number Monthly Cost', prefix: '$', step: '0.01' },
              { key: 'markup_percentage', label: 'Markup Percentage', suffix: '%', step: '0.5' },
            ].map(field => (
              <div key={field.key} className="flex items-center justify-between">
                <label className="text-[13px] text-[#9CA3AF]">{field.label}</label>
                {editingRates ? (
                  <div className="flex items-center gap-1">
                    {field.prefix && <span className="text-[13px] text-[#6B7280]">{field.prefix}</span>}
                    <input type="number" step={field.step}
                      value={rateForm[field.key] ?? ''}
                      onChange={e => setRateForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-24 bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1.5 text-[13px] text-[#E5E7EB] text-right outline-none focus:border-[#D4AF37]/40" />
                    {field.suffix && <span className="text-[13px] text-[#6B7280]">{field.suffix}</span>}
                  </div>
                ) : (
                  <p className="text-[14px] font-semibold text-[#E5E7EB]">
                    {field.prefix}{Number(data.rates[field.key]).toFixed(field.step === '0.0001' ? 4 : 2)}{field.suffix || ''}
                  </p>
                )}
              </div>
            ))}
          </div>
          {editingRates && (
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setEditingRates(false); setRateForm(data.rates); }}
                className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6">Cancel</button>
              <button onClick={handleSaveRates} disabled={rateSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 disabled:opacity-40">
                <Save size={13} /> {rateSaving ? 'Saving…' : 'Save Rates'}
              </button>
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-white/6">
            <p className="text-[11px] text-[#4B5563]">
              Cost formula: (segments × cost_per_segment × (1 + markup%)) + number_monthly_cost
            </p>
          </div>
        </div>
      )}

      {/* USAGE HISTORY TAB */}
      {tab === 'usage' && (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-white/6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Gym</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Month</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Sent</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Received</p>
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Cost</p>
          </div>
          <div className="divide-y divide-white/4 max-h-[500px] overflow-y-auto">
            {data.allUsage.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[13px] text-[#6B7280]">No usage data yet</p>
              </div>
            ) : data.allUsage.map(u => {
              const gymName = data.gyms.find(g => g.id === u.gym_id)?.name || 'Unknown';
              const cost = u.segments_sent * data.rates.cost_per_sms_segment * (1 + data.rates.markup_percentage / 100);
              return (
                <div key={u.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 hover:bg-white/[0.02]">
                  <p className="text-[13px] text-[#E5E7EB] truncate">{gymName}</p>
                  <p className="text-[12px] text-[#9CA3AF]">{format(new Date(u.month), 'MMM yyyy')}</p>
                  <p className="text-[12px] font-semibold text-[#9CA3AF]">{u.messages_sent}</p>
                  <p className="text-[12px] font-semibold text-[#9CA3AF]">{u.messages_received}</p>
                  <p className="text-[12px] font-semibold text-[#10B981]">${cost.toFixed(2)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Twilio Config Modal */}
      {configModal && (
        <TwilioConfigModal gym={configModal} existing={data.configMap[configModal.id]}
          onClose={() => setConfigModal(null)} onSaved={() => { setConfigModal(null); loadData(); }} />
      )}
    </div>
  );
}

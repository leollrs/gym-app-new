import { useEffect, useState } from 'react';
import { Plus, Megaphone, X, Trash2, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format } from 'date-fns';

const TYPE_OPTS = [
  { value: 'info',    label: 'Info',    color: 'text-blue-400 bg-blue-500/10' },
  { value: 'promo',   label: 'Promo',   color: 'text-[#D4AF37] bg-[#D4AF37]/10' },
  { value: 'alert',   label: 'Alert',   color: 'text-red-400 bg-red-500/10' },
];

const CreateModal = ({ onClose, onCreated, gymId, adminId }) => {
  const [form, setForm] = useState({ title: '', message: '', type: 'info', scheduled_for: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.title || !form.message) { setError('Title and message are required.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('gym_announcements').insert({
      gym_id:            gymId,
      created_by:        adminId,
      title:             form.title,
      message:           form.message,
      announcement_type: form.type,
      is_published:      !form.scheduled_for,
      published_at:      form.scheduled_for ? new Date(form.scheduled_for).toISOString() : new Date().toISOString(),
    });
    if (err) { setError(err.message); setSaving(false); return; }
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <p className="text-[16px] font-bold text-[#E5E7EB]">New Announcement</p>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Title</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. New equipment arriving Friday!"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Message</label>
            <textarea value={form.message} onChange={e => set('message', e.target.value)} rows={3}
              placeholder="Your message to members…"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Type</label>
            <div className="flex gap-2">
              {TYPE_OPTS.map(t => (
                <button key={t.value} onClick={() => set('type', t.value)}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    form.type === t.value ? t.color : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">
              Schedule (optional — leave blank to publish now)
            </label>
            <input type="datetime-local" value={form.scheduled_for} onChange={e => set('scheduled_for', e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
          </div>
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50">
            {saving ? 'Publishing…' : form.scheduled_for ? 'Schedule' : 'Publish Now'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function AdminAnnouncements() {
  const { profile, user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('gym_announcements')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('published_at', { ascending: false });
    setAnnouncements(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.gym_id]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    await supabase.from('gym_announcements').delete().eq('id', id);
    load();
  };

  const typeStyle = (type) =>
    TYPE_OPTS.find(t => t.value === type)?.color ?? 'text-[#9CA3AF] bg-white/6';

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Announcements</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Messages broadcast to all members</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
          <Plus size={15} /> New
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20">
          <Megaphone size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => (
            <div key={a.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <p className="text-[14px] font-semibold text-[#E5E7EB]">{a.title}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${typeStyle(a.announcement_type)}`}>
                      {a.announcement_type}
                    </span>
                    {!a.is_published && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 bg-amber-500/10">
                        Scheduled
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{a.message}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <Calendar size={11} className="text-[#4B5563]" />
                    <p className="text-[11px] text-[#6B7280]">
                      {a.is_published ? 'Published' : 'Scheduled for'} {format(new Date(a.published_at), 'MMM d, yyyy · h:mm a')}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleDelete(a.id)} className="text-[#4B5563] hover:text-red-400 transition-colors p-1 flex-shrink-0">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={load} gymId={profile.gym_id} adminId={user.id} />
      )}
    </div>
  );
}

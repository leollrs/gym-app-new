import { useEffect, useState } from 'react';
import { Plus, Megaphone, X, Trash2, Calendar, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { broadcastNotification } from '../../lib/notifications';
import { format, isFuture } from 'date-fns';
import { sanitize } from '../../lib/sanitize';

// Must match the announcement_type enum in the DB schema
const TYPE_OPTS = [
  { value: 'news',        label: 'News',        color: 'text-blue-400 bg-blue-500/10' },
  { value: 'event',       label: 'Event',       color: 'text-[#D4AF37] bg-[#D4AF37]/10' },
  { value: 'challenge',   label: 'Challenge',   color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'maintenance', label: 'Maintenance', color: 'text-red-400 bg-red-500/10' },
];

const CreateModal = ({ onClose, onCreated, gymId, adminId }) => {
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: '', message: '', type: 'news', scheduled_for: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.title || !form.message) { setError('Title and message are required.'); showToast('Title and message are required', 'error'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('announcements').insert({
      gym_id:      gymId,
      created_by:  adminId,
      title:       form.title,
      message:     form.message,
      type:        form.type,
      published_at: form.scheduled_for
        ? new Date(form.scheduled_for).toISOString()
        : new Date().toISOString(),
    });
    if (err) { setError(err.message); setSaving(false); showToast(err.message, 'error'); return; }
    showToast('Announcement published', 'success');
    // Notify all members
    broadcastNotification({
      gymId,
      type:  'announcement',
      title: form.title,
      body:  form.message,
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-announcement-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg md:max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <p id="new-announcement-title" className="text-[16px] font-bold text-[#E5E7EB]">New Announcement</p>
          <button onClick={onClose} aria-label="Close dialog"><X size={20} className="text-[#6B7280]" /></button>
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
            <div className="flex gap-2 flex-wrap">
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
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm]   = useState({ title: '', message: '', type: 'news' });
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('published_at', { ascending: false });
    setAnnouncements(data || []);
    setLoading(false);
  };

  useEffect(() => { document.title = 'Admin - Announcements | IronForge'; }, []);
  useEffect(() => { load(); }, [profile?.gym_id]);

  const handleDelete = async (id) => {
    await supabase.from('announcements').delete().eq('id', id);
    setConfirmDeleteId(null);
    load();
  };

  const startEditing = (a) => {
    setEditingId(a.id);
    setEditForm({ title: a.title, message: a.message, type: a.type });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({ title: '', message: '', type: 'news' });
  };

  const handleEditSave = async () => {
    if (!editForm.title || !editForm.message) return;
    setEditSaving(true);
    const { error: err } = await supabase
      .from('announcements')
      .update({ title: editForm.title, message: editForm.message, type: editForm.type })
      .eq('id', editingId);
    setEditSaving(false);
    if (err) return;
    cancelEditing();
    load();
  };

  const typeStyle = (type) =>
    TYPE_OPTS.find(t => t.value === type)?.color ?? 'text-[#9CA3AF] bg-white/6';

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
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
          {announcements.map(a => {
            const isScheduled = a.published_at && isFuture(new Date(a.published_at));
            const isEditing = editingId === a.id;
            return (
              <div key={a.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 hover:border-white/20 hover:bg-white/[0.03] transition-all">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Title</label>
                      <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                        className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Message</label>
                      <textarea value={editForm.message} onChange={e => setEditForm(p => ({ ...p, message: e.target.value }))} rows={3}
                        className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Type</label>
                      <div className="flex gap-2 flex-wrap">
                        {TYPE_OPTS.map(t => (
                          <button key={t.value} onClick={() => setEditForm(p => ({ ...p, type: t.value }))}
                            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                              editForm.type === t.value ? t.color : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                            }`}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={cancelEditing}
                        className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
                        Cancel
                      </button>
                      <button onClick={handleEditSave} disabled={editSaving || !editForm.title || !editForm.message}
                        className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-black bg-[#D4AF37] disabled:opacity-50">
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <p className="text-[14px] font-semibold text-[#E5E7EB]">{sanitize(a.title)}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${typeStyle(a.type)}`}>
                          {a.type}
                        </span>
                        {isScheduled && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 bg-amber-500/10">
                            Scheduled
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{sanitize(a.message)}</p>
                      {a.published_at && (
                        <div className="flex items-center gap-1 mt-2">
                          <Calendar size={11} className="text-[#4B5563]" />
                          <p className="text-[11px] text-[#6B7280]">
                            {isScheduled ? 'Scheduled for' : 'Published'}{' '}
                            {format(new Date(a.published_at), 'MMM d, yyyy · h:mm a')}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {confirmDeleteId === a.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-[#9CA3AF]">Delete?</span>
                          <button onClick={() => handleDelete(a.id)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                            Confirm
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => startEditing(a)} className="text-[#4B5563] hover:text-[#D4AF37] transition-colors p-1">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setConfirmDeleteId(a.id)} className="text-[#4B5563] hover:text-red-400 transition-colors p-1">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={load} gymId={profile.gym_id} adminId={user.id} />
      )}
    </div>
  );
}

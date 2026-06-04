import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import { FadeIn } from '../../../components/admin';
import { TK, FK, Ico, Card, DIC, CardHd, Fld, Help, TextField, fieldStyle } from './settingsKit';

/**
 * Manages gym closure days from Ajustes → Horario. A closure can be either a
 * FULL closure (is_closed=true) or OPEN with SPECIAL HOURS (is_closed=false +
 * open/close times) — a holiday doesn't always mean fully closed. The special-
 * hours columns (migration 0516) are written resiliently: if they don't exist
 * yet, the row still saves as a full closure. Restyled onto settingsKit.
 */
const isMissingColumn = (err) =>
  !!err && (err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist/i.test(err.message || ''));

export default function GymClosuresCard({ gymId, delay = 60, id }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const { profile } = useAuth();

  const [closures, setClosures] = useState([]);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('holiday');
  const [closureName, setClosureName] = useState('');
  const [closureClosed, setClosureClosed] = useState(true);
  const [openTime, setOpenTime] = useState('08:00');
  const [closeTime, setCloseTime] = useState('14:00');
  const [closureSaving, setClosureSaving] = useState(false);
  const [editingClosureId, setEditingClosureId] = useState(null);

  useEffect(() => {
    if (!gymId) return;
    supabase
      .from('gym_closures')
      .select('*')
      .eq('gym_id', gymId)
      .gte('closure_date', new Date().toISOString().slice(0, 10))
      .order('closure_date')
      .then(({ data }) => setClosures(data || []))
      .catch(() => {});
  }, [gymId]);

  const resetForm = () => {
    setEditingClosureId(null);
    setClosureDate('');
    setClosureReason('holiday');
    setClosureName('');
    setClosureClosed(true);
    setOpenTime('08:00');
    setCloseTime('14:00');
  };

  const handleAddClosure = async () => {
    if (!closureDate) return;
    if (!closureClosed && (!openTime || !closeTime || openTime >= closeTime)) {
      showToast(t('admin.closures.invalidSpecialHours', 'Open time must be before close time.'), 'error');
      return;
    }
    setClosureSaving(true);
    try {
      const base = { closure_date: closureDate, reason: closureReason, name: closureName || null };
      const extra = closureClosed
        ? { is_closed: true, open_time: null, close_time: null }
        : { is_closed: false, open_time: openTime, close_time: closeTime };

      if (editingClosureId) {
        let res = await supabase.from('gym_closures').update({ ...base, ...extra }).eq('id', editingClosureId).eq('gym_id', gymId).select().single();
        if (res.error && isMissingColumn(res.error)) {
          res = await supabase.from('gym_closures').update(base).eq('id', editingClosureId).eq('gym_id', gymId).select().single();
        }
        if (res.error) throw res.error;
        logAdminAction('update_closures', 'gym', gymId);
        setClosures(prev => prev.map(c => c.id === editingClosureId ? res.data : c).sort((a, b) => a.closure_date.localeCompare(b.closure_date)));
        showToast(t('admin.closures.updated', 'Cierre actualizado'), 'success');
      } else {
        let res = await supabase.from('gym_closures').insert({ gym_id: gymId, ...base, ...extra, created_by: profile?.id }).select().single();
        if (res.error && isMissingColumn(res.error)) {
          res = await supabase.from('gym_closures').insert({ gym_id: gymId, ...base, created_by: profile?.id }).select().single();
        }
        if (res.error) throw res.error;
        logAdminAction('update_closures', 'gym', gymId);
        setClosures(prev => [...prev, res.data].sort((a, b) => a.closure_date.localeCompare(b.closure_date)));
        showToast(t('admin.closures.added'), 'success');
      }
      resetForm();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setClosureSaving(false);
  };

  const handleEditClosure = (c) => {
    setEditingClosureId(c.id);
    setClosureDate(c.closure_date);
    setClosureReason(c.reason || 'holiday');
    setClosureName(c.name || '');
    const closed = c.is_closed !== false;
    setClosureClosed(closed);
    setOpenTime(c.open_time || '08:00');
    setCloseTime(c.close_time || '14:00');
  };

  const handleDeleteClosure = async (idToDelete) => {
    try {
      const { error: delErr } = await supabase.from('gym_closures').delete().eq('id', idToDelete).eq('gym_id', gymId);
      if (delErr) throw delErr;
      logAdminAction('delete_closure', 'gym_closure', idToDelete);
      setClosures(prev => prev.filter(c => c.id !== idToDelete));
      showToast(t('admin.closures.removed'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const reasonLabel = (reason) =>
    t(`admin.closures.reason${reason?.charAt(0).toUpperCase()}${reason?.slice(1)?.replace('_', '')}`, reason);

  const iconBtn = { width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, background: TK.surface, border: `1px solid ${TK.borderSolid}` };
  const segBtn = (active) => ({ flex: 1, padding: '11px 0', borderRadius: 11, cursor: 'pointer', textAlign: 'center', fontFamily: FK.body, fontSize: 13, fontWeight: 700, background: active ? TK.accentWash : TK.surface2, border: `1.5px solid ${active ? TK.accent : TK.borderSolid}`, color: active ? TK.accent : TK.textSub });

  return (
    <FadeIn delay={delay} className="min-w-0">
      <Card id={id} style={{ padding: '22px 24px' }}>
        <CardHd icon={DIC.calX}>{t('admin.closures.sectionTitle')}</CardHd>
        <Help>{t('admin.closures.description')}</Help>

        {/* add / edit form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
          <div>
            <Fld style={{ margin: '0 0 8px' }}>{t('admin.closures.date')}</Fld>
            <TextField type="date" value={closureDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setClosureDate(e.target.value)} mono />
          </div>
          <div>
            <Fld style={{ margin: '0 0 8px' }}>{t('admin.closures.reason')}</Fld>
            <div style={{ position: 'relative' }}>
              <select value={closureReason} onChange={e => setClosureReason(e.target.value)} style={{ ...fieldStyle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 38, cursor: 'pointer' }}>
                <option value="holiday">{t('admin.closures.reasonHoliday')}</option>
                <option value="maintenance">{t('admin.closures.reasonMaintenance')}</option>
                <option value="special_event">{t('admin.closures.reasonSpecialEvent')}</option>
                <option value="other">{t('admin.closures.reasonOther')}</option>
              </select>
              <Ico ch={DIC.chevD} size={15} color={TK.textMute} stroke={2.2} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>

        <Fld>{t('admin.closures.name')}</Fld>
        <TextField type="text" value={closureName} onChange={e => setClosureName(e.target.value)} placeholder={t('admin.closures.namePlaceholder')} />

        {/* closed-all-day vs special-hours */}
        <Fld>{t('admin.closures.availability', 'Availability')}</Fld>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={() => setClosureClosed(true)} style={segBtn(closureClosed)}>{t('admin.closures.closedAllDay', 'Closed all day')}</button>
          <button type="button" onClick={() => setClosureClosed(false)} style={segBtn(!closureClosed)}>{t('admin.closures.specialHours', 'Special hours')}</button>
        </div>
        {!closureClosed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
            <div><Fld style={{ margin: '0 0 8px' }}>{t('admin.closures.opensAt', 'Opens')}</Fld><TextField type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} mono /></div>
            <div><Fld style={{ margin: '0 0 8px' }}>{t('admin.closures.closesAt', 'Closes')}</Fld><TextField type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} mono /></div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          {editingClosureId && (
            <button type="button" onClick={resetForm} disabled={closureSaving} style={{ padding: '11px 16px', borderRadius: 11, cursor: 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, opacity: closureSaving ? 0.5 : 1 }}>
              {t('admin.closures.cancelEdit', 'Cancelar')}
            </button>
          )}
          <button type="button" onClick={handleAddClosure} disabled={!closureDate || closureSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 11, cursor: (!closureDate || closureSaving) ? 'default' : 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent, opacity: (!closureDate || closureSaving) ? 0.5 : 1 }}>
            <Ico ch={DIC.plus} size={15} color={TK.accent} stroke={2.4} />
            {closureSaving
              ? (editingClosureId ? t('admin.closures.saving', 'Guardando...') : t('admin.closures.adding'))
              : (editingClosureId ? t('admin.closures.saveChanges', 'Guardar cambios') : t('admin.closures.addClosure'))}
          </button>
        </div>

        {/* upcoming */}
        {closures.length > 0 ? (
          <>
            <div style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 700, color: TK.textSub, margin: '18px 0 12px' }}>{t('admin.closures.upcoming')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {closures.map(c => {
                const special = c.is_closed === false && c.open_time && c.close_time;
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }}>{c.name || reasonLabel(c.reason)}</div>
                      <div style={{ fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint, marginTop: 2 }}>
                        {new Date(c.closure_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}
                        {special
                          ? <span style={{ color: TK.accent, fontWeight: 700 }}>{c.open_time}–{c.close_time}</span>
                          : <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>{t('admin.closures.closedAllDay', 'Closed all day')}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => handleEditClosure(c)} aria-label={t('admin.closures.edit', 'Editar')} title={t('admin.closures.edit', 'Editar')} style={{ ...iconBtn, borderColor: editingClosureId === c.id ? TK.accent : TK.borderSolid }}>
                      <Ico ch={DIC.edit} size={15} color={editingClosureId === c.id ? TK.accent : TK.textSub} stroke={2} />
                    </button>
                    <button type="button" onClick={() => handleDeleteClosure(c.id)} aria-label={t('admin.closures.remove')} style={iconBtn}>
                      <Ico ch={DIC.trash} size={15} color="var(--color-danger)" stroke={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Help style={{ fontStyle: 'italic', marginTop: 16 }}>{t('admin.closures.noClosure')}</Help>
        )}
      </Card>
    </FadeIn>
  );
}

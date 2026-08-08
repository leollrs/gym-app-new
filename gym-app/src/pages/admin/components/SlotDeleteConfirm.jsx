// Antes de borrar una franja: qué se borra, y a cuánta gente le cae encima.
//
// LO QUE HABÍA. Nada. El cubo de basura borraba en el acto. Y borrar una franja
// no es borrar una fila: `gym_class_bookings.schedule_id` apunta a
// `gym_class_schedules` con ON DELETE CASCADE, así que se llevaba por delante
// todas las reservas de esa franja —pasadas y futuras— sin preguntar y sin
// avisar a nadie. Un clic mal dado a las 8 de la mañana deja a doce personas
// presentándose a una clase que ya no existe.
//
// El número no se estima: se cuenta contra la base en el momento de preguntar.
// Un aviso genérico («esto podría afectar reservas») no cambia la decisión de
// nadie; «se cancelan 12 reservas» sí.
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Users } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { supabase } from '../../../lib/supabase';
import { todayKey } from '../../../lib/dateKey';
import { format12h, slotDayLabel } from '../../../lib/admin/classScheduleHelpers';

export default function SlotDeleteConfirm({ slot, classItem, onConfirm, onCancel, deleting, dayLabel, t, tc, lang }) {
  // Reservas VIVAS de aquí en adelante. Las pasadas también se borran, pero
  // avisar de ellas solo añade ruido: a nadie deja tirado el borrado de una
  // reserva de hace tres semanas. Lo que importa es quién se queda sin sitio.
  const { data: affected, isLoading } = useQuery({
    queryKey: ['admin', 'slot-delete-impact', slot?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('gym_class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('schedule_id', slot.id)
        .gte('booking_date', todayKey())
        .in('status', ['confirmed', 'waitlisted']);
      if (error) return null;      // sin dato: se dice que no se pudo contar
      return count || 0;
    },
    enabled: !!slot?.id,
    staleTime: 0,
  });

  const when = slot?.specific_date
    ? new Date(`${slot.specific_date}T00:00:00`).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })
    : slotDayLabel(slot, dayLabel, lang);

  return (
    <AdminModal
      isOpen
      onClose={onCancel}
      title={t('admin.classes.deleteSlotTitle', 'Eliminar horario')}
      titleIcon={AlertTriangle}
      size="sm"
    >
      <div className="rounded-xl px-3.5 py-3 mb-4"
        style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
        <p className="text-[14px] font-extrabold capitalize" style={{ color: 'var(--color-admin-text)' }}>
          {when} · {format12h(slot?.start_time)} – {format12h(slot?.end_time)}
        </p>
        {classItem?.name && (
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{classItem.name}</p>
        )}
      </div>

      {/* La consecuencia, con su número. */}
      {isLoading ? (
        <p className="text-[12.5px] mb-5" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.classes.deleteSlotChecking', 'Mirando cuántas reservas tiene…')}
        </p>
      ) : affected == null ? (
        <p className="text-[12.5px] mb-5 leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.classes.deleteSlotUnknown', 'No se pudo comprobar cuántas reservas tiene. Al eliminarlo se cancelan todas las que haya, y nadie recibe aviso.')}
        </p>
      ) : affected > 0 ? (
        <div className="flex gap-2.5 px-3 py-3 rounded-xl mb-5"
          style={{ background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)' }}>
          <Users size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
          <div className="min-w-0">
            <p className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.classes.deleteSlotAffected', { count: affected, defaultValue: 'Se cancelan {{count}} reservas ya hechas' })}
            </p>
            <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.classes.deleteSlotNoNotice', 'Nadie recibe aviso: se enterarán al abrir la app o al presentarse. Si es un cambio de hora, avísales tú desde Enviar mensaje.')}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] mb-5 leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.classes.deleteSlotNoBookings', 'No tiene ninguna reserva futura, así que no deja a nadie tirado.')}
        </p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
          {tc('cancel')}
        </button>
        <button type="button" onClick={onConfirm} disabled={deleting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--color-danger)', color: '#fff' }}>
          {deleting ? '…' : t('admin.classes.deleteSlotConfirm', 'Eliminar horario')}
        </button>
      </div>
    </AdminModal>
  );
}

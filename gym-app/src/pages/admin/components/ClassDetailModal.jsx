import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, BarChart3, Users, AlertTriangle } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { supabase } from '../../../lib/supabase';
import { slotDayLabel, format12h } from '../../../lib/admin/classScheduleHelpers';
import { projectSessions } from '../../../lib/admin/classConflicts';
import {
  calcClassStats, duplicateSlots, describeNextSession,
} from '../../../lib/admin/classStats';
import ClassAnalytics from './ClassAnalytics';
import BookingsView from './BookingsView';
import ClassDetailHeader from './ClassDetailHeader';
import ClassWeekGrid from './ClassWeekGrid';
import ClassSlotList from './ClassSlotList';
import { dateKey } from '../../../lib/dateKey';

/**
 * Lo que el admin ve al pulsar una clase.
 *
 * LO QUE HABÍA. Tres pestañas y, en la primera, una ficha con la foto, el
 * nombre, el instructor, la duración y el aforo, más la lista de franjas en
 * texto. Todo cierto y todo inerte: no había forma de saber si la clase
 * funciona sin irse a Analíticas y leer.
 *
 * AHORA la primera pantalla responde a lo que uno viene a preguntar:
 *   · cuatro cifras arriba — ocupación, próxima sesión, horarios, no-show;
 *   · la semana DIBUJADA, con cada franja coloreada por lo llena que va;
 *   · y un aviso cuando hay dos horarios idénticos, que es un fallo real que
 *     nadie detectaba: el socio ve la clase repetida en la app y las reservas
 *     se parten entre las dos.
 *
 * La lista de franjas sigue siendo de solo lectura — se edita con el lápiz, que
 * abre el formulario. Dos sitios para cambiar lo mismo es como se desincronizan.
 */
export default function ClassDetailModal({ classItem, onClose, onEdit, onDeleteSlot, trainers = [], dayLabel, gymId, t, tc, lang }) {
  const [detailTab, setDetailTab] = useState('schedule');
  const slots = useMemo(() => classItem.gym_class_schedules || [], [classItem]);

  // Las últimas cuatro semanas. Es la ventana de la que habla la cabecera, y la
  // que hace que «ocupación media» signifique algo: con «todo el histórico», una
  // clase que arrancó floja hace un año arrastra el número para siempre.
  const { data: recent } = useQuery({
    queryKey: ['admin', 'class-detail-recent', classItem.id],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 28);
      const { data, error } = await supabase
        .from('gym_class_bookings')
        .select('schedule_id, status, attended, rating, booking_date')
        .eq('class_id', classItem.id)
        .gte('booking_date', dateKey(from))
        .order('booking_date', { ascending: true })
        .limit(1000);   // PostgREST corta ahí igual; se deja explícito
      if (error) return null;
      return data || [];
    },
    enabled: !!classItem.id,
    staleTime: 60 * 1000,
  });

  const stats = useMemo(() => {
    if (!recent) return null;
    const base = calcClassStats(recent, classItem.max_capacity);
    // Franjas recurrentes sin una sola reserva en la ventana.
    const withBookings = new Set(recent.map(b => b.schedule_id));
    const idleSlots = slots.filter(s => !s.specific_date && !withBookings.has(s.id)).length;
    return { ...base, idleSlots };
  }, [recent, classItem.max_capacity, slots]);

  // Reservas vivas por franja: lo que colorea la rejilla. Las canceladas no
  // ocupan sitio, así que no cuentan como ocupación.
  const bookedBySlot = useMemo(() => {
    if (!recent) return null;
    const m = {};
    recent.forEach(b => {
      if (b.status === 'cancelled' || !b.schedule_id) return;
      m[b.schedule_id] = (m[b.schedule_id] || 0) + 1;
    });
    // Se reparte entre las sesiones de la ventana para que el número sea «por
    // sesión» y no «cuatro semanas acumuladas», que llenaría todo de rojo o de
    // verde según la antigüedad.
    const sessionsBySlot = {};
    recent.forEach(b => {
      if (b.status === 'cancelled' || !b.schedule_id) return;
      (sessionsBySlot[b.schedule_id] ||= new Set()).add(b.booking_date);
    });
    Object.keys(m).forEach(k => {
      const n = sessionsBySlot[k]?.size || 1;
      m[k] = Math.round(m[k] / n);
    });
    return m;
  }, [recent]);

  const dups = useMemo(() => duplicateSlots(slots), [slots]);
  const dupIds = useMemo(() => new Set(dups.flat().map(s => s.id)), [dups]);

  const nextSession = useMemo(() => describeNextSession(
    projectSessions(slots, { weeks: 2 }), lang,
    { today: t('admin.classes.today', 'Hoy'), time: format12h },
  ), [slots, lang, t]);

  const coaches = useMemo(() => {
    const names = new Set();
    if (classItem.trainer?.full_name) names.add(classItem.trainer.full_name);
    (classItem.gym_class_trainers || []).forEach(r => { if (r?.trainer?.full_name) names.add(r.trainer.full_name); });
    if (!names.size && (classItem.instructor || classItem.instructor_name)) {
      names.add(classItem.instructor || classItem.instructor_name);
    }
    return [...names];
  }, [classItem]);

  const DETAIL_TABS = [
    { key: 'schedule', label: t('admin.classes.tabSchedule'), icon: Calendar, count: slots.length },
    { key: 'analytics', label: t('admin.classes.analytics'), icon: BarChart3, count: null },
    { key: 'bookings', label: t('admin.classes.bookings'), icon: Users, count: null },
  ];

  const sortedSlots = useMemo(() => slots.slice().sort((a, b) => {
    if (a.specific_date && !b.specific_date) return 1;
    if (!a.specific_date && b.specific_date) return -1;
    if (a.specific_date && b.specific_date) return a.specific_date.localeCompare(b.specific_date);
    return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || String(a.start_time).localeCompare(String(b.start_time));
  }), [slots]);

  return (
    <AdminModal isOpen onClose={onClose} title={classItem.name} size="lg">
      <ClassDetailHeader
        classItem={classItem} stats={stats} nextSession={nextSession}
        coaches={coaches} t={t} lang={lang}
      />

      <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
        {DETAIL_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = detailTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setDetailTab(tab.key)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] sm:text-[12px] font-semibold transition-all duration-200 border-b-2 -mb-px whitespace-nowrap"
              style={{
                color: isActive ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
                borderColor: isActive ? 'var(--color-accent)' : 'transparent',
              }}>
              <Icon size={13} /> {tab.label}
              {tab.count > 0 && (
                <span className="text-[10px] tabular-nums px-1.5 rounded-full"
                  style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}>{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {detailTab === 'schedule' && (
        <div className="space-y-3">
          {/* Horarios duplicados. No es una rareza: el formulario deja añadir la
              misma franja dos veces, el socio ve la clase repetida en la app y
              las reservas se parten entre las dos. Nadie lo detectaba. */}
          {dups.length > 0 && (
            <div className="flex gap-2.5 px-3 py-3 rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--color-warning, #F59E0B) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #F59E0B) 30%, transparent)' }}>
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning, #F59E0B)' }} />
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                  {t('admin.classes.dupTitle', { count: dups.length, defaultValue: '{{count}} horarios repetidos' })}
                </p>
                <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
                  {dups.map(g => slotDayLabel(g[0], dayLabel, lang) + ' · ' + format12h(g[0].start_time)).join(' · ')}
                  {' — '}
                  {t('admin.classes.dupBody', 'los miembros ven la clase dos veces en la app y las reservas se parten entre las dos. Quita la sobrante desde el lápiz.')}
                </p>
              </div>
            </div>
          )}

          <ClassWeekGrid
            schedules={slots} capacity={classItem.max_capacity}
            bookedBySlot={bookedBySlot} duplicateIds={dupIds} lang={lang} t={t}
          />

          <ClassSlotList
            slots={sortedSlots}
            capacity={classItem.max_capacity}
            bookedBySlot={bookedBySlot}
            duplicateIds={dupIds}
            trainers={trainers}
            mainTrainerId={classItem.trainer_id || classItem.trainer?.id || null}
            onAddSlot={onEdit ? () => onEdit(classItem) : null}
            onEditSlot={onEdit ? () => onEdit(classItem) : null}
            onDeleteSlot={onDeleteSlot}
            dayLabel={dayLabel} t={t} lang={lang}
          />
        </div>
      )}

      {detailTab === 'analytics' && <ClassAnalytics classItem={classItem} t={t} lang={lang} />}
      {detailTab === 'bookings' && <BookingsView classItem={classItem} gymId={gymId} t={t} tc={tc} />}
    </AdminModal>
  );
}

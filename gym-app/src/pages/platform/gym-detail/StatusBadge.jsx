import { useTranslation } from 'react-i18next';

const statusConfig = {
  active:      { key: 'active',      bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  frozen:      { key: 'frozen',      bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20' },
  deactivated: { key: 'deactivated', bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/20' },
  cancelled:   { key: 'cancelled',   bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
  banned:      { key: 'banned',      bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20' },
};

export { statusConfig };

export default function StatusBadge({ status }) {
  const { t } = useTranslation('pages');
  const cfg = statusConfig[status] ?? statusConfig.active;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {t(`platform.gymDetail.statuses.${cfg.key}`)}
    </span>
  );
}

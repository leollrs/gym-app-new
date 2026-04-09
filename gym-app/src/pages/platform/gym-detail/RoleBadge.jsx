import { useTranslation } from 'react-i18next';

const roleConfig = {
  super_admin: { key: 'super_admin', bg: 'bg-[#D4AF37]/10', text: 'text-[#D4AF37]', border: 'border-[#D4AF37]/20' },
  admin:       { key: 'admin',       bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  trainer:     { key: 'trainer',     bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  member:      { key: 'member',      bg: 'bg-white/6',       text: 'text-[#9CA3AF]',  border: 'border-white/10' },
};

export { roleConfig };

export default function RoleBadge({ role }) {
  const { t } = useTranslation('pages');
  const cfg = roleConfig[role] ?? roleConfig.member;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {t(`platform.gymDetail.roles.${cfg.key}`)}
    </span>
  );
}

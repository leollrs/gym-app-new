import { useTranslation } from 'react-i18next';
import { isValidNamePart } from '../../../lib/admin/memberName';

/**
 * Structured member-name inputs: first · middle · last · second last.
 * Controlled via `value` ({ first, middle, last, second }) + `onChange(next)`.
 * First and last names are required; middle and second-last are optional.
 * Invalid characters (digits/emoji/symbols) flag the field red + show a hint.
 */
export default function NameFields({ value, onChange }) {
  const { t } = useTranslation('pages');
  const k = (key, dv) => t(`admin.nameFields.${key}`, dv);

  const fields = [
    { key: 'first', label: k('firstName', 'First name'), required: true },
    { key: 'middle', label: k('middleName', 'Middle name'), required: false },
    { key: 'last', label: k('lastName', 'Last name'), required: true },
    { key: 'second', label: k('secondLastName', 'Second last name'), required: false },
  ];

  const anyInvalid = fields.some((f) => (value[f.key] || '').trim() && !isValidNamePart(value[f.key]));

  const baseStyle = {
    background: 'var(--color-bg-input, var(--color-bg-elevated))',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => {
          const invalid = (value[f.key] || '').trim() && !isValidNamePart(value[f.key]);
          return (
            <div key={f.key}>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {f.label}{f.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
              </label>
              <input
                type="text"
                value={value[f.key] || ''}
                onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
                autoComplete="off"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                style={{ ...baseStyle, border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-border-subtle)'}` }}
              />
            </div>
          );
        })}
      </div>
      {anyInvalid && (
        <p className="text-[11px]" style={{ color: 'var(--color-danger)' }}>
          {k('nameInvalid', 'Names can only contain letters, spaces, hyphens and apostrophes.')}
        </p>
      )}
    </div>
  );
}

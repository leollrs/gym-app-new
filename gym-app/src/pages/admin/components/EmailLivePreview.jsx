import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { replaceVariables } from '../../../lib/admin/emailTemplateRenderer';

/**
 * Renders the right-side WYSIWYG preview pane in the email template editor.
 * Mirrors the layout of the generated email HTML so admins see what their
 * tweaks look like before sending. Pure presentational — no state, no fetches.
 */
export default function EmailLivePreview({ template, gymName, gymLogoUrl }) {
  const c = template.colors;
  const { t } = useTranslation('pages');

  const renderBody = (text) => {
    if (!text) return null;
    const resolved = replaceVariables(text, gymName);
    return resolved.split('\n').map((line, i) => {
      if (line.startsWith('---') && line.endsWith('---')) {
        const inner = line.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        return <h3 key={i} style={{ fontSize: 14, fontWeight: 700, color: c.primary, margin: '20px 0 8px', letterSpacing: '-0.01em' }}>{inner}</h3>;
      }
      if (line.startsWith('- ')) return <li key={i} style={{ margin: '4px 0', color: c.text, fontSize: 13, lineHeight: 1.7, paddingLeft: 4 }}>{line.slice(2)}</li>;
      if (!line.trim()) return <div key={i} style={{ height: 10 }} />;
      return <p key={i} style={{ margin: '0 0 8px', lineHeight: 1.7, color: c.text, fontSize: 13, letterSpacing: '0.01em' }}>{line}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
        <Eye size={14} className="text-[#D4AF37]" />
        <span className="text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          {t('admin.emailTemplates.preview')}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4" style={{ background: '#1a1a2e' }}>
        <div
          style={{
            maxWidth: 600,
            margin: '0 auto',
            background: '#ffffff',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          {/* Header */}
          {template.header.enabled && (
            <>
              <div style={{ padding: '24px 32px 20px', textAlign: 'center' }}>
                {template.header.showLogo && gymLogoUrl && (
                  <img src={gymLogoUrl} alt={gymName} style={{ maxHeight: 40, marginBottom: 12, display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                )}
                {template.header.text && (
                  <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: c.primary, letterSpacing: '-0.02em' }}>
                    {replaceVariables(template.header.text, gymName)}
                  </h1>
                )}
              </div>
              <div style={{ margin: '0 32px', height: 1, background: `linear-gradient(90deg, transparent, ${c.primary}40, transparent)` }} />
            </>
          )}

          {/* Hero */}
          {template.hero.enabled && (
            template.hero.imageUrl ? (
              <img src={template.hero.imageUrl} alt="Email hero banner" style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover' }} />
            ) : (
              <div style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.primary}cc, ${c.primary}99)`, padding: '48px 32px', textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                  {replaceVariables(template.hero.headline, gymName)}
                </h2>
                {template.hero.subtitle && (
                  <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.88)', lineHeight: 1.5, fontWeight: 400 }}>
                    {replaceVariables(template.hero.subtitle, gymName)}
                  </p>
                )}
              </div>
            )
          )}

          {/* Body */}
          <div style={{ padding: '28px 32px 16px' }}>
            {renderBody(template.body.text)}
          </div>

          {/* CTA */}
          {template.cta.enabled && template.cta.text && (
            <div style={{ padding: '4px 32px 32px', textAlign: 'center' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '14px 36px',
                  background: template.cta.color,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 50,
                  textDecoration: 'none',
                  letterSpacing: '0.02em',
                  boxShadow: `0 4px 14px ${template.cta.color}44, 0 2px 6px rgba(0,0,0,0.08)`,
                }}
              >
                {replaceVariables(template.cta.text, gymName)}
              </span>
            </div>
          )}

          {/* Footer */}
          {template.footer.enabled && (
            <>
              <div style={{ margin: '0 32px', height: 1, background: '#f0f0f0' }} />
              <div style={{ padding: '20px 32px 24px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--color-admin-text-muted)', lineHeight: 1.5 }}>
                  {replaceVariables(template.footer.text, gymName)}
                </p>
                {template.footer.unsubscribeText && (
                  <span style={{ fontSize: 10, color: 'var(--color-admin-text-sub)', textDecoration: 'underline' }}>
                    {template.footer.unsubscribeText}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

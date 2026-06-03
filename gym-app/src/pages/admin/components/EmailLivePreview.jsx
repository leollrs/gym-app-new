import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { replaceVariables, rewardQrPayload } from '../../../lib/admin/emailTemplateRenderer';

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
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Eye size={14} style={{ color: 'var(--color-accent)' }} />
        <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em' }}>
          {t('admin.emailTemplates.preview')}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4" style={{ background: '#0b0b12' }}>
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

          {/* Reward — mirrors the same `reward?.enabled && reward?.title`
              gate the HTML renderer uses (emailTemplateRenderer.js), so what
              the admin sees here matches what actually ships. */}
          {template.reward?.enabled && template.reward?.title && (
            <div style={{ padding: '4px 32px 16px' }}>
              <div
                style={{
                  background: `linear-gradient(135deg, ${c.primary}08, ${c.primary}15)`,
                  border: `2px dashed ${c.primary}40`,
                  borderRadius: 12,
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: c.primary,
                    textTransform: 'uppercase',
                    letterSpacing: 2,
                  }}
                >
                  {template.reward.title.startsWith('🎁') ? '' : '🎁 '}
                  {template.reward.title}
                </p>
                {template.reward.description && (
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: c.text, lineHeight: 1.5 }}>
                    {template.reward.description}
                  </p>
                )}
                {/* Auto-generated QR — mirrors the rendered email so admins
                    see the same redemption artifact they're shipping. */}
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                  <div style={{ padding: 8, background: '#fff', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <QRCodeSVG value={rewardQrPayload(template.reward)} size={120} level="M" includeMargin={false} />
                  </div>
                </div>
                {template.reward.code && (
                  <p style={{
                    margin: '10px 0 0',
                    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
                    fontSize: 12, fontWeight: 700, letterSpacing: 3, color: c.text,
                  }}>
                    {template.reward.code}
                  </p>
                )}
                {template.reward.expiry && (
                  <p style={{ margin: '6px 0 0', fontSize: 10.5, color: '#9aa0a6' }}>
                    {template.reward.expiry}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* CTA — render as a real anchor so the preview button is actually
              clickable, matching what recipients get in the sent email. */}
          {template.cta.enabled && template.cta.text && (
            <div style={{ padding: '4px 32px 32px', textAlign: 'center' }}>
              <a
                href={template.cta.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
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
              </a>
            </div>
          )}

          {/* Footer */}
          {template.footer.enabled && (
            <>
              <div style={{ margin: '0 32px', height: 1, background: '#f0f0f0' }} />
              <div style={{ padding: '20px 32px 24px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: '#9aa0a6', lineHeight: 1.5 }}>
                  {replaceVariables(template.footer.text, gymName)}
                </p>
                {template.footer.unsubscribeText && (
                  <span style={{ fontSize: 10, color: '#9aa0a6', textDecoration: 'underline' }}>
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

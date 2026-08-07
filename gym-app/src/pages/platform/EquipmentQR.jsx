import React, { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { STATIONS, equipmentDeepLink } from '../../data/equipmentStations';

// Las tres familias del diseño de la etiqueta, cargadas SOLO en esta pantalla.
// En el bundle global costarían en toda la app por una página que casi no se abre.
const TAG_FONTS = 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400&family=JetBrains+Mono:wght@400;500&display=swap';

/**
 * Printable equipment-QR pack — a PLATFORM/super-admin tool. The QR codes are
 * universal (tugympr://equipment/<slug> works at every gym), so the operator
 * prints this once and places one on each machine during gym install. A member
 * scans it (in-app or with their phone camera) → jumps to that station's exercises.
 */
export default function EquipmentQR() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const spanish = (i18n.language || '').toLowerCase().startsWith('es');

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TAG_FONTS;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-admin-bg, #f6f7f9)' }}>
      <style>{`
        @media print {
          .eq-noprint { display: none !important; }
          .eq-sheet { padding: 0 !important; }
          .eq-card { break-inside: avoid; border: 1px solid #ddd !important; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="eq-noprint" style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--color-admin-panel, #fff)', borderBottom: '1px solid var(--color-admin-border, #e5e7eb)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} aria-label="Back" style={{ background: 'none', border: 'none', display: 'flex', color: 'var(--color-admin-text, #111)' }}>
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 24, textTransform: 'uppercase', color: 'var(--color-admin-text, #111)', lineHeight: 1 }}>
            {spanish ? 'Códigos QR de Equipos' : 'Equipment QR Pack'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-admin-text-muted, #667)', marginTop: 2 }}>
            {spanish ? 'Imprime, recorta y pega uno en cada máquina durante la instalación. Los miembros lo escanean para ver los ejercicios.' : 'Print, cut out, and place one on each machine during install. Members scan it to see the exercises.'}
          </p>
        </div>
        <button onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--color-admin-accent, #111)', color: '#fff', fontWeight: 700, fontSize: 14 }}>
          <Printer size={17} /> {spanish ? 'Imprimir' : 'Print'}
        </button>
      </div>

      {/* Print sheet */}
      <div className="eq-sheet" style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, maxWidth: 900, margin: '0 auto' }}>
        {STATIONS.map((s) => (
          <div key={s.slug} className="eq-card"
            style={{ background: '#fff', border: '1px solid var(--color-admin-border, #e5e7eb)', borderRadius: 12, padding: '22px 16px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 19, lineHeight: 1.12, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#0E1012' }}>
              {spanish ? s.name_es : s.name}
            </div>
            {s.name_es !== s.name && (
              <div style={{ marginTop: 7, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 8, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#7A736A' }}>
                {spanish ? s.name : s.name_es}
              </div>
            )}
            <div style={{ width: 56, height: 1, background: '#E8A02A', margin: '15px 0 16px' }} />
            <QRCodeSVG value={equipmentDeepLink(s.slug)} size={140} level="M" marginSize={0}
              bgColor="#ffffff" fgColor="#0E1012" />
            <div style={{ marginTop: 16, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#0E1012' }}>
              {spanish ? 'Escanea para ver ejercicios' : 'Scan for exercises'}
            </div>
            <div style={{ marginTop: 5, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 7.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#7A736A' }}>
              {spanish ? 'Scan for exercises' : 'Escanea para ver ejercicios'}
            </div>
            <div style={{ marginTop: 12, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 7.5, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#B8BEC5' }}>TuGymPR</div>
          </div>
        ))}
      </div>
    </div>
  );
}

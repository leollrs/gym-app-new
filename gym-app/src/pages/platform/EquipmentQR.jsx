import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { STATIONS, equipmentDeepLink } from '../../data/equipmentStations';

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
            style={{ background: '#fff', border: '1px solid var(--color-admin-border, #e5e7eb)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }}>{s.emoji}</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#111', lineHeight: 1.1 }}>{s.name}</div>
            {s.name_es !== s.name && <div style={{ fontSize: 12, color: '#666', marginTop: -4 }}>{s.name_es}</div>}
            <QRCodeSVG value={equipmentDeepLink(s.slug)} size={140} level="M" includeMargin
              style={{ marginTop: 4 }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#888' }}>
              {spanish ? 'Escanea para ver ejercicios' : 'Scan to see exercises'}
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#D8A93A' }}>TUGYMPR</div>
          </div>
        ))}
      </div>
    </div>
  );
}

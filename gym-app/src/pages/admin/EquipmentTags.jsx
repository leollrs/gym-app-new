// Etiquetas de equipo — la hoja imprimible que se pega en cada máquina.
//
// Tres cosas que NO se copian del mockup, a propósito:
//
//   1. La URL del QR. El mockup codifica https://tugympr.com/e/<gym>/<code>, que
//      no existe. Aquí se usa equipmentQrUrl(), la misma que verifica el test de
//      ida y vuelta y que ya responde en producción. Copiar la del mockup habría
//      impreso pegatinas muertas — y el fallo solo se descubre en la pared.
//   2. Las máquinas. El mockup lista 16 inventadas; aquí van las 36 reales de
//      equipmentStations.js, que es lo que el escáner sabe resolver.
//   3. El nombre. El mockup trae "Atlas Strength" fijo; aquí sale el gimnasio de
//      la sesión. Es el punto entero de la pantalla: la etiqueta lleva la marca
//      del gimnasio, no la nuestra. La versión anterior estampaba "TUGYMPR" en
//      cada pegatina, que es justo lo contrario de un producto de marca blanca.
//
// La paleta es clara y fija, no la del tema. Lo que se ve en pantalla es PAPEL:
// tiene que parecerse a lo que sale de la impresora, y en oscuro mentiría.
import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { STATIONS } from '../../data/equipmentStations';
import { equipmentQrUrl } from '../../lib/appUrls';
import { useAuth } from '../../contexts/AuthContext';

const isEs = (i18n) => (i18n.language || '').toLowerCase().startsWith('es');

// Carta con 0.5in de margen. El número por hoja se CALCULA, no se escribe a
// mano: si mañana entra otro tamaño, la cuenta de planchas sigue siendo cierta.
const PAGE_W = 7.5, PAGE_H = 10;
const SIZES = [
  { key: 'md', w: 3, h: 4, es: 'Mediana', en: 'Medium' },
  { key: 'sm', w: 2, h: 3, es: 'Pequeña', en: 'Small' },
  { key: 'lg', w: 4, h: 6, es: 'Grande', en: 'Large' },
];
const perSheet = (s) => Math.max(1, Math.floor(PAGE_W / s.w) * Math.floor(PAGE_H / s.h));

// Código de inventario correlativo (M-01…M-36). No vive en la base: es una
// etiqueta para que el dueño sepa cuál pegó dónde, no un identificador.
const invCode = (i) => 'M-' + String(i + 1).padStart(2, '0');

const FONTS = 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400&family=Archivo:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';

export default function EquipmentTags() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { gymName } = useAuth();
  const spanish = isEs(i18n);

  const [sizeKey, setSizeKey] = useState('md');
  const [bilingual, setBilingual] = useState(true);
  const [showGym, setShowGym] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [cutMarks, setCutMarks] = useState(true);
  const [selected, setSelected] = useState(() => new Set(STATIONS.map((s) => s.slug)));

  // Las tres familias del diseño se cargan SOLO aquí. Meterlas en el bundle
  // global costaría en cada pantalla de la app por una que casi no se abre.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  const size = SIZES.find((s) => s.key === sizeKey) || SIZES[0];
  const sheets = Math.ceil(selected.size / perSheet(size)) || 0;

  const toggle = (slug) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
  });

  // La escala de la tarjeta en pantalla. La geometría se define en pulgadas
  // reales (lo que se imprime) y sólo se ESCALA para caber en la rejilla, así
  // que la vista previa no puede desviarse de lo impreso.
  const k = useMemo(() => 240 / (size.w * 96), [size]);

  const t = (es, en) => (spanish ? es : en);

  return (
    <div className="eqt">
      <style>{CSS}</style>

      <header className="eqt-top eqt-noprint">
        <button className="eqt-back" onClick={() => navigate(-1)} aria-label={t('Volver', 'Back')}>
          <ArrowLeft size={19} />
        </button>
        <div className="eqt-ttl">
          <h1>{t('Etiquetas de equipo', 'Equipment tags')}</h1>
          <p>{t(
            'Una etiqueta por máquina. El socio la escanea y ve los ejercicios que puede hacer ahí. Llevan el nombre de tu gimnasio, no el nuestro.',
            'One tag per machine. A member scans it and sees the exercises they can do there. They carry your gym’s name, not ours.',
          )}</p>
        </div>
        <div className="eqt-acts">
          <button className="eqt-btn eqt-pri" onClick={() => window.print()} disabled={!selected.size}>
            <Printer size={16} /> {t('Imprimir', 'Print')}
          </button>
        </div>
      </header>

      <div className="eqt-body">
        <aside className="eqt-rail eqt-noprint">
          <section className="eqt-sec">
            <h3>{t('Tamaño', 'Size')}</h3>
            <div className="eqt-opts">
              {SIZES.map((s) => (
                <button key={s.key} className={`eqt-opt${s.key === sizeKey ? ' on' : ''}`} onClick={() => setSizeKey(s.key)}>
                  <span className="eqt-dot" />{spanish ? s.es : s.en}
                  <small>{s.w} × {s.h} in</small>
                </button>
              ))}
            </div>
          </section>

          <section className="eqt-sec">
            <h3>{t('Idioma', 'Language')}</h3>
            <div className="eqt-opts">
              <button className={`eqt-opt${bilingual ? ' on' : ''}`} onClick={() => setBilingual(true)}>
                <span className="eqt-dot" />{t('Español + inglés', 'English + Spanish')}
              </button>
              {/* La etiqueta pone PRIMERO el idioma de la app, así que la opción
                  de un solo idioma tiene que nombrar ESE, no siempre español.
                  Decía «Spanish only» con la app en inglés y los nombres salían
                  en inglés — la opción se contradecía a sí misma. */}
              <button className={`eqt-opt${bilingual ? '' : ' on'}`} onClick={() => setBilingual(false)}>
                <span className="eqt-dot" />{t('Solo español', 'English only')}
              </button>
            </div>
          </section>

          <section className="eqt-sec">
            <h3>{t('Contenido', 'Content')}</h3>
            <div className="eqt-opts">
              <Switch on={showGym} onClick={() => setShowGym((v) => !v)}
                label={t('Nombre del gimnasio', 'Gym name')} hint={gymName || t('Sin nombre de gimnasio', 'No gym name')} />
              <Switch on={showCode} onClick={() => setShowCode((v) => !v)}
                label={t('Código de inventario', 'Inventory code')} hint="M-01, M-02…" />
              <Switch on={cutMarks} onClick={() => setCutMarks((v) => !v)}
                label={t('Marcas de corte', 'Cut marks')} hint={t('Para imprenta profesional', 'For a professional print shop')} />
            </div>
          </section>

          <div className="eqt-tally">
            <div className="eqt-r"><span>{t('Seleccionadas', 'Selected')}</span><b>{selected.size} {t('de', 'of')} {STATIONS.length}</b></div>
            <div className="eqt-r"><span>{t('Planchas', 'Sheets')}</span><b>{sheets}</b></div>
            <div className="eqt-r"><span>{t('Papel', 'Paper')}</span><b>{t('Carta', 'Letter')}</b></div>
            <p className="eqt-hint">{t(
              'Imprime en papel adhesivo mate y pídele laminado al taller. Sin laminado la tinta no aguanta un mes en el gimnasio.',
              'Print on matte sticker paper and ask the shop to laminate. Unlaminated ink does not survive a month in a gym.',
            )}</p>
          </div>
        </aside>

        <main className="eqt-main">
          <div className="eqt-mhead eqt-noprint">
            <div className="eqt-cnt">
              {STATIONS.length} {t('máquinas', 'machines')} · {perSheet(size)} {t('por hoja', 'per sheet')}
            </div>
            <div className="eqt-lnk">
              <button onClick={() => setSelected(new Set(STATIONS.map((s) => s.slug)))}>{t('Seleccionar todas', 'Select all')}</button>
              <button onClick={() => setSelected(new Set())}>{t('Ninguna', 'None')}</button>
            </div>
          </div>

          <div className="eqt-sheet">
            {STATIONS.map((s, i) => {
              const on = selected.has(s.slug);
              return (
                <div key={s.slug} className={`eqt-cell${on ? ' sel' : ''}`}>
                  <button className="eqt-chk eqt-noprint" onClick={() => toggle(s.slug)}
                    aria-pressed={on} aria-label={spanish ? s.name_es : s.name}>
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                  </button>
                  <div className="eqt-paper" style={{ width: size.w * 96 * k, height: size.h * 96 * k }}>
                    <Tag station={s} size={size} scale={k} gym={showGym ? gymName : null}
                      code={showCode ? invCode(i) : null} bilingual={bilingual} cutMarks={cutMarks} spanish={spanish} />
                  </div>
                  <div className="eqt-cap eqt-noprint">
                    <b>{spanish ? s.name_es : s.name}</b><span>{invCode(i)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

function Switch({ on, onClick, label, hint }) {
  return (
    <button className={`eqt-sw${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span>{label}<i>{hint}</i></span>
      <span className="eqt-track" />
    </button>
  );
}

// La cara impresa. Todo en pt/in sobre un lienzo de pulgadas reales, escalado
// con transform para la vista previa — una sola geometría para pantalla y papel.
function Tag({ station, size, scale, gym, code, bilingual, cutMarks, spanish }) {
  const primary = spanish ? station.name_es : station.name;
  const secondary = spanish ? station.name : station.name_es;
  // A 2×3in el nombre no cabe al mismo cuerpo; el resto de la retícula es
  // proporcional, así que sólo el tipo necesita su propia escala.
  const nameSize = size.w <= 2 ? 13 : size.w >= 4 ? 25 : 19;

  return (
    <div className="eqt-tag" style={{ width: `${size.w}in`, height: `${size.h}in`, transform: `scale(${scale})` }}>
      {cutMarks && <span className="eqt-marks" aria-hidden="true" />}
      <div className="eqt-safe">
        {gym && <div className="eqt-gym">{gym}</div>}
        {gym && <div className="eqt-hair" />}
        <div className="eqt-mid">
          <div className="eqt-name" style={{ fontSize: `${nameSize}pt` }}>{primary}</div>
          {bilingual && secondary !== primary && <div className="eqt-en">{secondary}</div>}
          <div className="eqt-rule" />
          <div className="eqt-qr" style={{ width: `${size.w * 0.48}in`, height: `${size.w * 0.48}in` }}>
            {/* level="M" + margen 0: el marco blanco lo da la zona segura de la
                etiqueta, así que un quiet zone extra sólo encoge los módulos. */}
            <QRCodeSVG value={equipmentQrUrl(station.slug)} level="M" marginSize={0}
              bgColor="#ffffff" fgColor="#0E1012" style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>
        <div className="eqt-foot">
          <div className="eqt-cta">{spanish ? 'Escanea para ver ejercicios' : 'Scan for exercises'}</div>
          {bilingual && <div className="eqt-cta2">{spanish ? 'Scan for exercises' : 'Escanea para ver ejercicios'}</div>}
          {code && <div className="eqt-code">{code}</div>}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.eqt{--bg:#f0eee9;--elev:#faf8f3;--surface:#fff;--surface2:#f7f5f0;--borderSolid:#e8e4db;
  --text:#0B0F12;--sub:#5A6570;--mute:#96A0AA;--faint:#b8bec5;
  --accent:#19B8B8;--accentDark:#0F9E9E;--accentSoft:#D9F1F1;--accentInk:#08585A;
  --ink:#0E1012;--ink2:#2A2723;--amber:#E8A02A;--pmute:#7A736A;
  --shadow:0 1px 2px rgba(15,20,25,.03),0 6px 20px rgba(15,20,25,.04);
  min-height:100vh;background:var(--bg);color:var(--text);
  font-family:'Archivo',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.eqt *{box-sizing:border-box}
.eqt button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
.eqt button:disabled{opacity:.45;cursor:not-allowed}

.eqt-top{background:var(--elev);border-bottom:1px solid var(--borderSolid);padding:22px 32px 20px;display:flex;align-items:flex-start;gap:20px}
.eqt-back{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:var(--sub);margin-top:2px}
.eqt-back:hover{background:var(--surface2);color:var(--text)}
.eqt-ttl{flex:1;min-width:0}
/* color y familia EXPLÍCITOS: hay una regla global de h1 pensada para la app
   oscura que mete Barlow Condensed y rgb(232,230,225) — blanco roto, invisible
   sobre este crema. Heredar aquí no basta; el h1 gana por especificidad. */
.eqt-ttl h1{font-family:'Archivo',-apple-system,system-ui,sans-serif;color:var(--text);font-weight:800;font-size:23px;letter-spacing:-.01em;margin:0;text-transform:none}
.eqt-ttl p{margin:5px 0 0;font-size:13.5px;line-height:1.5;color:var(--sub);max-width:620px}
.eqt-acts{display:flex;gap:10px;align-items:center}
.eqt-btn{height:38px;padding:0 16px;border-radius:10px;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px;border:1px solid var(--borderSolid);background:var(--surface);color:var(--text)}
.eqt-btn:hover:not(:disabled){background:var(--surface2)}
.eqt-pri{background:var(--accent);border-color:var(--accent);color:#fff}
.eqt-pri:hover:not(:disabled){background:var(--accentDark);border-color:var(--accentDark)}

.eqt-body{display:flex;align-items:flex-start}
.eqt-rail{width:296px;flex:none;padding:24px;border-right:1px solid var(--borderSolid);display:flex;flex-direction:column;gap:22px;position:sticky;top:0}
.eqt-sec>h3{margin:0 0 12px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--mute);font-weight:500}
.eqt-opts{display:flex;flex-direction:column;gap:7px}
.eqt-opt{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:10px;border:1px solid var(--borderSolid);background:var(--surface);font-size:13.5px;text-align:left;width:100%}
.eqt-opt:hover{border-color:var(--faint)}
.eqt-opt.on{border-color:var(--accent);background:var(--accentSoft);color:var(--accentInk);font-weight:600}
.eqt-dot{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--faint);flex:none;display:grid;place-items:center}
.eqt-opt.on .eqt-dot{border-color:var(--accent)}
.eqt-opt.on .eqt-dot::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent)}
.eqt-opt small{margin-left:auto;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;color:var(--mute);font-weight:400}
.eqt-opt.on small{color:var(--accentInk)}
.eqt-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;border-radius:10px;border:1px solid var(--borderSolid);background:var(--surface);font-size:13.5px;width:100%;text-align:left}
.eqt-sw>span:first-child{flex:1;min-width:0}
.eqt-sw i{font-style:normal;display:block;font-size:11.5px;color:var(--mute);margin-top:3px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eqt-track{width:38px;height:22px;border-radius:11px;background:#dcd8cf;flex:none;position:relative;transition:background .15s}
.eqt-track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}
.eqt-sw.on .eqt-track{background:var(--accent)}
.eqt-sw.on .eqt-track::after{left:19px}
.eqt-tally{background:var(--surface2);border:1px solid var(--borderSolid);border-radius:12px;padding:15px 16px;display:flex;flex-direction:column;gap:9px}
.eqt-r{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--sub)}
.eqt-r b{font-weight:700;font-size:15px;color:var(--text)}
.eqt-hint{font-size:11.5px;line-height:1.5;color:var(--mute);border-top:1px solid var(--borderSolid);padding-top:9px;margin:1px 0 0}

.eqt-main{flex:1;padding:24px 32px 44px;min-width:0}
.eqt-mhead{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.eqt-cnt{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute)}
.eqt-lnk{margin-left:auto;display:flex;gap:16px;font-size:13px;font-weight:600;color:var(--accentDark)}
.eqt-lnk button:hover{color:var(--accentInk)}
.eqt-sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;justify-items:start}
.eqt-cell{position:relative}
.eqt-chk{position:absolute;left:11px;top:11px;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--borderSolid);background:rgba(255,255,255,.9);z-index:2;display:grid;place-items:center;color:#fff;padding:0}
.eqt-cell.sel .eqt-chk{background:var(--accent);border-color:var(--accent)}
.eqt-cell:hover .eqt-chk{border-color:var(--accent)}
.eqt-paper{border-radius:3px;overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--borderSolid);transition:box-shadow .15s,transform .15s;background:#fff}
.eqt-cell:hover .eqt-paper{box-shadow:0 2px 4px rgba(15,20,25,.05),0 14px 30px rgba(15,20,25,.09);transform:translateY(-2px)}
.eqt-cell.sel .eqt-paper{box-shadow:0 0 0 2px var(--accent),0 8px 22px rgba(15,20,25,.08)}
.eqt-cap{display:flex;align-items:baseline;gap:8px;margin-top:10px;padding:0 2px}
.eqt-cap b{font-size:13px;font-weight:600;letter-spacing:-.005em}
.eqt-cap span{margin-left:auto;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;color:var(--faint)}

/* la cara impresa — geometría en pulgadas reales */
.eqt-tag{position:relative;background:#fff;color:var(--ink);overflow:hidden;transform-origin:top left}
.eqt-marks{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(#0E1012,#0E1012) 0 0/.16in .4pt no-repeat,
             linear-gradient(#0E1012,#0E1012) 100% 0/.16in .4pt no-repeat,
             linear-gradient(#0E1012,#0E1012) 0 100%/.16in .4pt no-repeat,
             linear-gradient(#0E1012,#0E1012) 100% 100%/.16in .4pt no-repeat,
             linear-gradient(#0E1012,#0E1012) 0 0/.4pt .16in no-repeat,
             linear-gradient(#0E1012,#0E1012) 100% 0/.4pt .16in no-repeat,
             linear-gradient(#0E1012,#0E1012) 0 100%/.4pt .16in no-repeat,
             linear-gradient(#0E1012,#0E1012) 100% 100%/.4pt .16in no-repeat;
  opacity:.35}
.eqt-safe{position:absolute;inset:.25in;display:flex;flex-direction:column}
.eqt-gym{text-align:center;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:6.5pt;letter-spacing:.34em;text-transform:uppercase;color:var(--ink2);line-height:1.3}
.eqt-hair{height:.5pt;background:rgba(14,16,18,.2);margin-top:10pt}
.eqt-mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:0}
.eqt-name{font-family:'Newsreader',Georgia,serif;font-weight:400;text-transform:uppercase;letter-spacing:.13em;line-height:1.12}
.eqt-en{margin-top:7pt;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:6pt;letter-spacing:.26em;text-transform:uppercase;color:var(--pmute)}
.eqt-rule{width:.8in;height:.6pt;background:var(--amber);margin:15pt 0 16pt}
.eqt-qr svg{display:block}
.eqt-foot{text-align:center}
.eqt-cta{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:7pt;letter-spacing:.2em;text-transform:uppercase;color:var(--ink)}
.eqt-cta2{margin-top:4pt;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:5.5pt;letter-spacing:.2em;text-transform:uppercase;color:var(--pmute)}
.eqt-code{margin-top:6pt;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:5.5pt;letter-spacing:.24em;color:var(--faint)}

@media print{
  .eqt-noprint{display:none !important}
  .eqt{background:#fff}
  .eqt-body{display:block}
  .eqt-main{padding:0}
  /* Sin seleccionar = no se imprime. Es lo que hace que la casilla signifique
     algo: elegir 3 máquinas y gastar 9 hojas en blanco sería peor que nada. */
  .eqt-cell:not(.sel){display:none}
  .eqt-sheet{display:block}
  .eqt-cell{break-inside:avoid;page-break-inside:avoid;display:inline-block;vertical-align:top;margin:0}
  .eqt-paper{box-shadow:none;border:none;border-radius:0;width:auto !important;height:auto !important;transform:none}
  /* A papel se imprime a tamaño REAL: fuera la escala de la vista previa. */
  .eqt-tag{transform:none !important}
}
`;

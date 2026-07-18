import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ScanLine, Star, Dumbbell, LayoutGrid, LayoutList, ChevronRight } from 'lucide-react';
import { getExercises } from '../lib/exerciseStore';
const ALL_EXERCISES = getExercises();
import { Capacitor } from '@capacitor/core';
import { STATIONS, STATION_GROUPS, stationBySlug, stationFor, parseEquipmentSlug, difficultyFor } from '../data/equipmentStations';
import { ExerciseCard } from './ExerciseLibrary';
import ExerciseVideoThumb from '../components/ExerciseVideoThumb';
import { foodImageUrl } from '../lib/imageUrl';
import { exName } from '../lib/exerciseName';
import { useToast } from '../contexts/ToastContext';
import WebQrScanModal from '../components/WebQrScanModal';

// Station hero: prefer an uploaded equipment photo (food-images/equipment/<slug>.jpg),
// fall back to a representative exercise's video first-frame until the photo exists.
function StationHero({ station, rep, fill = false, size = 48, radius = 13 }) {
  const [broken, setBroken] = useState(false);
  const src = station?.slug ? foodImageUrl(`/equipment/${station.slug}.jpg`) : null;
  if (!src || broken) {
    return <ExerciseVideoThumb exercise={rep} fill={fill} size={fill ? undefined : size} radius={fill ? undefined : radius} showBadge={false} />;
  }
  if (fill) {
    return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)}
    style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0, background: 'var(--color-border-subtle)' }} />;
}

// Precompute station name → exercises once (module scope, cheap over ~305).
const BY_STATION = (() => {
  const m = {};
  for (const e of ALL_EXERCISES) {
    const s = stationFor(e);
    if (!s) continue;
    (m[s] ||= []).push(e);
  }
  return m;
})();

// One representative exercise per station for the browse tile hero — prefer one
// that actually has a demo video so the tile shows real movement.
const REP_BY_STATION = (() => {
  const m = {};
  for (const [name, list] of Object.entries(BY_STATION)) {
    m[name] = list.find((e) => e.videoUrl) || list[0];
  }
  return m;
})();

const es = (i18n) => (i18n.language || '').toLowerCase().startsWith('es');

/* ── Scan button — a clear, labeled action so it's obvious what it does. ───── */
function ScanButton({ onScan, spanish }) {
  return (
    <button onClick={onScan} aria-label={spanish ? 'Escanear el QR de una máquina' : 'Scan a machine QR'}
      className="active:scale-[0.98] transition-transform"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 12, padding: 12, borderRadius: 14,
        background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)', border: 'none',
        boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 28%, transparent)' }}>
      <ScanLine size={19} strokeWidth={2.4} />
      <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.01em' }}>{spanish ? 'Escanear QR de máquina' : 'Scan machine QR'}</span>
    </button>
  );
}

// A full-bleed photo tile (equipment station or category cover).
function BrowseTile({ station, rep, title, sub, onClick }) {
  return (
    <button onClick={onClick} className="active:scale-[0.98] transition-transform"
      style={{ position: 'relative', textAlign: 'left', aspectRatio: '1 / 1', borderRadius: 18, overflow: 'hidden',
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      <StationHero station={station} rep={rep} fill />
      <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,13,16,0.86) 0%, rgba(10,13,16,0.28) 46%, rgba(10,13,16,0.05) 100%)' }} />
      <span style={{ position: 'absolute', left: 12, right: 12, bottom: 11, color: '#fff' }}>
        <span style={{ display: 'block', fontWeight: 800, fontSize: 15.5, lineHeight: 1.15, letterSpacing: '-0.01em', textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>
          {title}
        </span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--color-accent)', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>
          {sub}
        </span>
      </span>
    </button>
  );
}

// List-row variant of BrowseTile — thumbnail + title + count, for list view.
function BrowseRow({ station, rep, title, sub, onClick }) {
  return (
    <button onClick={onClick} className="active:scale-[0.99] transition-transform"
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: 10, borderRadius: 14,
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      <StationHero station={station} rep={rep} size={52} radius={12} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 800, fontSize: 15, lineHeight: 1.15, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 700, color: 'var(--color-accent)' }}>{sub}</span>
      </span>
      <ChevronRight size={17} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
    </button>
  );
}

// Grid ⇄ list, shared across both browse levels. Persisted so the choice sticks.
function useBrowseView() {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem('equipment.viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const set = (mode) => { setV(mode); try { localStorage.setItem('equipment.viewMode', mode); } catch { /* ignore */ } };
  return [v, set];
}

function ViewToggle({ viewMode, setViewMode, spanish }) {
  const btn = (mode, Icon, label) => (
    <button type="button" onClick={() => setViewMode(mode)} aria-label={label} aria-pressed={viewMode === mode}
      style={{ display: 'flex', padding: '5px 8px', borderRadius: 8, border: 'none',
        background: viewMode === mode ? 'var(--color-bg-card)' : 'transparent',
        color: viewMode === mode ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
      <Icon size={15} />
    </button>
  );
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, padding: 3, borderRadius: 10, background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
      {btn('grid', LayoutGrid, spanish ? 'Cuadrícula' : 'Grid')}
      {btn('list', LayoutList, spanish ? 'Lista' : 'List')}
    </div>
  );
}

function BrowseSection({ items, viewMode }) {
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(({ key, ...it }) => <BrowseRow key={key} {...it} />)}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {items.map(({ key, ...it }) => <BrowseTile key={key} {...it} />)}
    </div>
  );
}

/* ── Level 1: pick a category (Free Weights, Machines, …) ─────────────────── */
function StationCategories({ onScan }) {
  const { i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const spanish = es(i18n);

  const [viewMode, setViewMode] = useBrowseView();
  const groups = STATION_GROUPS.map((g) => {
    const stations = STATIONS.filter((s) => s.group === g.key && (BY_STATION[s.name]?.length));
    return { ...g, stations };
  }).filter((g) => g.stations.length);
  const items = groups.map((g) => {
    const hero = g.stations[0];
    const n = g.stations.length;
    return {
      key: g.key, station: hero, rep: REP_BY_STATION[hero?.name],
      title: spanish ? g.label_es : g.label,
      sub: `${n} ${spanish ? (n === 1 ? 'estación' : 'estaciones') : (n === 1 ? 'station' : 'stations')}`,
      onClick: () => navigate(`/equipment/${g.key}`),
    };
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 96 }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-subtle)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            style={{ background: 'none', border: 'none', padding: 4, color: 'var(--color-text)', display: 'flex' }}>
            <ArrowLeft size={22} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 26, lineHeight: 1, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.01em' }}>
              {spanish ? 'Equipo' : 'Equipment'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-subtle)', marginTop: 2 }}>
              {spanish ? 'Elige una categoría, o escanea el código de una máquina' : 'Pick a category, or scan a machine’s code'}
            </p>
          </div>
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} spanish={spanish} />
        </div>
        <ScanButton onScan={onScan} spanish={spanish} />
      </header>

      <div style={{ padding: 16 }}>
        <BrowseSection items={items} viewMode={viewMode} />
      </div>
    </div>
  );
}

/* ── Level 2: equipment within a category ─────────────────────────────────── */
function StationEquipment({ group, onScan }) {
  const { i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const spanish = es(i18n);
  const [viewMode, setViewMode] = useBrowseView();
  const stations = STATIONS.filter((s) => s.group === group.key && (BY_STATION[s.name]?.length));
  const items = stations.map((s) => {
    const count = BY_STATION[s.name]?.length || 0;
    return {
      key: s.slug, station: s, rep: REP_BY_STATION[s.name],
      title: spanish ? s.name_es : s.name,
      sub: `${count} ${spanish ? (count === 1 ? 'ejercicio' : 'ejercicios') : (count === 1 ? 'exercise' : 'exercises')}`,
      onClick: () => navigate(`/equipment/${s.slug}`),
    };
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 96 }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-subtle)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            style={{ background: 'none', border: 'none', padding: 4, color: 'var(--color-text)', display: 'flex' }}>
            <ArrowLeft size={22} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 26, lineHeight: 1, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {spanish ? group.label_es : group.label}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-subtle)', marginTop: 2 }}>
              {spanish ? 'Toca un equipo para ver sus ejercicios' : 'Tap a piece of equipment to see its exercises'}
            </p>
          </div>
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} spanish={spanish} />
        </div>
        <ScanButton onScan={onScan} spanish={spanish} />
      </header>

      <div style={{ padding: 16 }}>
        <BrowseSection items={items} viewMode={viewMode} />
      </div>
    </div>
  );
}

/* ── Detail: one station ────────────────────────────────────────────────── */
// Grid tile for the exercise list's grid view — a first-frame video thumbnail
// with the name overlaid, tapping opens the full ExerciseCard info modal.
function ExerciseTile({ ex, onOpen }) {
  return (
    <button onClick={() => onOpen(ex)} className="active:scale-[0.98] transition-transform"
      style={{ position: 'relative', textAlign: 'left', aspectRatio: '4 / 5', borderRadius: 16, overflow: 'hidden',
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      <ExerciseVideoThumb exercise={ex} fill showBadge={false} />
      <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,13,16,0.86) 0%, rgba(10,13,16,0.2) 52%, transparent 100%)' }} />
      <span style={{ position: 'absolute', left: 10, right: 10, bottom: 9, color: '#fff', fontWeight: 800, fontSize: 12.5, lineHeight: 1.16,
        textShadow: '0 1px 6px rgba(0,0,0,0.55)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {exName(ex)}
      </span>
    </button>
  );
}

function StationDetail({ station }) {
  const { i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const spanish = es(i18n);
  const [muscle, setMuscle] = useState('All');
  const [beginnerOnly, setBeginnerOnly] = useState(false);
  const [viewMode, setViewMode] = useBrowseView();
  const [infoEx, setInfoEx] = useState(null);

  const all = BY_STATION[station.name] || [];
  const rep = REP_BY_STATION[station.name];
  const muscles = useMemo(() => ['All', ...Array.from(new Set(all.map((e) => e.muscle)))], [all]);
  // Only surface the Beginner toggle when the station is actually a mix — if
  // every exercise here is (or isn't) beginner, the toggle would visibly do
  // nothing, which reads as broken.
  const beginnerCount = useMemo(() => all.filter((e) => difficultyFor(e) === 'beginner').length, [all]);
  const showBeginner = beginnerCount > 0 && beginnerCount < all.length;
  let shown = muscle === 'All' ? all : all.filter((e) => e.muscle === muscle);
  if (beginnerOnly && showBeginner) shown = shown.filter((e) => difficultyFor(e) === 'beginner');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 96 }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-subtle)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            style={{ background: 'none', border: 'none', padding: 4, color: 'var(--color-text)', display: 'flex' }}>
            <ArrowLeft size={22} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            {rep ? (
              <StationHero station={station} rep={rep} size={48} radius={13} />
            ) : (
              <span style={{ width: 48, height: 48, borderRadius: 13, background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Dumbbell size={22} style={{ color: 'var(--color-accent)' }} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 24, lineHeight: 1, color: 'var(--color-text)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {spanish ? station.name_es : station.name}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--color-accent)', fontWeight: 700, marginTop: 3 }}>
                {spanish ? `Puedes hacer ${all.length} ejercicios aquí` : `You can do ${all.length} exercises here`}
              </p>
            </div>
          </div>
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} spanish={spanish} />
        </div>

        {(showBeginner || muscles.length > 2) && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 12, paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
          {showBeginner && (
          <button onClick={() => setBeginnerOnly((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '6px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              border: '1px solid ' + (beginnerOnly ? 'var(--color-accent)' : 'var(--color-border-subtle)'),
              background: beginnerOnly ? 'var(--color-accent)' : 'var(--color-surface)',
              color: beginnerOnly ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text)' }}>
            <Star size={13} strokeWidth={2.4} fill={beginnerOnly ? 'currentColor' : 'none'} /> {spanish ? 'Principiante' : 'Beginner'}
          </button>
          )}
          {muscles.length > 2 && muscles.map((m) => (
            <button key={m} onClick={() => setMuscle(m)}
              style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                border: '1px solid ' + (muscle === m ? 'var(--color-accent)' : 'var(--color-border-subtle)'),
                background: muscle === m ? 'var(--color-accent)' : 'var(--color-surface)',
                color: muscle === m ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text)' }}>
              {m === 'All' ? (spanish ? 'Todos' : 'All') : m}
            </button>
          ))}
        </div>
        )}
      </header>

      <div style={{ padding: '16px' }}>
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-3">
            {shown.map((e) => (
              <ExerciseTile key={e.id} ex={e} onOpen={setInfoEx} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shown.map((e) => (
              <ExerciseCard key={e.id} exercise={e} />
            ))}
          </div>
        )}
        {!shown.length && (
          <p style={{ textAlign: 'center', color: 'var(--color-text-subtle)', padding: 40 }}>
            {spanish ? 'No hay ejercicios para este filtro.' : 'No exercises for this filter.'}
          </p>
        )}
      </div>

      {infoEx && (
        <ExerciseCard exercise={infoEx} modalOnly initiallyOpen onExternalClose={() => setInfoEx(null)} />
      )}
    </div>
  );
}

/* ── Route entry ────────────────────────────────────────────────────────── */
export default function Equipment() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const spanish = es(i18n);
  // The :slug param drives all three levels: a station slug → its exercises,
  // a group key → that category's equipment, nothing → the category list.
  const station = slug ? stationBySlug(slug) : null;
  const group = slug ? STATION_GROUPS.find((g) => g.key === slug) : null;

  // Web/desktop camera scanner (mobile web + laptops). Native uses MLKit below.
  const [scanOpen, setScanOpen] = useState(false);

  // A decoded QR → if it's a machine tag, jump to that station. Returns true
  // when consumed so the web scanner modal knows to close.
  const routeScannedSlug = (raw) => {
    const s = parseEquipmentSlug(raw);
    if (s) { setScanOpen(false); navigate(`/equipment/${s}`); return true; }
    return false;
  };

  // Scan a machine's QR (tugympr://equipment/<slug>) → jump to that station.
  const onScan = async () => {
    // Web / desktop: open the in-browser camera scanner (html5-qrcode).
    if (!Capacitor.isNativePlatform()) {
      setScanOpen(true);
      return;
    }
    // Native: MLKit fullscreen scanner.
    try {
      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted') {
        showToast(spanish ? 'Permiso de cámara denegado.' : 'Camera permission denied.', 'error');
        return;
      }
      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      if (barcodes?.length && barcodes[0].rawValue) {
        if (!routeScannedSlug(barcodes[0].rawValue)) {
          showToast(spanish ? 'Ese código no corresponde a un equipo.' : "That code isn't a recognized equipment tag.", 'error');
        }
      }
    } catch (e) {
      if (e?.message?.toLowerCase?.().includes('cancel')) return;
      showToast(spanish ? 'Error del escáner.' : 'Scanner error.', 'error');
    }
  };

  const body = station
    ? <StationDetail station={station} />
    : group
      ? <StationEquipment group={group} onScan={onScan} />
      : <StationCategories onScan={onScan} />;

  return (
    <>
      {body}
      <WebQrScanModal open={scanOpen} onClose={() => setScanOpen(false)} onDecode={routeScannedSlug} spanish={spanish} />
    </>
  );
}

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, User, BookOpen, Dumbbell, Megaphone, Filter as FilterIcon, ArrowRight, X, Compass } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Cmd-K global search palette for admin. Opens with Cmd/Ctrl-K from anywhere
 * (or via the trigger button mounted in AdminLayout's topbar). Pulls a small
 * search index of members / classes / programs / segments / announcements
 * once on first open and filters client-side as the admin types — keeps the
 * keystroke latency near zero even on slow networks.
 *
 * Keyboard contract: ↑/↓ move selection, Enter activates, Esc closes.
 * On result activation we navigate to the destination page; the open page
 * is responsible for any deeper drill-in (e.g. member detail).
 */

const ICONS = {
  page: Compass,
  member: User,
  class: BookOpen,
  program: Dumbbell,
  segment: FilterIcon,
  announcement: Megaphone,
};

/**
 * Cmd/Ctrl-K toggles the palette; Esc closes it when open. The parent owns
 * the open/close state — we just invoke its callbacks. (Previously this hook
 * tried to be a drop-in `setOpen` setter; the wrapper in the consumer never
 * actually opened the modal because the toggle path passed `setOpen(o => !o)`
 * and the wrapper assumed `next === false` was the only "close" signal.)
 */
export function useGlobalSearchHotkey({ open, onToggle, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      // Cmd-K (mac) / Ctrl-K (everyone else).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onToggle?.();
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onToggle, onClose]);
}

export default function GlobalSearch({ open, onClose, onToggle, pageIndex = [] }) {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gymId = profile?.gym_id;
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useGlobalSearchHotkey({ open, onToggle, onClose });

  // Reset state whenever the palette opens fresh.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      // Focus the input on the next frame so the modal mounts first.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Lazy: only fetch when the palette is opened at least once.
  const { data: index = [] } = useQuery({
    queryKey: ['admin', 'global-search', gymId],
    queryFn: async () => {
      const [members, classes, programs, segments, announcements] = await Promise.all([
        // `email` is not on the profiles table (lives on auth.users); searching
        // by full_name / username covers the admin use case here.
        supabase.from('profiles')
          .select('id, full_name, username')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .limit(1000),
        supabase.from('gym_classes')
          .select('id, name, description')
          .eq('gym_id', gymId)
          .limit(200),
        supabase.from('gym_programs')
          .select('id, name, description')
          .eq('gym_id', gymId)
          .limit(200),
        supabase.from('member_segments')
          .select('id, name')
          .eq('gym_id', gymId)
          .limit(50),
        supabase.from('announcements')
          .select('id, title, message')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      const rows = [];
      (members.data || []).forEach(m => rows.push({
        kind: 'member',
        id: m.id,
        label: m.full_name || m.username || '—',
        sub: m.username ? `@${m.username}` : '',
        route: '/admin/members',
        // Tokens we'll fuzzy-match against (lowercased once).
        haystack: `${m.full_name || ''} ${m.username || ''}`.toLowerCase(),
      }));
      (classes.data || []).forEach(c => rows.push({
        kind: 'class',
        id: c.id,
        label: c.name || '—',
        sub: c.description?.slice(0, 60) || '',
        route: '/admin/classes',
        haystack: `${c.name || ''} ${c.description || ''}`.toLowerCase(),
      }));
      (programs.data || []).forEach(p => rows.push({
        kind: 'program',
        id: p.id,
        label: p.name || '—',
        sub: p.description?.slice(0, 60) || '',
        route: '/admin/programs',
        haystack: `${p.name || ''} ${p.description || ''}`.toLowerCase(),
      }));
      (segments.data || []).forEach(s => rows.push({
        kind: 'segment',
        id: s.id,
        label: s.name || '—',
        sub: t('admin.search.segmentSub', 'Saved member segment'),
        route: '/admin/segments',
        haystack: (s.name || '').toLowerCase(),
      }));
      (announcements.data || []).forEach(a => rows.push({
        kind: 'announcement',
        id: a.id,
        label: a.title || '—',
        sub: a.message?.slice(0, 60) || '',
        route: '/admin/announcements',
        haystack: `${a.title || ''} ${a.message || ''}`.toLowerCase(),
      }));
      return rows;
    },
    enabled: !!gymId && open,
    staleTime: 60_000,
  });

  // Merge static page index (admin nav) with the lazy gym-data index. Pages
  // are always available — they don't require the lazy query to resolve.
  const combinedIndex = useMemo(() => [...pageIndex, ...index], [pageIndex, index]);

  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) {
      // No query: surface pages first (the common case — admin wants to jump
      // somewhere), then a few recent data rows.
      const pages = combinedIndex.filter(r => r.kind === 'page').slice(0, 12);
      const data = combinedIndex.filter(r => r.kind !== 'page').slice(0, 8);
      return [...pages, ...data];
    }
    return combinedIndex.filter(r => r.haystack.includes(trimmed)).slice(0, 40);
  }, [combinedIndex, trimmed]);

  // Group results by kind for the rendered list.
  const grouped = useMemo(() => {
    const order = ['page', 'member', 'class', 'program', 'segment', 'announcement'];
    const map = {};
    results.forEach(r => {
      if (!map[r.kind]) map[r.kind] = [];
      map[r.kind].push(r);
    });
    return order.filter(k => map[k]?.length).map(k => ({ kind: k, items: map[k] }));
  }, [results]);

  // Flat ordered list (matches what we render) so keyboard nav stays consistent.
  const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  useEffect(() => { setSelectedIdx(0); }, [trimmed]);

  const activate = useCallback((item) => {
    if (!item) return;
    onClose?.();
    navigate(item.route);
  }, [navigate, onClose]);

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(flat[selectedIdx]);
    }
  };

  if (!open) return null;

  const kindLabel = (k) => ({
    page: t('admin.search.pages', 'Pages'),
    member: t('admin.search.members', 'Members'),
    class: t('admin.search.classes', 'Classes'),
    program: t('admin.search.programs', 'Programs'),
    segment: t('admin.search.segments', 'Segments'),
    announcement: t('admin.search.announcements', 'Announcements'),
  }[k] || k);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[10vh] pb-8"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          maxHeight: 'calc(90vh - 10vh)',
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <Search size={16} style={{ color: 'var(--color-text-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('admin.search.placeholder', 'Search pages, members, classes…')}
            className="flex-1 bg-transparent outline-none text-[15px]"
            style={{ color: 'var(--color-text-primary)' }}
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono"
            style={{ background: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            ESC
          </kbd>
          <button onClick={onClose} className="sm:hidden p-1 rounded-lg" aria-label="Close">
            <X size={16} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {flat.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Search size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-faint)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                {trimmed
                  ? t('admin.search.noResults', `No matches for "{{q}}"`, { q: query })
                  : t('admin.search.emptyHint', 'Start typing to search across your gym.')}
              </p>
            </div>
          ) : (
            grouped.map(g => {
              const Icon = ICONS[g.kind];
              return (
                <div key={g.kind}>
                  <p className="px-4 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                    {kindLabel(g.kind)}
                  </p>
                  {g.items.map(item => {
                    const flatIdx = flat.indexOf(item);
                    const active = flatIdx === selectedIdx;
                    return (
                      <button
                        key={`${g.kind}-${item.id}`}
                        type="button"
                        onClick={() => activate(item)}
                        onMouseEnter={() => setSelectedIdx(flatIdx)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                        style={{ background: active ? 'var(--color-admin-panel)' : 'transparent' }}
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--color-bg-deep)' }}>
                          <Icon size={13} style={{ color: 'var(--color-text-muted)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {item.label}
                          </p>
                          {item.sub && (
                            <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                              {item.sub}
                            </p>
                          )}
                        </div>
                        <ArrowRight size={12} style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-faint)' }} />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t text-[10.5px]"
          style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>↑↓</kbd>
            {t('admin.search.hintNavigate', 'navigate')}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>↵</kbd>
            {t('admin.search.hintOpen', 'open')}
          </span>
          <span className="hidden sm:inline">
            {t('admin.search.hintShortcut', 'Cmd-K to toggle')}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Tiny pill-button that the topbar mounts as the "open search" affordance.
 *  Sibling-component to keep the consumer ergonomics simple. */
export function GlobalSearchTrigger({ onOpen }) {
  const { t } = useTranslation('pages');
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] transition-colors"
      style={{
        background: 'var(--color-bg-input)',
        border: '1px solid var(--color-border-subtle)',
        color: 'var(--color-text-muted)',
      }}
      aria-label={t('admin.search.open', 'Open search')}
    >
      <Search size={13} />
      <span className="hidden sm:inline">{t('admin.search.shortLabel', 'Search')}</span>
      <kbd className="hidden md:inline-flex items-center ml-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono"
        style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
        ⌘K
      </kbd>
    </button>
  );
}

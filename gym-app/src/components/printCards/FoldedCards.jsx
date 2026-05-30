/**
 * Folded card spreads — 1056 × 408 px open (11×4.25 in @ 96 dpi).
 *
 *   OUTSIDE spread: LEFT panel = back, RIGHT panel = front cover
 *   INSIDE  spread: LEFT panel = pre-printed tribute, RIGHT panel = owner's handwriting canvas
 *
 * Each folded card prints as ONE US Letter landscape sheet:
 *   outside spread (top half) + inside spread (bottom half).
 * Owner cuts horizontally at center, then folds each panel at its own center crease.
 *
 * Only 2 occasions: tenure_365 (one year anniversary) and milestone_500
 * (five hundred workouts). These are the "ceremony" moments where a
 * single-sided postcard would be undersized.
 */
import { useTranslation } from 'react-i18next';
import { FoldedShell, GymMark, QRBlock, Stamp } from './CardPrimitives.jsx';

// ── TENURE_365 — outside cover ─────────────────────────────────────────
export function Tenure365Outside({ gym, member, headline, year, foundedYear }) {
  const { t } = useTranslation('pages');
  const yr = year || new Date().getFullYear().toString();
  return (
    <FoldedShell side="outside">
      {/* LEFT: back panel */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '32px 36px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stamp text={t('admin.printCards.card.back', { defaultValue: 'back' })} color={gym.primary} dot={false} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>{t('admin.printCards.card.fold', { defaultValue: 'fold ▶' })}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 19, lineHeight: 1.35, color: 'rgba(17,17,17,0.7)', maxWidth: 320, textWrap: 'balance' }}>
              {t('admin.printCards.card.tenure365.backQuote', { defaultValue: 'The first year is mostly believing. The second is mostly proving.' })}
            </div>
          </div>
          <div>
            <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
            {(foundedYear || gym.est) && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.45)', marginTop: 6 }}>
                {t('admin.printCards.card.est', { year: foundedYear || gym.est, defaultValue: 'est. {{year}}' })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: front cover */}
      <div style={{ position: 'absolute', left: 528, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: 18, border: `0.5px solid ${gym.primary}`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: '32px 36px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
            <Stamp text={t('admin.printCards.card.stamp.oneYear', { defaultValue: 'one year' })} color={gym.primary} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 92, lineHeight: 0.85, fontWeight: 500, letterSpacing: '-0.045em', color: '#111' }}>
              {t('admin.printCards.card.tenure365.big1', { defaultValue: 'One' })}<br />
              <span style={{ fontStyle: 'italic', color: gym.primary }}>{t('admin.printCards.card.tenure365.big2', { defaultValue: 'year.' })}</span>
            </div>
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 18, lineHeight: 1.2, color: 'rgba(17,17,17,0.78)', maxWidth: 360, textWrap: 'balance' }}>
              {headline || t('admin.printCards.card.tenure365.coverHeadline', { defaultValue: 'On the house. On the wall. On the record.' })}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>{t('admin.printCards.card.for', { defaultValue: 'for' })}</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 22, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 380, marginTop: 4 }}>{member}</div>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: gym.primary }}>{yr}</div>
          </div>
        </div>
      </div>
    </FoldedShell>
  );
}

// ── TENURE_365 — inside spread ─────────────────────────────────────────
export function Tenure365Inside({ gym, member, note, qr, rewardLabel, occasionData = {} }) {
  const { t } = useTranslation('pages');
  const joinedDate = occasionData.joined_date || '';
  const dateClause = joinedDate
    ? t('admin.printCards.card.tenure365.dateClause', { date: joinedDate, defaultValue: ', this {{date}},' })
    : '';
  return (
    <FoldedShell side="inside">
      {/* LEFT: pre-printed inscription */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '44px 48px 36px 56px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: gym.primary, fontWeight: 600 }}>
            {t('admin.printCards.card.tenure365.beItKnown', { defaultValue: 'be it known —' })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 21, lineHeight: 1.3, color: '#111', maxWidth: 380, textWrap: 'pretty' }}>
              {t('admin.printCards.card.tenure365.inscriptionPre', { defaultValue: 'that ' })}
              <span style={{ fontStyle: 'italic', color: gym.primary, fontWeight: 500 }}>{member}</span>
              {t('admin.printCards.card.tenure365.inscriptionPost', { dateClause, gym: gym.name, defaultValue: ' has{{dateClause}} completed a full year of training at {{gym}}.' })}
            </div>
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 17, lineHeight: 1.3, color: 'rgba(17,17,17,0.7)', maxWidth: 380 }}>
              {t('admin.printCards.card.tenure365.inscriptionBody', { defaultValue: 'The wall has space for one more photograph. The next pull-up bar is rated for one more name. Welcome to the long view.' })}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
            <div>
              {joinedDate && (
                <>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.45)' }}>
                    {t('admin.printCards.card.tenure365.joined', { defaultValue: 'joined' })}
                  </div>
                  <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 14, color: '#111', marginTop: 2 }}>
                    {joinedDate}
                  </div>
                </>
              )}
            </div>
            {qr ? <QRBlock size={68} value={qr} label={rewardLabel || t('admin.printCards.card.tenure365.qrLabel', { defaultValue: 'year-one gesture' })} /> : null}
          </div>
        </div>
      </div>

      {/* RIGHT: owner's canvas + signature (blank line — owner signs by hand) */}
      <div style={{ position: 'absolute', left: 528, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '44px 56px 36px 48px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.6)' }}>
            {t('admin.printCards.card.tenure365.fromOwner', { defaultValue: 'from the owner —' })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32, justifyContent: 'center', paddingTop: 8, paddingBottom: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ borderBottom: '0.5px solid rgba(17,17,17,0.18)', height: 1, position: 'relative' }}>
                {i === 0 && note && (
                  <div style={{ position: 'absolute', left: 0, bottom: 2, fontFamily: "'Caveat', cursive", fontSize: 22, color: 'rgba(17,17,17,0.78)', lineHeight: 1 }}>{note}</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, borderBottom: '0.5px solid rgba(17,17,17,0.18)', paddingBottom: 4, height: 26 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)', paddingBottom: 4 }}>{t('admin.printCards.card.signed', { defaultValue: 'signed' })}</span>
          </div>
        </div>
      </div>
    </FoldedShell>
  );
}

// ── MILESTONE_500 — outside cover ──────────────────────────────────────
export function Milestone500Outside({ gym, headline }) {
  const { t } = useTranslation('pages');
  return (
    <FoldedShell side="outside">
      {/* LEFT: back panel — quiet */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '32px 36px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stamp text={t('admin.printCards.card.back', { defaultValue: 'back' })} color={gym.primary} dot={false} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>{t('admin.printCards.card.fold', { defaultValue: 'fold ▶' })}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 18, lineHeight: 1.3, color: 'rgba(17,17,17,0.6)', maxWidth: 320 }}>
              {t('admin.printCards.card.milestone500.backQuote', { defaultValue: "Five hundred is rarefied air. The card is folded because the moment doesn't fit on one side." })}
            </div>
          </div>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
        </div>
      </div>

      {/* RIGHT: front cover — the 500 dominates */}
      <div style={{ position: 'absolute', left: 528, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: 16, border: `0.5px solid ${gym.primary}`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 20, border: '0.5px solid rgba(17,17,17,0.2)', pointerEvents: 'none' }} />

        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 360, lineHeight: 0.8, fontWeight: 500, color: gym.primary, letterSpacing: '-0.06em' }}>500</div>
        </div>

        <div style={{ position: 'absolute', left: 28, right: 28, bottom: 60, height: 1, background: 'rgba(17,17,17,0.3)' }} />
        <div style={{ position: 'absolute', left: 36, right: 36, bottom: 28, fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 15, color: '#111', textAlign: 'center', background: 'rgba(255,255,255,0.92)', padding: '4px 8px' }}>
          {headline || t('admin.printCards.card.milestone500.coverHeadline', { defaultValue: 'Inscribed, not counted.' })}
        </div>

        <div style={{ position: 'absolute', left: 36, top: 36, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: gym.primary, fontWeight: 600, background: 'rgba(255,255,255,0.92)', padding: '2px 6px' }}>
          {t('admin.printCards.card.milestone500.hallOfFame', { defaultValue: 'hall of fame' })}
        </div>
        <div style={{ position: 'absolute', right: 36, top: 36, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.6)', background: 'rgba(255,255,255,0.92)', padding: '2px 6px' }}>
          {t('admin.printCards.card.milestone500.workoutsFiveHundred', { defaultValue: 'workouts · five hundred' })}
        </div>
      </div>
    </FoldedShell>
  );
}

// ── MILESTONE_500 — inside spread ──────────────────────────────────────
export function Milestone500Inside({ gym, member, note }) {
  const { t } = useTranslation('pages');
  return (
    <FoldedShell side="inside">
      {/* LEFT: minimal inscription header — the moment, named */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '48px 48px 36px 64px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: gym.primary, fontWeight: 600 }}>
            {t('admin.printCards.card.milestone500.cardIsFor', { defaultValue: 'this card is for —' })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 36, lineHeight: 0.98, color: '#111', fontWeight: 500, letterSpacing: '-0.02em', textWrap: 'balance', maxWidth: 380 }}>
              {member}
            </div>
            <div style={{ height: 1, background: gym.primary, width: 48 }} />
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 17, lineHeight: 1.35, color: 'rgba(17,17,17,0.78)', maxWidth: 380 }}>
              {t('admin.printCards.card.milestone500.body', { defaultValue: 'who walked into this building five hundred times, by their own count, on their own legs, before this card was printed.' })}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>{t('admin.printCards.card.milestone500.witnessedBy', { defaultValue: 'witnessed by' })}</div>
            <div style={{ marginTop: 4 }}>
              <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: owner's tribute canvas — generous (signature line left blank) */}
      <div style={{ position: 'absolute', left: 528, top: 0, width: 528, height: 408 }}>
        <div style={{ position: 'absolute', inset: '48px 64px 36px 48px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.6)' }}>
            {t('admin.printCards.card.milestone500.aNoteByHand', { defaultValue: 'a note, by hand —' })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32, justifyContent: 'center' }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ borderBottom: '0.5px solid rgba(17,17,17,0.18)', height: 1, position: 'relative' }}>
                {i === 0 && note && (
                  <div style={{ position: 'absolute', left: 0, bottom: 2, fontFamily: "'Caveat', cursive", fontSize: 22, color: 'rgba(17,17,17,0.78)', lineHeight: 1 }}>
                    {note}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, borderBottom: '0.5px solid rgba(17,17,17,0.18)', paddingBottom: 4, height: 28 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)', paddingBottom: 4 }}>{t('admin.printCards.card.inscribed', { defaultValue: 'inscribed' })}</span>
          </div>
        </div>
      </div>
    </FoldedShell>
  );
}

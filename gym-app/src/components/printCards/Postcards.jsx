/**
 * 9 postcard occasions, 4×6 portrait (384×576 px @ 96 dpi).
 *
 * Each occasion has a distinct visual character — the typography +
 * layout do the heavy lifting, not chrome. The QROrNote pattern keeps
 * the lower-right reserved for either a real QR (when admin attached
 * a reward) or blank handwriting lines (owner adds a note by pen).
 */
import { GymMark, PostcardShell, QRBlock, SignBlock, Stamp } from './CardPrimitives.jsx';

function PostcardScaffold({ children, gym, topStamp, padding = 28 }) {
  return (
    <PostcardShell>
      <div
        style={{
          position: 'absolute',
          inset: padding,
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          rowGap: 18,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
          {topStamp}
        </div>
        {children}
      </div>
    </PostcardShell>
  );
}

// ── 1. WELCOME ─────────────────────────────────────────────────────────
export function WelcomeCard({ gym, member, headline, subline, note, qr, rewardLabel }) {
  return (
    <PostcardScaffold gym={gym} topStamp={<Stamp text="day one" color={gym.primary} />}>
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', rowGap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
          <div
            style={{
              fontFamily: "'EB Garamond', serif",
              fontStyle: 'italic',
              fontSize: 44,
              lineHeight: 1.0,
              color: '#111',
              letterSpacing: '-0.015em',
              textWrap: 'balance',
              maxWidth: 280,
            }}
          >
            {headline}
          </div>
          {subline && (
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                lineHeight: 1.45,
                color: 'rgba(17,17,17,0.62)',
                maxWidth: 260,
                textWrap: 'pretty',
              }}
            >
              {subline}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)', marginBottom: 4 }}>for</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 19, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 200 }}>{member}</div>
            </div>
            {qr && <QRBlock size={72} value={qr} label={rewardLabel} />}
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={qr ? 1 : 2} />
        </div>
      </div>
    </PostcardScaffold>
  );
}

// ── 2. HABIT_9IN6 — pickup ticket ──────────────────────────────────────
export function HabitCard({ gym, member, headline, note, qr, rewardLabel, occasionData = {} }) {
  const window_days = occasionData.window_days || 42;
  const count = occasionData.count || 9;
  const cupNoun = gym.cupNoun || 'shaker';
  return (
    <PostcardShell>
      {/* Ticket-stub perforation dots running down the right edge */}
      <div style={{ position: 'absolute', right: 18, top: 60, bottom: 60, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
        {Array.from({ length: 22 }).map((_, i) => (
          <span key={i} style={{ width: 4, height: 1, background: 'rgba(17,17,17,0.22)', display: 'block' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 6, background: gym.primary }} />
      <div style={{ position: 'absolute', inset: '32px 36px 28px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: gym.primary, fontWeight: 600 }}>pickup ticket</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)', marginTop: 3 }}>no. {String(count).padStart(3, '0')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.6)' }}>
            present at front desk —
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 36, lineHeight: 0.95, color: '#111', letterSpacing: '-0.02em' }}>
            One {cupNoun},
            <br />
            <span style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontWeight: 500 }}>with your name on it.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 30, fontWeight: 500, color: gym.primary, lineHeight: 1, letterSpacing: '-0.02em' }}>{count}</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'rgba(17,17,17,0.65)', lineHeight: 1.3 }}>
              workouts in {window_days} days.<br />
              That counts as a habit.
            </div>
          </div>
          {headline && (
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 14, color: 'rgba(17,17,17,0.7)', marginTop: 6, lineHeight: 1.3, maxWidth: 260 }}>
              {headline}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)', marginBottom: 4 }}>bearer</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, lineHeight: 1.1, color: '#111', marginBottom: 12, maxWidth: 180 }}>{member}</div>
            <SignBlock color={gym.primary} label="signed by" noteLines={1} note={note} compact />
          </div>
          {qr ? <QRBlock size={84} value={qr} label={rewardLabel || 'redeem at desk'} /> : null}
        </div>
      </div>
    </PostcardShell>
  );
}

// ── 3. TENURE_30 ───────────────────────────────────────────────────────
export function Tenure30Card({ gym, member, headline, subline, note, qr, rewardLabel }) {
  return (
    <PostcardScaffold gym={gym} topStamp={<Stamp text="thirty days" color={gym.primary} />}>
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', rowGap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 76, lineHeight: 0.88, fontWeight: 500, letterSpacing: '-0.04em', color: '#111' }}>
            thirty<br />
            <span style={{ fontStyle: 'italic', color: gym.primary }}>days.</span>
          </div>
          <div style={{ height: 1, background: gym.primary, width: 60 }} />
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 19, lineHeight: 1.2, color: '#111', maxWidth: 260, textWrap: 'balance' }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.4, color: 'rgba(17,17,17,0.62)', maxWidth: 260 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>for</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 200, marginTop: 2 }}>{member}</div>
            </div>
            {qr && <QRBlock size={68} value={qr} label={rewardLabel} />}
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={qr ? 1 : 2} />
        </div>
      </div>
    </PostcardScaffold>
  );
}

// ── 4. TENURE_90 — the cliff ───────────────────────────────────────────
export function Tenure90Card({ gym, member, headline, subline, note, qr, rewardLabel }) {
  return (
    <PostcardShell>
      <div style={{ position: 'absolute', inset: '28px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
          <Stamp text="past the cliff" color={gym.primary} />
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, top: 224, height: 1, background: gym.primary }} />
        <div style={{ position: 'absolute', left: 0, top: 192, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.45)' }}>
          ─── day 0 ─────────────────── day 90 ───→
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, top: 252, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 68, lineHeight: 0.88, fontWeight: 500, letterSpacing: '-0.04em', color: '#111' }}>
            Ninety<br />
            <span style={{ fontStyle: 'italic' }}>days in.</span>
          </div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 18, lineHeight: 1.25, color: 'rgba(17,17,17,0.78)', maxWidth: 270, textWrap: 'balance' }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.4, color: 'rgba(17,17,17,0.6)', maxWidth: 260 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>for</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 200, marginTop: 2 }}>{member}</div>
            </div>
            {qr && <QRBlock size={68} value={qr} label={rewardLabel || 'juice / smoothie token'} />}
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={1} compact />
        </div>
      </div>
    </PostcardShell>
  );
}

// ── 5. MILESTONE_100 — century mark ────────────────────────────────────
export function Milestone100Card({ gym, member, headline, subline, note, qr, rewardLabel }) {
  return (
    <PostcardShell>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 8, background: gym.primary }} />
      <div style={{ position: 'absolute', inset: '36px 28px 28px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
          <Stamp text="century mark" color={gym.primary} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 196, lineHeight: 0.78, fontWeight: 500, letterSpacing: '-0.05em', color: '#111', position: 'relative' }}>
            100
          </div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 22, lineHeight: 1.15, color: '#111', maxWidth: 300, textWrap: 'balance' }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.4, color: 'rgba(17,17,17,0.6)', maxWidth: 280 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>for</div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 16, lineHeight: 1.05, color: '#111', maxWidth: 200, marginTop: 2 }}>{member}</div>
            </div>
            {qr && <QRBlock size={72} value={qr} label={rewardLabel} />}
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={qr ? 1 : 2} />
        </div>
      </div>
    </PostcardShell>
  );
}

// ── 6. MILESTONE_250 — rare company ────────────────────────────────────
export function Milestone250Card({ gym, member, headline, note, qr, rewardLabel }) {
  return (
    <PostcardShell>
      <div style={{ position: 'absolute', inset: 14, border: `0.5px solid ${gym.primary}`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 18, border: '0.5px solid rgba(17,17,17,0.22)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: '36px 36px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="sm" />
          <Stamp text="rare company" color={gym.primary} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 15, color: 'rgba(17,17,17,0.65)', letterSpacing: '0.04em' }}>
            this is to acknowledge
          </div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 22, fontWeight: 500, lineHeight: 1.05, color: '#111', maxWidth: 280 }}>
            {member}
          </div>
          <div style={{ width: 30, height: 1, background: gym.primary, margin: '8px 0' }} />
          <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 130, lineHeight: 0.82, fontWeight: 500, letterSpacing: '-0.045em', color: gym.primary }}>
            250
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.6)', marginTop: -2 }}>
            workouts logged
          </div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 16, lineHeight: 1.25, color: '#111', marginTop: 12, maxWidth: 280, textWrap: 'balance' }}>
            {headline}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: qr ? '1fr auto' : '1fr', gap: 14, alignItems: 'end' }}>
          <SignBlock color={gym.primary} label="inscribed" note={note} noteLines={qr ? 1 : 2} compact />
          {qr && <QRBlock size={64} value={qr} label={rewardLabel} />}
        </div>
      </div>
    </PostcardShell>
  );
}

// ── 7. RETURNING — never a QR, never a reward ──────────────────────────
export function ReturningCard({ gym, member, headline, subline, note, occasionData = {} }) {
  const days = occasionData.absence_days || 23;
  return (
    <PostcardScaffold
      gym={gym}
      topStamp={
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.55)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 5, background: gym.primary, display: 'inline-block' }} />
          {days} days
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', rowGap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 46, lineHeight: 1.0, color: '#111', letterSpacing: '-0.015em', maxWidth: 310, textWrap: 'balance' }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, lineHeight: 1.45, color: 'rgba(17,17,17,0.62)', maxWidth: 290 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>for</div>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 280, marginTop: 2 }}>{member}</div>
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={2} />
        </div>
      </div>
    </PostcardScaffold>
  );
}

// ── 8. BIRTHDAY ────────────────────────────────────────────────────────
export function BirthdayCard({ gym, member, headline, subline, note, qr, rewardLabel, occasionData = {} }) {
  const day = occasionData.day || '—';
  const month = occasionData.month || '';
  return (
    <PostcardScaffold
      gym={gym}
      topStamp={<Stamp text="your week" color={gym.primary} />}
    >
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', rowGap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 }}>
          <div style={{ display: 'inline-flex', alignSelf: 'flex-start', border: `1.5px solid ${gym.primary}`, padding: '10px 16px 12px', flexDirection: 'column', alignItems: 'center', minWidth: 110 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.28em', color: gym.primary, fontWeight: 600 }}>{month}</div>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 64, lineHeight: 0.92, fontWeight: 500, color: '#111', letterSpacing: '-0.03em' }}>{day}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: '0.24em', color: 'rgba(17,17,17,0.55)', marginTop: 2, textTransform: 'uppercase' }}>yours</div>
          </div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 28, lineHeight: 1.08, color: '#111', letterSpacing: '-0.015em', maxWidth: 290, textWrap: 'balance' }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.4, color: 'rgba(17,17,17,0.6)', maxWidth: 280 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(17,17,17,0.5)' }}>for</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, lineHeight: 1.05, color: '#111', fontWeight: 500, maxWidth: 200, marginTop: 2 }}>{member}</div>
            </div>
            {qr && <QRBlock size={72} value={qr} label={rewardLabel || 'drink on the house'} />}
          </div>
          <SignBlock color={gym.primary} note={note} noteLines={qr ? 1 : 2} />
        </div>
      </div>
    </PostcardScaffold>
  );
}

// ── 9. CUSTOM ──────────────────────────────────────────────────────────
export function CustomCard({ gym, member, headline, subline, qr, rewardLabel }) {
  return (
    <PostcardShell>
      <div style={{ position: 'absolute', left: 28, right: 28, top: 32, height: 1, background: gym.primary }} />
      <div style={{ position: 'absolute', inset: '44px 28px 28px', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <GymMark gymName={gym.name} gymLogoUrl={gym.logo} size="md" />
          <Stamp text="a note" color={gym.primary} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, justifyContent: 'center', paddingTop: 8, paddingBottom: 8 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ borderBottom: '0.5px solid rgba(17,17,17,0.18)', height: 1, position: 'relative' }}>
              {i === 0 && headline && (
                <div style={{ position: 'absolute', left: 0, bottom: 2, fontFamily: "'Caveat', cursive", fontSize: 22, color: 'rgba(17,17,17,0.78)', lineHeight: 1 }}>{headline}</div>
              )}
              {i === 1 && subline && (
                <div style={{ position: 'absolute', left: 0, bottom: 2, fontFamily: "'Caveat', cursive", fontSize: 22, color: 'rgba(17,17,17,0.78)', lineHeight: 1 }}>{subline}</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'auto auto', rowGap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 17, color: '#111', lineHeight: 1.05 }}>for {member}</div>
            {qr && <QRBlock size={64} value={qr} label={rewardLabel} />}
          </div>
          <SignBlock color={gym.primary} noteLines={0} compact />
        </div>
      </div>
    </PostcardShell>
  );
}

import { Bell, Lock, Mail, MessageSquare, Smartphone } from 'lucide-react';

/**
 * Multi-channel toggle row for the Outreach composer. Each channel is
 * independently on/off; the parent controls the booleans and the send
 * orchestrator fans out only to enabled channels.
 *
 * Push and in-app are mutually exclusive UI-wise — push always writes the
 * in-app row too, so showing both as "on" would double-deliver. The picker
 * disables `inApp` whenever `push` is on.
 *
 * Styled to the "Enviar Mensaje" design: icon-chip + title/sub + a real pill
 * toggle, accent-wash selected state. All colors flow from the gym's brand
 * CSS variables (--color-accent et al.) so it stays on-brand + theme-aware.
 */

// Pill toggle — mirrors the design's 40×23 switch. Accent track when on.
function PillToggle({ on, disabled }) {
  return (
    <span
      className="relative flex-shrink-0 rounded-full transition-colors"
      style={{
        width: 40,
        height: 23,
        background: disabled
          ? 'color-mix(in srgb, var(--color-text-muted) 18%, transparent)'
          : on
            ? 'var(--color-accent)'
            : 'color-mix(in srgb, var(--color-text-muted) 38%, transparent)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        className="absolute rounded-full transition-all"
        style={{
          top: 2.5,
          left: on ? 19 : 2.5,
          width: 18,
          height: 18,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}
      />
    </span>
  );
}

export default function OutreachChannelPicker({ value, onChange, t, lockedToEmail = false }) {
  const set = (key, on) => onChange({ ...value, [key]: on });

  const channels = [
    {
      key: 'push',
      icon: Bell,
      label: t('admin.outreach.channelPush', 'Push notification'),
      desc: t('admin.outreach.channelPushDesc', 'Members who have push enabled'),
      disabled: lockedToEmail,
    },
    {
      key: 'inApp',
      icon: Smartphone,
      label: t('admin.outreach.channelInApp', 'In-app only'),
      desc: t('admin.outreach.channelInAppDesc', 'Notification inside the app, no push'),
      disabled: lockedToEmail || value.push,
    },
    {
      key: 'email',
      icon: Mail,
      label: t('admin.outreach.channelEmail', 'Email'),
      desc: t('admin.outreach.channelEmailDesc', 'Members with email on file'),
      // While a designer email is attached, email is the only valid channel:
      // force it on and lock it (can't be toggled off either).
      disabled: lockedToEmail,
      forceOn: lockedToEmail,
    },
    {
      key: 'sms',
      icon: MessageSquare,
      label: t('admin.outreach.channelSms', 'SMS'),
      desc: t('admin.outreach.channelSmsDesc', 'Members with phone — costs per message'),
      disabled: lockedToEmail,
    },
  ];

  const isOn = (ch) => (ch.forceOn ? true : (!!value[ch.key] && !ch.disabled));
  const activeCount = channels.filter(isOn).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.outreach.channels', 'Channels')}
        </label>
        <span className="text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.outreach.channelsActive', { count: activeCount, defaultValue: '{{count}} active' })}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {channels.map(ch => {
          const Icon = ch.icon;
          const on = isOn(ch);
          // Dim only genuinely-unavailable channels — not the locked-on email,
          // which should still read as the active selection.
          const dim = ch.disabled && !ch.forceOn;
          return (
            <button
              key={ch.key}
              type="button"
              onClick={() => !ch.disabled && set(ch.key, !on)}
              disabled={ch.disabled}
              className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
              style={{
                background: on ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-deep)',
                border: `${on ? 1.5 : 1}px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 11%, transparent)' : 'none',
                opacity: dim ? 0.5 : 1,
                cursor: ch.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div
                className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                style={{ background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-hover)' }}
              >
                <Icon size={17} strokeWidth={2} style={{ color: on ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>
                  {ch.label}
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {ch.desc}
                </p>
              </div>
              <PillToggle on={on} disabled={ch.disabled && !ch.forceOn} />
            </button>
          );
        })}
      </div>

      {lockedToEmail && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          <Lock size={11} className="flex-shrink-0" />
          <span>{t('admin.outreach.emailLockedHint', 'Email design attached — sends as email only. Remove it to use other channels.')}</span>
        </div>
      )}
    </div>
  );
}

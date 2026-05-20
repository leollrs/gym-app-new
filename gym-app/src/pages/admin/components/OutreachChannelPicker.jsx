import { Bell, Mail, MessageSquare, Smartphone } from 'lucide-react';

/**
 * Multi-channel toggle row for the Outreach composer. Each channel is
 * independently on/off; the parent controls the booleans and the send
 * orchestrator fans out only to enabled channels.
 *
 * Push and in-app are mutually exclusive UI-wise — push always writes the
 * in-app row too, so showing both as "on" would double-deliver. The picker
 * disables `inApp` whenever `push` is on.
 */
export default function OutreachChannelPicker({ value, onChange, t }) {
  const set = (key, on) => onChange({ ...value, [key]: on });

  const channels = [
    {
      key: 'push',
      icon: Bell,
      label: t('admin.outreach.channelPush', 'Push notification'),
      desc: t('admin.outreach.channelPushDesc', 'Members who have push enabled'),
    },
    {
      key: 'inApp',
      icon: Smartphone,
      label: t('admin.outreach.channelInApp', 'In-app only'),
      desc: t('admin.outreach.channelInAppDesc', 'Notification inside the app, no push'),
      disabled: value.push,
    },
    {
      key: 'email',
      icon: Mail,
      label: t('admin.outreach.channelEmail', 'Email'),
      desc: t('admin.outreach.channelEmailDesc', 'Members with email on file'),
    },
    {
      key: 'sms',
      icon: MessageSquare,
      label: t('admin.outreach.channelSms', 'SMS'),
      desc: t('admin.outreach.channelSmsDesc', 'Members with phone — costs per message'),
    },
  ];

  return (
    <div className="space-y-2.5">
      <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
        {t('admin.outreach.channels', 'Channels')}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {channels.map(ch => {
          const Icon = ch.icon;
          const on = !!value[ch.key];
          return (
            <button
              key={ch.key}
              type="button"
              onClick={() => !ch.disabled && set(ch.key, !on)}
              disabled={ch.disabled}
              className="flex items-start gap-3 p-3 rounded-xl text-left transition-all border disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: on
                  ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                  : 'var(--color-bg-deep)',
                borderColor: on ? 'var(--color-accent)' : 'var(--color-border-subtle)',
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-bg-hover)' }}
              >
                <Icon size={14} style={{ color: on ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {ch.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {ch.desc}
                </p>
              </div>
              <div
                className="w-4 h-4 rounded-full border flex-shrink-0 mt-0.5"
                style={{
                  borderColor: on ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                  background: on ? 'var(--color-accent)' : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

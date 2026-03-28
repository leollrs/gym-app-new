import { useEffect, useState } from 'react';
import { Save, Clock, Upload, Image as ImageIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { applyBranding } from '../../lib/branding';
import { validateImageFile } from '../../lib/validateImage';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton } from '../../components/admin';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Signed URL expiry for logos (1 day)
const LOGO_URL_EXPIRY_SECONDS = 60 * 60 * 24;

// Compress image on the client before upload
async function compressImage(file, maxSize = 512, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > height) {
        if (width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = URL.createObjectURL(file);
  });
}

// Helper to generate a signed URL for a logo path in the private bucket
async function getSignedLogoUrl(path) {
  if (!path) return '';
  const { data, error } = await supabase
    .storage
    .from('gym-logos')
    .createSignedUrl(path, LOGO_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) {
    logger.warn('Failed to create signed URL for logo', error);
    return '';
  }
  return data.signedUrl;
}

export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Editable fields
  const [name, setName]           = useState('');
  const [primaryColor, setPrimary] = useState('#D4AF37');
  const [accentColor, setAccent]   = useState('#D4AF37');
  const [welcomeMsg, setWelcome]   = useState('');
  const [logoUrl, setLogoUrl]     = useState('');
  const [logoFile, setLogoFile]   = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [openTime, setOpenTime]    = useState('06:00');
  const [closeTime, setCloseTime]  = useState('22:00');
  const [openDays, setOpenDays]    = useState([0, 1, 2, 3, 4, 5, 6]);
  const defaultHours = () => [0,1,2,3,4,5,6].map(d => ({ day_of_week: d, open_time: '06:00', close_time: '22:00', is_closed: false }));
  const [dayHours, setDayHours]    = useState(defaultHours);


  useEffect(() => { document.title = 'Admin - Settings | TuGymPR'; }, []);

  // ── Load settings ──
  const { data: settingsData, isLoading } = useQuery({
    queryKey: adminKeys.settings(gymId),
    queryFn: async () => {
      const [{ data: gymData }, { data: brandingData }, { data: hoursData }] = await Promise.all([
        supabase.from('gyms').select('*').eq('id', gymId).single(),
        supabase.from('gym_branding').select('primary_color, accent_color, welcome_message, logo_url').eq('gym_id', gymId).single(),
        supabase.from('gym_hours').select('*').eq('gym_id', gymId).order('day_of_week'),
      ]);
      let signedLogoUrl = '';
      const path = brandingData?.logo_url ?? '';
      if (path) {
        signedLogoUrl = await getSignedLogoUrl(path);
      }
      return { gym: gymData, branding: brandingData, signedLogoUrl, hours: hoursData };
    },
    enabled: !!gymId,
  });

  // Populate form when data loads
  useEffect(() => {
    if (!settingsData) return;
    const { gym, branding, signedLogoUrl, hours } = settingsData;
    if (gym) {
      setName(gym.name ?? '');
      setOpenTime(gym.open_time ?? '06:00');
      setCloseTime(gym.close_time ?? '22:00');
      setOpenDays(gym.open_days ?? [0, 1, 2, 3, 4, 5, 6]);
    }
    if (hours?.length) {
      setDayHours(hours.map(h => ({ day_of_week: h.day_of_week, open_time: h.open_time, close_time: h.close_time, is_closed: h.is_closed })));
    }
    if (branding) {
      setPrimary(branding.primary_color ?? '#D4AF37');
      setAccent(branding.accent_color ?? '#10B981');
      setWelcome(branding.welcome_message ?? '');
    }
    setLogoUrl(signedLogoUrl);
  }, [settingsData]);

  const handleLogoUpload = async (file) => {
    if (!file) return;
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error);
      showToast(validation.error, 'error');
      return;
    }
    setUploadingLogo(true);
    try {
      const compressed = await compressImage(file);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${gymId}/logo.${ext}`;
      const { error: storageErr } = await supabase.storage
        .from('gym-logos')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (storageErr) {
        setError(`Logo upload failed: ${storageErr.message}`);
        setUploadingLogo(false);
        return;
      }
      const signedUrl = await getSignedLogoUrl(path);
      setLogoUrl(signedUrl);
      setLogoFile(null);
      await supabase
        .from('gym_branding')
        .update({ logo_url: path })
        .eq('gym_id', gymId);
    } catch (err) {
      setError(err.message || 'Logo upload failed');
    }
    setUploadingLogo(false);
  };

  const toggleDay = (idx) => {
    setOpenDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort()
    );
  };

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Derive open_days from dayHours for backward compat
      const derivedOpenDays = dayHours.filter(d => !d.is_closed).map(d => d.day_of_week).sort();
      const [{ error: gymErr }, { error: brandingErr }] = await Promise.all([
        supabase.from('gyms').update({
          name,
          open_time: dayHours.find(d => !d.is_closed)?.open_time || openTime,
          close_time: dayHours.find(d => !d.is_closed)?.close_time || closeTime,
          open_days: derivedOpenDays,
          updated_at: new Date().toISOString(),
        }).eq('id', gymId),
        supabase.from('gym_branding').update({
          primary_color: primaryColor,
          accent_color: accentColor,
          welcome_message: welcomeMsg,
          updated_at: new Date().toISOString(),
        }).eq('gym_id', gymId),
      ]);
      // Upsert per-day hours
      const hoursRows = dayHours.map(d => ({ gym_id: gymId, day_of_week: d.day_of_week, open_time: d.open_time, close_time: d.close_time, is_closed: d.is_closed }));
      await supabase.from('gym_hours').upsert(hoursRows, { onConflict: 'gym_id,day_of_week' });
      if (!brandingErr) applyBranding({ primaryColor, secondaryColor: accentColor });
      if (gymErr || brandingErr) {
        throw new Error(gymErr?.message || brandingErr?.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      showToast('Settings saved', 'success');
    },
    onError: (err) => {
      setError(err.message);
      showToast(err.message, 'error');
    },
  });

  const handleSave = () => {
    setError('');
    saveMutation.mutate();
  };

  if (isLoading) return (
    <div className="px-4 md:px-8 py-6 max-w-2xl md:max-w-3xl mx-auto space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[280px]" />
      <CardSkeleton h="h-[200px]" />
    </div>
  );

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl md:max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Gym branding and configuration" className="mb-6" />

      <div className="space-y-4">
        {/* Branding */}
        <FadeIn delay={0}>
          <AdminCard hover padding="p-5">
            <SectionLabel className="mb-4">Branding</SectionLabel>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Gym Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Welcome Message</label>
                <textarea value={welcomeMsg} onChange={e => setWelcome(e.target.value)} rows={2}
                  placeholder="Shown to new members during onboarding..."
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Gym Logo</label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Gym logo" className="w-12 h-12 rounded-xl object-contain bg-[#111827] border border-white/6 p-1" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#111827] border border-white/6 flex items-center justify-center flex-shrink-0">
                      <ImageIcon size={20} className="text-[#4B5563]" />
                    </div>
                  )}
                  <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-colors border border-dashed border-white/10 hover:border-white/20 text-[#6B7280] hover:text-[#9CA3AF]">
                    <Upload size={14} />
                    <span className="text-[12px] font-medium">
                      {uploadingLogo ? 'Uploading...' : logoFile ? logoFile.name : 'Upload logo'}
                    </span>
                    <input
                      type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      disabled={uploadingLogo}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) { setLogoFile(f); handleLogoUpload(f); }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Primary Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={primaryColor} onChange={e => setPrimary(e.target.value)}
                      className="w-10 h-10 rounded-xl border border-white/6 bg-[#111827] cursor-pointer p-1" />
                    <input value={primaryColor} onChange={e => setPrimary(e.target.value)}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Accent Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={accentColor} onChange={e => setAccent(e.target.value)}
                      className="w-10 h-10 rounded-xl border border-white/6 bg-[#111827] cursor-pointer p-1" />
                    <input value={accentColor} onChange={e => setAccent(e.target.value)}
                      className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 font-mono" />
                  </div>
                </div>
              </div>
            </div>
          </AdminCard>
        </FadeIn>

        {/* Gym hours — per-day table */}
        <FadeIn delay={60}>
          <AdminCard hover padding="p-5">
            <SectionLabel icon={Clock} className="mb-4">Gym Hours</SectionLabel>
            <p className="text-[12px] text-[#6B7280] mb-4">Set opening hours for each day. Toggle days off to mark as closed.</p>
            <div className="space-y-2">
              {DAYS.map((day, idx) => {
                const dh = dayHours.find(d => d.day_of_week === idx) || { open_time: '06:00', close_time: '22:00', is_closed: false };
                const updateDay = (field, value) => {
                  setDayHours(prev => prev.map(d => d.day_of_week === idx ? { ...d, [field]: value } : d));
                };
                return (
                  <div key={day} className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${dh.is_closed ? 'opacity-50' : ''}`}
                    style={{ backgroundColor: 'var(--color-bg-deep, #111827)', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))' }}>
                    <button
                      onClick={() => updateDay('is_closed', !dh.is_closed)}
                      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                      style={{ backgroundColor: dh.is_closed ? 'var(--color-text-faint, #4B5563)' : 'var(--color-accent, #D4AF37)' }}
                      aria-label={`Toggle ${day}`}
                    >
                      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                        style={{ left: dh.is_closed ? '2px' : 'calc(100% - 18px)' }} />
                    </button>
                    <span className="text-[13px] font-semibold w-12 flex-shrink-0" style={{ color: 'var(--color-text-primary, #E5E7EB)' }}>
                      {day.slice(0, 3)}
                    </span>
                    {dh.is_closed ? (
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-danger, #EF4444)' }}>Closed</span>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <input type="time" value={dh.open_time} onChange={e => updateDay('open_time', e.target.value)}
                          className="bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 w-[110px]" />
                        <span className="text-[12px]" style={{ color: 'var(--color-text-muted, #6B7280)' }}>to</span>
                        <input type="time" value={dh.close_time} onChange={e => updateDay('close_time', e.target.value)}
                          className="bg-[#111827] border border-white/6 rounded-lg px-2.5 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 w-[110px]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AdminCard>
        </FadeIn>

        {/* Gym info */}
        <FadeIn delay={120}>
          <AdminCard padding="p-4">
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Gym Slug</p>
            <p className="text-[12px] text-[#6B7280]">Members sign up using: <span className="text-[#D4AF37] font-mono">{settingsData?.gym?.slug}</span></p>
          </AdminCard>
        </FadeIn>

        {error && <p className="text-[13px] text-red-400">{error}</p>}

        <button onClick={handleSave} disabled={saveMutation.isPending}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all ${
            saved ? 'bg-emerald-500 text-white' : 'bg-[#D4AF37] text-black'
          } disabled:opacity-50`}>
          <Save size={16} />
          {saveMutation.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Save, Clock, Upload, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { applyBranding } from '../../lib/branding';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Signed URL expiry for logos (1 day — shorter to limit exposure if URL leaks)
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
    // eslint-disable-next-line no-console
    console.warn('Failed to create signed URL for logo', error);
    return '';
  }
  return data.signedUrl;
}

export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [gym, setGym]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  // Editable fields
  const [name, setName]           = useState('');
  const [primaryColor, setPrimary]   = useState('#D4AF37');
  const [accentColor, setAccent]   = useState('#D4AF37');
  const [welcomeMsg, setWelcome]   = useState('');
  const [logoUrl, setLogoUrl]     = useState('');
  const [logoFile, setLogoFile]   = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [openTime, setOpenTime]    = useState('06:00');
  const [closeTime, setCloseTime]  = useState('22:00');
  const [openDays, setOpenDays]    = useState([0, 1, 2, 3, 4, 5, 6]); // Mon–Sun indices

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      // select('*') so it works even if migration 0012 hasn't been applied yet
      const [{ data: gymData }, { data: brandingData }] = await Promise.all([
        supabase.from('gyms').select('*').eq('id', profile.gym_id).single(),
        supabase.from('gym_branding').select('primary_color, accent_color, welcome_message, logo_url').eq('gym_id', profile.gym_id).single(),
      ]);
      if (gymData) {
        setGym(gymData);
        setName(gymData.name ?? '');
        setOpenTime(gymData.open_time ?? '06:00');
        setCloseTime(gymData.close_time ?? '22:00');
        setOpenDays(gymData.open_days ?? [0, 1, 2, 3, 4, 5, 6]);
      }
      if (brandingData) {
        setPrimary(brandingData.primary_color ?? '#D4AF37');
        setAccent(brandingData.accent_color ?? '#10B981');
        setWelcome(brandingData.welcome_message ?? '');
        // Treat logo_url as a storage path in the private bucket
        const path = brandingData.logo_url ?? '';
        if (path) {
          const signed = await getSignedLogoUrl(path);
          setLogoUrl(signed);
        } else {
          setLogoUrl('');
        }
      }
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  const handleLogoUpload = async (file) => {
    if (!file) return;

    // Validate file type to prevent malicious SVG uploads (stored XSS)
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only PNG, JPEG, and WebP images are allowed');
      showToast('Only PNG, JPEG, and WebP images are allowed', 'error');
      return;
    }

    setUploadingLogo(true);
    try {
      // Compress before upload to save bandwidth & storage
      const compressed = await compressImage(file);
      const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${profile.gym_id}/logo.${ext}`;
      const { error: storageErr } = await supabase.storage
        .from('gym-logos')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (storageErr) {
        setError(`Logo upload failed: ${storageErr.message}`);
        setUploadingLogo(false);
        return;
      }

      // Use a signed URL so the bucket can remain private
      const signedUrl = await getSignedLogoUrl(path);
      setLogoUrl(signedUrl);
      setLogoFile(null);
      // Save storage path to branding immediately (not the signed URL, which expires)
      await supabase
        .from('gym_branding')
        .update({ logo_url: path })
        .eq('gym_id', profile.gym_id);
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

  const handleSave = async () => {
    setSaving(true);
    setError('');

    // Run both saves in parallel but handle errors independently
    const [{ error: gymErr }, { error: brandingErr }] = await Promise.all([
      supabase.from('gyms').update({
        name,
        open_time:  openTime,
        close_time: closeTime,
        open_days:  openDays,
        updated_at: new Date().toISOString(),
      }).eq('id', profile.gym_id),
      supabase.from('gym_branding').update({
        primary_color:   primaryColor,
        accent_color:    accentColor,
        welcome_message: welcomeMsg,
        updated_at:      new Date().toISOString(),
      }).eq('gym_id', profile.gym_id),
    ]);

    // Always apply branding to the UI even if gym name save failed
    if (!brandingErr) applyBranding(primaryColor);

    if (gymErr || brandingErr) {
      const msg = gymErr?.message || brandingErr?.message;
      setError(msg);
      showToast(msg, 'error');
      setSaving(false);
      return;
    }
    refreshProfile(); // re-fetches gymName so the nav updates immediately
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setSaving(false);
    showToast('Settings saved', 'success');
  };

  if (loading) return (
    <div className="flex justify-center py-24">
      <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Settings</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Gym branding and configuration</p>
      </div>

      <div className="space-y-4">

        {/* Branding */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <p className="text-[14px] font-semibold text-[#E5E7EB] mb-4">Branding</p>
          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Gym Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Welcome Message</label>
              <textarea value={welcomeMsg} onChange={e => setWelcome(e.target.value)} rows={2}
                placeholder="Shown to new members during onboarding…"
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
                    {uploadingLogo ? 'Uploading…' : logoFile ? logoFile.name : 'Upload logo'}
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
        </div>

        {/* Gym hours */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={15} className="text-[#9CA3AF]" />
            <p className="text-[14px] font-semibold text-[#E5E7EB]">Gym Hours</p>
          </div>
          <p className="text-[12px] text-[#6B7280] mb-3">Used to pause leaderboard updates during closed hours</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Opens</label>
              <input type="time" value={openTime} onChange={e => setOpenTime(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Closes</label>
              <input type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">Open Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((day, idx) => (
                <button key={day} onClick={() => toggleDay(idx)}
                  className={`px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors ${
                    openDays.includes(idx)
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'bg-[#111827] border border-white/6 text-[#6B7280]'
                  }`}>
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Gym info */}
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">Gym Slug</p>
          <p className="text-[12px] text-[#6B7280]">Members sign up using: <span className="text-[#D4AF37] font-mono">{gym?.slug}</span></p>
        </div>

        {error && <p className="text-[13px] text-red-400">{error}</p>}

        <button onClick={handleSave} disabled={saving}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all ${
            saved ? 'bg-emerald-500 text-white' : 'bg-[#D4AF37] text-black'
          } disabled:opacity-50`}>
          <Save size={16} />
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

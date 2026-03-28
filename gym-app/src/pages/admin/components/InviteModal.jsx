import { useState } from 'react';
import { UserPlus, Copy, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';

export default function InviteModal({ gymId, onClose }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.inviteModal.${key}`);

  // Phase: 'form' | 'result'
  const [phase, setPhase] = useState('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { code, expires_at }
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_invite_code', {
        p_gym_id: gymId,
        p_member_name: name.trim(),
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
      });
      if (rpcError) throw rpcError;
      setResult(data);
      setPhase('result');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result?.code) return;
    navigator.clipboard.writeText(result.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAddAnother = () => {
    setPhase('form');
    setName('');
    setPhone('');
    setEmail('');
    setResult(null);
    setError(null);
    setCopied(false);
  };

  const expiryDate = result?.expires_at
    ? new Date(result.expires_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={k('title')} titleIcon={UserPlus} size="sm">
      {phase === 'form' ? (
        <div className="space-y-4">
          {/* Member Name */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('memberName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={k('memberName')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('phone')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={k('phone')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={k('email')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[12px] text-[#EF4444]">{error}</p>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!name.trim() || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {k('generating')}
              </>
            ) : (
              <>
                <UserPlus size={14} />
                {k('generateCode')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Success heading */}
          <p className="text-center text-[14px] font-semibold text-[#10B981]">
            {k('codeGenerated')}
          </p>

          {/* Code display */}
          <div className="bg-[#111827] border border-white/6 rounded-xl py-5 px-4 text-center">
            <p className="text-[32px] font-bold tracking-[0.25em] text-[#E5E7EB] font-mono select-all">
              {result?.code}
            </p>
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold transition-colors ${
              copied
                ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20'
                : 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'
            }`}
          >
            {copied ? (
              <>
                <Check size={14} />
                {k('copied')}
              </>
            ) : (
              <>
                <Copy size={14} />
                {k('copyCode')}
              </>
            )}
          </button>

          {/* Member name + expiry */}
          <div className="text-center space-y-1">
            <p className="text-[13px] text-[#9CA3AF]">{name}</p>
            {expiryDate && (
              <p className="text-[12px] text-[#6B7280]">
                {k('expires')} {expiryDate}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleAddAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#111827] text-[#9CA3AF] border border-white/6 hover:bg-[#1a2235] transition-colors"
            >
              {k('addAnother')}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors"
            >
              {k('done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}

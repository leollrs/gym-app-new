import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Avatar } from '../../../components/admin';
import AdminModal from '../../../components/admin/AdminModal';

/**
 * Modal shown to admins when they scan a password_reset QR or click a pending
 * reset request. Shows member info and approve/deny buttons.
 *
 * Props:
 * - requestId: the password_reset_requests.id
 * - onClose: close handler
 * - onComplete: called after approve/deny with the action taken
 */
export default function PasswordResetApprovalModal({ requestId, onClose, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState(null); // 'approved' | 'denied'

  // Fetch the request + member info
  useEffect(() => {
    if (!requestId) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: req, error: reqErr } = await supabase
          .from('password_reset_requests')
          .select('id, profile_id, status, created_at, expires_at')
          .eq('id', requestId)
          .single();

        if (reqErr) throw reqErr;
        if (!req) throw new Error('Reset request not found.');
        setRequest(req);

        if (req.status !== 'pending') {
          setResult(req.status);
          setLoading(false);
          return;
        }

        if (new Date(req.expires_at) < new Date()) {
          setError('This reset request has expired.');
          setLoading(false);
          return;
        }

        // Fetch member profile
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .eq('id', req.profile_id)
          .single();

        setMember(prof);
      } catch (err) {
        setError(err.message || 'Failed to load request.');
      } finally {
        setLoading(false);
      }
    })();
  }, [requestId]);

  const handleApprove = async () => {
    setActing(true);
    setError('');
    try {
      const { error } = await supabase.rpc('admin_approve_password_reset', { p_request_id: requestId });
      if (error) throw error;
      setResult('approved');
      onComplete?.('approved');
    } catch (err) {
      setError(err.message || 'Failed to approve.');
    } finally {
      setActing(false);
    }
  };

  const handleDeny = async () => {
    setActing(true);
    setError('');
    try {
      const { error } = await supabase.rpc('admin_deny_password_reset', { p_request_id: requestId });
      if (error) throw error;
      setResult('denied');
      onComplete?.('denied');
    } catch (err) {
      setError(err.message || 'Failed to deny.');
    } finally {
      setActing(false);
    }
  };

  // Fetch the member's email for display (from auth isn't available, use profile username as fallback)
  const memberEmail = member?.username ? `@${member.username}` : '';

  return (
    <AdminModal
      isOpen={true}
      onClose={onClose}
      title="Password Reset Request"
      titleIcon={ShieldCheck}
      size="sm"
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Loader2 size={24} className="text-[#D4AF37] animate-spin mb-3" />
          <p className="text-[13px] text-[#6B7280]">Loading request...</p>
        </div>
      ) : error && !member ? (
        <div className="text-center py-8">
          <XCircle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-[14px] text-red-400 mb-4">{error}</p>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-[13px] font-semibold bg-white/6 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors whitespace-nowrap"
          >
            Close
          </button>
        </div>
      ) : result ? (
        <div className="text-center py-8">
          {result === 'approved' ? (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/12 border-2 border-emerald-500/30 mx-auto mb-4">
                <CheckCircle size={32} className="text-emerald-400" />
              </div>
              <p className="text-[16px] font-bold text-[#E5E7EB]">Reset Approved</p>
              <p className="text-[13px] text-[#6B7280] mt-1">
                {member?.full_name || 'The member'} can now set a new password.
              </p>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/12 border-2 border-red-500/30 mx-auto mb-4">
                <XCircle size={32} className="text-red-400" />
              </div>
              <p className="text-[16px] font-bold text-[#E5E7EB]">Reset Denied</p>
              <p className="text-[13px] text-[#6B7280] mt-1">The request has been denied.</p>
            </>
          )}
          <button
            onClick={onClose}
            className="mt-5 px-6 py-2.5 rounded-xl text-[13px] font-semibold bg-white/6 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors whitespace-nowrap"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Member info */}
          <div className="flex items-center gap-3 bg-[#111827] border border-white/6 rounded-xl p-4 overflow-hidden">
            <Avatar name={member?.full_name} size="lg" src={member?.avatar_url} className="flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-[#E5E7EB] truncate">{member?.full_name || 'Unknown'}</p>
              {memberEmail && <p className="text-[12px] text-[#6B7280]">{memberEmail}</p>}
            </div>
          </div>

          {/* Description */}
          <div className="flex items-center gap-2.5 bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl px-4 py-3">
            <ShieldCheck size={15} className="text-[#D4AF37] flex-shrink-0" />
            <p className="text-[13px] text-[#D4AF37]">
              This member is requesting a password reset. Verify their identity before approving.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <XCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-[12px] text-red-400">{error}</p>
            </div>
          )}

          {/* Created at */}
          {request?.created_at && (
            <p className="text-[11px] text-[#6B7280] text-center">
              Requested {new Date(request.created_at).toLocaleString()}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={acting}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold transition-colors disabled:opacity-50 bg-emerald-500/12 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 whitespace-nowrap"
            >
              {acting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle size={15} />
              )}
              Approve
            </button>
            <button
              onClick={handleDeny}
              disabled={acting}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold transition-colors disabled:opacity-50 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/18 whitespace-nowrap"
            >
              {acting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <XCircle size={15} />
              )}
              Deny
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}

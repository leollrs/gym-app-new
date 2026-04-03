import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Messages from '../Messages';

export default function TrainerMessages() {
  const { profile } = useAuth();
  const [clientIds, setClientIds] = useState(new Set());

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('trainer_clients')
      .select('client_id')
      .eq('trainer_id', profile.id)
      .eq('is_active', true)
      .then(({ data }) => setClientIds(new Set((data || []).map(r => r.client_id))));
  }, [profile?.id]);

  return <Messages trainerClientIds={clientIds} />;
}

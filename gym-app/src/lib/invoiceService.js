// Trainer invoices — data layer.
//
// Records-only billing: the app never processes money. A trainer builds an
// itemized invoice for one of their clients, sends it as a generated PDF FILE
// (WhatsApp/SMS/share — see lib/invoicePdf), and marks it paid manually. Backed
// by the trainer_invoices / trainer_invoice_items tables (migration 0639).
// Security is enforced by RLS (_can_manage_client + current_user_is_staff), so
// these queries stay simple.

import { supabase } from './supabase';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Normalize a raw item ({description, quantity, unit_price}) → row shape with amount. */
function normalizeItems(items = []) {
  return (items || [])
    .map((it, i) => {
      const quantity = round2(it.quantity ?? 1) || 1;
      const unit_price = round2(it.unit_price ?? 0);
      return {
        description: (it.description || '').trim(),
        quantity,
        unit_price,
        amount: round2(quantity * unit_price),
        position: i,
      };
    })
    .filter((it) => it.description); // drop blank rows
}

/** The trainer's active clients (members only) — the invoice client picker. */
export async function listInvoiceClients(trainerId) {
  if (!trainerId) return [];
  const { data, error } = await supabase
    .from('trainer_clients')
    .select('client_id, profiles!trainer_clients_client_id_fkey (id, full_name, username, avatar_url, avatar_type, avatar_value, phone_number)')
    .eq('trainer_id', trainerId)
    .eq('is_active', true);
  if (error) throw error;
  return (data || [])
    .map((r) => r.profiles)
    .filter(Boolean)
    .sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
}

/** All of a trainer's invoices (newest first) with the client's display name. */
export async function listInvoices(trainerId) {
  if (!trainerId) return [];
  const { data, error } = await supabase
    .from('trainer_invoices')
    .select('id, invoice_number, status, currency, total, due_date, issued_at, paid_at, created_at, share_token, client:profiles!trainer_invoices_client_id_fkey (id, full_name, username)')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** A single client's invoices (newest first) — for the per-client card. */
export async function listClientInvoices(clientId) {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('trainer_invoices')
    .select('id, invoice_number, status, currency, total, due_date, issued_at, paid_at, created_at, share_token')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** One invoice + its line items (for edit / detail). */
export async function getInvoice(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('trainer_invoices')
    .select('*, client:profiles!trainer_invoices_client_id_fkey (id, full_name, username, phone_number), items:trainer_invoice_items (id, description, quantity, unit_price, amount, position)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data?.items) data.items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return data;
}

/**
 * Create or update a DRAFT invoice + replace its line items. Totals are computed
 * from the items (no tax in v1). Returns the saved invoice row (incl. share_token).
 */
export async function saveInvoice({ id, trainerId, gymId, clientId, items, notes, dueDate }) {
  const rows = normalizeItems(items);
  const subtotal = round2(rows.reduce((s, r) => s + r.amount, 0));
  const total = subtotal;
  const base = {
    client_id: clientId,
    notes: notes?.trim() || null,
    due_date: dueDate || null,
    subtotal,
    total,
    currency: 'USD',
  };

  let invoiceId = id;
  if (id) {
    const { error } = await supabase.from('trainer_invoices').update(base).eq('id', id);
    if (error) throw error;
    // Replace items wholesale (simplest correct approach for a small list).
    const { error: delErr } = await supabase.from('trainer_invoice_items').delete().eq('invoice_id', id);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await supabase
      .from('trainer_invoices')
      .insert({ ...base, trainer_id: trainerId, gym_id: gymId, status: 'draft' })
      .select('id')
      .single();
    if (error) throw error;
    invoiceId = data.id;
  }

  if (rows.length) {
    const { error: itErr } = await supabase
      .from('trainer_invoice_items')
      .insert(rows.map((r) => ({ ...r, invoice_id: invoiceId })));
    if (itErr) throw itErr;
  }

  return getInvoice(invoiceId);
}

/** Mark an invoice as sent (first send stamps issued_at). Returns share_token. */
export async function sendInvoice(id) {
  const { data, error } = await supabase
    .from('trainer_invoices')
    .update({ status: 'sent', issued_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, share_token, status')
    .single();
  if (error) throw error;
  return data;
}

/** Manually mark paid (money is off-platform). Optional free-text method. */
export async function markInvoicePaid(id, method = null) {
  const { error } = await supabase
    .from('trainer_invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: method?.trim() || null })
    .eq('id', id);
  if (error) throw error;
}

/** Reopen a paid invoice back to sent (undo a mistaken mark-paid). */
export async function reopenInvoice(id) {
  const { error } = await supabase
    .from('trainer_invoices')
    .update({ status: 'sent', paid_at: null, payment_method: null })
    .eq('id', id);
  if (error) throw error;
}

/** Void an invoice (kept as a record, never hard-deleted once sent). */
export async function voidInvoice(id) {
  const { error } = await supabase.from('trainer_invoices').update({ status: 'void' }).eq('id', id);
  if (error) throw error;
}

/** Hard-delete — only meaningful for never-sent drafts. */
export async function deleteInvoice(id) {
  const { error } = await supabase.from('trainer_invoices').delete().eq('id', id);
  if (error) throw error;
}

/** Save the trainer's "how to pay" instructions (shown on every invoice). */
export async function saveTrainerPaymentInstructions(profileId, text) {
  const { error } = await supabase
    .from('profiles')
    .update({ trainer_payment_instructions: text?.trim() || null })
    .eq('id', profileId);
  if (error) throw error;
}

/** The trainer's "how to pay" text — shown on every generated invoice PDF. */
export async function getTrainerPaymentInstructions(trainerId) {
  if (!trainerId) return '';
  const { data, error } = await supabase
    .from('profiles')
    .select('trainer_payment_instructions')
    .eq('id', trainerId)
    .maybeSingle();
  if (error) throw error;
  return data?.trainer_payment_instructions || '';
}

-- ==========================================================================
-- 0639_trainer_invoices.sql
-- Trainer → client INVOICES (itemized, sent as a generated PDF FILE via the OS
-- share sheet — WhatsApp / SMS / email). RECORDS ONLY — money is handled
-- OFF-platform; the trainer marks paid manually. Slots in alongside
-- member_payments (0450/0451) and reuses the same RLS security model
-- (_can_manage_client + current_user_is_staff).
--
-- Design agreed 2026-07-18: members-only client, USD. Delivery is a client-side
-- PDF (lib/invoicePdf) shared as a file — NOT a hosted link, because
-- app.tugympr.com is auth-gated. No public/anon RPC is needed.
-- ==========================================================================

-- ── 1. Trainer payment instructions on profiles (shown on every invoice) ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trainer_payment_instructions TEXT;
COMMENT ON COLUMN public.profiles.trainer_payment_instructions IS
  'Free-text "how to pay" a trainer shows on their invoices (e.g. "ATH Movil @coachluis"). Payment is off-platform.';

-- ── 2. Tables (created first, policies after) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         UUID NOT NULL REFERENCES public.gyms(id)     ON DELETE CASCADE,
  trainer_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_number INT  NOT NULL DEFAULT 0,            -- per-trainer sequence (set by trigger)
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','void')),
  currency       TEXT NOT NULL DEFAULT 'USD',
  subtotal       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  due_date       DATE,
  issued_at      TIMESTAMPTZ,                        -- set when first sent
  paid_at        TIMESTAMPTZ,
  payment_method TEXT,                               -- free text, how they paid
  share_token    TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trainer_invoices_trainer_idx ON public.trainer_invoices (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_invoices_client_idx  ON public.trainer_invoices (client_id);
CREATE INDEX IF NOT EXISTS trainer_invoices_token_idx   ON public.trainer_invoices (share_token);

CREATE TABLE IF NOT EXISTS public.trainer_invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES public.trainer_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  position    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trainer_invoice_items_invoice_idx ON public.trainer_invoice_items (invoice_id, position);

-- ── 3. Per-trainer invoice numbering + updated_at (BEFORE triggers) ────────
CREATE OR REPLACE FUNCTION public.trainer_invoices_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = 0 THEN
    SELECT COALESCE(MAX(invoice_number), 0) + 1
      INTO NEW.invoice_number
      FROM public.trainer_invoices
     WHERE trainer_id = NEW.trainer_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trainer_invoices_number ON public.trainer_invoices;
CREATE TRIGGER trainer_invoices_number
  BEFORE INSERT ON public.trainer_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trainer_invoices_before_insert();

CREATE OR REPLACE FUNCTION public.trainer_invoices_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trainer_invoices_updated_at ON public.trainer_invoices;
CREATE TRIGGER trainer_invoices_updated_at
  BEFORE UPDATE ON public.trainer_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trainer_invoices_set_updated_at();

-- ── 4. RLS — trainer manages own; client reads own ────────────────────────
ALTER TABLE public.trainer_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainer_invoices_trainer_select" ON public.trainer_invoices;
CREATE POLICY "trainer_invoices_trainer_select" ON public.trainer_invoices
  FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- INSERT is the security-critical one: pin to the trainer, their gym, confirm
-- they're staff, and that the client is really one of their clients (mirrors
-- the 0608 privilege-escalation hardening — do NOT drop current_user_is_staff).
DROP POLICY IF EXISTS "trainer_invoices_trainer_insert" ON public.trainer_invoices;
CREATE POLICY "trainer_invoices_trainer_insert" ON public.trainer_invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    trainer_id = auth.uid()
    AND gym_id = public.current_gym_id()
    AND public.current_user_is_staff()
    AND public._can_manage_client(client_id)
  );

-- UPDATE/DELETE gate on ownership only (so marking an old invoice paid still
-- works even if the trainer↔client link was later deactivated).
DROP POLICY IF EXISTS "trainer_invoices_trainer_update" ON public.trainer_invoices;
CREATE POLICY "trainer_invoices_trainer_update" ON public.trainer_invoices
  FOR UPDATE TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

DROP POLICY IF EXISTS "trainer_invoices_trainer_delete" ON public.trainer_invoices;
CREATE POLICY "trainer_invoices_trainer_delete" ON public.trainer_invoices
  FOR DELETE TO authenticated
  USING (trainer_id = auth.uid());

-- Client can read invoices addressed to them (in case we ever surface in-app).
DROP POLICY IF EXISTS "trainer_invoices_client_select" ON public.trainer_invoices;
CREATE POLICY "trainer_invoices_client_select" ON public.trainer_invoices
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_invoices TO authenticated;

ALTER TABLE public.trainer_invoice_items ENABLE ROW LEVEL SECURITY;

-- Items inherit access from the parent invoice (trainer or the billed client
-- can read; only the trainer can write).
DROP POLICY IF EXISTS "trainer_invoice_items_read" ON public.trainer_invoice_items;
CREATE POLICY "trainer_invoice_items_read" ON public.trainer_invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.trainer_invoices i
     WHERE i.id = invoice_id
       AND (i.trainer_id = auth.uid() OR i.client_id = auth.uid())
  ));

DROP POLICY IF EXISTS "trainer_invoice_items_write" ON public.trainer_invoice_items;
CREATE POLICY "trainer_invoice_items_write" ON public.trainer_invoice_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.trainer_invoices i
     WHERE i.id = invoice_id AND i.trainer_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.trainer_invoices i
     WHERE i.id = invoice_id AND i.trainer_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_invoice_items TO authenticated;

-- NOTE: no public/anon RPC. The invoice is rendered to a PDF client-side
-- (lib/invoicePdf) and shared as a file, so nothing is exposed to `anon`.
-- share_token is retained as a stable per-invoice id (handy if a hosted view is
-- ever added on a non-auth-gated host).

NOTIFY pgrst, 'reload schema';

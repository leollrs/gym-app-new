# `tugympr.com/eliminar-cuenta` — drop-in snippet

Replace the form on your existing `/eliminar-cuenta` page with this JS. It handles **both** flows:

- **No token in URL** → shows the request form, POSTs email + reason to `request-account-deletion`, shows generic confirmation
- **`?token=...` in URL** → shows the "Confirm deletion" UI, POSTs the token to `confirm-account-deletion`, shows success/failure

You only need to set ONE constant: `SUPABASE_PROJECT_REF`.

---

## Before you paste

1. Find your Supabase project ref in the Dashboard URL (it's the subdomain of `*.supabase.co`).
2. Confirm both edge functions are deployed:
   ```bash
   supabase functions deploy request-account-deletion
   supabase functions deploy confirm-account-deletion
   ```
3. Confirm the migrations are pushed:
   ```bash
   supabase db push
   ```
   This applies `0337` through `0341`, including the `account_deletion_requests` table and the `delete_user_account_admin` RPC.

---

## HTML + JS

Drop this into your `/eliminar-cuenta` page. Style as you like.

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Eliminar tu cuenta · TuGymPR</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0B0F12; color: #f0eee9; max-width: 480px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 28px; margin: 0 0 8px; color: #E8C547; }
    p { line-height: 1.5; color: #c5c2bb; }
    label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9A988E; margin: 18px 0 6px; }
    input, textarea, button { width: 100%; box-sizing: border-box; font-size: 16px; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: #161a1d; color: #f0eee9; font-family: inherit; }
    button { margin-top: 22px; background: #E8C547; color: #0B0F12; font-weight: 700; border: none; cursor: pointer; }
    button[disabled] { opacity: 0.5; cursor: not-allowed; }
    .muted { font-size: 13px; color: #6B6A63; margin-top: 8px; }
    .ok { background: #1f3a1f; border: 1px solid #5EAA5E; padding: 14px; border-radius: 10px; }
    .err { background: #3a1f1f; border: 1px solid #C13B14; padding: 14px; border-radius: 10px; }
  </style>
</head>
<body>
  <h1>Eliminar tu cuenta</h1>
  <p id="intro">
    Esto borra tu perfil, entrenos, fotos de progreso, mensajes y todos los datos
    asociados a tu cuenta de TuGymPR. La acción no se puede deshacer.
  </p>

  <div id="root"></div>

  <p class="muted">
    Mantenemos los registros de auditoría hasta 90 días por motivos de fraude y
    cumplimiento. El resto se elimina en un máximo de 30 días.
    Privacidad: <a href="/privacy" style="color:#E8C547">tugympr.com/privacy</a>
  </p>

  <script>
    // ─── Set your Supabase project ref here ───────────────────────────
    const SUPABASE_PROJECT_REF = 'YOUR_PROJECT_REF';
    const FN_BASE = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;

    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const root = document.getElementById('root');

    if (token) renderConfirm(token); else renderRequest();

    // ─── Step 1: request flow (no token) ──────────────────────────────
    function renderRequest() {
      root.innerHTML = `
        <form id="reqForm" novalidate>
          <label for="email">Correo electrónico</label>
          <input id="email" type="email" required autocomplete="email" placeholder="tucorreo@ejemplo.com" />
          <label for="reason">Razón (opcional)</label>
          <textarea id="reason" rows="3" maxlength="2000" placeholder="Cuéntanos por qué te vas. Nos ayuda a mejorar."></textarea>
          <button type="submit" id="submitBtn">Enviar enlace de confirmación</button>
          <div id="msg"></div>
        </form>
      `;
      document.getElementById('reqForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submitBtn');
        const msg = document.getElementById('msg');
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await fetch(`${FN_BASE}/request-account-deletion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: document.getElementById('email').value.trim().toLowerCase(),
              reason: document.getElementById('reason').value.trim() || undefined,
            }),
          });
        } catch { /* swallow — generic message either way */ }
        msg.innerHTML = `
          <div class="ok" style="margin-top:18px">
            <strong>Revisa tu correo.</strong><br />
            Si existe una cuenta con ese correo, te enviamos un enlace para confirmar
            la eliminación. El enlace caduca en 1 hora.
          </div>`;
        btn.style.display = 'none';
      });
    }

    // ─── Step 2: confirmation flow (token present) ────────────────────
    function renderConfirm(t) {
      root.innerHTML = `
        <div class="err" style="margin-top:6px">
          <strong>Última oportunidad.</strong> Al confirmar, eliminaremos
          permanentemente tu cuenta y todos los datos asociados.
        </div>
        <button id="confirmBtn" style="background:#C13B14;color:#fff">Eliminar mi cuenta permanentemente</button>
        <div id="cmsg"></div>
      `;
      document.getElementById('confirmBtn').addEventListener('click', async () => {
        const btn = document.getElementById('confirmBtn');
        const msg = document.getElementById('cmsg');
        btn.disabled = true; btn.textContent = 'Eliminando…';
        try {
          const r = await fetch(`${FN_BASE}/confirm-account-deletion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: t }),
          });
          const data = await r.json().catch(() => ({}));
          if (r.ok && data.ok) {
            msg.innerHTML = `<div class="ok" style="margin-top:18px"><strong>Cuenta eliminada.</strong> Sentimos verte ir.</div>`;
            btn.style.display = 'none';
            document.getElementById('intro').style.display = 'none';
          } else {
            msg.innerHTML = `<div class="err" style="margin-top:18px">${data.error || 'No se pudo eliminar la cuenta. Contacta support@tugympr.com.'}</div>`;
            btn.disabled = false;
            btn.textContent = 'Reintentar';
          }
        } catch {
          msg.innerHTML = `<div class="err" style="margin-top:18px">Error de red. Inténtalo de nuevo.</div>`;
          btn.disabled = false;
          btn.textContent = 'Reintentar';
        }
      });
    }
  </script>
</body>
</html>
```

---

## Notes

- The page is **fully self-contained** — no external scripts, no auth, no cookies. Hosting it as a static page on `tugympr.com/eliminar-cuenta` is enough.
- Both endpoints return generic messages — a third party scraping the form cannot determine whether an email exists in your system.
- The token expires in 1 hour, set by `request-account-deletion`. After that, the user must request a new link.
- The single-use guard is enforced server-side: `confirm-account-deletion` marks the row consumed before triggering the cascade, so a duplicate click is a no-op.
- Spanish copy throughout (matches the URL slug). Add an English variant if you publish a `/delete-account` mirror.

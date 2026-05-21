# Sidecar Contract

This document describes the HTTP contract between the TuGymPR Tauri desktop app and the local sidecar process that bridges scan events to the gym's existing software.

## Why a sidecar?

The Tauri app talks to Supabase for everything tenant-related (check-ins, member data, points). But many gyms run legacy software (member management, POS, access control) that:

- Has no public API
- Lives only on their LAN or front-desk machine
- Cannot be reached from a cloud webhook

The sidecar fills that gap. It runs on the same Windows/Mac machine as the Tauri app, listens for scan events from us, and forwards them to the gym's legacy software using whatever mechanism that vendor provides (keystroke emulation, file drops, named pipes, vendor SDK, etc.).

## Network endpoint

- **Host:** `127.0.0.1` (localhost only — never bind to a public interface)
- **Default port:** `9876`
- **Override:** Set `VITE_SIDECAR_URL` at Tauri build time to point elsewhere — e.g., `http://127.0.0.1:8080/scan`

The Tauri app will POST to `{SIDECAR_URL}` on every successful scan.

## Request shape

`POST {SIDECAR_URL}` with header `Content-Type: application/json`:

```json
{
  "action": "checkin",
  "payload": {
    "action": "checkin",
    "memberId": "550e8400-e29b-41d4-a716-446655440000",
    "memberExternalId": "MBR-001234",
    "memberName": "María Rodríguez",
    "timestamp": "2026-05-22T15:33:01.123Z",
    "data": {
      "pointsEarned": 20
    }
  },
  "timestamp": "2026-05-22T15:33:01.456Z",
  "gymId": "abc12345-6789-0abc-def0-123456789abc",
  "source": "tauri-desktop"
}
```

Field reference:

| Field | Type | Notes |
|---|---|---|
| `action` | string | `checkin`, `purchase`, `reward_redemption`, `referral`, `voucher` |
| `payload.memberId` | UUID | TuGymPR's internal member id |
| `payload.memberExternalId` | string \| null | The gym's existing system's member id (if mapped) — **use this to look up the member in the legacy system** |
| `payload.memberName` | string | Full name |
| `payload.timestamp` | ISO-8601 | When the scan happened |
| `payload.data` | object | Action-specific extras |
| `timestamp` | ISO-8601 | When the bridge dispatched (will be ≥ `payload.timestamp` by a few ms) |
| `gymId` | UUID | Tenant id — only one gym per machine, but included for sanity-check logging |
| `source` | string | Always `tauri-desktop` for now |

## Response shape

We don't read the response body. Status code is the only thing that matters:

- **2xx** — success, log and move on
- **non-2xx or timeout (2000ms)** — log a warning, continue. **We don't block the TuGymPR check-in on sidecar failure.**

If the sidecar is offline (ECONNREFUSED), TuGymPR's check-in still completes — it just doesn't propagate to the legacy system. The gym can reconcile later (or you can have the sidecar re-poll missed events on startup if that matters).

## Minimal sidecar example (Node.js)

```js
import http from 'node:http';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/scan') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', () => {
    try {
      const evt = JSON.parse(body);
      console.log(`[sidecar] ${evt.action} for ${evt.payload.memberName}`);
      // TODO: drive the legacy gym software here.
      // e.g. spawn a keystroke macro, write to a watched folder,
      // call a vendor SDK, post to an internal LAN service, etc.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400).end();
    }
  });
});

server.listen(9876, '127.0.0.1', () => {
  console.log('[sidecar] listening on http://127.0.0.1:9876');
});
```

## Idempotency

Same scan, same member, same payload — but `payload.timestamp` and the outer `timestamp` will differ on retries. If you need de-duplication, key on `(payload.memberId, action, payload.timestamp)`. We don't retry from the Tauri side, but you might want internal retry-with-dedupe for talking to the legacy system.

## Security notes

- The sidecar binds to `127.0.0.1` only — no LAN exposure.
- We don't sign the body. The sidecar is on the same machine as the Tauri app and the threat model assumes localhost is trusted.
- If you later want HMAC-style signing for extra safety, the Tauri side can sign with a shared secret read from an env var; tell me when you want that and I'll wire it.

## Lifecycle: how to run the sidecar alongside TuGymPR

Three options, in order of how I'd recommend them:

1. **Windows Service / launchd job** — runs always, separate from TuGymPR. Survives TuGymPR crashes. Best for production.
2. **Auto-launch via the same `Run` registry key** TuGymPR uses, but as a separate executable. Both apps start at boot independently.
3. **Spawned by TuGymPR itself** (Tauri sidecar feature) — simplest, but ties the sidecar's lifecycle to the Tauri process. If you crash the app, the sidecar dies too. Fine for development.

The Tauri sidecar feature (`tauri-plugin-shell` with `Command::new_sidecar`) is the right path if you bundle the sidecar binary with the installer. When you've got the sidecar built, we can wire it into the installer so a single download gives the gym both pieces.

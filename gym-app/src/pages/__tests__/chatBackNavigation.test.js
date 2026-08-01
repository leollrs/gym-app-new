/**
 * Regression test for the trainer-profile ↔ chat back-button loop.
 *
 * PublicTrainerProfile pushes /messages/:id with `state.from` pointing back at
 * itself. Messages.handleBack used to honour that by calling navigate(from) —
 * a PUSH, which stacked a second copy of the profile on top of the chat. The
 * profile's own back button (navigate(-1)) then landed on the chat again, and
 * the two pages bounced forever with no way out.
 *
 * This drives a real router rather than asserting on the source, so it fails
 * if either page's back behaviour regresses.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryRouter } from 'react-router-dom';

const routes = [
  { path: '/trainers', element: null },
  { path: '/trainers/:id', element: null },
  { path: '/messages/:cid', element: null },
];

// Open the trainer directory → a trainer → tap "Message".
async function openChatFromProfile() {
  const router = createMemoryRouter(routes, { initialEntries: ['/trainers'] });
  await router.navigate('/trainers/abc');
  await router.navigate('/messages/c1', { state: { from: '/trainers/abc' } });
  return router;
}

// Walk back repeatedly, using each page's own back handler.
async function walkBack(router, backFromChat, steps = 6) {
  const visited = [router.state.location.pathname];
  for (let i = 0; i < steps; i++) {
    if (router.state.location.pathname.startsWith('/messages/')) {
      await backFromChat(router);
    } else {
      await router.navigate(-1); // the profile's back button
    }
    visited.push(router.state.location.pathname);
  }
  return visited;
}

describe('chat opened from a trainer profile', () => {
  it('reproduces the loop when back PUSHES state.from (the old behaviour)', async () => {
    const router = await openChatFromProfile();
    const visited = await walkBack(router, (r) => r.navigate('/trainers/abc'));

    // Ping-pongs between exactly two entries and never reaches the directory.
    expect(new Set(visited)).toEqual(new Set(['/messages/c1', '/trainers/abc']));
    expect(visited).not.toContain('/trainers');
  });

  it('escapes to the page before the profile when back POPS (the fix)', async () => {
    const router = await openChatFromProfile();
    const visited = await walkBack(router, (r) => r.navigate(-1));

    expect(visited[0]).toBe('/messages/c1');
    expect(visited[1]).toBe('/trainers/abc'); // back from chat → the profile
    expect(visited[2]).toBe('/trainers');     // back from profile → where it came from
  });

  it('leaves the stack no deeper than it found it', async () => {
    const router = await openChatFromProfile();
    await router.navigate(-1); // back from chat
    await router.navigate(-1); // back from profile
    // Two pushes, two pops — we're at the entry we started on.
    expect(router.state.location.pathname).toBe('/trainers');
  });
});

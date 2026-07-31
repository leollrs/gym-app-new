import { describe, it, expect, vi } from 'vitest';

// The real module opens a Supabase client at import time (needs env + network).
// getPublicUrl is pure string-building, so a stand-in that mirrors its actual
// output shape is enough — and it lets the test assert the KEY we hand it,
// which is where every bug in this helper has lived.
const BASE = 'https://example.supabase.co/storage/v1/object/public';
vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: (bucket) => ({
        getPublicUrl: (key) => ({ data: { publicUrl: `${BASE}/${bucket}/${key}` } }),
      }),
    },
  },
}));

const { classImageUrl } = await import('../classImageUrl');

describe('classImageUrl', () => {
  it('resolves a bucket-relative path', () => {
    expect(classImageUrl('gym-1/1775613613143.jpg'))
      .toBe(`${BASE}/class-images/gym-1/1775613613143.jpg`);
  });

  // THE regression: legacy gym_classes.image_url rows stored the path WITH the
  // bucket prefix. getPublicUrl prepends the bucket itself, so those produced
  // .../class-images/class-images/... and every one of them 400'd.
  it('does not double the bucket prefix on legacy paths', () => {
    const url = classImageUrl('class-images/gym-1/1775613613143.jpg');
    expect(url).toBe(`${BASE}/class-images/gym-1/1775613613143.jpg`);
    expect(url).not.toContain('class-images/class-images');
  });

  // The admin form previews a just-picked file via URL.createObjectURL. Feeding
  // that to getPublicUrl produced .../class-images/blob:http://... — a 400 on
  // the one screen an admin opens to FIX a broken cover.
  it('passes through srcs that are already usable', () => {
    expect(classImageUrl('blob:http://localhost:5173/abc-123')).toBe('blob:http://localhost:5173/abc-123');
    expect(classImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(classImageUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(classImageUrl('http://cdn.example.com/a.jpg')).toBe('http://cdn.example.com/a.jpg');
  });

  it('returns null for an absent path', () => {
    expect(classImageUrl(null)).toBeNull();
    expect(classImageUrl(undefined)).toBeNull();
    expect(classImageUrl('')).toBeNull();
  });
});

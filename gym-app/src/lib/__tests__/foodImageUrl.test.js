import { describe, it, expect, vi } from 'vitest';

// Same stand-in as classImageUrl.test.js: getPublicUrl is pure string-building,
// and the transform option is what this suite exists to assert. Encoding it into
// the URL lets a test see whether we asked Supabase to RENDER an image (billed
// per unique origin image) or just to hand back an object (free).
const BASE = 'https://example.supabase.co/storage/v1/object/public';
vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: (bucket) => ({
        getPublicUrl: (key, opts) => ({
          data: {
            publicUrl: opts?.transform
              ? `${BASE}/${bucket}/${key}?RENDER=${JSON.stringify(opts.transform)}`
              : `${BASE}/${bucket}/${key}`,
          },
        }),
      }),
    },
  },
}));

const { foodImageUrl, BAKED_THUMBS_READY } = await import('../imageUrl');

const isRendered = (url) => url.includes('RENDER=');

describe('foodImageUrl — thumbnails are baked, not billed', () => {
  // The bug this locks: `ingredients/` and `categories/` defaulted to a
  // { width: 144 } transform. Supabase meters that per UNIQUE ORIGIN IMAGE, and
  // those two prefixes hold ~127 static objects against a quota of 100 — so the
  // project was permanently over on content that never changes.
  //
  // The rewrite ships behind BAKED_THUMBS_READY because the code and the data
  // migration are independent: pointing at `thumb/` before the bake has run
  // would show a placeholder for every ingredient tile. These assert BOTH
  // states, so the suite is honest about which one is live.
  it('serves the baked copy for ingredients once the bake has run', () => {
    const url = foodImageUrl('/ingredients/kale.jpg');
    if (BAKED_THUMBS_READY) {
      expect(url).toBe(`${BASE}/food-images/ingredients/thumb/kale.jpg`);
      expect(isRendered(url)).toBe(false);
    } else {
      // Pre-bake: byte-identical to the old behaviour, transform and all.
      expect(url).toContain('/food-images/ingredients/kale.jpg');
      expect(isRendered(url)).toBe(true);
    }
  });

  it('serves the baked copy for categories too', () => {
    const url = foodImageUrl('/categories/high_protein.jpg');
    expect(url).toContain(BAKED_THUMBS_READY
      ? '/food-images/categories/thumb/high_protein.jpg'
      : '/food-images/categories/high_protein.jpg');
  });

  it('never rewrites a path that is already a thumb', () => {
    // Guards against double-prefixing if a DB row ever stores the baked path.
    // True in both states: `thumb/` is nested, so the rewrite skips it, and the
    // default transform does not apply to a nested path either.
    expect(foodImageUrl('/ingredients/thumb/kale.jpg'))
      .toBe(`${BASE}/food-images/ingredients/thumb/kale.jpg`);
  });

  it('leaves other prefixes on the original', () => {
    const url = foodImageUrl('/meals/chicken_bowl.jpg');
    expect(url).toBe(`${BASE}/food-images/meals/chicken_bowl.jpg`);
    expect(isRendered(url)).toBe(false);
  });

  it('honours an explicit size instead of the baked thumb', () => {
    // The full-width hero and the 150 px card pass a width; there is no baked
    // variant at those sizes, so they still render from the original.
    const url = foodImageUrl('/ingredients/kale.jpg', { width: 1024, quality: 75 });
    expect(url).toContain('/food-images/ingredients/kale.jpg');
    expect(url).not.toContain('/thumb/');
    expect(isRendered(url)).toBe(true);
  });

  it('still corrects .png to .jpg and passes through absolute / data / blob urls', () => {
    expect(foodImageUrl('/meals/x.png')).toBe(`${BASE}/food-images/meals/x.jpg`);
    expect(foodImageUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(foodImageUrl('data:image/jpeg;base64,AAA')).toBe('data:image/jpeg;base64,AAA');
    expect(foodImageUrl('blob:http://x/y')).toBe('blob:http://x/y');
    expect(foodImageUrl('')).toBeNull();
  });
});

#!/usr/bin/env node
/**
 * Upload program template images to the Supabase "program-images" storage bucket.
 *
 * Usage:
 *   VITE_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/upload-program-images.js
 *
 * Requirements:
 *   - The "program-images" bucket must already exist (created by migration 0243).
 *   - Uses the service-role key so it bypasses RLS (admin INSERT policy).
 *   - Images are read from public/programs/ and uploaded to the bucket root.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const imagesDir = path.resolve(__dirname, '../public/programs');

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

async function main() {
  const files = fs.readdirSync(imagesDir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ext in MIME_TYPES;
  });

  console.log(`Found ${files.length} images to upload.\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const contentType = MIME_TYPES[ext];
    const filePath = path.join(imagesDir, file);
    const fileBuffer = fs.readFileSync(filePath);

    const { error } = await supabase.storage
      .from('program-images')
      .upload(file, fileBuffer, {
        contentType,
        upsert: true, // overwrite if exists
      });

    if (error) {
      if (error.message?.includes('already exists')) {
        console.log(`  SKIP  ${file} (already exists)`);
        skipped++;
      } else {
        console.error(`  FAIL  ${file}: ${error.message}`);
        failed++;
      }
    } else {
      console.log(`  OK    ${file}`);
      success++;
    }
  }

  console.log(`\nDone: ${success} uploaded, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

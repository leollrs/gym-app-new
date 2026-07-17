// One-off uploader for exercise demo videos -> Supabase Storage.
// Run:  SUPABASE_SERVICE_ROLE_KEY=<key> node upload_videos.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const URL = 'https://erdhnixjnjullhjzmvpm.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIR = '/Users/leollorens/Downloads/exercise-videos-upload/global';
const BUCKET = 'exercise-videos';

if (!KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var'); process.exit(1); }

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.mp4'));
console.log(`Uploading ${files.length} files to ${BUCKET}/global/ ...`);

let ok = 0, fail = 0;
for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  const { error } = await supabase.storage.from(BUCKET).upload(`global/${f}`, buf, {
    contentType: 'video/mp4', upsert: true, cacheControl: '3600',
  });
  if (error) { console.error(`  FAIL ${f}: ${error.message}`); fail++; }
  else { ok++; process.stdout.write(`  ok ${ok}/${files.length}\r`); }
}
console.log(`\nDone. Uploaded ${ok}, failed ${fail}.`);

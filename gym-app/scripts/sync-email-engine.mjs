#!/usr/bin/env node
/**
 * Copia el motor de correo del navegador a la carpeta de Deno.
 *
 * Deno no puede importar desde `src/`, así que el enviador necesita su propia
 * copia. Mantenerlas a mano ya falló una vez y caro: la vista previa y el
 * envío acabaron divergiendo en la maqueta entera, en el separador de sección
 * (`--Título--` vs `---Título---`), en las viñetas, en la sustitución de
 * tokens y en el pie — y el editor llevaba semanas enseñando una cosa y
 * mandando otra.
 *
 * El motor es JS puro a propósito —sin DOM, sin dependencias— para que esta
 * copia sea literal y este script pueda ser tonto.
 *
 *   node scripts/sync-email-engine.mjs           genera
 *   node scripts/sync-email-engine.mjs --check   solo verifica (para CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Los archivos que se copian.
 *
 * `sliceFrom` recorta el docblock de cabecera cuando habla del navegador y no
 * tendría sentido en la copia; sin él se copia el archivo entero.
 */
export const FILES = [
  {
    src: 'src/lib/admin/emailEngine.js',
    out: 'supabase/functions/_shared/emailEngine.ts',
    sliceFrom: '// ── Color',
  },
  {
    src: 'src/lib/admin/emailVariants.js',
    out: 'supabase/functions/_shared/emailVariants.ts',
  },
  {
    src: 'src/lib/admin/outreachTokens.js',
    out: 'supabase/functions/_shared/outreachTokens.ts',
  },
];

const HEADER = `/**
 * COPIA GENERADA de %SRC% — NO EDITAR A MANO.
 *
 * El original es JS puro (sin DOM, sin dependencias, sin npm) precisamente para
 * que esta copia sea literal. Deno no puede importar desde \`src/\`, y la
 * alternativa —dos implementaciones escritas por separado— ya nos costó un dia
 * entero: la vista previa y el envio divergieron en la maqueta, en el
 * separador de seccion, en las vinetas, en los tokens y en el pie.
 *
 * SI TOCAS EL ORIGINAL:
 *   1. edita %SRC%
 *   2. \`npm run sync:email-engine\`  (scripts/sync-email-engine.mjs)
 *   3. \`npx vitest run\` — el test de contrato compara las dos copias byte a
 *      byte y falla si se separan.
 */
/* eslint-disable */
// @ts-nocheck

`;

export function buildDenoCopy(source, file) {
  const header = HEADER.split('%SRC%').join(file.src);
  if (!file.sliceFrom) return header + source;
  // Se descarta el docblock de cabecera (habla del navegador) y se conserva
  // TODO lo demás, empezando en el primer separador de sección.
  const start = source.indexOf(file.sliceFrom);
  if (start === -1) throw new Error(`No encuentro el marcador "${file.sliceFrom}" en ${file.src}`);
  return header + source.slice(start);
}

/** Lo que DEBERÍA haber en la copia de Deno de `file`, leyendo el original. */
export function expectedCopy(file) {
  return buildDenoCopy(fs.readFileSync(path.join(root, file.src), 'utf8'), file);
}

export const outPath = (file) => path.join(root, file.out);

// Solo actúa cuando se EJECUTA, nunca al importarlo.
//
// El test de contrato importa `buildDenoCopy` de aquí. Sin esta guarda, correr
// la suite reescribía el archivo generado — o sea, el test que existe para
// detectar la divergencia la arreglaba solo y pasaba siempre. Un test que
// repara lo que mide no mide nada.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const file of FILES) {
    const expected = expectedCopy(file);
    const out = outPath(file);
    if (check) {
      const actual = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
      if (actual !== expected) {
        console.error(`✗ ${file.out} está desincronizado.`);
        stale += 1;
      }
    } else {
      fs.writeFileSync(out, expected);
      console.log('✓ escrito', file.out);
    }
  }
  if (check) {
    if (stale) {
      console.error('  Ejecuta: node scripts/sync-email-engine.mjs');
      process.exit(1);
    }
    console.log('✓ el motor de correo está sincronizado');
  }
}

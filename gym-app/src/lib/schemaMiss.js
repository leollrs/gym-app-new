/**
 * "The database is behind the frontend."
 *
 * Migrations are applied by hand here, so a deployed bundle routinely runs for
 * a while against a schema that doesn't have its new columns yet — and a
 * PostgREST request naming a missing column fails the WHOLE query, not just
 * that column. A list read then comes back empty and the page looks broken.
 *
 * Same detector AdminPrograms.jsx:47 has used for the gym_programs extended
 * columns; lifted here so the trainer-consent reads (0657) can degrade the same
 * way instead of each file growing its own copy.
 */
export const isSchemaMiss = (err) =>
  !!err && (
    err.code === 'PGRST204' ||
    err.code === '42703' ||          // undefined_column
    err.code === '42P01' ||          // undefined_table
    err.code === 'PGRST205' ||       // table not in schema cache
    /could not find|does not exist|schema cache/i.test(err.message || '')
  );

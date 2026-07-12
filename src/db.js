import pg from 'pg';

export let dbAvailable = false;

let pool;

export async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — using file-based storage');
    return;
  }
  try {
    const useSSL = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', err => {
      console.error('PostgreSQL pool error:', err.message);
    });

    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    dbAvailable = true;
    console.log('PostgreSQL connected');
  } catch (err) {
    console.warn('PostgreSQL unavailable, falling back to file:', err.message);
    try { await pool?.end(); } catch {}
    pool = null;
  }
}

export async function loadResults() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query('SELECT data FROM results ORDER BY id');
    return rows.map(r => r.data);
  } catch (err) {
    console.error('DB loadResults failed:', err.message);
    return null;
  }
}

export async function upsertResult(result) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO results (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [result.id, result]
    );
  } catch (err) {
    console.error('DB upsertResult failed:', err.message);
  }
}

export async function deleteResults(modelIds) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM results WHERE id = ANY($1::text[])', [modelIds]);
  } catch (err) {
    console.error('DB deleteResults failed:', err.message);
  }
}

export async function replaceAll(results) {
  if (!pool) return;
  try {
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE results');
      for (const r of results) {
        await client.query(
          'INSERT INTO results (id, data, updated_at) VALUES ($1, $2, NOW())',
          [r.id, r]
        );
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('DB replaceAll failed:', err.message);
  }
}

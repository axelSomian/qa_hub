import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err: Error) => {
  console.error('❌ Erreur PostgreSQL inattendue', err);
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export const testConnection = async (): Promise<void> => {
  try {
    const res = await pool.query('SELECT NOW() as current_time');
    console.log('✅ Postgres connecté :', res.rows[0].current_time);
  } catch (err) {
    console.error('❌ Impossible de connecter à Postgres :', err);
  }
};

export default pool;
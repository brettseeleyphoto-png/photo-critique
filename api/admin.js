const { neon } = require('@neondatabase/serverless');

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS critiques (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      num_lights TEXT,
      light_type TEXT,
      modifiers TEXT,
      creative TEXT,
      shoot_type TEXT,
      post_processing TEXT,
      extra_context TEXT,
      image_url TEXT,
      critique TEXT NOT NULL
    )
  `;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS image_pathname TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS image_mime_type TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS image_size_bytes INTEGER`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS original_filename TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS original_mime_type TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS storage_provider TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS storage_error TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS feedback_token TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS ai_feedback_ratings JSONB`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMP`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction_status TEXT DEFAULT 'pending'`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_corrected_at TIMESTAMP`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_sent_at TIMESTAMP`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_id TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_error TEXT`;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureSchema(sql);
    const rows = await sql`
      SELECT
        id, created_at, name, email, num_lights, light_type, modifiers, creative, shoot_type, post_processing, extra_context,
        image_url, image_pathname, image_mime_type, image_size_bytes, original_filename, original_mime_type,
        storage_provider, storage_error, ai_feedback_ratings, feedback_submitted_at,
        brett_correction, brett_correction_status, brett_corrected_at, brett_email_sent_at, brett_email_id, brett_email_error,
        critique
      FROM critiques
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return res.status(200).json({ submissions: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

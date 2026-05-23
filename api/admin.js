const { neon } = require('@neondatabase/serverless');

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
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction_status TEXT DEFAULT 'pending'`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_corrected_at TIMESTAMP`;
}

module.exports = async function handler(req, res) {
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
        storage_provider, storage_error, brett_correction, brett_correction_status, brett_corrected_at, critique
      FROM critiques
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return res.status(200).json({ submissions: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

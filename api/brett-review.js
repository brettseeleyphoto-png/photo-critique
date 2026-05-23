const { neon } = require('@neondatabase/serverless');

async function ensureSchema(sql) {
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction_status TEXT DEFAULT 'pending'`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_corrected_at TIMESTAMP`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, critiqueId, correction } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!critiqueId) {
    return res.status(400).json({ error: 'Missing critique ID' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureSchema(sql);
    const cleanedCorrection = String(correction || '').trim();
    const rows = await sql`
      UPDATE critiques
      SET brett_correction = ${cleanedCorrection || null},
          brett_correction_status = ${cleanedCorrection ? 'reviewed' : 'pending'},
          brett_corrected_at = CASE WHEN ${Boolean(cleanedCorrection)} THEN NOW() ELSE NULL END
      WHERE id = ${Number(critiqueId)}
      RETURNING id
    `;
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Brett review save failed:', err.message);
    return res.status(500).json({ error: 'Could not save Brett review' });
  }
};

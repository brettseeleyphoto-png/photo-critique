const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT id, created_at, name, email, num_lights, light_type, modifiers, creative, shoot_type, post_processing, extra_context, image_url, critique
      FROM critiques
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return res.status(200).json({ submissions: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

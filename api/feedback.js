const { neon } = require('@neondatabase/serverless');

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

const VALID_SECTIONS = new Set([
  "WHAT'S WORKING",
  'LIGHTING',
  'POSING',
  'COMPOSITION',
  'STORY / IMPACT',
  'YOUR ONE PRIORITY',
  'CRITIQUE',
]);

async function ensureSchema(sql) {
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS feedback_token TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS ai_feedback_ratings JSONB`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMP`;
}

function cleanRatings(raw) {
  const ratings = {};
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const key of Object.keys(input)) {
    const value = Number(input[key]);
    if (!VALID_SECTIONS.has(key) || !Number.isInteger(value) || value < 1 || value > 10) {
      throw new Error('Ratings must be 1-10 for each critique section.');
    }
    ratings[key] = value;
  }
  if (!Object.keys(ratings).length) {
    throw new Error('At least one section rating is required.');
  }
  return ratings;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { critiqueId, feedbackToken, ratings } = req.body || {};
  if (!critiqueId || !feedbackToken) {
    return res.status(400).json({ error: 'Missing critique feedback reference.' });
  }

  try {
    const cleanedRatings = cleanRatings(ratings);
    const sql = neon(process.env.DATABASE_URL);
    await ensureSchema(sql);

    const rows = await sql`
      UPDATE critiques
      SET ai_feedback_ratings = ${JSON.stringify(cleanedRatings)}::jsonb,
          feedback_submitted_at = NOW()
      WHERE id = ${Number(critiqueId)}
        AND feedback_token = ${feedbackToken}
      RETURNING id
    `;

    if (!rows.length) {
      return res.status(404).json({ error: 'Could not find this critique feedback record.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Feedback save failed:', err.message);
    return res.status(400).json({ error: err.message });
  }
};

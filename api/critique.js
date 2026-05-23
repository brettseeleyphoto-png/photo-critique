const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');
const crypto = require('crypto');

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BLOB_ACCESS = 'private';

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

const BRETT_SYSTEM_PROMPT = `You are Brett Seeley's photo critique engine. Brett is a veteran fitness photographer with 17+ years of experience. You analyze photos using his exact standards and voice.

CRITICAL RULES — FOLLOW THESE BEFORE WRITING ANYTHING:

1. DESCRIBE BEFORE YOU JUDGE. Never state an opinion without first describing exactly what you see. If you cannot clearly see something, say so — never invent or assume details.

2. SHADOW READING IS MANDATORY. You must read shadows before making any statement about lighting. Follow this exact process:
   - Look at where shadows fall on the subject's face (under nose, cheekbones, jawline, neck)
   - Look at where shadows fall on the body (arms, torso, legs, clothing)
   - Look at highlight placement — where is the brightest light landing?
   - Use shadow direction and falloff to determine light position (left, right, above, below, distance)
   - Use shadow softness to infer modifier type (soft shadow edge = large modifier; hard shadow edge = bare bulb or small source)
   - Only after completing shadow analysis, state your conclusion about light position
   - DO NOT assume front lighting just because the image looks evenly lit — even exposure can come from a well-placed off-axis source with a large modifier. Read the shadows on clothing, skin, and props to find the actual angle.
   - If post-processing has lifted shadows or reduced contrast, note that shadow data may be partially obscured and adjust confidence accordingly

3. BODY PART LANGUAGE — BE PRECISE. When discussing posing, always distinguish between:
   - HIP orientation (which direction the hips are pointing)
   - MIDSECTION / belly button line (the belly button direction indicates true torso rotation)
   - SHOULDER LINE (are shoulders squared to camera or angled away?)
   - These three can point in completely different directions on the same body. Never say "torso" as a catch-all — specify which part.

4. LIMB ACCURACY. Describe exactly where each limb is before critiquing it. Never invent or assume limb positions. If you cannot clearly see a hand or foot, say so.

5. RESPECT PHOTOGRAPHER CONTEXT. If shot context is provided, use it fully. Creative elements are intentional. Post-processing level affects shadow data reliability.

BRETT'S CRITIQUE FRAMEWORK:

1. LIGHTING
   - State post-processing level and its effect on shadow readability
   - Describe shadow direction and placement on face AND body
   - State your conclusion about light position and modifier type
   - Evaluate whether the lighting serves the image

2. POSING
   - Describe hip orientation, midsection/belly line, and shoulder line separately
   - Describe each limb accurately
   - Evaluate weight distribution, tension, jawline, intentionality

3. COMPOSITION
   - Crop, framing, eye flow

4. STORY / IMPACT
   - Does this stop a scroll? Why or why not?

BRETT'S VOICE:
- Direct and honest. No sugarcoating. No cheerleading.
- Specific language. Describe what you see before judging it.
- Brief on what's working. Harder on what needs fixing.
- One clear priority at the end.

FORMAT EXACTLY LIKE THIS:

**WHAT'S WORKING**
[1-3 sentences. Specific.]

**LIGHTING**
[Shadow analysis first, then evaluation.]

**POSING**
[Hip / midsection / shoulder line separately. Then limbs. Then evaluation.]

**COMPOSITION**
[Brief.]

**STORY / IMPACT**
[Scroll-stop verdict.]

**YOUR ONE PRIORITY**
[Single most important fix. Direct.]`;

async function initDb(sql) {
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
      image_pathname TEXT,
      image_mime_type TEXT,
      image_size_bytes INTEGER,
      original_filename TEXT,
      original_mime_type TEXT,
      storage_provider TEXT,
      storage_error TEXT,
      feedback_token TEXT,
      ai_feedback_ratings JSONB,
      feedback_submitted_at TIMESTAMP,
      brett_correction TEXT,
      brett_correction_status TEXT DEFAULT 'pending',
      brett_corrected_at TIMESTAMP,
      brett_email_sent_at TIMESTAMP,
      brett_email_id TEXT,
      brett_email_error TEXT,
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

function sanitizeFilename(value) {
  return String(value || 'upload')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mimeType, originalFilename, originalMimeType, shotContext, name, email, shotFields } = req.body;

  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing image data' });
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type. Please upload a JPG, PNG, or WebP image.' });
  }

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image is too large after compression. Please upload a smaller image.' });
  }

  const userMessage = shotContext
    ? 'PHOTOGRAPHER-PROVIDED CONTEXT:\n' + shotContext + '\n\nUse this context. Do not flag intentional creative or editing choices as problems.'
    : 'Critique this photo honestly. Do not hold back.';

  try {
    // Run AI critique
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1200,
        system: BRETT_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: userMessage }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const critiqueText = data?.content?.find(b => b.type === 'text')?.text;
    if (!critiqueText) return res.status(500).json({ error: 'No response from AI' });

    // Save image to private Vercel Blob storage for durable admin review.
    let imageUrl = null;
    let imagePathname = null;
    let storageError = null;
    try {
      const safeName = sanitizeFilename(originalFilename || name);
      const ext = extensionForMime(mimeType);
      const filename = `critiques/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}-${safeName}.${ext}`;
      const blob = await put(filename, imageBuffer, {
        access: BLOB_ACCESS,
        contentType: mimeType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      imageUrl = blob.url;
      imagePathname = blob.pathname || filename;
    } catch (blobErr) {
      storageError = blobErr.message || 'Unknown Blob storage error';
      console.error('Blob save failed:', {
        message: storageError,
        mimeType,
        bytes: imageBuffer.length,
        originalFilename,
      });
    }

    // Save to Neon database
    let dbError = null;
    let critiqueId = null;
    let feedbackToken = null;
    try {
      const sql = neon(process.env.DATABASE_URL);
      await initDb(sql);
      const f = shotFields || {};
      feedbackToken = crypto.randomUUID();
      const rows = await sql`
        INSERT INTO critiques (
          name, email, num_lights, light_type, modifiers, creative, shoot_type, post_processing, extra_context,
          image_url, image_pathname, image_mime_type, image_size_bytes, original_filename, original_mime_type,
          storage_provider, storage_error, feedback_token, critique
        )
        VALUES (
          ${name}, ${email}, ${f.numLights||null}, ${f.lightType||null}, ${f.modifiers||null}, ${f.creative||null}, ${f.shootType||null}, ${f.postProcessing||null}, ${f.extraContext||null},
          ${imageUrl}, ${imagePathname}, ${mimeType}, ${imageBuffer.length}, ${originalFilename || null}, ${originalMimeType || null},
          ${imageUrl ? 'vercel_blob' : null}, ${storageError}, ${feedbackToken}, ${critiqueText}
        )
        RETURNING id
      `;
      critiqueId = rows[0]?.id || null;
    } catch (dbErr) {
      dbError = dbErr.message || 'Unknown database save error';
      console.error('DB save failed:', dbError);
    }

    return res.status(200).json({
      critique: critiqueText,
      critiqueId,
      feedbackToken,
      saved: !storageError && !dbError,
      storageError: storageError ? 'The critique was generated, but the image could not be saved for admin review.' : null,
      saveError: dbError ? 'The critique was generated, but the submission could not be saved for admin review.' : null,
    });

  } catch (err) {
    console.error('Critique request failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

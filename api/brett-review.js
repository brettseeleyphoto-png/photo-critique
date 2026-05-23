const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

async function ensureSchema(sql) {
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_correction_status TEXT DEFAULT 'pending'`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_corrected_at TIMESTAMP`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_sent_at TIMESTAMP`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_id TEXT`;
  await sql`ALTER TABLE critiques ADD COLUMN IF NOT EXISTS brett_email_error TEXT`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reviewEmailHtml(name, correction) {
  const safeName = escapeHtml(name || 'there');
  const safeCorrection = escapeHtml(correction).replace(/\n/g, '<br>');
  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; color:#181512; line-height:1.6; max-width:680px;">
      <p>Hi ${safeName},</p>
      <p>Brett reviewed your photo critique submission and added an updated human review below.</p>
      <div style="border-left:3px solid #c08a4c; padding:14px 0 14px 18px; margin:22px 0; color:#2b2823;">
        ${safeCorrection}
      </div>
      <p>Thank you for helping improve the critique process.</p>
      <p style="color:#6b6258;">Seeley Photo Critique</p>
    </div>
  `;
}

function reviewEmailText(name, correction) {
  return [
    `Hi ${name || 'there'},`,
    '',
    'Brett reviewed your photo critique submission and added an updated human review below.',
    '',
    correction,
    '',
    'Thank you for helping improve the critique process.',
    '',
    'Seeley Photo Critique',
  ].join('\n');
}

async function sendUpdatedReviewEmail(submission, correction) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY. Add Resend to Vercel and set a verified from address to email updated reviews.');
  }

  const from = process.env.REVIEW_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'Seeley Photo Critique <onboarding@resend.dev>';
  const replyTo = process.env.REVIEW_REPLY_TO || process.env.BRETT_REPLY_TO || undefined;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `brett-review-${submission.id}-${crypto.createHash('sha256').update(correction).digest('hex').slice(0, 32)}`,
    },
    body: JSON.stringify({
      from,
      to: submission.email,
      reply_to: replyTo,
      subject: 'Your updated photo critique from Brett',
      html: reviewEmailHtml(submission.name, correction),
      text: reviewEmailText(submission.name, correction),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error?.message || 'Resend could not send the updated review email.';
    throw new Error(message);
  }

  return data?.id || data?.data?.id || null;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
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
          brett_corrected_at = CASE WHEN ${Boolean(cleanedCorrection)} THEN NOW() ELSE NULL END,
          brett_email_error = NULL
      WHERE id = ${Number(critiqueId)}
      RETURNING id, name, email
    `;
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });

    let emailSent = false;
    let emailId = null;
    let emailError = null;

    if (cleanedCorrection) {
      try {
        emailId = await sendUpdatedReviewEmail(rows[0], cleanedCorrection);
        emailSent = true;
        await sql`
          UPDATE critiques
          SET brett_email_sent_at = NOW(),
              brett_email_id = ${emailId},
              brett_email_error = NULL
          WHERE id = ${Number(critiqueId)}
        `;
      } catch (emailErr) {
        emailError = emailErr.message || 'Updated review saved, but email could not be sent.';
        console.error('Brett review email failed:', {
          critiqueId,
          email: rows[0].email,
          message: emailError,
        });
        await sql`
          UPDATE critiques
          SET brett_email_error = ${emailError}
          WHERE id = ${Number(critiqueId)}
        `;
      }
    }

    return res.status(200).json({ ok: true, emailSent, emailId, emailError });
  } catch (err) {
    console.error('Brett review save failed:', err.message);
    return res.status(500).json({ error: 'Could not save Brett review' });
  }
};

const { get } = require('@vercel/blob');
const { Readable } = require('stream');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password, pathname } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!pathname || Array.isArray(pathname)) {
    return res.status(400).json({ error: 'Missing image pathname' });
  }

  try {
    const result = await get(pathname, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (!result || result.statusCode !== 200) {
      return res.status(404).send('Image not found');
    }

    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return Readable.fromWeb(result.stream).pipe(res);
  } catch (err) {
    console.error('Private image fetch failed:', {
      message: err.message,
      pathname,
    });
    return res.status(500).json({ error: 'Could not load stored image' });
  }
};

const BRETT_SYSTEM_PROMPT = `You are Brett Seeley's photo critique engine. Brett is a veteran fitness photographer with 17+ years of experience. You analyze photos using his exact standards and voice.

BRETT'S CRITIQUE FRAMEWORK:

1. LIGHTING (most important)
- Is light sculpting the subject or flattening them?
- Where is the key light placed? Is it creating dimension or washing the subject out?
- Are shadows doing any work? Shadows are not the enemy — flat light is.
- Look for: flat front lighting, harsh overhead light, missing fill balance, blown highlights

2. POSING & BODY DIRECTION
- Is weight distributed intentionally? (hip shifts, weight on back foot)
- Are limbs placed with purpose or just hanging?
- Is the jawline strong or soft/weak?
- Is the torso angled or straight-on to camera?
- Is there a clear line of tension through the body?

3. COMPOSITION
- Does the framing serve the subject or fight it?
- Is negative space working intentionally?
- Is the crop appropriate or awkward?

4. STORY & EMOTIONAL IMPACT
- Does this image make you feel something?
- Would this image stop someone scrolling?

BRETT'S VOICE:
- Direct and honest. No sugarcoating. No cheerleading.
- Specific language only. Not "lighting could be better" — say exactly what the light is doing wrong.
- Lead with what is actually working (brief), then go hard on what needs fixing.
- End with one clear priority.

FORMAT EXACTLY LIKE THIS:

**WHAT'S WORKING**
[1-3 sentences.]

**LIGHTING**
[Specific critique.]

**POSING**
[Specific critique.]

**COMPOSITION**
[Brief.]

**STORY / IMPACT**
[Does this stop a scroll?]

**YOUR ONE PRIORITY**
[Single most important fix.]`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, mimeType } = req.body;

  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing imageBase64 or mimeType' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: BRETT_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: 'Critique this photo honestly. Do not hold back.' }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    const text = data?.content?.find(b => b.type === 'text')?.text;
    if (!text) return res.status(500).json({ error: 'No text in response' });

    return res.status(200).json({ critique: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

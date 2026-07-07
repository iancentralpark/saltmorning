function isGeminiConfigured() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

async function askGemini(prompt, options) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('AI English Buddy is not configured.');

  const model = (options && options.model) || 'gemini-2.5-flash-lite';
  const systemInstruction = (options && options.systemInstruction) || '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: (options && options.temperature) != null ? options.temperature : 0.4,
      maxOutputTokens: (options && options.maxOutputTokens) || 400
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'Gemini request failed.';
    throw new Error(msg);
  }
  const text = data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('No response from AI.');
  return String(text).trim();
}

module.exports = { isGeminiConfigured, askGemini };

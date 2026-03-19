// Retry helper for Claude API rate limits (429)
// Netlify Function timeout is 26s — max 3 retries with short delays (2s, 4s, 8s = 14s total)
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    if (attempt < maxRetries) {
      const delay = 2000 * Math.pow(2, attempt - 1); // 2s → 4s → 8s
      console.log(`[podcast-fetch] Rate limited (429), retry ${attempt}/${maxRetries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Claude API rate limit: max retries exceeded');
}


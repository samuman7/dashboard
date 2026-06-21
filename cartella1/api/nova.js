// ============================================================
// POST /api/nova
// Body: { messages: [{ role:'user'|'assistant', content:string }],
//         finance: { ...snapshot of the user's money... } }
//
// Nova is the dashboard's built-in money coach. This proxies the
// chat to Anthropic's Claude (Opus 4.8) with a finance-advisor
// system prompt + the user's finance snapshot as grounding context.
//
// The API key lives ONLY on the server (never shipped to the
// browser). Set it in Vercel:
//   Project → Settings → Environment Variables → ANTHROPIC_API_KEY
// Get a key at https://console.anthropic.com → API Keys.
//
// Raw fetch (no SDK) to match the existing whoop-* functions and
// keep this dependency-free.
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'Nova is not configured yet — set ANTHROPIC_API_KEY in your Vercel environment variables.'
    });
  }

  // Vercel parses JSON bodies, but be defensive in case it arrives as a string.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const finance = body.finance || {};
  if (!messages.length) return res.status(400).json({ error: 'messages required' });

  const system =
`You are Nova, the built-in money coach for a personal net-worth dashboard.
A JSON snapshot of the user's own finances is included below — use it to give
specific, grounded, practical guidance about their money.

How to respond:
- Be warm, direct and concise. Lead with the answer, then a short reason. A few
  sentences or a tight bulleted list — never an essay.
- Ground every claim in their actual data. Quote real figures (with the currency
  shown) instead of speaking in generalities. If the snapshot doesn't contain what
  you'd need, say so and ask one focused follow-up question.
- Net-worth amounts in the snapshot are stored in CHF; "currency" is the user's
  display currency. Subscriptions list a cost and billing period; orders are
  incoming purchases; wishlist items are things they're saving for.
- You give general financial education and guidance, not regulated investment,
  tax or legal advice. For big or irreversible money decisions, remind them to
  confirm with a qualified professional.
- Never invent balances, holdings or transactions that aren't in the snapshot.
- Reply with your final answer only — no internal reasoning, no "Based on..." preamble.

Finance snapshot (JSON):
${JSON.stringify(finance)}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system,
        messages,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || 'Claude API error';
      return res.status(r.status).json({ error: msg });
    }

    const text = (data.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    return res.status(200).json({ text: text || '(no response)' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

// ============================================================
// POST /api/receipt
// Body: { image: "<base64 jpeg/png, no data: prefix>", mediaType: "image/jpeg" }
//
// Reads ANY image with financial info — receipts, bills, invoices,
// bank / fintech app screenshots, account balances, transaction lists
// and statements — with Claude's vision model and returns a structured
// JSON reading. The browser then shows it for confirmation and logs it
// to a named net-worth account (set balance / add / deduct).
//
// The API key lives ONLY on the server (never shipped to the browser).
// Set it in Vercel:
//   Project → Settings → Environment Variables → ANTHROPIC_API_KEY
//
// Raw fetch (no SDK) to match /api/nova and keep this dependency-free.
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
      error: 'Image scanning is not configured yet — set ANTHROPIC_API_KEY in your Vercel environment variables.'
    });
  }

  // Vercel parses JSON bodies, but be defensive in case it arrives as a string.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Accept either a raw base64 string or a full data: URL.
  let image = String(body.image || '');
  let mediaType = String(body.mediaType || 'image/jpeg');
  const m = image.match(/^data:([^;]+);base64,(.*)$/);
  if (m) { mediaType = m[1]; image = m[2]; }
  if (!image) return res.status(400).json({ error: 'image required' });

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(mediaType)) mediaType = 'image/jpeg';

  const tool = {
    name: 'read_finance_image',
    description: 'Record the financial figures read from an image: a receipt, bill, invoice, bank / fintech app screenshot, account balance, transaction list or statement.',
    input_schema: {
      type: 'object',
      properties: {
        readable: { type: 'boolean', description: 'True if the image contains any legible monetary amount at all.' },
        kind: {
          type: 'string',
          enum: ['balance', 'expense', 'income', 'other'],
          description: 'balance = an account balance / total shown on a banking screen; expense = money spent (receipt, outgoing payment); income = money received; other = anything else.'
        },
        source:   { type: 'string', description: 'Best label: the bank / app / account name for a balance (e.g. "Revolut", "Wise"), or the merchant / payee for a transaction (e.g. "Migros"). Empty if unknown.' },
        currency: { type: 'string', description: 'ISO 4217 code (CHF, USD, EUR, GBP, ...). Infer from symbols (Fr/CHF, $, €, £) or language. Default CHF if unclear.' },
        amount:   { type: 'number', description: 'The single most important amount: the account balance on a balance screen, or the total on a receipt/transaction. Always a positive number. 0 if none.' },
        date:     { type: 'string', description: 'Date as YYYY-MM-DD if visible, else empty string.' },
        items: {
          type: 'array',
          description: 'Individual transactions or line items if the image is a list / receipt. Best effort, omit if none.',
          items: {
            type: 'object',
            properties: {
              name:   { type: 'string' },
              amount: { type: 'number' }
            },
            required: ['name', 'amount']
          }
        }
      },
      required: ['readable', 'kind', 'source', 'currency', 'amount']
    }
  };

  const system =
`You read ANY image that contains financial information — receipts, bills, invoices,
bank or fintech app screenshots, account balances, transaction lists and statements —
and extract its figures.
- Always call the read_finance_image tool exactly once with your best reading. Do NOT
  refuse just because the image isn't a paper receipt; a screenshot of a bank balance
  is perfectly valid.
- "amount" is the single headline figure: the account balance on a balance / home
  screen, or the grand total on a receipt or transaction. Use a positive number.
- Set "kind" to "balance" for an account balance/total, "expense" for money spent,
  "income" for money received, otherwise "other".
- "source" is the bank / app / account name for a balance (e.g. Revolut, Wise), or the
  merchant / payee for a purchase (e.g. Migros).
- Numbers must be plain (no currency symbols, no thousands separators). Read "Fr 199.54"
  as 199.54 with currency CHF.
- Only set readable=false if there is genuinely no monetary amount anywhere in the image.`;

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
        tools: [tool],
        tool_choice: { type: 'tool', name: 'read_finance_image' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: 'Read this image and record any financial figures.' }
          ]
        }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || 'Claude API error';
      return res.status(r.status).json({ error: msg });
    }

    const block = (data.content || []).find(b => b && b.type === 'tool_use' && b.name === 'read_finance_image');
    if (!block || !block.input) {
      return res.status(502).json({ error: 'Could not read that image. Try a clearer, well-lit photo or screenshot.' });
    }

    return res.status(200).json({ receipt: block.input });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

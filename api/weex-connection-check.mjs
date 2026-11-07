// Read-only WEEX Futures credential check. No order creation or account balance retrieval.
import {createHmac, timingSafeEqual} from 'node:crypto';

export const WEEX_ACCOUNT_CONFIG_PATH = '/capi/v3/account/accountConfig';
export function constantTimeSecretMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signedReadHeaders({key, secret, passphrase}, timestamp) {
  if (![key, secret, passphrase].every(x => typeof x === 'string' && x.length))
    throw Error('Missing WEEX credentials');
  if (!/^\d{13}$/.test(String(timestamp))) throw Error('Invalid timestamp');
  const signature = createHmac('sha256', secret)
    .update(String(timestamp) + 'GET' + WEEX_ACCOUNT_CONFIG_PATH)
    .digest('base64');
  return {
    'ACCESS-KEY': key,
    'ACCESS-SIGN': signature,
    'ACCESS-PASSPHRASE': passphrase,
    'ACCESS-TIMESTAMP': String(timestamp),
    Accept: 'application/json'
  };
}
export async function checkWeexReadOnly(credentials, fetchImpl = fetch, timestamp = Date.now()) {
  const headers = signedReadHeaders(credentials, timestamp);
  const response = await fetchImpl('https://api-contract.weex.com' + WEEX_ACCOUNT_CONFIG_PATH, {
    method: 'GET', headers, cache:'no-store', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return false;
  const payload = await response.json();
  const account = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  return typeof account?.canTrade === 'boolean' &&
    typeof account?.canWithdraw === 'boolean' &&
    typeof account?.dualSidePosition === 'boolean';
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  if (!constantTimeSecretMatch(req.headers['x-radar-cron-key'], process.env.PUSH_CRON_KEY))
    return res.status(401).json({error: 'Unauthorized'});
  const credentials = {key:process.env.WEEX_API_KEY,secret:process.env.WEEX_API_SECRET,passphrase:process.env.WEEX_API_PASSPHRASE};
  if (Object.values(credentials).some(x => !x)) return res.status(503).json({ok:false,error:'WEEX credentials not configured'});
  try {
    const verified = await checkWeexReadOnly(credentials);
    return res.status(verified ? 200 : 502).json({ok:verified, authenticated:verified, exchange:'WEEX', mode:'READ_ONLY', ordersEnabled:false});
  } catch {
    return res.status(502).json({ok:false, authenticated:false, exchange:'WEEX', mode:'READ_ONLY', ordersEnabled:false});
  }
}

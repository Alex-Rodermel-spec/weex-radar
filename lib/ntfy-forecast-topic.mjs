// Shared, owner-private ntfy topic derivation for the dedicated read-only
// FORECAST channel. Keep the same HMAC scheme used since launch: migrating
// must NEVER require the Android owner to resubscribe.
import {createHmac} from 'node:crypto';
const safeTopic=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(s);
export function forecastTopic(env=process.env){
 const original=env.NTFY_TOPIC;
 if(!safeTopic(original))return null;
 return 'wr-'+createHmac('sha256',original)
  .update('weex-radar-forecast-topic-v1').digest('hex').slice(0,32);
}

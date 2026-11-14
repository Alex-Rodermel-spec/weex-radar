// Offline, private journal ingestion. No network, no live orders, no deployment.
// Usage: node scripts/v110-ingest-private-journal.mjs <private-store.json> <verified-batch.json>
import {readFileSync} from 'node:fs';
import {appendV110VerifiedJournal} from '../lib/v110-private-journal-store.mjs';
import {validateV110EvaluationTimes} from '../lib/v110-evaluation-time.mjs';
import {adaptV110ForecastJournal} from '../lib/v110-journal-adapter.mjs';
const [store,batch]=process.argv.slice(2);
if(!store||!batch||store===batch){console.error('Usage: node scripts/v110-ingest-private-journal.mjs <private-store.json> <verified-batch.json>');process.exitCode=2;}
else{
 try{
  const raw=readFileSync(batch,'utf8');
  if(raw.length>5_000_000)throw Error('INPUT_TOO_LARGE');
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows)||!rows.length||rows.some(r=>typeof r?.symbol!=='string'||!/^[A-Z0-9]{2,30}$/.test(r.symbol)))throw Error('INVALID_SYMBOL_OR_EMPTY_BATCH');
  const timing=validateV110EvaluationTimes(rows);
  if(timing.status!=='VALIDATED'||timing.rejected.length)throw Error('INVALID_EVALUATION_TIMES');
  const adapted=adaptV110ForecastJournal(timing.valid);
  if(adapted.status!=='ADAPTED'||adapted.skipped)throw Error('UNVERIFIED_OR_DUPLICATED_BATCH');
  const result=await appendV110VerifiedJournal(store,rows);
  console.log(JSON.stringify({status:'PRIVATE_JOURNAL_UPDATED',...result}));
 }catch(e){console.error('V110_PRIVATE_INGEST_FAILED: '+String(e.message).slice(0,120));process.exitCode=1;}
}

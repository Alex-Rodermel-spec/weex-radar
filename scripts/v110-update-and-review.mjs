// Offline research pipeline: validate, accumulate, then compare privately.
// Usage: node scripts/v110-update-and-review.mjs <private-store.json> <verified-batch.json>
// No trading, network access, publication, or production changes.
import {readFileSync} from 'node:fs';
import {appendV110VerifiedJournal} from '../lib/v110-private-journal-store.mjs';
import {validateV110EvaluationTimes} from '../lib/v110-evaluation-time.mjs';
import {adaptV110ForecastJournal} from '../lib/v110-journal-adapter.mjs';
import {auditV110PriceConsistency} from '../lib/v110-price-consistency.mjs';
import {auditV110DirectionalDisagreements} from '../lib/v110-disagreement-audit.mjs';
import {compareV110ForwardOutcomes} from '../lib/v110-forward-comparison.mjs';
const [store,batch]=process.argv.slice(2);
try{
 if(!store||!batch||store===batch)throw Error('STORE_AND_BATCH_PATHS_REQUIRED');
 const raw=readFileSync(batch,'utf8');
 if(raw.length>5_000_000)throw Error('INPUT_TOO_LARGE');
 const rows=JSON.parse(raw);
 if(!Array.isArray(rows)||!rows.length||rows.some(r=>typeof r?.symbol!=='string'||!/^[A-Z0-9]{2,30}$/.test(r.symbol)))throw Error('INVALID_SYMBOL_OR_EMPTY_BATCH');
 const timing=validateV110EvaluationTimes(rows);
 if(timing.status!=='VALIDATED'||timing.rejected.length)throw Error('INVALID_EVALUATION_TIMES');
 const a=adaptV110ForecastJournal(timing.valid);
 if(a.status!=='ADAPTED'||a.skipped)throw Error('INVALID_BATCH');
 // Validate the combined view before persisting new observations.
 let existing=[];
 try{existing=JSON.parse(readFileSync(store,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!Array.isArray(existing))throw Error('INVALID_EXISTING_STORE');
 const ids=new Map(existing.map(r=>[[r.model,r.symbol,r.alertId,r.horizonMinutes,r.observedAt].join('|'),JSON.stringify(r)]));
 const fresh=[];
 for(const r of rows){
  const k=[r.model,r.symbol,r.alertId,r.horizonMinutes,r.observedAt].join('|');
  if(ids.has(k)){if(ids.get(k)!==JSON.stringify(r))throw Error('CONFLICTING_REPLAY');continue;}
  ids.set(k,JSON.stringify(r));fresh.push(r);
 }
 const combined=[...existing,...fresh];
 const allTiming=validateV110EvaluationTimes(combined);
 if(allTiming.status!=='VALIDATED'||allTiming.rejected.length)throw Error('INVALID_ACCUMULATED_TIMES');
 const adapted=adaptV110ForecastJournal(allTiming.valid);
 if(adapted.status!=='ADAPTED'||adapted.skipped)throw Error('INVALID_ACCUMULATED_JOURNAL');
 const price=auditV110PriceConsistency(adapted);
 if(price.status!=='RESEARCH_AUDIT_ONLY'||price.priceConflicts||price.ambiguous)throw Error('CONFLICTING_PAIRED_MARKET_PRICES');
 const result=compareV110ForwardOutcomes(adapted);
 const disagreement=auditV110DirectionalDisagreements(adapted);
 const saved=await appendV110VerifiedJournal(store,rows);
 console.log(JSON.stringify({status:'RESEARCH_UPDATED',saved,priceAudit:price,disagreementAudit:disagreement,comparison:result,approvedForLive:false},null,2));
}catch(e){console.error('V110_UPDATE_AND_REVIEW_FAILED: '+String(e.message).slice(0,120));process.exitCode=1;}

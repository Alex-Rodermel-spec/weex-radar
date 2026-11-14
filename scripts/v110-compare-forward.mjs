// Offline, read-only V110 comparison of independently verified forecast outcomes.
// Usage: node scripts/v110-compare-forward.mjs path/to/verified-outcomes.json
// Input is a JSON array of journal outcome records; never accepts credentials.
import {readFileSync} from 'node:fs';
import {adaptV110ForecastJournal} from '../lib/v110-journal-adapter.mjs';
import {compareV110ForwardOutcomes} from '../lib/v110-forward-comparison.mjs';
import {validateV110EvaluationTimes} from '../lib/v110-evaluation-time.mjs';
import {auditV110DirectionalDisagreements} from '../lib/v110-disagreement-audit.mjs';
import {auditV110PriceConsistency} from '../lib/v110-price-consistency.mjs';
const path=process.argv[2];
if(!path){console.error('Usage: node scripts/v110-compare-forward.mjs <verified-outcomes.json>');process.exitCode=2;}
else {
 try {
  const raw=readFileSync(path,'utf8');
  if(raw.length>5_000_000)throw Error('INPUT_TOO_LARGE');
  const records=JSON.parse(raw);
  if(!Array.isArray(records)||records.some(r=>typeof r?.symbol!=='string'||!/^[A-Z0-9]{2,30}$/.test(r.symbol)))throw Error('MARKET_SYMBOL_REQUIRED');
  const timing=validateV110EvaluationTimes(records);
  if(timing.status!=='VALIDATED'||timing.rejected.length)throw Error('UNVERIFIED_FORECAST_EVALUATION_TIMES');
  const adapted=adaptV110ForecastJournal(timing.valid);
  if(adapted.status!=='ADAPTED')throw Error('INVALID_JOURNAL');
  if(adapted.skipped>0)throw Error('UNVERIFIED_OR_DUPLICATED_JOURNAL_ROWS');
  const priceAudit=auditV110PriceConsistency(adapted);
  if(priceAudit.status!=='RESEARCH_AUDIT_ONLY'||priceAudit.priceConflicts||priceAudit.ambiguous)throw Error('CONFLICTING_PAIRED_MARKET_PRICES');
  const comparison=compareV110ForwardOutcomes(adapted);
  const disagreementAudit=auditV110DirectionalDisagreements(adapted);
  process.stdout.write(JSON.stringify({inputRows:records.length,acceptedRows:adapted.baseline.length+adapted.candidate.length,skipped:adapted.skipped,priceAudit,disagreementAudit,...comparison},null,2)+'\n');
 }catch(e){console.error('V110_READ_ONLY_COMPARISON_FAILED: '+String(e.message).slice(0,120));process.exitCode=1;}
}

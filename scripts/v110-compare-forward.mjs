// Offline, read-only V110 comparison of independently verified forecast outcomes.
// Usage: node scripts/v110-compare-forward.mjs path/to/verified-outcomes.json
// Input is a JSON array of journal outcome records; never accepts credentials.
import {readFileSync} from 'node:fs';
import {adaptV110ForecastJournal} from '../lib/v110-journal-adapter.mjs';
import {compareV110ForwardOutcomes} from '../lib/v110-forward-comparison.mjs';
const path=process.argv[2];
if(!path){console.error('Usage: node scripts/v110-compare-forward.mjs <verified-outcomes.json>');process.exitCode=2;}
else {
 try {
  const raw=readFileSync(path,'utf8');
  if(raw.length>5_000_000)throw Error('INPUT_TOO_LARGE');
  const records=JSON.parse(raw);
  const adapted=adaptV110ForecastJournal(records);
  if(adapted.status!=='ADAPTED')throw Error('INVALID_JOURNAL');
  const comparison=compareV110ForwardOutcomes(adapted);
  process.stdout.write(JSON.stringify({inputRows:records.length,acceptedRows:adapted.baseline.length+adapted.candidate.length,skipped:adapted.skipped,...comparison},null,2)+'\n');
 }catch(e){console.error('V110_READ_ONLY_COMPARISON_FAILED: '+String(e.message).slice(0,120));process.exitCode=1;}
}

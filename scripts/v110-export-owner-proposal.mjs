// Fetches only PUBLIC aggregate research status; never reads private journal,
// ntfy topics, trading secrets or market credentials. No GitHub write here.
import {buildV110OwnerProposal} from '../lib/v110-owner-proposal.mjs';
const URL='https://weex-radar.vercel.app/api/signals?mode=journal';
async function main(){
 const response=await fetch(URL,{headers:{Accept:'application/json'},
  signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok)throw Error('V110_JOURNAL_STATUS_HTTP_'+response.status);
 const raw=await response.text();
 if(raw.length>700000)throw Error('V110_JOURNAL_STATUS_TOO_LARGE');
 const report=JSON.parse(raw);
 // Only freshly computed aggregate evidence may initiate a new draft PR.
 // A stale CDN/report or a clock in the future must not replay old screening.
 const age=Date.now()-report.generatedAt;
 if(!Number.isSafeInteger(report.generatedAt)||
  age< -60_000||age>3*60*60_000)
  throw Error('V110_JOURNAL_STATUS_STALE');
 const proposal=buildV110OwnerProposal(report);
 if(!proposal){
  console.error('V110_NO_QUALIFIED_RESEARCH_PROPOSAL');
  process.exitCode=3;
  return;
 }
 process.stdout.write(JSON.stringify(proposal,null,2)+'\n');
}
main().catch(e=>{
 console.error('V110_PROPOSAL_CHECK_FAILED: '+String(e.message).slice(0,100));
 process.exitCode=1;
});

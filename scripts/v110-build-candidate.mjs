// Emits a deterministic research-only source file for a screened proposal.
// The emitted module never trades, calls an API, or alters production №108.
import {readFileSync} from 'node:fs';
import {buildV110CandidateModule} from '../lib/v110-candidate-template.mjs';
const file=process.argv[2];
if(!file)throw Error('V110_PROPOSAL_INPUT_REQUIRED');
const p=JSON.parse(readFileSync(file,'utf8'));
if(p.schema!=='v110-research-proposal-v1'||
 p.readiness!=='FORWARD_TEST_REQUIRED'||
 p.requiresOwnerApproval!==true||
 p.affectsLiveSignals!==false||
 p.affectsOrders!==false||
 p.canAutoMerge!==false)throw Error('V110_PROPOSAL_UNVERIFIED');
const source=buildV110CandidateModule(p.policyId);
if(!source)throw Error('V110_POLICY_NOT_ALLOWED');
process.stdout.write(source);

// Validate the complete research proposal through V110 Hands before emitting
// any inert candidate source. No trading, network, deployment or GitHub writes.
import {readFileSync} from 'node:fs';
import {prepareV110HandsProposal} from '../lib/v110-hands.mjs';
const file=process.argv[2];
if(!file)throw Error('V110_PROPOSAL_INPUT_REQUIRED');
const proposal=JSON.parse(readFileSync(file,'utf8'));
const prepared=prepareV110HandsProposal(proposal);
if(!prepared)throw Error('V110_HANDS_PROPOSAL_REJECTED');
const source=prepared.files.find(f=>f.path===
 `research/v110-proposals/${proposal.policyId}.mjs`);
if(!source||!source.content)throw Error('V110_HANDS_SOURCE_MISSING');
process.stdout.write(source.content);

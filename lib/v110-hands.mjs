// V110 Hands phase 1: pure research artifact preparation. No filesystem, network,
// trading or deployment side effects. Caller owns branch/PR creation.
import {V110_PROPOSAL_POLICY_IDS} from './v110-owner-proposal.mjs';
import {buildV110CandidateModule} from './v110-candidate-template.mjs';

const POLICY=/^(LONG|SHORT)_SKIP_(CAUTION|CHASE|CAUTION_CHASE)$/;
const SAFE_PATH=/^research\/v110-proposals\/[A-Z_]+\.(json|mjs)$/;
export function isV110HandsResearchPath(path){
 return typeof path==='string'&&SAFE_PATH.test(path)&&
  V110_PROPOSAL_POLICY_IDS.some(id=>path===`research/v110-proposals/${id}.json`||
   path===`research/v110-proposals/${id}.mjs`);
}
export function validateV110HandsPaths(paths){
 return Array.isArray(paths)&&paths.length>0&&
  paths.every(isV110HandsResearchPath)&&new Set(paths).size===paths.length;
}
export function prepareV110HandsProposal(proposal){
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))return null;
 const id=proposal.policyId;
 if(typeof id!=='string'||!POLICY.test(id)||!V110_PROPOSAL_POLICY_IDS.includes(id)||
  proposal.schema!=='v110-research-proposal-v1'||
  proposal.direction!==(id.startsWith('LONG_')?'LONG':'SHORT')||
  proposal.readiness!=='FORWARD_TEST_REQUIRED'||
  proposal.requiresOwnerApproval!==true||
  proposal.affectsLiveSignals!==false||proposal.affectsOrders!==false||
  proposal.canAutoMerge!==false)return null;
 const sampleTime=Date.parse(proposal.sampleGeneratedAt);
 if(!Number.isFinite(sampleTime))return null;
 for(const section of ['training','screeningHoldout']){
  if(!proposal[section]||typeof proposal[section]!=='object')return null;
 }
 if(!Number.isSafeInteger(proposal.training.days)||proposal.training.days<3||
  !Number.isSafeInteger(proposal.training.n)||proposal.training.n<120||
  !Number.isSafeInteger(proposal.screeningHoldout.days)||proposal.screeningHoldout.days<2||
  !Number.isSafeInteger(proposal.screeningHoldout.n)||proposal.screeningHoldout.n<50)return null;
 const code=buildV110CandidateModule(id);
 if(!code)return null;
 const files=[
  {path:`research/v110-proposals/${id}.json`,content:JSON.stringify(proposal,null,2)+'\n'},
  {path:`research/v110-proposals/${id}.mjs`,content:code}
 ];
 if(!validateV110HandsPaths(files.map(f=>f.path)))return null;
 return Object.freeze({branch:`v110-owner-review-${id.toLowerCase()}`,
  status:'DRAFT_RESEARCH_ONLY',ownerApprovalRequired:true,
  liveChangesAllowed:false,files});
}

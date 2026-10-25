import type {ConversationConfig,SubmitTurn,TurnEnvelope} from '@bellntell/contracts';
import type {Receipt,Payload} from '../actions/service.js';
import type {Schedule,Appointment} from '../scheduling/service.js';
export type {ConversationConfig,SubmitTurn,TurnEnvelope};
export type Pending={id:string;revision:number;stateRevision:number;readback:string;responseId:string;voiceEligible:boolean;payload:Payload;simulated:boolean;expiresAt:string};
export type Proof={handle:string;appointmentId:string;credential:string;expiresAt:number};
export type ActionReceipt=Receipt&{simulated:boolean;label:string};
export type EngineState={blockId:string;slots:Record<string,string>;customAnswers:Record<string,string>;clarifications:Record<string,number>;transitions:number;detours:number;newRequests:number;humanVisited:boolean;resumeBlockId:string|null;management:null|'verify'|'choose'|'availability'|'readback';proof:Proof|null;pending:Pending|null;receipts:ActionReceipt[];directive:string;candidates:{serviceId:string;resourceId:string;startsAt:string;endsAt:string;readback:string}[];latestInputTurnId:string|null;seenTurns:string[];simulationAppointments:Appointment[];simulationPayloads:Record<string,Payload>};
export type Session={id:string;businessId:string;configVersionId:string;createdBy:string;capabilityHash:string;providerRealtimeCallId:string|null;mode:'preview'|'real_test'|'integration'|'public';transport:'simulator'|'realtime';status:string;stateRevision:number;engineState:EngineState;sequence:number;maxEndAt:Date;admissionExpiresAt:Date|null;heartbeatAt:Date|null;reservedUsd:string;closedAt:Date|null;restartOfSessionId:string|null};
export type Fixture={schedule:Schedule;now:string};
export type Version={id:string;businessId:string;draftRevision:number;sourceDraftId:string|null;sourceDraftRevision:number|null;status:string;flow:ConversationConfig['flow'];policy:ConversationConfig['policy'];content:ConversationConfig['content'];testFixture:Fixture|null;checksum:string};
export function configOf(version:Version):ConversationConfig{return {flow:version.flow,policy:version.policy,content:version.content};}
export function redact(text:string):string{return text.replace(/\b[A-Za-z0-9_-]{32,}\b/g,value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:'[private code removed]');}
export function normalizeConfirmation(text:string){return text.trim().toLowerCase().replace(/[.!?]+$/g,'').trim().replace(/\s+/g,' ');}
export function confirmation(text:string):'accept'|'reject'|'other'{const clean=normalizeConfirmation(text);if(['yes','yes please','confirm','please confirm','yes confirm'].includes(clean))return 'accept';if(['no','no thanks','cancel that'].includes(clean))return 'reject';return 'other';}

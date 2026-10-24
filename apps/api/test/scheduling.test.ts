import {describe,it,expect} from 'vitest';
import {slot,availability,localInstants,displayTime,type Schedule} from '../src/scheduling/service.js';
const now=new Date('2026-10-24T00:00:00Z');
function fixture(timezone='Asia/Karachi'):Schedule {
 return {business:{id:'b',name:'Test',slug:'test',timezone,status:'setup'},policy:{businessId:'b',revision:1,slotMinutes:15,noticeMinutes:60,horizonDays:60,cutoffMinutes:1440},services:[{id:'s',businessId:'b',revision:1,name:'Consultation',durationMinutes:30,priceText:'1000',publicDescription:'',active:true}],resources:[{id:'r',businessId:'b',revision:1,displayName:'Staff',active:true}],eligible:[{serviceId:'s',resourceId:'r'}],hours:Array.from({length:7},(_,weekday)=>({weekday,start:'09:00:00',end:'18:00:00'})),overrides:[],busy:[]};
}
describe('deterministic local-time scheduling',()=>{
 it('enforces notice/grid/seconds/horizon and accepts the full boundary interval',()=>{
  const schedule=fixture();expect(slot(schedule,'s','r',new Date('2026-10-24T17:30:00+05:00'),now).end.toISOString()).toBe('2026-10-24T13:00:00.000Z');
  for(const value of ['2026-10-24T05:30:00+05:00','2026-10-24T09:01:00+05:00','2026-10-24T09:00:01+05:00','2026-10-24T17:45:00+05:00','2026-12-24T09:00:00+05:00'])expect(()=>slot(schedule,'s','r',new Date(value),now)).toThrow();
  expect(()=>slot(schedule,'s','r',new Date('2026-12-23T09:00:00+05:00'),now)).not.toThrow();
 });
 it('replaces weekly hours with business exceptions, then intersects resource exceptions',()=>{
  const schedule=fixture();schedule.overrides=[{resourceId:null,localDate:'2026-10-25',kind:'open',start:'11:00',end:'14:00'},{resourceId:'r',localDate:'2026-10-25',kind:'open',start:'12:00',end:'16:00'}];
  for(const time of ['09:00','11:30','14:00'])expect(()=>slot(schedule,'s','r',new Date(`2026-10-25T${time}:00+05:00`),now)).toThrow();
  expect(()=>slot(schedule,'s','r',new Date('2026-10-25T12:00:00+05:00'),now)).not.toThrow();
  schedule.overrides[0]={resourceId:null,localDate:'2026-10-25',kind:'closed',start:null,end:null};expect(()=>slot(schedule,'s','r',new Date('2026-10-25T12:00:00+05:00'),now)).toThrow();
 });
 it('handles adjacent half-open appointments and does not offer inactive or ineligible resources',()=>{
  const schedule=fixture();schedule.busy=[{id:'a',resourceId:'r',startsAt:new Date('2026-10-25T09:00:00+05:00'),endsAt:new Date('2026-10-25T09:30:00+05:00')}];
  expect(()=>slot(schedule,'s','r',new Date('2026-10-25T09:15:00+05:00'),now)).toThrow();expect(()=>slot(schedule,'s','r',new Date('2026-10-25T09:30:00+05:00'),now)).not.toThrow();
  expect(availability(schedule,{serviceId:'s',from:'2026-10-25',to:'2026-10-25'},now)).toHaveLength(3);
  schedule.resources[0].active=false;expect(()=>slot(schedule,'s','r',new Date('2026-10-25T09:30:00+05:00'),now)).toThrow();schedule.resources[0].active=true;schedule.eligible=[];expect(()=>slot(schedule,'s','r',new Date('2026-10-25T09:30:00+05:00'),now)).toThrow();
 });
 it('skips DST gaps, distinguishes repeated offsets and derives real service duration across transitions',()=>{
  expect(localInstants('2026-03-08','02:30','America/New_York')).toHaveLength(0);
  const repeated=localInstants('2026-11-01','01:30','America/New_York');expect(repeated).toHaveLength(2);const schedule=fixture('America/New_York');schedule.hours=schedule.hours.map(x=>({...x,start:'00:00:00',end:'04:00:00'}));
  const first=slot(schedule,'s','r',repeated[0],now);const second=slot(schedule,'s','r',repeated[1],now);expect(+first.end-+repeated[0]).toBe(1800000);expect(displayTime(repeated[0],first.end,'America/New_York')).not.toBe(displayTime(repeated[1],second.end,'America/New_York'));
  const spring=localInstants('2026-03-08','01:30','America/New_York')[0];schedule.services[0].durationMinutes=60;expect(slot(schedule,'s','r',spring,new Date('2026-03-01')).end.toISOString()).toBe('2026-03-08T07:30:00.000Z');
 });
 it('allows split adjacent-day hours and rejects a gap anywhere in the full service interval',()=>{
  const schedule=fixture();schedule.services[0].durationMinutes=60;schedule.hours=[{weekday:0,start:'23:30:00',end:'24:00:00'},{weekday:1,start:'00:00:00',end:'01:00:00'}];expect(()=>slot(schedule,'s','r',new Date('2026-10-25T23:30:00+05:00'),now)).not.toThrow();schedule.hours[1].start='00:15:00';expect(()=>slot(schedule,'s','r',new Date('2026-10-25T23:30:00+05:00'),now)).toThrow();
 });
});

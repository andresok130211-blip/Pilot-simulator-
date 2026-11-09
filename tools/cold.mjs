import { PL_BY, AP_BY, bearing, distKm } from '../src/js/data.js';
import { Flight } from '../src/js/sim.js';
const plane=PL_BY.a320, from=AP_BY.UUEE||Object.values(AP_BY)[0], to=Object.values(AP_BY)[5];
const f=new Flight({plane,from,to,bearing:bearing(from,to),distM:distKm(from,to)*1000,pax:150,fuelKg:8000,assist:{taxi:true,auto:false,config:false},cold:true,taxi:true,recAlt:10000});
f.gate.done=true;
f.c.brake=false; f.c.thr=0.6;
const run=(n)=>{for(let i=0;i<n;i++)f.step(1/30)};
run(600); console.log('cold: ias',(f.ias*3.6).toFixed(1),'x',f.x.toFixed(1),'eng',f.eng);
f.startReq=true; run(1200); console.log('started: eng',f.eng,'ias',(f.ias*3.6).toFixed(1),'cold',f.cold);

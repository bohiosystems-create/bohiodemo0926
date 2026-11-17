/* Bohio pricing engine.
   The block between CALC markers is copied verbatim from bohio-genhvac/quoting/index.html
   (source of truth for pricing). If prices change there, paste the new block here and run
   `node test/run.js`. Do not edit prices in this file by hand. */
/*CALC*/
const USD={wt301:114.94,wt201:135.585,ws202:58.5,vs370:111.435,ws301:63.19,ug65:383.99,rut956:275,revpi:479.28,ct101:105.3,sensibo:217.2954,intesis:289.02,hexa:57};
const P0={margin:25,landed:12,tstat:40,cable:70,sensor:10,platform:5.5,contractor:5500,upgrade:7000};
const NAMES={A1:'Open BMS: supervisory setpoint control',A2:'Legacy BMS: upgrade, then control',A3:'BMS read-only: advisory mode',B1:'Fan coils: keep Modbus thermostats, wire RS485',B2:'Fan coils: wireless LoRaWAN thermostats',B3:'Fan coils: wired Modbus thermostats',C1:'Split ACs: IR controllers',C2:'Split ACs: wired two-way gateways',D1:'Ducted DX: 24 V LoRaWAN thermostats',E1:'VRF: gateway on the central controller'};
const TYPES={apartment:['Flats','flat',20,3,7],office:['Office suites','suite',10,6,6],hotel:['Guest rooms','room',40,1,8],retail:['Shops','shop',15,2,6],villa:['Villas','villa',20,5,0]};
const SENSE={apartment:'Occupancy (apartments): motion sensors in common areas only; sensors inside flats are an option that needs tenant consent. A flat counts as empty only after hours without activity, never minutes.',office:'Occupancy (offices): radar presence in every zone, because motion (PIR) sensors miss people sitting still at desks. Schedules follow working hours; radar catches empty floors and meeting rooms.',hotel:'Occupancy (hotels): a motion sensor plus a door contact in every room tells a guest who is in from a room left empty; where keycard switches exist they can be read too.',retail:'Occupancy (retail): cooling follows opening hours; a motion sensor per shop catches cooling left on after closing. Entrance people counters can be added on request.',villa:'Occupancy (villas): one sensor per villa detects homes left empty, for example during travel; schedules handle the rest.'};
const BALC={apartment:'Balcony door contact in each flat',hotel:'Balcony door contact in each guest room',villa:'Terrace door contact in each villa'};
const RISK={A1:['mid','Depends on BMS contractor'],A2:['high','Upgrade needed first'],A3:['low','No write access needed'],B1:['low','Reuses what is there'],B2:['low','No new cabling'],B3:['mid','Cabling in occupied flats'],C1:['mid','One-way control'],C2:['high','Highest cost'],D1:['low','Simple swap'],E1:['low','One integration point']};
function price(code,st,p){
  const cp=u=>Math.ceil(u*(1+p.landed/100)*(1+p.margin/100));
  const BT=st.btype||'apartment', N=st.flats*st.perFlat+st.common, F=st.flats, C=st.common, hw=[], sv=[], op=[], notes=[];
  const L=(a,n,q,u)=>a.push({n,q,u,t:q*u});
  let mo=p.platform;
  if(code[0]==='A'){
    L(hw,'Revolution Pi edge controller (local logic, guardrails, fallback)',1,cp(USD.revpi));
    L(hw,'Teltonika RUT956 4G router with VPN',1,cp(USD.rut956));
    L(hw,'Panel and accessories (allowance)',1,400);
    if(st.bmsType==='legacy') L(hw,'Protocol gateway / controller upgrade (allowance)',1,p.upgrade);
    L(sv,'Site survey and BMS point-list review',1,550);
    if(st.bmsAccess==='read'){
      L(sv,'BMS contractor: read-only data export (allowance)',1,1650);L(sv,'Bohio setup, dashboards and recommendations',1,1100);
      L(sv,'Baseline and savings verification setup',1,800);L(sv,'Project management',1,400);mo=p.platform/2;
      notes.push('Advisory mode: the AI recommends, the facility team applies changes. Same route Office-in-the-Loop used in its field trial.');
    }else{
      L(sv,'BMS contractor: point mapping, heartbeat and fallback logic (allowance)',1,p.contractor);L(sv,'Bohio integration and commissioning',1,2000);
      L(sv,'Baseline and savings verification setup',1,800);L(sv,'Project management',1,800);
      notes.push('AI writes setpoints at a supervisory BACnet priority; operator overrides and safety logic always win, and the BMS falls back to its schedule if the heartbeat stops.');
    }
  }else{
    const units=N, conv=st.floors;
    if(code==='B1'){L(hw,'RS485-to-Ethernet converter, one per floor (allowance)',conv,165);L(sv,'RS485 cabling per thermostat (allowance)',units,p.cable);L(sv,'Thermostat Modbus configuration',units,15)}
    if(code==='B2'){L(hw,'Milesight WT301 LoRaWAN fan coil thermostat',units,cp(USD.wt301));L(sv,'Thermostat replacement',units,p.tstat)}
    if(code==='B3'){L(hw,'Modbus fan coil thermostat (Hexa RT226 class)',units,cp(USD.hexa));L(hw,'RS485-to-Ethernet converter, one per floor (allowance)',conv,165);L(sv,'Thermostat replacement',units,p.tstat);L(sv,'RS485 cabling per thermostat (allowance)',units,p.cable)}
    if(code==='C1'){L(hw,'Sensibo Air PRO IR controller (retail price)',units,cp(USD.sensibo));L(hw,'Wi-Fi access point, one per flat (allowance)',F,70);L(sv,'IR controller installation and pairing',units,10);L(sv,'Wi-Fi access point installation',F,25);notes.push('IR is one-way: the system cannot confirm the AC obeyed. Ask Sensibo for Airbend commercial pricing, which may cut hardware cost.')}
    if(code==='C2'){L(hw,'Intesis AC-to-Modbus gateway, one per indoor unit',units,cp(USD.intesis));L(hw,'RS485-to-Ethernet converter, one per floor (allowance)',conv,165);L(sv,'Gateway installation in indoor unit',units,80);L(sv,'RS485 cabling per unit (allowance)',units,p.cable);notes.push('Gateway model depends on the AC brand; prices shown for Mitsubishi Electric.')}
    if(code==='D1'){L(hw,'Milesight WT201 24 V LoRaWAN thermostat',units,cp(USD.wt201));L(sv,'Thermostat replacement',units,p.tstat)}
    if(code==='E1'){L(hw,'Multi-unit VRF protocol gateway, up to 64 indoor units (allowance)',Math.max(1,Math.ceil(units/64)),1650);L(sv,'Gateway integration and VRF point mapping',1,1650)}
    L(hw,'Milesight UG65 LoRaWAN gateway',Math.max(1,Math.ceil(units/40)),cp(USD.ug65));
    L(hw,'Teltonika RUT956 4G router with VPN',1,cp(USD.rut956));
    L(hw,'Revolution Pi edge controller (local logic, guardrails, fallback)',1,cp(USD.revpi));
    L(hw,'Panel, UPS and accessories (allowance)',1,700);
    const add=(n,q,u)=>{if(q>0){L(hw,n,q,u);sens+=q}}; let sens=0;
    if(BT==='office') add('Milesight VS370 radar presence sensor, one per office zone',F*st.perFlat,cp(USD.vs370));
    if(BT==='hotel'){add('Milesight WS202 motion sensor, one per guest room',F,cp(USD.ws202));add('Milesight WS301 room door contact, one per guest room',F,cp(USD.ws301))}
    if(BT==='retail') add('Milesight WS202 motion sensor, one per shop',F,cp(USD.ws202));
    if(BT==='villa') add('Milesight WS202 motion sensor, main living area per villa',F,cp(USD.ws202));
    add('Milesight WS202 motion sensor, common areas',C,cp(USD.ws202));
    if(sens) L(sv,'Sensor installation and pairing',sens,p.sensor);
    if(st.cooling==='dc'){L(hw,'BTU meter data interface (allowance)',1,500);notes.push('District cooling: the controller keeps a hard limit on chilled-water return temperature so savings never trigger Delta T penalties.')}
    else{const k=Math.min(F,6)+1;L(hw,'Milesight CT101 current clamp, sample metering',k,cp(USD.ct101));L(sv,'CT clamp installation (licensed electrician)',k,40)}
    L(sv,'Site survey and compatibility audit',1,550);L(sv,'Gateway and network installation',1,700);L(sv,'Commissioning and configuration',1,2000);
    L(sv,'Baseline and savings verification setup',1,800);L(sv,'Project management',1,800);L(sv,'Tenant communication and FM training',1,400);
  }
  if(st.occ&&BT==='apartment') L(op,'Occupancy sensor in each flat',F,cp(USD.ws202)+p.sensor);
  if(st.balc&&BT!=='office'&&BT!=='retail') L(op,BALC[BT],F,cp(USD.ws301)+p.sensor);
  notes.unshift(code[0]==='A'?'Occupancy: the AI reads the BMS\'s existing occupancy points where they exist; no new sensors are included on this route.':SENSE[BT]);
  if(st.warr) L(op,'Extended warranty, years 2-3',1,1200);
  const sum=a=>a.reduce((s,x)=>s+x.t,0), H=sum(hw), S=sum(sv), O=sum(op), one=H+S+O;
  const monthly=N*mo+40;
  return {code,N,hw,sv,op,H,S,O,one,monthly,perFlat:F?one/F:0,mo,notes};
}
/*ENDCALC*/

/* Launch-phase rules (bohio-genhvac/CLAUDE.md, "Quoting rules"): offer A3, B1, B2, D1, E1;
   A1 only with a fixed BMS-contractor price; never offer A2, B3, C1, C2. */
const OFFERED=['A3','B1','B2','D1','E1'];
const WHY_NOT={A2:'Legacy BMS buildings need a controller upgrade first, so this route is not offered at launch.',B3:'Wired Modbus thermostats are not offered at launch; wireless LoRaWAN (B2) is.',C1:'Split ACs with IR controllers are not offered at launch.',C2:'Split ACs with wired gateways are not offered at launch.'};
if(typeof module!=='undefined')module.exports={USD,P0,NAMES,TYPES,SENSE,BALC,RISK,price,OFFERED,WHY_NOT};

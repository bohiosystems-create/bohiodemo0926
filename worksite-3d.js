/* Local, dependency-free 3D coordination model. Demo geometry is not survey/BIM data.
   World coordinates are x/east, y/elevation, z/south. Orthographic projection keeps
   the model useful at close zoom without perspective distortion. */
const Worksite3D=(()=>{
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const home={yaw:-0.52,pitch:0.78,zoom:1,x:0,z:0};
  const positions={delta:[-57,1,-30],aqua:[16,6,-25],voltaic:[64,8,-41],meridian:[-25,1,28],verdant:[-61,1,53],robopave:[58.5,5,45.5],gridbot:[61,6.5,-7],terra:[-18,20.5,-51]};
  const features={delta:{zone:'Earthworks & foundation grid',detail:'Excavated footing bays, concrete columns, rebar and survey stakes.'},aqua:{zone:'Pump station & water chambers',detail:'Two circular water chambers, pump house, access covers and blue water main.'},voltaic:{zone:'High-voltage substation & ductbank',detail:'Protection and switchgear hall, transformer bunds, finned radiators, cooling fans, conservators, HV gantries, three-phase busbars, SF6 breakers, disconnectors, instrument transformers, cable trenches, earthing grid, security fence and fire-safety equipment.'},meridian:{zone:'Road sub-base work strip',detail:'Unsurfaced aggregate strip south of the road spine, roller, kerb stacks and cones.'},verdant:{zone:'Landscaping & nursery plots',detail:'Planted rows, crossing footpaths, nursery beds and irrigation.'},robopave:{zone:'Autonomous paver staging bay',detail:'Blue autonomous paver with GNSS mast beside containers and material bays.'},gridbot:{zone:'Lighting installation corridor',detail:'Row of lighting poles, solar heads, foundation plinths and installation equipment.'},terra:{zone:'Aerial survey over north entrance',detail:'Four-rotor survey drone directly above the north entrance road.'}};
  function project(point,camera,width,height){
    const [x,y,z]=point,dx=x-camera.x,dz=z-camera.z,c=Math.cos(camera.yaw),s=Math.sin(camera.yaw),rx=dx*c-dz*s,rz=dx*s+dz*c;
    const scale=Math.min(width/280,height/205)*camera.zoom;
    return {x:width/2+rx*scale,y:height*.53+(rz*Math.sin(camera.pitch)-y*Math.cos(camera.pitch))*scale,depth:rz*Math.cos(camera.pitch)+y*Math.sin(camera.pitch),scale};
  }
  // Keep numbered pins distinct; clipped or crowded pins remain available in the HTML index.
  function placePins(items,width,height){
    const occupied=[],result=[];
    for(const item of [...items].sort((a,b)=>Number(b.selected)-Number(a.selected))){
      let location=null;
      if(item.x<16||item.x>width-16||item.y<62||item.y>height-25)continue;
      for(const [dx,dy] of [[0,-25],[0,-67],[-42,-25],[42,-25],[-42,-67],[42,-67],[0,-109]]){
        const x=item.x+dx,y=item.y+dy;
        if(x<24||x>width-74||y<85||y>height-76)continue;
        if(occupied.every(p=>Math.hypot(p.x-x,p.y-y)>=43)){location={...item,x,y,anchorX:item.x,anchorY:item.y};break;}
      }
      if(location){occupied.push(location);result.push(location);}
    }
    return result;
  }
  function model(){
    const faces=[],lines=[];let objects=0;
    const shade=(hex,n)=>{const a=hex.replace('#',''),v=[0,2,4].map(i=>parseInt(a.slice(i,i+2),16));return '#'+v.map(c=>Math.round(clamp(c*n,0,255)).toString(16).padStart(2,'0')).join('');};
    const face=(p,c,layer='structures',ground=false)=>{faces.push({p,c,layer,ground});};
    const line=(a,b,c='#bac6c7',w=.15,layer='structures',ground=false)=>lines.push({p:[a,b],c,w,layer,ground});
    function slab(x,z,w,d,c,y=.04,layer='ground'){face([[x,y,z],[x+w,y,z],[x+w,y,z+d],[x,y,z+d]],c,layer,true);}
    function box(x,y,z,w,h,d,c,layer='structures'){
      objects++;const p=[[x,y,z],[x+w,y,z],[x+w,y,z+d],[x,y,z+d],[x,y+h,z],[x+w,y+h,z],[x+w,y+h,z+d],[x,y+h,z+d]];
      face([p[0],p[1],p[5],p[4]],shade(c,.77),layer);face([p[1],p[2],p[6],p[5]],shade(c,.91),layer);
      face([p[2],p[3],p[7],p[6]],shade(c,.85),layer);face([p[3],p[0],p[4],p[7]],shade(c,.66),layer);face([p[4],p[5],p[6],p[7]],c,layer);
    }
    function cylinder(x,y,z,r,h,c,layer='structures',segments=24){
      objects++;const top=[];
      for(let n=0;n<segments;n++){const a=n*Math.PI*2/segments,b=(n+1)*Math.PI*2/segments,p=[x+Math.cos(a)*r,y,z+Math.sin(a)*r],q=[x+Math.cos(b)*r,y,z+Math.sin(b)*r];top.push([p[0],y+h,p[2]]);face([p,q,[q[0],y+h,q[2]],[p[0],y+h,p[2]]],shade(c,.72+.20*(Math.cos(a)+1)/2),layer);}
      face(top,c,layer);
    }
    function beam(a,b,w,c,layer='equipment'){
      const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1,ox=-dz/length*w/2,oz=dx/length*w/2;
      const p=[[a[0]+ox,a[1]-w/2,a[2]+oz],[a[0]-ox,a[1]-w/2,a[2]-oz],[b[0]-ox,b[1]-w/2,b[2]-oz],[b[0]+ox,b[1]-w/2,b[2]+oz]];
      face(p.map(v=>[v[0],v[1]+w,v[2]]),c,layer);for(let n=0;n<4;n++){const q=p[n],r=p[(n+1)%4];face([q,r,[r[0],r[1]+w,r[2]],[q[0],q[1]+w,q[2]]],shade(c,.75),layer);}
    }
    function tube(a,b,r,c,layer='equipment',segments=12){
      objects++;const v=b.map((n,i)=>n-a[i]),len=Math.hypot(...v),d=v.map(n=>n/len),ref=Math.abs(d[1])>.9?[1,0,0]:[0,1,0];
      const u=[d[1]*ref[2]-d[2]*ref[1],d[2]*ref[0]-d[0]*ref[2],d[0]*ref[1]-d[1]*ref[0]],ul=Math.hypot(...u);u.forEach((n,i)=>u[i]=n/ul);
      const w=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];
      const ring=p=>Array.from({length:segments},(_,i)=>p.map((n,k)=>n+r*(u[k]*Math.cos(i*2*Math.PI/segments)+w[k]*Math.sin(i*2*Math.PI/segments))));
      const p=ring(a),q=ring(b);for(let i=0;i<segments;i++)face([p[i],p[(i+1)%segments],q[(i+1)%segments],q[i]],shade(c,.75+.22*(1+Math.sin(i*2*Math.PI/segments))/2),layer);face(p,shade(c,.72),layer);face(q,c,layer);
    }
    function crown(x,y,z,r,c){
      const point=(a,b)=>[x+Math.cos(a)*Math.sin(b)*r,y+Math.cos(b)*r*.85,z+Math.sin(a)*Math.sin(b)*r];
      for(let j=0;j<4;j++)for(let i=0;i<8;i++){const a=i*Math.PI/4,b=j*Math.PI/4;face([point(a,b),point(a+Math.PI/4,b),point(a+Math.PI/4,b+Math.PI/4),point(a,b+Math.PI/4)],shade(c,.78+.2*(i%3)/2+.07*j/4),'landscape');}
    }
    function tree(x,z,size=1){
      cylinder(x,.1,z,.24,4.4*size,'#806952','landscape',8);
      for(let i=0;i<5;i++){const a=i*Math.PI*.4,dx=Math.cos(a)*1.35*size,dz=Math.sin(a)*1.35*size;
        tube([x,2.4*size,z],[x+dx,4.5*size,z+dz],.10*size,'#8a7258','landscape',6);
        crown(x+dx,4.6*size,z+dz,1.45*size,['#608666','#71956f','#83a479'][i%3]);
      }crown(x,6*size,z,1.45*size,'#89aa7b');
      for(let i=0;i<3;i++){const a=i*2.1;line([x,.2,z],[x+Math.cos(a)*.8,.05,z+Math.sin(a)*.8],'#7b7057',.12,'landscape');}
    }
    function scaleVehicle(start,x,z,sx=.65,sy=.58,sz=.82){
      const point=p=>[x+(p[0]-x)*sx,p[1]*sy,z+(p[2]-z)*sz];
      for(const f of faces.slice(start.f))f.p=f.p.map(point);
      for(const l of lines.slice(start.l)){l.p=l.p.map(point);l.w*=sx;}
    }
    function truck(x,z,c='#edf4f6'){
      const start={f:faces.length,l:lines.length};
      box(x+.2,.9,z+.4,2.9,.42,6.3,'#394c52','equipment');
      box(x,1.35,z,3.3,1.35,2.1,c,'equipment');box(x,2.7,z+.12,3.3,1.8,1.98,c,'equipment');box(x+.25,3,z+.07,2.8,.9,.12,'#3d6476','equipment');
      box(x+.15,1.65,z+2.45,3,.2,4.3,'#829793','equipment');
      for(const dx of [.15,3])box(x+dx,1.85,z+2.45,.15,.9,4.3,c,'equipment');
      box(x+.15,1.85,z+6.6,3,.9,.15,c,'equipment');
      for(const dz of [1.7,5.8])for(const dx of [-.35,3]){tube([x+dx,.95,z+dz],[x+dx+.65,.95,z+dz],.68,'#29383d');tube([x+dx-.02,.95,z+dz],[x+dx+.68,.95,z+dz],.31,'#9ba9a8');}
      for(const dx of [-.03,3.31]){box(x+dx,3.1,z+.3,.03,1.05,1.3,'#486b79','equipment');box(x+dx,2.65,z+1.55,.04,.12,.35,'#6c8085','equipment');}
      for(let i=0;i<5;i++)box(x+.3+i*.55,1.35,z-.05,.3,.6,.06,'#50636a','equipment');
      cylinder(x+2.9,2.7,z+2.3,.12,2,'#526268','equipment');
      scaleVehicle(start,x,z);
    }
    function excavator(x,z){
      const start={f:faces.length,l:lines.length};
      // Individual articulated track shoes wrap around aligned rollers and final drives.
      for(const dx of [-.5,3.5]){
        const loop=[];
        for(let k=0;k<=16;k++){const a=-Math.PI/2+k*Math.PI/16;loop.push([.7+.58*Math.sin(a),5.35+.58*Math.cos(a)]);}
        for(let k=0;k<=16;k++){const a=Math.PI/2+k*Math.PI/16;loop.push([.7+.58*Math.sin(a),.65+.58*Math.cos(a)]);}
        for(let k=0;k<loop.length;k++){const a=loop[k],b=loop[(k+1)%loop.length];face([[x+dx,a[0],z+a[1]],[x+dx+1,a[0],z+a[1]],[x+dx+1,b[0],z+b[1]],[x+dx,b[0],z+b[1]]],'#35494b','equipment');}
        for(let zz=.65;zz<=5.35;zz+=.27)for(const y of [.1,1.28]){
          box(x+dx-.06,y,z+zz,1.12,.09,.22,'#7e8880','detail');
          box(x+dx-.06,y+.09,z+zz+.08,1.12,.045,.035,'#a5aaa0','detail');
          for(const bx of [.18,.78])cylinder(x+dx+bx,y+.095,z+zz+.045,.036,.035,'#404f50','micro',6);
        }
        for(const end of [.65,5.35])for(let k=0;k<9;k++){
          const a=(end<1?Math.PI/2:-Math.PI/2)+k*Math.PI/8;
          beam([x+dx-.06,.7+.6*Math.sin(a),z+end+.6*Math.cos(a)],[x+dx+1.06,.7+.6*Math.sin(a),z+end+.6*Math.cos(a)],.13,'#7b8880','detail');
        }
        for(const zz of [.65,1.6,2.55,3.5,4.45,5.35]){
          const radius=(zz===.65||zz===5.35)?.51:.38;
          tube([x+dx-.025,.7,z+zz],[x+dx+1.025,.7,z+zz],radius,'#3b5053','equipment',24);
          for(const side of [dx-.04,dx+1.04]){
            tube([x+side-.015,.7,z+zz],[x+side+.015,.7,z+zz],radius*.62,'#a0a89b','detail',20);
            tube([x+side-.025,.7,z+zz],[x+side+.025,.7,z+zz],.12,'#526769','detail',12);
            for(let k=0;k<8;k++){const a=k*Math.PI/4;tube([x+side-.025,.7+radius*.44*Math.sin(a),z+zz+radius*.44*Math.cos(a)],[x+side+.025,.7+radius*.44*Math.sin(a),z+zz+radius*.44*Math.cos(a)],.032,'#d4d4bc','micro',6);}
          }
        }
      }
      tube([x+3.2,3.5,z+1.4],[x+4.8,7.4,z-.4],.18,'#526266');tube([x+4.8,7.4,z-.4],[x+5,8.6,z-.9],.11,'#c8d8d7');
      tube([x+5.2,8.5,z-1.2],[x+6.5,3,z-3.4],.14,'#53646a');
      for(let i=0;i<4;i++)box(x+6.1+i*.48,.15,z-5.55,.25,.35,.8,'#b8b3a1','equipment');
      for(let i=0;i<6;i++)box(x+2.8,2.2,z+3+i*.3,1,.12,.12,'#645f4d','equipment');
      box(x,1,z,4,1.7,6,'#dcac51','equipment');for(const dx of [-.5,3.5])box(x+dx,.2,z,1,.9,6,'#475557','equipment');box(x+.3,2.7,z+1,2.2,2.3,2.6,'#efbc5c','equipment');box(x+.5,3.1,z+.94,1.8,1.4,.15,'#537a86','equipment');beam([x+3,3,z+2],[x+5,9,z-1],.8,'#e9b856');beam([x+5,9,z-1],[x+7,1.5,z-4],.6,'#e9b856');
      // Curved scoop, dark open interior, cab glazing and hydraulic hose routing.
      for(let i=0;i<10;i++){const a=i*Math.PI/20,b=(i+1)*Math.PI/20;face([[x+6,.3+1.2*Math.sin(a),z-5+1.6*(1-Math.cos(a))],[x+8,.3+1.2*Math.sin(a),z-5+1.6*(1-Math.cos(a))],[x+8,.3+1.2*Math.sin(b),z-5+1.6*(1-Math.cos(b))],[x+6,.3+1.2*Math.sin(b),z-5+1.6*(1-Math.cos(b))]],'#59635d','equipment');}
      for(const dx of [.27,2.51]){face([[x+dx,3.1,z+1.25],[x+dx,4.65,z+1.45],[x+dx,4.65,z+3.25],[x+dx,3.1,z+3.25]],'#537c88','equipment');box(x+dx,3,z+2.15,.04,1.7,.07,'#344f5c','equipment');}
      box(x+.15,5,z+.85,2.5,.15,2.95,'#cfad60','equipment');tube([x+3.5,2.7,z+4.6],[x+3.5,4.1,z+4.6],.12,'#475f67');
      for(let j=0;j<4;j++)line([x+3+j*.1,3.6,z+1],[x+5+j*.1,8.9,z-1],'#3a515b',.045,'equipment');
      for(const dx of [-.4,4]){box(x+dx,1.5,z+1,.3,.12,.9,'#7b8e88','equipment');tube([x+dx,1.6,z+1],[x+dx,2.5,z+1],.05,'#4b6268');}
      // Excavator close-up mechanical package: rollers, pins, hydraulics, cab interior and service hardware.
      cylinder(x+2,1.82,z+2.9,.72,.28,'#4f6267','equipment',24);cylinder(x+2,2.1,z+2.9,.28,.22,'#b7a268','detail',18);
      for(const [a,b] of [[[[x+3.05,3.55,z+1.6],[x+4.55,7.1,z-.25]],[[x+3.15,3.65,z+1.72],[x+4.7,7.32,z-.42]]],[[[x+4.95,7.7,z-.75],[x+6.42,3.25,z-3.15]],[[x+5.08,7.78,z-.7],[x+6.58,3.12,z-3.32]]]]){
        tube(a[0],a[1],.14,'#d3a84f','equipment',12);tube(b[0],b[1],.075,'#d9ded7','equipment',12);
      }
      for(const [px,py,pz] of [[x+3.1,3.6,z+1.65],[x+4.95,7.7,z-.75],[x+6.45,3.2,z-3.2]]){tube([px-.18,py,pz],[px+.18,py,pz],.3,'#5e6b69','equipment',16);tube([px-.21,py,pz],[px+.21,py,pz],.11,'#bd9a56','detail',12);}
      for(let j=0;j<6;j++)line([x+3+j*.08,3.45,z+1.15],[x+5.15+j*.08,8.65,z-1.08],j<3?'#293f47':'#596c70',.038,'detail');
      for(let j=0;j<4;j++)line([x+5+j*.08,8.45,z-1.15],[x+6.75+j*.08,2.6,z-4.15],'#334950',.04,'detail');
      // Glazed cab framing, operator seat, controls, wiper, mirrors and work lights.
      box(x+.72,3.28,z+1.35,1.35,1.25,1.55,'#395966','equipment');box(x+.94,3.35,z+2.05,.72,.8,.62,'#243d47','detail');box(x+1.07,4.05,z+2.18,.46,.12,.35,'#657a7d','detail');
      tube([x+1.08,3.9,z+1.3],[x+1.08,4.65,z+1.18],.028,'#1f343c','detail',8);line([x+1.08,4.62,z+1.18],[x+1.62,4.08,z+1.16],'#1f343c',.035,'detail');
      for(const dx of [.45,2.35]){tube([x+dx,4.35,z+1.1],[x+dx+(dx<1?-.6:.6),4.65,z+.6],.045,'#374d55','detail',8);box(x+dx+(dx<1?-.75:.6),4.55,z+.5,.2,.16,.32,'#566d72','detail');}
      for(const dx of [.55,2.05])box(x+dx,4.6,z+.82,.42,.28,.18,'#e9dfb0','equipment');
      box(x+.35,2.25,z+4.1,2.85,.9,1.55,'#ce9f48','equipment');for(let j=0;j<8;j++)line([x+.55+j*.32,2.48,z+5.66],[x+.55+j*.32,2.95,z+5.66],'#6f6046',.045,'detail');
      tube([x+2.65,3.1,z+4.8],[x+2.65,5.1,z+4.8],.12,'#384c52','equipment',12);cylinder(x+2.65,5.08,z+4.8,.2,.18,'#8c9590','detail',12);
      for(let y=2.45;y<3.15;y+=.22)box(x+.08,y,z+4.25,.7,.08,.28,'#6c7771','detail');
      for(const [px,pz] of [[x-.05,z+.5],[x+3.75,z+.5],[x-.05,z+5.35],[x+3.75,z+5.35]]){tube([px,1.35,pz],[px,2.5,pz],.045,'#3f555d','detail',8);box(px-.08,2.45,pz-.08,.16,.16,.16,'#d39a3e','detail');}
      // Bucket wear plates, side cutters, teeth and packed soil residue.
      for(let i=0;i<7;i++){box(x+6.05+i*.31,.18,z-5.75,.22,.42,.95,'#7e8178','equipment');box(x+6.08+i*.31,.05,z-6.15,.16,.25,.52,'#555e5c','detail');}
      for(let i=0;i<18;i++){const bx=x+6.15+(i%6)*.34,bz=z-5.3+Math.floor(i/6)*.31;cylinder(bx,.58,bz,.1,.08,['#9a876b','#786c58','#b39b76'][i%3],'detail',6);}
      // Fabricated service panels, fasteners, hydraulic manifold and protected cab fittings.
      for(const side of [.28,2.53]){
        for(const zz of [1.23,3.28])beam([x+side,3.02,z+zz],[x+side,4.85,z+zz],.065,'#263f49','detail');
        beam([x+side,4.85,z+1.23],[x+side,4.85,z+3.28],.065,'#263f49','detail');
        line([x+side,3.2,z+1.5],[x+side,4.5,z+2.7],'#8caeb1',.055,'detail');
        box(x+side-.035,3.55,z+2.95,.09,.08,.3,'#c3c9bd','detail');
        for(const y of [3.15,4.25])box(x+side-.045,y,z+3.21,.09,.22,.1,'#ad944f','detail');
      }
      for(let k=0;k<13;k++)box(x+.48+k*.19,3.17,z+4.3,.065,.025,1.15,'#465854','detail');
      for(const zz of [4.12,5.63])for(let xx=.5;xx<3.1;xx+=.4)cylinder(x+xx,3.16,z+zz,.035,.025,'#d9c792','micro',6);
      cylinder(x+2.95,3.18,z+4.42,.14,.06,'#465b5d','detail',16);
      for(const zz of [4.1,5.3])box(x+3.99,1.62,z+zz,.035,.33,.38,'#e4cd89','detail');
      for(let zz=3.65;zz<5.5;zz+=.16)box(x+4.015,1.9,z+zz,.03,.48,.055,'#655d42','detail');
      for(const xx of [.5,3.25]){box(x+xx,2.08,z+6.015,.5,.22,.08,'#953e32','detail');box(x+xx+.03,2.12,z+6.105,.16,.11,.025,'#e8be69','detail');}
      cylinder(x+1.4,5.17,z+2.7,.19,.08,'#415963','detail',16);cylinder(x+1.4,5.25,z+2.7,.14,.24,'#e4a448','detail',16);
      tube([x+2.25,5.17,z+3.35],[x+2.25,5.98,z+3.35],.022,'#304b54','detail',8);
      // Grease caps and bolted cheeks at the actual boom and stick pivot axes.
      for(const [px,py,pz] of [[3,3,2],[5,9,-1],[7,1.5,-4]]){
        tube([x+px-.52,py,z+pz],[x+px+.52,py,z+pz],.24,'#5f706b','detail',24);
        for(const side of [-.54,.54]){
          tube([x+px+side-.02,py,z+pz],[x+px+side+.02,py,z+pz],.16,'#d1b269','detail',18);
          for(let k=0;k<6;k++){const a=k*Math.PI/3;tube([x+px+side-.025,py+.11*Math.sin(a),z+pz+.11*Math.cos(a)],[x+px+side+.025,py+.11*Math.sin(a),z+pz+.11*Math.cos(a)],.027,'#52656b','micro',6);}
        }
      }
      for(let k=0;k<4;k++){
        const hose=[[x+3.15+k*.09,3.45,z+1.8],[x+3.5+k*.09,4.1,z+1.5],[x+4.85+k*.09,8.8,z-.9],[x+5.25+k*.09,9.12,z-1.15],[x+5.55+k*.09,8.6,z-1.45]];
        for(let j=1;j<hose.length;j++)tube(hose[j-1],hose[j],.025,'#2d4148','detail',6);
      }
      for(const side of [-.32,.32]){
        beam([x+7+side,1.5,z-4],[x+7.4+side,1.2,z-4.85],.12,'#cea34c','detail');
        tube([x+6.3+side,3.45,z-3.15],[x+6.95+side,1.9,z-3.8],.11,'#6b7872','detail',12);
        tube([x+6.95+side,1.9,z-3.8],[x+7.4+side,1.2,z-4.85],.055,'#d3ddd5','detail',12);
      }
      for(const xx of [6.02,7.98])face([[x+xx,.3,z-5],[x+xx,1.62,z-4.25],[x+xx,1.4,z-3.6],[x+xx,.5,z-3.8]],'#b5995d','equipment');
      scaleVehicle(start,x,z,.68,.68,.68);
    }
    // Land, seawall and waterfront foundations render before smaller ground detail.
    box(-98,-5,-73,190,5,149,'#d8d7cb','base');
    slab(-98,-73,185,149,'#e3e4d9',0,'foundation');
    slab(87,-90,65,185,'#92c6d1',-.6,'foundation');
    for(let x=89;x<150;x+=5)for(let z=-86;z<95;z+=7)line([x,-.55,z],[x+2.1,-.55,z],'#b4dce0',.12,'water',true);
    // Clean open ground: keep all added details attached to the built work zones.
    box(82,-1,-73,5,1.1,149,'#c2d0ca','base');
    slab(76,-73,6,149,'#cdd7cc');
    for(let z=-69;z<76;z+=3)line([76,.12,z],[86,.12,z],'#b6c2b8',.09,'ground',true);
    for(const z of [-52,-15,25,57]){
      // Short deck panels and pile bands keep depth sorting local at every camera angle.
      for(let x=90;x<111;x+=4){
        for(const pz of [z+.55,z+2.45])for(let y=-.6;y<.65;y+=.2)cylinder(x,y,pz,.34,.21,'#687c80','structures',16);
        for(let dz=.22;dz<2.78;dz+=.32)box(x-.65,.52,z+dz,1.3,.32,.32,'#849392','structures');
      }
      for(let x=87;x<112;x+=.5){
        for(let dz=0;dz<3;dz+=.5)box(x,.75,z+dz,.5,.48,.5,'#d7c6a4','structures');
        for(const dz of [.18,2.5])box(x,.62,z+dz,.5,.22,.32,'#899695','structures');
      }
      // Shore landing slopes up to the connected pier deck.
      face([[84,.12,z],[87,1.23,z],[87,1.23,z+3],[84,.12,z+3]],'#d7c6a4','structures');
      for(let x=89;x<112;x+=1.6)line([x,1.24,z],[x,1.24,z+3],'#aa987b',.08,'detail');
      for(let x=91;x<111;x+=5){cylinder(x,1.23,z+1.5,.22,.6,'#506b74','equipment',12);}
    }
    // Two coastal product tankers in the offshore berth, scaled beyond the small piers.
    function tanker(x,z){
      const hullWidth=t=>{const bow=Math.min(1,Math.max(0,t)/.16),stern=1-.1*Math.pow(Math.max(0,(t-.76)/.24),1.7);return 4.5*Math.sin(bow*Math.PI/2)*stern;};
      const edge=[];
      for(let i=0;i<=48;i++){const t=i/48;edge.push([-hullWidth(t),-25+49*t]);}
      for(let i=48;i>0;i--){const t=i/48;edge.push([hullWidth(t),-25+49*t]);}
      const deck=edge.map(([dx,dz])=>[x+dx,2.4,z+dz]);
      // Tanker hull 10x close-up package: curved shell strakes, keel, bow and stern structure.
      const hullLevels=[[-1,.64,'#304d5b'],[-.35,.82,'#385766'],[.25,.92,'#4a6874'],[.95,.98,'#526f79'],[1.68,1,'#58757e'],[2.4,1,'#607c84']];
      for(let i=0;i<48;i++){
        const ta=i/48,tb=(i+1)/48,za=z-25+49*ta,zb=z-25+49*tb,wa=hullWidth(ta),wb=hullWidth(tb);
        for(const side of [-1,1])for(let band=0;band<hullLevels.length-1;band++){
          const [ya,sa,ca]=hullLevels[band],[yb,sb]=hullLevels[band+1];
          face([[x+side*wa*sa,ya,za],[x+side*wb*sa,ya,zb],[x+side*wb*sb,yb,zb],[x+side*wa*sb,yb,za]],i%5===0?shade(ca,.91):ca,'structures');
        }
      }
      // Keel line, boot-top stripe, longitudinal welds and transverse frame seams.
      line([x,-1.02,z-24.8],[x,-1.02,z+23.8],'#223c49',.18,'structures');
      for(const side of [-1,1]){
        for(const [y,s,c,w] of [[-.34,.82,'#1f3c49',.13],[.18,.91,'#a86149',.16],[.95,.98,'#38535f',.045],[1.68,1,'#405e68',.045]]){
          for(let i=0;i<48;i++){const ta=i/48,tb=(i+1)/48;line([x+side*hullWidth(ta)*s,y,z-25+49*ta],[x+side*hullWidth(tb)*s,y,z-25+49*tb],c,w,'detail');}
        }
        for(let i=3;i<48;i+=2){const t=i/48,h=hullWidth(t),zz=z-25+49*t;line([x+side*h*.83,-.32,zz],[x+side*h,2.32,zz],i%4===1?'#789096':'#657e86',.025,'micro');}
      }
      // Bow flare, bulbous bow, stem bar and spray rails.
      for(let i=0;i<12;i++){
        const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
        face([[x,-.48,z-26.45],[x+Math.cos(a)*1.02,-.35+Math.sin(a)*.66,z-24.55],[x+Math.cos(b)*1.02,-.35+Math.sin(b)*.66,z-24.55]],i%2?'#365663':'#405f6b','structures');
      }
      beam([x,-.9,z-26.3],[x,2.36,z-25],.16,'#d3d5c8','structures');
      for(const side of [-1,1]){line([x+side*.2,1.35,z-24.8],[x+side*3.8,2.1,z-20.8],'#80969a',.06,'detail');line([x+side*.35,.55,z-24.5],[x+side*3.4,.9,z-20.2],'#36515d',.05,'detail');}
      // Stern transom, skeg, rudder and four-bladed propeller.
      const sternW=hullWidth(1);
      face([[x-sternW*.82,-.35,z+24],[x+sternW*.82,-.35,z+24],[x+sternW,2.4,z+24],[x-sternW,2.4,z+24]],'#486773','structures');
      face([[x-.28,-1,z+20.8],[x+.28,-1,z+20.8],[x+.42,.25,z+24.8],[x-.42,.25,z+24.8]],'#2f4d5a','structures');
      face([[x-.08,-.78,z+24.25],[x+.08,-.78,z+24.25],[x+.7,.2,z+25],[x-.7,.2,z+25]],'#506c75','equipment');
      tube([x,-.42,z+24],[x,-.42,z+25.05],.14,'#8f927f','equipment',12);
      for(let k=0;k<4;k++){const a=k*Math.PI/2;face([[x,-.42,z+25.08],[x+Math.cos(a)*1.22,-.42+Math.sin(a)*1.22,z+25.12],[x+Math.cos(a+.55)*.46,-.42+Math.sin(a+.55)*.46,z+25.13]],'#a98c58','equipment');}
      // Hawse pipes, stockless anchors, shell openings and sea-chest grilles.
      for(const side of [-1,1]){
        const hx=x+side*hullWidth(.1)*.94,hz=z-20.1;
        const ring=[];for(let k=0;k<16;k++){const a=k*Math.PI/8;ring.push([hx+side*.03,1.25+.38*Math.cos(a),hz+.38*Math.sin(a)]);}face(ring,'#263e49','equipment');
        tube([hx,1.15,hz],[hx+side*.38,.05,hz+.6],.09,'#313e42','equipment',8);beam([hx+side*.38,.05,hz+.6],[hx+side*.72,-.35,hz+.85],.18,'#59696b','equipment');
        for(const [t,y] of [[.42,.22],[.58,.52],[.88,.18]]){const hw=hullWidth(t),zz=z-25+49*t;cylinder(x+side*hw*.94,y,zz,.11,.04,'#243e49','detail',12);}
        const gt=.72,gw=hullWidth(gt),gz=z-25+49*gt;
        box(x+side*gw*.985-(side<0?.025:0),-.15,gz-1,.025,.9,2,'#2c4651','equipment');
        for(let j=0;j<8;j++)line([x+side*gw*.99,-.08,gz-.88+j*.24],[x+side*gw*.99,.65,gz-.88+j*.24],'#7d9293',.025,'micro');
      }
      // Draft marks, Plimsoll load-line symbols, sacrificial anodes and tug contact patches.
      for(const side of [-1,1]){
        for(const t of [.055,.92]){const hw=hullWidth(t),zz=z-25+49*t;for(let j=0;j<8;j++){const y=-.2+j*.28;line([x+side*hw*.985,y,zz-.25],[x+side*hw*.985,y,zz+(j%2?.15:.32)],'#e8e6d7',.035,'micro');}}
        const pt=.36,pw=hullWidth(pt),pz=z-25+49*pt;
        for(let k=0;k<20;k++){const a=k*Math.PI/10,b=(k+1)*Math.PI/10;line([x+side*pw*.99,.66+.42*Math.cos(a),pz+.42*Math.sin(a)],[x+side*pw*.99,.66+.42*Math.cos(b),pz+.42*Math.sin(b)],'#e2dfcf',.035,'detail');}
        line([x+side*pw*.99,.66,pz-.75],[x+side*pw*.99,.66,pz+.75],'#e2dfcf',.055,'detail');
        for(const t of [.3,.48,.66,.84]){const hw=hullWidth(t),zz=z-25+49*t;box(x+side*hw*.985-(side<0?.1:0),-.72,zz-.35,.1,.18,.7,'#9b8460','detail');}
        for(const t of [.18,.82]){const hw=hullWidth(t),zz=z-25+49*t;box(x+side*hw*1.002-(side<0?.055:0),.45,zz-1.1,.055,.8,2.2,'#2c4650','detail');}
      }
      // Short transverse deck panels avoid a single polygon occluding the aft superstructure.
      for(let i=0;i<48;i++){
        const za=-25+i*49/48,zb=-25+(i+1)*49/48;
        const wa=hullWidth(i/48),wb=hullWidth((i+1)/48);
        for(let j=0;j<4;j++){const a=-1+j*.5,b=a+.5;face([[x+wa*a,2.4,z+za],[x+wa*b,2.4,z+za],[x+wb*b,2.4,z+zb],[x+wb*a,2.4,z+zb]],'#b4b9a4');}
      }
      for(let i=0;i<deck.length-1;i++){const p=deck[i],q=deck[i+1];line([p[0],3.1,p[2]],[q[0],3.1,q[2]],'#d7deca',.06);if(i%2===0)line(p,[p[0],3.1,p[2]],'#9dacaa',.055);}
      // Cargo manifolds, tank access domes and longitudinal product lines.
      for(const dz of [-15,-8,-1,6])for(const dx of [-2.2,2.2]){cylinder(x+dx,2.42,z+dz,1.05,.22,'#7d9190');cylinder(x+dx,2.64,z+dz,.48,.22,'#c7d1bb');tube([x+dx,2.8,z+dz],[x+dx,4.5,z+dz],.1,'#d0d6c5');}
      for(const dx of [-.65,0,.65]){tube([x+dx,2.8,z-18],[x+dx,2.8,z+11],.17,'#8b6e56');for(let dz=-16;dz<11;dz+=4)box(x+dx-.25,2.45,z+dz,.5,.25,.45,'#758c89');}
      for(const dz of [-1,1]){tube([x,2.8,z+dz],[x-4,2.8,z+dz],.2,'#aa8a59');cylinder(x-3.5,2.8,z+dz,.12,.55,'#647f83');cylinder(x-3.5,3.35,z+dz,.33,.07,'#ac5444');}
      // Aft accommodation block, glazed bridge, funnel and radar mast.
      box(x-3.15,2.4,z+11.8,6.3,.16,7.5,'#8c9e96');
      box(x-3,2.45,z+12,6,4.6,7,'#e1e3d4');box(x-3.3,7.05,z+11.8,6.6,.25,7.4,'#a5b8b2');box(x-2.8,7.3,z+12.2,5.6,1.8,3,'#e5e6d8');
      for(let dx=-2.5;dx<2.6;dx+=.85){box(x+dx,7.7,z+12.12,.65,.8,.08,'#456a7c');for(const y of [3.3,5])box(x+dx,y,z+11.96,.5,.6,.07,'#607f88');}
      box(x+1.1,7.3,z+17,1.4,2.6,1.6,'#b3704e');box(x+1.1,9.5,z+17,1.4,.4,1.6,'#405763');tube([x,9.1,z+13],[x,12,z+13],.09,'#acbdb7');beam([x-1.3,11.5,z+13],[x+1.3,11.5,z+13],.09,'#d6dccb');
      for(const dz of [-20,21]){cylinder(x,2.5,z+dz,.6,.5,'#5c747b');for(const dx of [-2,2])cylinder(x+dx,2.45,z+dz,.18,.5,'#657c82');}
      // Pipe expansion loops, manifold valves and grated central access walkway.
      for(let dz=-17;dz<10;dz+=1){box(x-.42,3.25,z+dz,.84,.06,.82,'#778c89');for(let j=0;j<5;j++)line([x-.38,3.32,z+dz+j*.16],[x+.38,3.32,z+dz+j*.16],'#bbc4b3',.025);}
      for(let dz=-15;dz<10;dz+=5){for(const dx of [-.6,.6]){tube([x+dx,3.3,z+dz],[x+dx,4,z+dz],.035,'#c2caba');line([x+dx,4,z+dz],[x+dx,4,z+dz+5],'#b1c1b9',.035);}
        for(const dx of [-2.2,2.2]){tube([x+dx,2.85,z+dz],[x+dx,3.5,z+dz],.08,'#839a93');for(let k=0;k<12;k++){const a=k*Math.PI/6,b=(k+1)*Math.PI/6;line([x+dx+.27*Math.cos(a),3.5,z+dz+.27*Math.sin(a)],[x+dx+.27*Math.cos(b),3.5,z+dz+.27*Math.sin(b)],'#a7654b',.045);}}
      }
      // Bridge side windows, stairs, deck lights and weather-deck lifeboat davits.
      for(const dx of [-3.03,3.03])for(let dz=13;dz<19;dz+=1.1)for(const y of [3.4,5.2])box(x+dx,y,z+dz,.055,.52,.6,'#527781');
      for(let j=0;j<12;j++)box(x+3.1,2.45+j*.36,z+12+j*.34,.7,.12,.42,'#98aaa0');
      for(const dx of [-3.65,3.65]){
        for(const dz of [15.5,18.3]){tube([x+dx,2.5,z+dz],[x+dx,5.4,z+dz],.09,'#bccabf');beam([x+dx,5.4,z+dz],[x+dx+Math.sign(dx)*.7,5.4,z+dz],.1,'#c5d0c1');}
        const lx=x+dx;face([[lx-.45,3.3,z+15.2],[lx+.45,3.3,z+15.2],[lx+.55,3.3,z+17.8],[lx,3.3,z+18.6],[lx-.55,3.3,z+17.8]],'#cf8750');
        box(lx-.35,3.32,z+15.7,.7,.45,1.65,'#e1a067');
      }
      // Tanker navigation bridge and accommodation 10x close-up package.
      // Bridge wings, consoles, glazed corners and deck-edge rails.
      for(const dx of [-3.9,3.25]){
        box(x+dx,7.15,z+12.35,.65,.18,3.2,'#cbd4c8');
        box(x+dx+.08,7.35,z+12.75,.48,.55,.85,'#667f82');
        for(const dz of [12.2,13.5,14.8])tube([x+dx,7.35,z+dz],[x+dx,8.45,z+dz],.035,'#d7dfd1');
        line([x+dx,8.42,z+12.15],[x+dx,8.42,z+15.1],'#d7dfd1',.035);
        box(x+dx-.05,7.86,z+12.92,.1,.12,.42,'#d7b752');
      }
      for(let dx=-2.55;dx<=2.55;dx+=.72){
        box(x+dx,8.05,z+12.08,.54,.68,.07,'#315665');
        box(x+dx+.23,8.05,z+12.01,.025,.72,.09,'#dce1d5');
      }
      for(const dz of [12.22,14.2,16.1,18.05])for(const y of [3.05,4.72,6.35]){
        box(x-3.08,y,z+dz,.08,.82,.75,'#536f78');box(x+3,y,z+dz,.08,.82,.75,'#536f78');
        box(x-3.14,y+.23,z+dz+.58,.1,.12,.1,'#ddd7b5');box(x+3.04,y+.23,z+dz+.58,.1,.12,.1,'#ddd7b5');
      }
      // External companionways, watertight doors, portholes and fire stations.
      for(const side of [-1,1]){
        const sx=x+side*3.18;
        for(let j=0;j<15;j++)box(sx-side*.32,2.55+j*.29,z+18.2-j*.34,.65,.09,.32,'#839994');
        line([sx,2.55,z+18.2],[sx,6.75,z+13.45],'#c3cec1',.07);line([sx-side*.64,2.55,z+18.2],[sx-side*.64,6.75,z+13.45],'#c3cec1',.07);
        for(const y of [3.18,4.85,6.5]){box(sx-side*.05,y,z+15.7,.08,1.18,.7,'#78908e');cylinder(sx-side*.12,y+.55,z+15.82,.08,.04,'#d8c08a','structures',8);}
        cylinder(sx-side*.12,4.05,z+18.1,.34,.08,'#c94e3e','equipment',16);cylinder(sx-side*.16,4.05,z+18.1,.12,.1,'#ece6cf','equipment',12);
      }
      // Radar, communications, navigation lights and bridge-roof equipment.
      tube([x,9.1,z+13.4],[x,13.3,z+13.4],.08,'#cbd5c8');
      for(const y of [10.45,11.7,12.75])beam([x-1.3,y,z+13.4],[x+1.3,y,z+13.4],.055,'#dbe1d3');
      beam([x-1.7,12.78,z+13.4],[x+1.7,12.78,z+13.4],.11,'#edf0df');box(x-1.55,12.72,z+13.25,3.1,.12,.3,'#687d7d');
      beam([x-.9,11.72,z+13.4],[x+.9,11.72,z+13.4],.07,'#e4e8da');box(x-.75,11.68,z+13.3,1.5,.09,.2,'#728887');
      for(const dx of [-2.05,2.05]){cylinder(x+dx,9.25,z+13.85,.55,.18,'#e8eadb','equipment',20);cylinder(x+dx,9.43,z+13.85,.42,.5,'#ecefe1','equipment',20);tube([x+dx,9.93,z+13.85],[x+dx,10.35,z+13.85],.035,'#9eaaa4');}
      for(const dx of [-2.65,0,2.65]){tube([x+dx,9.1,z+14.4],[x+dx,10.55,z+14.4],.035,'#c9d5ca');cylinder(x+dx,10.52,z+14.4,.08,.12,dx<0?'#c7443d':dx>0?'#4e9d75':'#e4d8ad','equipment',10);}
      // Funnel louvers, exhaust crowns, HVAC plant and emergency deck equipment.
      for(let y=7.75;y<9.35;y+=.3)box(x+1.02,y,z+17.02,1.56,.08,.06,'#594d43');
      for(const dx of [1.35,1.85]){tube([x+dx,9.65,z+17.45],[x+dx,10.35,z+17.45],.12,'#3f5358');cylinder(x+dx,10.33,z+17.45,.2,.12,'#263a40','equipment',12);}
      for(const dx of [-1.9,-.75,.4]){box(x+dx,9.05,z+16.25,.85,.48,.72,'#9baaa3');for(let k=0;k<4;k++)line([x+dx+.08+k*.18,9.55,z+16.3],[x+dx+.08+k*.18,9.55,z+16.85],'#637879',.025);}
      for(const dx of [-2.45,2.45]){box(x+dx-.24,6.82,z+18.65,.48,.72,.2,'#d8d4b7');cylinder(x+dx,7.2,z+18.48,.24,.06,'#d34f42','equipment',12);}
      for(const y of [3,4.65,6.3,7.1]){line([x-3.15,y,z+12.2],[x-3.15,y,z+18.8],'#d1dbce',.035);line([x+3.15,y,z+12.2],[x+3.15,y,z+18.8],'#d1dbce',.035);}
      // Mooring winches, anchor chain and pronounced welded hull plating.
      // Accommodation foundation skirt, deck balconies, roof drains and window reveals.
      for(const side of [-1,1])for(let dz=12;dz<19;dz+=.7){
        box(x+side*3.02,2.42,z+dz,.06,.32,.65,'#7e918c');
        for(const y of [4.55,6.2]){box(x+side*3.03,y,z+dz,.15,.08,.65,'#c4cec0');line([x+side*3.18,y+.12,z+dz],[x+side*3.18,y+.75,z+dz],'#d6ded1',.025);}
      }
      for(const dx of [-2.8,2.8])tube([x+dx,7.05,z+18.8],[x+dx,2.45,z+18.8],.055,'#a9bcb1');
      for(let dx=-2.4;dx<2.5;dx+=.8){box(x+dx,5.3,z+19.02,.54,.6,.05,'#375765');box(x+dx-.04,5.23,z+19.07,.62,.07,.08,'#c5cec1');}
      for(const dz of [12.3,18.7])for(const dx of [-2.4,2.4]){box(x+dx,2.56,z+dz,.4,.55,.25,'#b8493d');tube([x+dx+.2,3.1,z+dz],[x+dx+.2,3.3,z+dz],.035,'#788d86');}
      for(const dz of [-20,21]){tube([x-.8,2.95,z+dz],[x+.8,2.95,z+dz],.3,'#617d81');for(let k=0;k<12;k++)line([x-.6+k*.1,2.67,z+dz],[x-.6+k*.1,3.23,z+dz],'#adb9ad',.03);}
      for(let dz=-21;dz<-17;dz+=.22)cylinder(x,2.48,z+dz,.09,.035,'#596d70','structures',8);
      for(let i=1;i<deck.length;i+=2){const p=deck[i];line([p[0],.3,p[2]],[p[0],2.35,p[2]],'#657e86',.025);}
      for(const dz of [-12,0,9])for(const dx of [-3.5,3.5]){tube([x+dx,2.4,z+dz],[x+dx,5,z+dz],.045,'#a6bbb6');box(x+dx-.12,4.95,z+dz,.24,.16,.3,'#e1dfbd');}
    }
    tanker(122,-43);tanker(133,33);
    // Road spine, north entrance and southern loop, with kerbs, striping and crossings.
    for(let x=-97;x<77;x+=8){slab(x,5,8,12,'#59676b',.09);slab(x,3.6,8,1.4,'#c7d0c9',.12);slab(x,17,8,1.4,'#c7d0c9',.12);slab(x+1.3,10.7,3.7,.3,'#e7e8d5',.14);}
    for(let z=-65;z<4;z+=7){slab(-23,z,11,7,'#667377',.08);slab(-24.5,z,1.5,7,'#cbd4cd',.1);slab(-12,z,1.5,7,'#cbd4cd',.1);slab(-17.7,z+1.8,.3,3,'#e7e8d5',.14);}
    for(let z=18;z<70;z+=7){slab(17,z,11,7,'#737c79',.08);slab(15.5,z,1.5,7,'#cbd4cd',.1);slab(28,z,1.5,7,'#cbd4cd',.1);slab(22.4,z+1.8,.3,3,'#f0ead4',.14);}
    for(let i=0;i<7;i++){slab(-30,5.5+i*1.6,3,.65,'#eeeede',.16);slab(34,5.5+i*1.6,3,.65,'#eeeede',.16);}
    for(const x of [-91,69]){box(x,.1,19,4,3,4,'#e9eee9');box(x+.3,1.4,18.9,3.4,1,.1,'#57808d');cylinder(x,0,4,.28,2.4,'#b35145');beam([x,2.2,4],[x,2.2,14],.28,'#faf5e4','structures');}
    // Earthworks excavation, foundations, shuttering, and a rising concrete frame.
    slab(-86,-53,54,44,'#cbbca1');
    for(let x=-82;x<-36;x+=15)for(let z=-48;z<-12;z+=16){
      box(x,0,z,11,.7,12,'#a89d89');box(x+.8,.7,z+.8,9.4,.35,10.4,'#dedfd4');
      for(const dx of [1,9])for(const dz of [1,10]){box(x+dx,1,z+dz,.65,5.8,.65,'#bfc8c3');box(x+dx-.25,.1,z+dz-.25,1.2,1.2,1.2,'#cbd2c8');}
      if(x<-65){box(x+.8,6.8,z+.8,9.5,.45,10.5,'#d6dbd1');for(const dx of [1,9])for(const dz of [1,10])box(x+dx,7.25,z+dz,.65,5,.65,'#c9d0c8');}
      for(let dz=2;dz<11;dz+=2)line([x+1,1.1,z+dz],[x+10,1.1,z+dz],'#94a39e',.1);
    }
    // Area 1 structural and earthworks 10x close-up package.
    // Layered excavation faces, battered slopes, haul tracks and drained working formation.
    for(let i=0;i<7;i++){
      const inset=i*.72;
      face([[-86+inset,.05+i*.08,-53+inset],[-32-inset,.05+i*.08,-53+inset],[-34-inset,.05+i*.08,-50+inset],[-84+inset,.05+i*.08,-50+inset]],i%2?'#b7a58b':'#c8b79a','ground');
      line([-84+inset,.12+i*.08,-51+inset],[-35-inset,.12+i*.08,-51+inset],i%2?'#927d61':'#a18d70',.06,'ground');
    }
    for(let x=-82;x<-35;x+=3.2)for(const z of [-50.5,-13.2]){box(x,.3,z,2.45,.24,.28,'#d99749');box(x+.3,.54,z+.03,.06,.82,.06,'#d7c49c');box(x+1.75,.54,z+.03,.06,.82,.06,'#d7c49c');line([x+.3,1.32,z+.03],[x+1.81,1.32,z+.03],'#d7c49c',.045);}
    // Dense reinforcement cages, starter bars, ties, formwork walers and anchor bolts.
    for(const cx of [-80,-65,-50,-38])for(const cz of [-45,-29,-16]){
      for(const dx of [-.34,.34])for(const dz of [-.34,.34])tube([cx+dx,.45,cz+dz],[cx+dx,4.25,cz+dz],.045,'#7f6957');
      for(let y=.7;y<4.2;y+=.38){for(const [a,b] of [[[-.4,0,-.4],[.4,0,-.4]],[[.4,0,-.4],[.4,0,.4]],[[.4,0,.4],[-.4,0,.4]],[[-.4,0,.4],[-.4,0,-.4]]])line([cx+a[0],y,cz+a[2]],[cx+b[0],y,cz+b[2]],'#9a765b',.025);}
      box(cx-.78,.18,cz-.78,1.56,.18,1.56,'#bfc7bf');for(const dx of [-.55,.55])for(const dz of [-.55,.55]){tube([cx+dx,.38,cz+dz],[cx+dx,.78,cz+dz],.035,'#6a7370');cylinder(cx+dx,.77,cz+dz,.09,.06,'#a8aaa0','structures',8);}
    }
    for(const bx of [-82,-67,-52])for(const bz of [-47,-31,-15]){
      for(const side of [-1,1]){box(bx+side*5.55,.55,bz, .14,2.9,11.8,'#b99b70');for(let y=.8;y<3.3;y+=.65)box(bx+side*5.63,y,bz+.25,.12,.12,11.3,'#6e7773');}
      for(let zt=bz+1;zt<bz+11;zt+=2.1)beam([bx-5.7,1.35,zt],[bx+5.7,1.35,zt],.08,'#80705e');
    }
    // Access scaffold with ledgers, bracing, boarded lifts, ladder and toe boards.
    for(const sx of [-83,-78,-73])for(const sz of [-11,-7]){tube([sx,.2,sz],[sx,7.1,sz],.055,'#6e8380');for(const y of [2,4,6]){beam([sx,y,-11],[sx,y,-7],.045,'#758a87');}}
    for(const sx of [-83,-78])for(const y of [2,4,6]){beam([sx,y,-11],[sx+5,y,-11],.045,'#758a87');beam([sx,y,-7],[sx+5,y,-7],.045,'#758a87');line([sx,y,-11],[sx+5,y+2,-11],'#8b9992',.04);}
    for(const y of [2.08,4.08,6.08])for(let sx=-82.8;sx<-72.8;sx+=.7)box(sx,y,-10.85,.58,.09,3.7,'#b7a075');
    for(let j=0;j<11;j++)box(-83.35,.5+j*.5,-10.65,.52,.07,.18,'#c8d0c5');line([-83.35,.4,-10.6],[-83.35,6,-10.6],'#758985',.05);line([-82.85,.4,-10.6],[-82.85,6,-10.6],'#758985',.05);
    // Dewatering sump, pump, discharge hose, survey control and temporary services.
    cylinder(-36,.05,-47,2.2,.38,'#7d8f88','ground',24);cylinder(-36,.12,-47,1.72,.28,'#516f76','ground',24);box(-39,.25,-45.2,2,1.2,1.2,'#d9a848');cylinder(-38.5,1.45,-44.9,.18,.7,'#4e5d5c');
    tube([-38,.85,-45],[-36,.6,-47],.11,'#365968');tube([-38,.85,-45],[-31,.65,-43],.11,'#365968');tube([-31,.65,-43],[-27,.25,-40],.11,'#365968');
    for(const [sx,sz] of [[-84,-51],[-61,-51],[-35,-51],[-84,-13],[-61,-13],[-35,-13]]){tube([sx,.1,sz],[sx,2.2,sz],.035,'#dbca9b');box(sx-.22,2.05,sz-.05,.44,.24,.1,'#da4d42');line([sx,1.25,sz],[-61,1.25,sz],'#e8d98b',.025);}
    // Material laydown: rebar bundles, shuttering timber, pallets and covered cement bags.
    for(let j=0;j<12;j++)tube([-83,.45+j*.065,-8+j*.035],[-70,.45+j*.065,-8+j*.035],.035,'#725e4e');
    for(const px of [-65,-61,-57]){box(px,.18,-7.8,3,.22,2.1,'#9b7955');for(let y=.42;y<1.7;y+=.28)for(let k=0;k<4;k++)box(px+.15+k*.68,y,-7.55, .55,.18,1.55,'#dfd6b8');}
    box(-51,.15,-7.5,6,.22,2.6,'#977552');for(let i=0;i<9;i++)box(-50.8+i*.62,.4,-7.3,.48,.18,2.1,'#bd9a6d');
    // Mobile light towers, distribution boards, barriers and close-range safety detail.
    for(const [lx,lz] of [[-81,-22],[-58,-48],[-39,-27]]){box(lx-.45,.18,lz-.35,.9,.55,.7,'#d8a944');tube([lx,.7,lz],[lx,5.8,lz],.055,'#858f8a');beam([lx-.55,5.75,lz],[lx+.55,5.75,lz],.07,'#8e9992');for(const dx of [-.45,.45])box(lx+dx-.15,5.55,lz-.12,.3,.34,.24,'#e7dec0');}
    for(let i=0;i<8;i++){const cx=-80+i*5.2,cz=-55;box(cx,.1,cz,.7,.95,.7,'#e0783c');box(cx+.08,.55,cz+.08,.54,.12,.54,'#eee4c9');}
    for(let i=0;i<5;i++)cylinder(-79+i*4,0,-3,3,1.2+(i%3)*.9,'#b8a689','equipment',7);
    excavator(-42,-9);truck(-86,-64,'#ddd5b4');
    // Wet utilities: pump station, treatment chambers and exposed access structures.
    slab(-3,-44,28,34,'#c6d9d2');box(-1,0,-43,12,6,9,'#dce8e4');box(-1.4,6,-43.4,12.8,.4,9.8,'#a4bec1');
    for(const x of [2,16]){cylinder(x,0,-25,4.7,5.6,'#cad9d7');cylinder(x,5.6,-25,4.8,.3,'#e3eddf');cylinder(x,5.9,-25,1,.25,'#859c9e');for(let n=0;n<6;n++)line([x+4.1,n*.8,-24],[x+4.1,n*.8,-26],'#6e8786',.1);}
    for(const x of [0,8,16]){box(x,.2,-13,5,.5,5,'#94a9a6');box(x+.6,.7,-12.4,3.8,.2,3.8,'#546d70');}
    // Substation: switchgear hall, transformer radiators, insulators and cable trenches.
    slab(36,-62,39,36,'#cfd7ce');box(38,0,-60,34,8,9,'#dbe4df');box(37.5,8,-60.5,35,.5,10,'#adbdba');
    for(let i=0;i<6;i++){box(40+i*5,1,-50.9,3.4,4,.16,'#839d9e');box(40.5+i*5,5.5,-50.8,2.4,1,.12,'#587b84');}
    for(const x of [40,58]){
      box(x,0,-45,13,1.2,13,'#bcc9c5');box(x+2,1.2,-43,8,5,8,'#93a8aa');
      for(let i=0;i<8;i++)box(x+1+i*1.25,1.6,-44,.35,4.5,10,'#b5c5c4');
      for(const dx of [3,7]){cylinder(x+dx,6.2,-41,.7,2.2,'#7b8d8d');for(let j=0;j<4;j++)cylinder(x+dx,6.4+j*.5,-41,1,.12,'#ccd5ca');}
    }
    for(let x=37;x<74;x+=3){cylinder(x,0,-27,.16,3.2,'#8a9f9d');line([x,1,-27],[x+3,1,-27],'#839996',.08);line([x,2.4,-27],[x+3,2.4,-27],'#839996',.08);}
    // Voltaic high-voltage yard: protection, switching, buswork, cooling and safety detail.
    {
      const steel='#70878a',dark='#3f565d',ceramic='#d9d8c4',copper='#a86e48',live='#b98235',safety='#d8a742';
      // Compacted substation gravel at close range.
      let subSeed=2817;const subRandom=()=>{subSeed=(subSeed*1664525+1013904223)>>>0;return subSeed/4294967296;};
      for(let n=0;n<220;n++){const x=36.5+subRandom()*37.5,z=-61.5+subRandom()*34.5,r=.035+subRandom()*.11;face([[x,.17,z],[x+r,.17,z-r*.45],[x+r*1.25,.17,z+r*.35],[x-r*.3,.17,z+r]],['#aeb9ad','#c3cabc','#919f98','#d0d4c5'][n%4],'micro',true);}
      // Full perimeter palisade fence, anti-climb strands and double vehicle gate.
      const fencePost=(x,z)=>{box(x-.07,.15,z-.07,.14,3.15,.14,steel,'structures');box(x-.12,3.3,z-.12,.24,.12,.24,dark,'detail');};
      for(let x=36;x<=75;x+=2){fencePost(x,-62);fencePost(x,-26);for(const y of [.8,1.7,2.65]){line([x,y,-62],[Math.min(x+2,75),y,-62],'#879b98',.035,'detail');line([x,y,-26],[Math.min(x+2,75),y,-26],'#879b98',.035,'detail');}}
      for(let z=-60;z<=-28;z+=2){fencePost(36,z);fencePost(75,z);for(const y of [.8,1.7,2.65]){line([36,y,z],[36,y,Math.min(z+2,-26)],'#879b98',.035,'detail');line([75,y,z],[75,y,Math.min(z+2,-26)],'#879b98',.035,'detail');}}
      for(let x=36;x<75;x+=1){line([x,3.35,-62],[x+.5,3.72,-62],'#6b807e',.025,'detail');line([x+.5,3.72,-62],[x+1,3.35,-62],'#6b807e',.025,'detail');}
      for(const gx of [51,56]){box(gx,.15,-25.9,.14,3.2,.14,steel,'structures');beam([gx,3.25,-25.9],[gx+5,3.25,-25.9],.11,steel,'structures');line([gx,.35,-25.88],[gx+5,3.15,-25.88],dark,.055,'detail');line([gx,3.15,-25.88],[gx+5,.35,-25.88],dark,.055,'detail');}
      // Three-phase steel gantries and overhead aluminium busbars.
      for(const x of [39,50,61,72]){for(const dz of [-36,-29]){box(x,0,dz,.28,10,.28,steel,'structures');box(x+3.7,0,dz,.28,10,.28,steel,'structures');beam([x,9.6,dz],[x+4,9.6,dz],.22,steel,'structures');for(const h of [3,6]){beam([x,h,dz],[x+3.8,h+2,dz],.08,dark,'detail');beam([x+3.8,h,dz],[x,h+2,dz],.08,dark,'detail');}}}
      for(const [phase,z,color] of [[0,-29.7,'#9aa9a5'],[1,-31,'#aeb9b1'],[2,-32.3,'#8d9e9b']]){for(let x=40;x<72;x+=4)for(let k=0;k<5;k++)cylinder(x,8.2+k*.27,z,.34,.11,k%2?ceramic:'#aab7ae','equipment',12);tube([40,9.55,z],[72,9.55,z],.095,color,'equipment',12);}
      // SF6 breakers, centre-break disconnectors and current/voltage transformers.
      for(const x of [41,47,53,59,65,71]){
        box(x-.75,.15,-33.2,1.5,.35,2.2,'#aebbb4','equipment');
        for(const dz of [-32.7,-31.9,-31.1]){cylinder(x,.5,dz,.28,2.5,dark,'equipment',12);for(let j=0;j<7;j++)cylinder(x,1.15+j*.27,dz,.48,.09,ceramic,'equipment',12);box(x-.22,3.08,dz-.22,.44,.5,.44,'#7f9290','equipment');}
        box(x-.7,.5,-34.1,1.4,1.25,.9,'#91a4a0','equipment');box(x-.5,.85,-34.56,.35,.25,.06,'#d9ad4e','detail');
        for(const dz of [-29.7,-31,-32.3]){cylinder(x,3.5,dz,.2,1.8,steel,'equipment',10);for(let j=0;j<5;j++)cylinder(x,4+j*.28,dz,.38,.07,ceramic,'equipment',10);beam([x,5.25,dz],[x+1.6,5.75,dz],.075,copper,'equipment');}
      }
      // Transformer accessories: oil conservators, Buchholz pipework, cooling fans and marshalling kiosks.
      for(const x of [40,58]){
        tube([x+2.2,8.15,-39.6],[x+8.2,8.15,-39.6],.72,'#8fa4a4','equipment',20);for(const ex of [x+2.2,x+8.2])cylinder(ex,7.45,-39.6,.72,1.4,'#819899','equipment',16);
        tube([x+4.2,6.2,-40.4],[x+4.2,7.8,-39.8],.16,'#6d8382','equipment',10);box(x+4,6.8,-40.2,.45,.4,.45,'#aa774c','detail');
        for(const side of [-1,1])for(let row=0;row<2;row++)for(let col=0;col<3;col++){const fx=x+2.1+col*2.3,fz=-43+side*4.25,fy=2.25+row*2.15;for(let k=0;k<16;k++){const a=k*Math.PI/8,b=(k+1)*Math.PI/8;line([fx+.72*Math.cos(a),fy+.72*Math.sin(a),fz],[fx+.72*Math.cos(b),fy+.72*Math.sin(b),fz],dark,.07,'detail');}for(let k=0;k<8;k++){const a=k*Math.PI/4;line([fx,fy,fz],[fx+.61*Math.cos(a),fy+.61*Math.sin(a),fz],steel,.035,'micro');}}
        box(x+9.5,.4,-46.2,1.5,2.3,1,'#a9b8b2','equipment');box(x+9.7,1,-46.73,.35,.5,.05,'#304d58','detail');box(x+10.2,1,-46.73,.35,.5,.05,'#304d58','detail');
        for(const bx of [x+1.5,x+8.5])for(const bz of [-48.5,-34.5]){cylinder(bx,.25,bz,.18,1.5,safety,'equipment',8);box(bx-.25,1.55,bz-.1,.5,.55,.2,'#c95046','detail');}
        // Oil bund wall, sump and flame separation.
        for(const bz of [-49,-33])box(x-.7,.15,bz,14.4,.75,.35,'#c9cec4','structures');for(const bx of [x-.7,x+13.35])box(bx,.15,-49,.35,.75,16.35,'#c9cec4','structures');
        box(x+11.8,.18,-47.5,1,.2,1,'#4f6669','detail');for(let k=0;k<5;k++)line([x+11.9+k*.18,.4,-47.45],[x+11.9+k*.18,.4,-46.55],'#8da09a',.035,'micro');
      }
      box(55.2,.15,-49.4,.42,7.5,16.8,'#d2d5ca','structures');for(let z=-48;z<-34;z+=2)box(55.05,1,z,.72,.18,.65,'#b7bcb2','detail');
      // Switchgear hall doors, relay panels, roof HVAC, gutters, lighting and cable entries.
      for(let x=39.2;x<71;x+=2.05){box(x,.9,-60.08,1.55,5.6,.13,'#80989a','equipment');line([x+.78,1,-60.16],[x+.78,6.35,-60.16],dark,.035,'detail');box(x+1.22,3.45,-60.18,.1,.18,.08,'#d0ac52','detail');for(let y=1.5;y<6;y+=.65)line([x+.15,y,-60.2],[x+1.4,y,-60.2],'#b8c5bd',.025,'micro');}
      for(let x=40;x<71;x+=5){box(x,8.5,-58.8,3.1,1.35,2.1,'#9eb0aa','equipment');for(let k=0;k<6;k++)line([x+.25+k*.45,9.88,-58.6],[x+.25+k*.45,9.88,-57.1],dark,.045,'detail');tube([x+1.55,9.85,-57.8],[x+1.55,11.2,-57.8],.16,'#788e8b','equipment',10);}
      for(let x=38;x<72;x+=2){box(x,.2,-50.65,1.8,.18,.9,'#778c89','structures');for(let k=0;k<7;k++)line([x+.12+k*.23,.4,-50.6],[x+.12+k*.23,.4,-49.8],'#c0c8bd',.025,'micro');}
      // Buried earthing grid risers, earth pits and cable identification posts.
      for(let x=38;x<74;x+=4)line([x,.21,-60],[x,.21,-27],copper,.035,'utilities',true);for(let z=-58;z<-27;z+=4)line([37,.22,z],[74,.22,z],copper,.035,'utilities',true);
      for(const [x,z] of [[38,-28],[73,-28],[38,-60],[73,-60]]){cylinder(x,.18,z,.65,.14,'#5f7473','utilities',16);cylinder(x,.32,z,.52,.06,'#c7b984','utilities',16);}
      for(let z=-47;z<-34;z+=2.6){box(72.6,.2,z,.18,1.3,.18,'#d6a63f','detail');box(72.35,1.45,z-.1,.7,.45,.2,'#f0df8a','detail');}
      // Yard lighting, CCTV, fire points and safety bollards.
      for(const [x,z] of [[38,-59],[73,-59],[38,-28],[73,-28]]){cylinder(x,.2,z,.12,7.5,steel,'equipment',8);beam([x,7.7,z],[x+1,7.7,z],.12,steel,'equipment');box(x+.75,7.55,z-.25,.65,.28,.5,'#e6e1b9','equipment');box(x-.3,6.9,z-.25,.5,.35,.5,'#3e5862','detail');}
      for(const [x,z] of [[37.3,-48],[37.3,-40],[73.5,-48],[73.5,-40]]){cylinder(x,.15,z,.18,1.1,safety,'equipment',8);box(x-.32,1.2,z-.18,.64,.9,.36,'#c74942','equipment');tube([x,2.05,z],[x+.42,2.35,z],.06,dark,'detail');}
    }
    // Utilities are drawn above grade as a coordination overlay, with chamber details.
    const routes=[{p:[[7,-37],[7,-2],[-67,-2],[-67,33],[5,33]],c:'#2196bf'}, {p:[[57,-36],[57,-18],[71,-18],[71,27],[28,27]],c:'#d99d30'}, {p:[[19,-20],[19,-6],[-39,-6],[-39,35]],c:'#47a377'}, {p:[[43,-43],[43,-10],[32,-10],[32,36]],c:'#a882c0'}];
    // Pipe-rack centreline provides more than 5.5 m clear height over access roads.
    const pipeHeight=6.4;
    routes.forEach(r=>r.p.forEach(([x,z])=>{cylinder(x,.05,z,1.3,.6,'#799697','utilities');cylinder(x,.65,z,1,.15,r.c,'utilities');tube([x,.75,z],[x,pipeHeight,z],.38,r.c,'utilities',14);}));
    // Round service pipes, flanged joints, supports and valve handwheels.
    routes.forEach(r=>r.p.slice(1).forEach((p,i)=>{
      const a=r.p[i],len=Math.hypot(p[0]-a[0],p[1]-a[1]),dx=(p[0]-a[0])/len,dz=(p[1]-a[1])/len;
      for(let t=0;t<len;t+=1){const end=Math.min(len,t+1);tube([a[0]+dx*t,pipeHeight,a[1]+dz*t],[a[0]+dx*end,pipeHeight,a[1]+dz*end],.38,r.c,'utilities',14);}
      line([a[0]+.65,.08,a[1]+.65],[p[0]+.65,.08,p[1]+.65],'#b3b9ac',.65,'utilities',true);
      for(let t=3;t<len;t+=8){const x=a[0]+dx*t,z=a[1]+dz*t;
        tube([x-dx*.12,pipeHeight,z-dz*.12],[x+dx*.12,pipeHeight,z+dz*.12],.51,'#a5b4af','utilities');
        const px=-dz,pz=dx,postOffset=2.8;
        for(const side of [-1,1]){
          const sx=x+px*postOffset*side,sz=z+pz*postOffset*side;
          box(sx-.4,.05,sz-.4,.8,.22,.8,'#bdc7bc','utilities');
          box(sx-.17,.27,sz-.17,.34,pipeHeight-.75,.34,'#617b80','utilities');
          for(const bx of [-.29,.29])for(const bz of [-.29,.29])cylinder(sx+bx,.27,sz+bz,.042,.055,'#53686a','micro',6);
          tube([sx,1.05,sz],[x+px*(postOffset-.7)*side,pipeHeight-.55,z+pz*(postOffset-.7)*side],.075,'#71888a','detail',8);
          box(sx-.28,pipeHeight-.48,sz-.28,.56,.24,.56,'#80928e','utilities');
        }
        beam([x+px*(postOffset+.2),pipeHeight-.48,z+pz*(postOffset+.2)],[x-px*(postOffset+.2),pipeHeight-.48,z-pz*(postOffset+.2)],.18,'#8b9d98','utilities');
        box(x-.28,pipeHeight-.34,z-.28,.56,.18,.56,'#aab6ae','utilities');
        for(let j=0;j<6;j++){const angle=j*Math.PI/3;const bx=x-dz*Math.cos(angle)*.44,bz=z+dx*Math.cos(angle)*.44;box(bx-.035,pipeHeight+Math.sin(angle)*.44,bz-.035,.07,.07,.07,'#526a70','utilities');}
      }
      if(len>14){const x=a[0]+dx*7,z=a[1]+dz*7;cylinder(x,pipeHeight,z,.12,1.05,'#728887','utilities');
        for(let j=0;j<12;j++){const a1=j*Math.PI/6,a2=(j+1)*Math.PI/6;line([x+.55*Math.cos(a1),pipeHeight+1.05,z+.55*Math.sin(a1)],[x+.55*Math.cos(a2),pipeHeight+1.05,z+.55*Math.sin(a2)],r.c,.10,'utilities');}line([x-.55,pipeHeight+1.05,z],[x+.55,pipeHeight+1.05,z],r.c,.09,'utilities');
      }
    }));
    // Close-range pipe fabrication: welded spools, flanges, anchors, valves and instruments.
    routes.forEach((r,routeIndex)=>r.p.slice(1).forEach((p,i)=>{
      const a=r.p[i],len=Math.hypot(p[0]-a[0],p[1]-a[1]),dx=(p[0]-a[0])/len,dz=(p[1]-a[1])/len,px=-dz,pz=dx;
      // Weld beads divide the network into believable fabricated spools.
      for(let t=1.75;t<len;t+=3.5){
        const x=a[0]+dx*t,z=a[1]+dz*t;
        tube([x-dx*.032,pipeHeight,z-dz*.032],[x+dx*.032,pipeHeight,z+dz*.032],.405,'#50666b','detail',18);
        for(let k=0;k<8;k++){
          const q=k*Math.PI/4;
          box(x+px*Math.cos(q)*.39-.018,pipeHeight+Math.sin(q)*.39-.018,z+pz*Math.cos(q)*.39-.018,.036,.036,.036,'#9caaa5','micro');
        }
      }
      // Bolted flange pairs, gaskets and identification bands.
      for(let t=6;t<len;t+=12){
        const x=a[0]+dx*t,z=a[1]+dz*t;
        for(const offset of [-.14,.14])tube([x+dx*(offset-.04),pipeHeight,z+dz*(offset-.04)],[x+dx*(offset+.04),pipeHeight,z+dz*(offset+.04)],.54,'#829590','utilities',20);
        tube([x-dx*.025,pipeHeight,z-dz*.025],[x+dx*.025,pipeHeight,z+dz*.025],.48,'#263f48','detail',18);
        for(let k=0;k<10;k++){
          const q=k*Math.PI/5,ox=px*Math.cos(q)*.45,oy=Math.sin(q)*.45,oz=pz*Math.cos(q)*.45;
          tube([x-dx*.2+ox,pipeHeight+oy,z-dz*.2+oz],[x+dx*.2+ox,pipeHeight+oy,z+dz*.2+oz],.026,'#d1d2c2','micro',6);
        }
        for(const band of [-.42,-.32])tube([x+dx*(band-.025),pipeHeight,z+dz*(band-.025)],[x+dx*(band+.025),pipeHeight,z+dz*(band+.025)],.41,'#eef0df','detail',16);
      }
      // One maintainable isolation valve per long run, with gearbox, stem and handwheel.
      if(len>18){
        const t=Math.min(10,len*.55),x=a[0]+dx*t,z=a[1]+dz*t;
        tube([x-dx*.42,pipeHeight,z-dz*.42],[x+dx*.42,pipeHeight,z+dz*.42],.62,'#596f72','utilities',22);
        cylinder(x,pipeHeight+.38,z,.26,.58,'#6f8584','utilities',16);
        box(x-.34,pipeHeight+.96,z-.34,.68,.42,.68,'#50696d','utilities');
        cylinder(x,pipeHeight+1.38,z,.075,.52,'#506568','utilities',10);
        for(let k=0;k<16;k++){
          const q=k*Math.PI/8,n=(k+1)*Math.PI/8;
          line([x+.55*Math.cos(q),pipeHeight+1.9,z+.55*Math.sin(q)],[x+.55*Math.cos(n),pipeHeight+1.9,z+.55*Math.sin(n)],r.c,.075,'utilities');
        }
        for(let k=0;k<4;k++){const q=k*Math.PI/2;line([x,pipeHeight+1.9,z],[x+.55*Math.cos(q),pipeHeight+1.9,z+.55*Math.sin(q)],r.c,.055,'detail');}
        cylinder(x,pipeHeight+1.88,z,.13,.08,'#c9cfbf','detail',12);
        // Drain and vent branches connect visibly to the main body.
        tube([x+px*.18,pipeHeight+.26,z+pz*.18],[x+px*.18,1.65,z+pz*.18],.075,'#667c7d','detail',10);
        tube([x-px*.16,pipeHeight+.3,z-pz*.16],[x-px*.16,pipeHeight+1.02,z-pz*.16],.065,'#728888','detail',10);
        cylinder(x-px*.16,pipeHeight+1.03,z-pz*.16,.13,.09,'#d5b55c','detail',12);
      }
      // Pressure and temperature take-offs alternate by service line.
      if(len>11){
        const t=Math.min(len-2,routeIndex%2?4.5:8.5),x=a[0]+dx*t,z=a[1]+dz*t;
        tube([x,pipeHeight+.28,z],[x,pipeHeight+1.12,z],.055,'#526a70','detail',8);
        box(x-.22,pipeHeight+1.1,z-.09,.44,.44,.18,'#e5e7d9','detail');
        for(let k=0;k<10;k++){const q=k*Math.PI/5,n=(k+1)*Math.PI/5;line([x+.18*Math.cos(q),pipeHeight+1.32+.18*Math.sin(q),z-.1],[x+.18*Math.cos(n),pipeHeight+1.32+.18*Math.sin(n),z-.1],'#3d5960',.035,'micro');}
        line([x,pipeHeight+1.32,z-.11],[x+.1,pipeHeight+1.42,z-.11],'#b84a42',.04,'micro');
      }
    }));
    // Elbow reinforcement, branch collars and numbered junction hardware at every change of direction.
    routes.forEach((r,routeIndex)=>r.p.forEach(([x,z],i)=>{
      if(i===0||i===r.p.length-1)return;
      const prev=r.p[i-1],next=r.p[i+1],inLen=Math.hypot(x-prev[0],z-prev[1]),outLen=Math.hypot(next[0]-x,next[1]-z);
      const ix=(x-prev[0])/inLen,iz=(z-prev[1])/inLen,ox=(next[0]-x)/outLen,oz=(next[1]-z)/outLen;
      for(const offset of [-.42,-.24,.24,.42]){
        tube([x+ix*offset,pipeHeight,z+iz*offset],[x+ix*(offset+.06),pipeHeight,z+iz*(offset+.06)],.45,'#829692','utilities',18);
        tube([x+ox*offset,pipeHeight,z+oz*offset],[x+ox*(offset+.06),pipeHeight,z+oz*(offset+.06)],.45,'#829692','utilities',18);
      }
      cylinder(x,pipeHeight-.05,z,.46,.1,'#657c7e','utilities',18);
      cylinder(x,pipeHeight+.05,z,.31,.25,r.c,'utilities',16);
      for(let k=0;k<8;k++){const q=k*Math.PI/4;cylinder(x+.36*Math.cos(q),pipeHeight+.16,z+.36*Math.sin(q),.035,.055,'#d1d1bf','micro',6);}
      // Compact service marker mounted beside the junction, visible only at close zoom.
      const mx=x+.85,mz=z+.85;
      tube([mx,.15,mz],[mx,1.35,mz],.035,'#526a70','detail',8);
      box(mx-.28,1.35,mz-.05,.56,.42,.1,routeIndex%2?'#e2c05b':'#e7e7d8','detail');
      for(let k=0;k<routeIndex+2;k++)line([mx-.2+k*.1,1.48,mz-.06],[mx-.2+k*.1,1.68,mz-.06],'#4b6268',.022,'micro');
    }));
    // Tank access ladders, shell seams, roof hatches, vents and inlet fittings.
    for(const x of [2,16]){
      for(const y of [1.5,3,4.5])for(let j=0;j<32;j++){const a=j*Math.PI/16,b=(j+1)*Math.PI/16;line([x+4.73*Math.cos(a),y,-25+4.73*Math.sin(a)],[x+4.73*Math.cos(b),y,-25+4.73*Math.sin(b)],'#93aaa7',.065);}
      for(const dz of [-.45,.45])tube([x+4.8,.3,-25+dz],[x+4.8,6.7,-25+dz],.07,'#7c9390','structures',8);
      for(let y=.5;y<6.6;y+=.4)tube([x+4.84,y,-25-.45],[x+4.84,y,-25+.45],.055,'#a3b8b1','structures',8);
      cylinder(x-1.7,5.9,-25,.75,.2,'#748f92');cylinder(x-1.7,6.1,-25,.68,.08,'#b7c6bd');
      cylinder(x+1.5,5.9,-26.5,.18,.8,'#92a6a3');cylinder(x+1.5,6.7,-26.5,.4,.1,'#b6c7bd');
      tube([x,1.3,-29.6],[x,1.3,-32.5],.42,'#568f9f','utilities');
    }
    // Landscaping plots, curving planting bands, paths and perimeter trees.
    slab(-88,39,50,29,'#b5cba5');slab(-87,51,48,2,'#e2dbbe');slab(-65,39,2,29,'#e2dbbe');
    for(let x=-84;x<-40;x+=7)for(const z of [44,60])tree(x,z,.7+(x%3+3)*.035);
    for(let z=-66;z<71;z+=12){tree(-93,z,.75);tree(79,z,.68);}
    for(let i=0;i<15;i++)cylinder(-34+i*6,0,69,1.7,.75,'#91b08c','landscape',7);
    // Logistics compound: containers, material stacks, plant, paving robot, offices.
    slab(34,37,40,29,'#c7cbbd');
    for(let i=0;i<4;i++){
      const x=36+i*9;box(x,0,57,7,3.8,7,['#829faa','#bcac8e','#97afa7','#9caab0'][i],'equipment');
      for(let j=1;j<7;j++)line([x+j,.5,64.04],[x+j,3.5,64.04],'#d1d9d4',.07,'equipment');
      slab(x,39,7,15,'#b3bab1');line([x,.2,39],[x,.2,54],'#e7eadb',.12,'ground',true);
    }
    truck(37,41);truck(47,41,'#89a99e');truck(65,41,'#e3b861');
    // RoboPave machine: open feed hopper, tracked chassis and articulated finishing screed.
    {
      const steel='#47616b',blue='#628f9d',light='#8aafb6',rubber='#263c45';
      box(56.05,.85,43,4.8,.48,6.65,steel,'equipment');
      // Closed track loops with rounded ends, separate shoes, rollers and bolted final drives.
      for(const tx of [55.55,60.5]){
        const loop=[];
        for(let i=0;i<=12;i++){const a=-Math.PI/2+i*Math.PI/12;loop.push([.76+.65*Math.sin(a),48.05+.65*Math.cos(a)]);}
        for(let i=0;i<=12;i++){const a=Math.PI/2+i*Math.PI/12;loop.push([.76+.65*Math.sin(a),43.85+.65*Math.cos(a)]);}
        for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];face([[tx,a[0],a[1]],[tx+.75,a[0],a[1]],[tx+.75,b[0],b[1]],[tx,b[0],b[1]]],rubber,'equipment');}
        for(let zz=43.65;zz<=48.2;zz+=.28)for(const y of [.13,1.38]){box(tx-.035,y,zz,.82,.08,.21,'#7c8b88','equipment');for(const dx of [.15,.58])box(tx+dx,y+.08,zz+.05,.06,.035,.06,'#b2b9ab','micro');}
        for(const zz of [43.85,44.65,45.5,46.35,47.2,48.05]){
          tube([tx-.015,.76,zz],[tx+.765,.76,zz],.43,steel,'equipment',16);
          for(const end of [tx-.025,tx+.775]){tube([end-.01,.76,zz],[end+.01,.76,zz],.23,'#94a59f','equipment',12);for(let j=0;j<6;j++){const a=j*Math.PI/3;box(end-.02,.76+.16*Math.cos(a),zz+.16*Math.sin(a),.04,.045,.045,'#d7d8c6','micro');}}
        }
        beam([tx+.37,1.05,44],[tx+.37,1.05,47.9],.18,steel,'equipment');
      }
      // Split hopper with inward-sloping plates and exposed dual slat conveyors.
      for(const side of [-1,1]){
        const outer=58.45+side*2.55,inner=58.45+side*.65;
        face([[outer,2.35,40.5],[outer,2.35,43.65],[inner,1.3,43.65],[inner,1.3,41]],blue,'equipment');
        face([[outer,2.35,40.5],[inner,1.3,41],[58.45,1.3,41],[58.45,2.2,40.5]],light,'equipment');
        beam([outer,2.37,40.5],[outer,2.37,43.65],.1,'#aac0ba','equipment');
        tube([outer-side*.15,1.05,43.1],[outer-side*.65,2.15,42.3],.09,steel,'equipment',10);
        tube([outer-side*.65,2.15,42.3],[outer-side*.85,2.42,42.05],.05,'#d6ded4','equipment',10);
        for(let zz=41;zz<43.6;zz+=.65)beam([outer,2.32,zz],[inner,1.34,zz],.055,'#345965','equipment');
      }
      box(57.78,1.27,41.05,1.35,.09,4.2,rubber,'equipment');
      for(let zz=41.1;zz<45;zz+=.22){box(57.82,1.36,zz,1.26,.075,.11,'#8c9a94','equipment');box(58.4,1.43,zz,.08,.035,.11,steel,'micro');}
      for(const tx of [56.55,59.55])tube([tx,1.22,40.33],[tx+.75,1.22,40.33],.24,rubber,'equipment',16);
      // Shaped engine enclosure with recessed access panels, louvers and fan grille.
      box(56.65,1.34,44,3.6,1.65,3.9,blue,'equipment');
      face([[56.65,2.99,44],[60.25,2.99,44],[59.9,3.38,44.45],[57,3.38,44.45]],light,'equipment');
      box(57,2.99,44.45,2.9,.38,3.12,'#d3ded4','equipment');
      for(const tx of [56.61,60.27]){
        for(const zz of [44.35,45.75,47.05]){box(tx,1.68,zz,.045,.95,1.06,'#3b6271','equipment');box(tx,2.35,zz+.72,.07,.08,.2,'#bbc7bb','detail');for(let j=0;j<5;j++)line([tx,1.82+j*.14,zz+.1],[tx,1.82+j*.14,zz+.92],'#9cb4b1',.035,'detail');}
        for(let y=1.65;y<2.65;y+=.35)box(tx-.15,y,47.3,.42,.08,.7,'#718985','equipment');
      }
      cylinder(58.45,3.38,46.35,.69,.08,rubber,'equipment',24);
      for(let j=0;j<16;j++){const a=j*Math.PI/8;line([58.45,3.48,46.35],[58.45+.61*Math.cos(a),3.48,46.35+.61*Math.sin(a)],'#a6bab2',.025,'detail');}
      tube([59.65,3.35,47.1],[59.65,4.25,47.1],.1,steel,'equipment',12);cylinder(59.65,4.25,47.1,.16,.08,'#253c44','equipment',12);
      // Rear service platform, emergency controls and tubular guardrails.
      box(56.2,1.4,47.95,4.5,.12,1.35,'#738b88','equipment');
      for(let tx=56.35;tx<60.6;tx+=.22)line([tx,1.54,48.02],[tx,1.54,49.2],'#bac9be',.025,'detail');
      for(const tx of [56.2,60.7]){tube([tx,1.5,48.15],[tx,2.55,48.15],.055,steel,'equipment',8);tube([tx,1.5,49.2],[tx,2.55,49.2],.055,steel,'equipment',8);tube([tx,2.55,48.15],[tx,2.55,49.2],.055,steel,'equipment',8);box(tx-.18,2.15,48.4,.36,.4,.3,light,'equipment');box(tx-.12,2.3,48.36,.18,.13,.045,'#253e4a','detail');box(tx+.09,2.2,48.35,.07,.07,.05,'#c84b37','detail');}
      // Auger, tow arms, hydraulic extension cylinders and three-part screed.
      tube([55.65,.85,49.85],[61.25,.85,49.85],.13,steel,'equipment',12);
      for(let tx=55.75;tx<61.15;tx+=.2){const a=(tx-55.75)*Math.PI*3;line([tx,.85+.32*Math.cos(a),49.85+.32*Math.sin(a)],[tx+.2,.85+.32*Math.cos(a+1.88),49.85+.32*Math.sin(a+1.88)],'#a0aaa0',.09,'equipment');}
      for(const tx of [56.35,60.5]){beam([tx,1.3,45.6],[tx,.7,50.3],.19,steel,'equipment');tube([tx,2.05,47.8],[tx,1.2,49.3],.1,steel,'equipment',10);tube([tx,1.2,49.3],[tx,.72,50.15],.055,'#ccd5cf','equipment',10);for(let j=0;j<3;j++)line([tx+j*.07,2,47.6],[tx+j*.07,.9,49.7],rubber,.035,'detail');}
      for(const [tx,w] of [[54.95,1.35],[56.3,4.3],[60.6,1.35]]){box(tx,.22,50.35,w,.18,1.25,'#495e62','equipment');box(tx,.4,50.65,w,.55,.55,blue,'equipment');for(let k=0;k<w;k+=.25)line([tx+k,.98,50.67],[tx+k,.98,51.15],'#b3c0b5',.025,'detail');box(tx,.22,51.52,w,.075,.13,'#c5c6b1','equipment');}
      for(const tx of [54.91,61.98]){box(tx,.15,50.15,.08,1.05,1.5,'#748a85','equipment');tube([tx,.9,50.8],[tx,1.6,50.8],.035,steel,'equipment',8);}
      // GNSS receivers, lidar, cameras, work lights and amber beacons.
      for(const tx of [56.8,60.1]){tube([tx,2.75,45],[tx,4.65,45],.065,steel,'equipment',10);cylinder(tx,4.65,45,.2,.11,'#dce0ce','equipment',16);box(tx-.12,3.7,44.83,.24,.25,.2,rubber,'equipment');box(tx-.16,2.83,43.87,.32,.22,.14,'#eee7c7','equipment');}
      cylinder(58.45,3.4,45,.22,.18,steel,'equipment',16);cylinder(58.45,3.58,45,.25,.2,'#76a9b9','equipment',16);
      cylinder(57.25,3.37,47.1,.11,.18,'#e2a443','equipment',12);
    }
    box(-3,0,48,14,5,15,'#dbe2d6');box(-3.4,5,47.6,14.8,.35,15.8,'#a3b5ae');for(let i=0;i<4;i++)box(-1+i*3,1.9,47.85,2,1.5,.18,'#658791');
    for(let i=0;i<4;i++)for(let j=0;j<3;j++)box(37+i*3.3,.1+j*.65,31,2.5,.5,3.4,'#d4c5a4','equipment');
    // Road surfacing works, kerb bundles and cones.
    slab(-51,21,58,13,'#c6bca4');for(let i=0;i<7;i++)box(-50+i*7,.1,23,4,.6,2,'#d6d5c7','equipment');
    for(let x=-38;x<40;x+=8){cylinder(x,0,20,.45,.2,'#6c7470','equipment',6);cylinder(x,.2,20,.25,.75,'#de854e','equipment',6);}
    truck(-18,24,'#d6af58');excavator(0,30);
    // Tower crane: mast, bracing, jib, cab, counterweight and hanging hook.
    const cx=1,cz=41;box(cx-2,0,cz-2,4,1,4,'#b6bfb6','equipment');
    for(const dx of [-.7,.7])for(const dz of [-.7,.7])box(cx+dx,1,cz+dz,.22,30,.22,'#ccaa60','equipment');
    for(let y=1;y<29;y+=3){for(const dz of [-.7,.7]){beam([cx-.7,y,cz+dz],[cx+.7,y+3,cz+dz],.1,'#c4a15d');beam([cx+.7,y,cz+dz],[cx-.7,y+3,cz+dz],.1,'#c4a15d');}}
    beam([cx-10,29,cz],[cx+27,29,cz],.8,'#e1be74');beam([cx-10,31,cz],[cx+27,31,cz],.25,'#e1be74');
    for(let x=-10;x<27;x+=3)beam([cx+x,29,cz],[cx+x+3,31,cz],.12,'#d6b267');
    box(cx-10,27,cz-1,4,2,2,'#8e9c98','equipment');box(cx+.4,27,cz-1.3,2,2,2.6,'#e8c87f','equipment');line([cx+22,29,cz],[cx+22,8,cz],'#697773',.12,'equipment');box(cx+21.5,7,cz-.5,1,1,1,'#657972','equipment');
    // Crane mast ladder, platforms, suspension ropes and a multi-part hook block.
    for(let y=2;y<28;y+=.6)tube([cx-.45,y,cz-.85],[cx+.45,y,cz-.85],.04,'#7f8067');
    for(const y of [10,20,27]){box(cx-1.3,y,cz-1.3,2.6,.12,2.6,'#b39b64','equipment');for(const dx of [-1.3,1.3])tube([cx+dx,y,cz-1.3],[cx+dx,y+1,cz-1.3],.06,'#cbb170');}
    for(const dz of [-.35,.35]){line([cx,34,cz+dz],[cx+25,31,cz+dz],'#657679',.07,'equipment');line([cx,34,cz+dz],[cx-9,31,cz+dz],'#657679',.07,'equipment');line([cx+21.7,29,cz+dz],[cx+21.7,8,cz+dz],'#42575f',.06,'equipment');}
    tube([cx,30,cz],[cx,34,cz],.12,'#d8b777');box(cx+20.8,28,cz-.7,2.2,.6,1.4,'#728986','equipment');
    tube([cx+21.5,7.3,cz-.6],[cx+21.5,7.3,cz+.6],.5,'#d9ae5c');
    for(let j=0;j<7;j++){const a=j*Math.PI/6,b=(j+1)*Math.PI/6;line([cx+21.5+Math.cos(a)*.45,6.8-Math.sin(a)*.65,cz],[cx+21.5+Math.cos(b)*.45,6.8-Math.sin(b)*.65,cz],'#405963',.18,'equipment');}
    // Lighting masts, solar cabinets and security fence.
    for(let x=-80;x<77;x+=20){cylinder(x,0,1,.16,8,'#829c9b','equipment',6);beam([x,8,1],[x,8,3.4],.18,'#849c9b');box(x-.3,7.8,3, .6,.3,1,'#dae8d7','equipment');}
    for(let x=44;x<73;x+=8){box(x,0,-8,2,1,2,'#b6c9bf');cylinder(x+1,1,-7,.18,5.5,'#90a7a3','equipment',6);box(x+.3,6.5,-7.5,1.4,.2,1,'#487c97','equipment');}
    for(let x=-91;x<77;x+=7){cylinder(x,0,-67,.12,2.3,'#879d93','structures',5);line([x,1,-67],[x+7,1,-67],'#a2b1a5',.06);line([x,2.1,-67],[x+7,2.1,-67],'#a2b1a5',.06);}
    // Drone and survey targets at height.
    box(-19,20,-52,2,.5,2,'#6e8992','equipment');for(const x of [-20,-16])for(const z of [-53,-49]){beam([-18,20.2,-51],[x,20.2,z],.12,'#627c88');cylinder(x,20.3,z,1.05,.08,'#adc2c4','equipment',8);}
    // Close-up construction detail, located inside the corresponding contractor zones.
    for(let x=-81;x<-35;x+=15)for(let z=-47;z<-13;z+=16){
      for(let k=0;k<8;k++){line([x+k,1.15,z],[x+k,1.15,z+9],'#747f79',.08);line([x,1.16,z+k],[x+9,1.16,z+k],'#747f79',.08);}
      for(const dx of [0,9])for(const dz of [0,10])cylinder(x+dx,1.1,z+dz,.09,1.3,'#6e7873','structures',5);
      box(x-.3,.1,z-.3,.25,1,10.5,'#a58963');
    }
    for(let x=-84;x<-32;x+=4){box(x,0,-55,.14,1.4,.14,'#c68b61');box(x-.3,1.4,-55.1,.75,.12,.3,'#efdfaa');}
    for(const x of [2,16]){
      for(let n=0;n<12;n++){const a=n*Math.PI/6,b=(n+1)*Math.PI/6;line([x+4.6*Math.cos(a),6,-25+4.6*Math.sin(a)],[x+4.6*Math.cos(a),7,-25+4.6*Math.sin(a)],'#728e8b',.1);line([x+4.6*Math.cos(a),7,-25+4.6*Math.sin(a)],[x+4.6*Math.cos(b),7,-25+4.6*Math.sin(b)],'#728e8b',.1);}
      beam([x,2,-25],[x,2,-32],.45,'#358eaa','utilities');box(x-.6,2,-30,1.2,.5,1,'#567f87','utilities');
    }
    for(let x=39;x<72;x+=3){box(x,8.5,-58,1.6,.7,2.6,'#819995');for(let n=0;n<4;n++)line([x,9.23,-58+n*.6],[x+1.6,9.23,-58+n*.6],'#506f74',.08);}
    for(let z=-48;z<-28;z+=2){box(73,.1,z,1.4,.25,1.7,'#a3aea4');for(let n=0;n<4;n++)line([73,.38,z+n*.4],[74.4,.38,z+n*.4],'#667975',.08);}
    for(let x=-48;x<5;x+=2)for(let z=26;z<33;z+=1.8)cylinder(x,.06,z,.18+(Math.abs(x)%3)*.06,.13,'#b0a38b','structures',5);
    // Roller has twin drums; paver has tracks, hopper, screed and sensor mast.
    // Articulated tandem roller: machined drums, yokes, glazed cab and engine hood.
    for(const z of [27.8,31.6]){
      tube([-29.1,.73,z],[-26.65,.73,z],.72,'#889597','equipment',32);
      for(const x of [-29.14,-26.63]){tube([x-.025,.73,z],[x+.025,.73,z],.35,'#576f77');for(let j=0;j<8;j++){const a=j*Math.PI/4;box(x-.04,.73+.25*Math.cos(a),z+.25*Math.sin(a),.08,.065,.065,'#c4ccbe','equipment');}}
      for(const x of [-29.3,-26.55]){beam([x,.74,z],[x,1.55,z+.65],.16,'#bd954f');box(x-.1,1.45,z-.65,.2,.18,1.6,'#d6b665','equipment');}
      line([-29.1,1.45,z],[-26.65,1.45,z],'#536b74',.06,'equipment');
    }
    box(-28.9,1.45,28.1,2.25,.45,3.4,'#c4a051','equipment');cylinder(-27.8,1.1,29.7,.25,.5,'#647778','equipment');
    box(-28.75,1.9,30.2,1.95,.65,1.4,'#d1ac56','equipment');
    for(let j=0;j<7;j++)box(-28.6+j*.24,2.1,31.61,.11,.3,.03,'#50656b','equipment');
    box(-28.5,1.95,28.3,1.5,.25,1.7,'#546c70','equipment');
    for(const x of [-28.5,-27])for(const z of [28.3,30])box(x,2.15,z,.065,1.55,.065,'#415d67','equipment');
    face([[-28.43,2.2,28.32],[-27.07,2.2,28.32],[-27.07,3.64,28.52],[-28.43,3.64,28.52]],'#779ea9','equipment');
    for(const x of [-28.48,-27.01])face([[x,2.2,28.38],[x,3.65,28.56],[x,3.65,29.94],[x,2.2,29.94]],'#638996','equipment');
    box(-28.63,3.73,28.3,1.85,.13,1.85,'#d9bd71','equipment');box(-28.05,2.25,29.3,.55,.5,.5,'#314c59','equipment');
    tube([-27.8,2.25,28.75],[-27.8,2.9,28.6],.055,'#47606b');cylinder(-27.8,3.86,29.2,.11,.18,'#d49842','equipment');
    for(const x of [-29,-26.8]){tube([x,1.8,29],[x,2.8,29],.035,'#3f5b66');box(x-.12,1.6,29.3,.35,.1,.5,'#82958c','equipment');}
    for(let x=-82;x<-43;x+=6)for(let z=56;z<64;z+=3){box(x,.1,z,2,.35,1.5,'#8d7c59','landscape');cylinder(x+1,.45,z+.75,.65,.65,'#689071','landscape',6);}
    for(let x=-85;x<-40;x+=8){beam([x,.18,40],[x,.18,66],.12,'#597e7c','utilities');box(x,0,53,2,.8,.6,'#acbaa6','landscape');}
    for(let x=44;x<73;x+=8){box(x-1,.05,-9,4,.15,4,'#cbd4c8');for(const dx of [.5,1.5])for(const dz of [-7.5,-6.5])cylinder(x+dx,1.02,dz,.08,.25,'#4d6668','structures',5);}
    for(let z=-61;z<65;z+=6){box(75.5,.2,z,.25,1,.25,'#91a49b');line([75.5,1.2,z],[75.5,1.2,z+6],'#8da198',.1);}
    const zones=[[-86,-53,54,44,'#679990'],[-3,-44,28,34,'#3a9db1'],[36,-62,39,36,'#c78585'],[-51,21,58,13,'#bd9c68'],[34,37,40,29,'#7896b3'],[-88,39,50,29,'#79a06e'],[42,-10,32,9,'#a18eb7']];
    zones.forEach(([x,z,w,d,c])=>{const p=[[x,.3,z],[x+w,.3,z],[x+w,.3,z+d],[x,.3,z+d]];p.forEach((v,i)=>line(v,p[(i+1)%4],c,.45,'zones'));});
    // Close-range asphalt aggregate, joints, drainage and construction fittings.
    let noiseSeed=7193;
    const random=()=>{noiseSeed=(noiseSeed*1664525+1013904223)>>>0;return noiseSeed/4294967296;};
    for(const [x,z,w,d] of [[-97,5,174,12],[-23,-65,11,69],[17,18,11,58]]){
      for(let n=0;n<w*d*1.5;n++){
        const px=x+random()*w,pz=z+random()*d,r=.03+random()*.10;
        face([[px,.18,pz],[px+r,.18,pz-r*.5],[px+r*1.3,.18,pz+r],[px-r*.5,.18,pz+r*.6]],['#637073','#707a7b','#4e5c60','#7b8381'][Math.floor(random()*4)],'micro',true);
      }
      if(w>d){for(let px=x+5;px<x+w;px+=12)line([px,.185,z],[px+.15,.185,z+d],'#424f53',.045,'detail',true);for(const dz of [2.1,3.8,8,9.7])line([x,.186,z+dz],[x+w,.186,z+dz],'#526064',.17,'detail',true);}
      else for(let pz=z+5;pz<z+d;pz+=12)line([x,.185,pz],[x+w,.185,pz+.12],'#48575a',.04,'detail',true);
    }
    for(let x=-96;x<76;x+=1.2)for(const z of [3.7,17])box(x,.13,z,1.12,.18,.38,'#d0d5ca','detail');
    for(let x=-88;x<72;x+=16){
      box(x,.17,5.15,1.7,.05,.9,'#36474a','detail');
      for(let k=0;k<9;k++)box(x+k*.19,.22,5.17,.07,.04,.86,'#8b9792','detail');
      cylinder(x+5,.18,14,1,.025,'#3c5053','detail',20);
      for(let k=-3;k<=3;k++)line([x+4.4,.22,14+k*.18],[x+5.6,.22,14+k*.18],'#82918c',.05,'detail');
      box(x+3,.18,10.45,.2,.06,.16,'#eee4b1','detail');box(x+3,.18,11.15,.2,.06,.16,'#eee4b1','detail');
    }
    for(const x of [-30,34])for(const z of [4,17.1]){
      slab(x,z,3,1,'#d4b98b',.34,'detail');
      for(let dx=.15;dx<3;dx+=.28)for(let dz=.15;dz<1;dz+=.28)cylinder(x+dx,.35,z+dz,.055,.025,'#a99474','micro',5);
    }
    for(let x=-46;x<1;x+=6){box(x,.1,34.5,3.6,.45,.9,'#c2c8bf','detail');box(x+.2,.55,34.7,3.2,.8,.5,'#d4d7cb','detail');box(x+.35,1.05,34.65,.65,.22,.6,'#d99155','detail');}
    for(let z=-43;z<-16;z+=3){box(27,.1,z,.1,2.1,2.85,'#b9c9c6','detail');box(26.8,.1,z,.3,2.3,.2,'#829795','detail');}
    for(const [x,z] of [[37,41],[47,41],[65,41],[-18,24],[-86,-64]]){
      const start={f:faces.length,l:lines.length};

      for(const dx of [.3,2.5]){box(x+dx,1.8,z-.06,.5,.28,.13,'#f1eac5','detail');box(x+dx,1.7,z+7,.5,.25,.12,'#a25449','detail');}
      for(const dx of [-.4,3.3])box(x+dx,3.5,z+.5,.35,.35,.3,'#526c75','detail');
      line([x+.3,3.4,z-.12],[x+1.3,3.1,z-.12],'#253c47',.035,'detail');
      scaleVehicle(start,x,z);
    }
    // Directional ground shadows connect the buildings and equipment to the site.
    for(const [x,z,w,d,h] of [[38,-60,34,9,8],[-3,48,14,15,5],[-1,-43,12,9,6],[37,41,3.3,7,4.5],[47,41,3.3,7,4.5],[65,41,3.3,7,4.5]]){
      face([[x,.19,z],[x+w,.19,z],[x+w+h*.65,.19,z+d+h*.4],[x+h*.65,.19,z+d+h*.4],[x,.19,z+d]],'rgba(36,59,61,0.16)','shadow',true);
    }
    // Material-scale detailing: domed steel roofs and radial standing seams.
    for(const tx of [2,16]){
      const dome=(a,t)=>[tx+4.78*Math.sin(t)*Math.cos(a),5.9+.92*Math.cos(t),-25+4.78*Math.sin(t)*Math.sin(a)];
      for(let j=0;j<5;j++)for(let i=0;i<40;i++){
        const a=i*Math.PI/20,t=j*Math.PI/10;
        face([dome(a,t),dome(a+Math.PI/20,t),dome(a+Math.PI/20,t+Math.PI/10),dome(a,t+Math.PI/10)],shade('#d2dedb',.87+.11*Math.cos(a-.7)+.025*j),'structures');
      }
      for(let i=0;i<20;i++)for(let j=0;j<5;j++){const a=i*Math.PI/10,t=j*Math.PI/10;line(dome(a,t),dome(a,t+Math.PI/10),'#a0b5b2',.025);}
      cylinder(tx,6.8,-25,.65,.14,'#acbebb');cylinder(tx,6.94,-25,.42,.1,'#d3dfd8');
      for(let i=0;i<10;i++){const a=i*Math.PI/5;cylinder(tx+.52*Math.cos(a),6.96,-25+.52*Math.sin(a),.045,.045,'#627e82','detail',6);}
      for(let i=0;i<24;i++){const a=i*Math.PI/12;line([tx+4.72*Math.cos(a),.15,-25+4.72*Math.sin(a)],[tx+4.72*Math.cos(a),5.6,-25+4.72*Math.sin(a)],'#a9bebb',.022);}
      // Concrete ring foundation and anchor plates at the tank foot.
      for(let i=0;i<16;i++){const a=i*Math.PI/8,x=tx+4.7*Math.cos(a),z=-25+4.7*Math.sin(a);box(x-.15,.05,z-.15,.3,.15,.3,'#879993');cylinder(x,.2,z,.055,.13,'#657d80','detail',6);}
      box(tx-1,2.7,-20.26,2,.72,.03,'#dce5da');box(tx-.8,2.85,-20.22,.45,.38,.03,'#be9254');
    }
    // Switchgear hall: cladding seams, framed glazing, flashing and service doors.
    for(let x=38.5;x<71.8;x+=.65)line([x,.3,-50.98],[x,7.7,-50.98],'#b3c5bf',.035);
    for(let i=0;i<6;i++){
      const x=40+i*5;
      box(x-.1,.7,-50.75,3.6,.13,.3,'#8b9e98');
      for(const dx of [0,3.4])box(x+dx,.8,-50.7,.08,4.4,.13,'#526f78');
      line([x+1.7,1,-50.68],[x+1.7,4.9,-50.68],'#4e6770',.05);
      box(x+1.45,2.55,-50.55,.12,.36,.1,'#c3cebd');box(x+1.85,2.55,-50.55,.12,.36,.1,'#c3cebd');
      box(x+.4,5.4,-50.68,2.6,1.2,.15,'#46646d');box(x+.52,5.53,-50.49,2.36,.94,.035,'#84a9b7');
      face([[x+.52,5.53,-50.44],[x+2.88,6.47,-50.44],[x+2.88,6.18,-50.44],[x+.52,5.53,-50.44]],'#c2d5da');
      box(x+1.65,5.5,-50.4,.07,1,.05,'#536f75');
    }
    for(let x=38;x<72;x+=1.1)line([x,8.53,-60],[x,8.53,-51],'#8ea4a0',.035);
    for(const x of [38,71.5]){tube([x,7.9,-50.4],[x,.3,-50.4],.1,'#8baba8','structures');box(x-.2,.1,-50.6,.5,.3,.6,'#8f9f96');}
    // Office glazing, window reveals, entrance landing, rooftop air conditioning.
    for(let i=0;i<4;i++){const x=-1+i*3;
      box(x-.13,1.75,47.7,2.26,1.8,.18,'#496872');box(x,1.9,47.65,2,1.5,.04,'#85a9b5');
      face([[x,1.9,47.59],[x+2,3.4,47.59],[x+2,3.05,47.59],[x,1.9,47.59]],'#bfd2d5');box(x+.95,1.9,47.56,.07,1.5,.03,'#48636d');
      box(x-.15,1.7,47.4,2.3,.12,.5,'#bccbc1');
    }
    box(9.7,.1,49,1.35,3.1,.13,'#526e77');box(9.9,1.3,48.9,.9,1.5,.1,'#88aab6');
    for(let i=0;i<3;i++)box(8.9,-.02,47.8-i*.5,2.3,.12+i*.12,.55,'#bdc5b7');
    for(const x of [0,5]){box(x,5.36,53,3,1.1,3.5,'#b6c8c1');cylinder(x+1.5,6.46,54.7,.95,.08,'#506970');for(let a=0;a<12;a++)line([x+1.5,6.56,54.7],[x+1.5+.8*Math.cos(a*Math.PI/6),6.56,54.7+.8*Math.sin(a*Math.PI/6)],'#93aaa7',.04);}
    // Truck cab panels, rounded wheel shoulders, tread blocks and cargo bed ribs.
    for(const [x,z] of [[37,41],[47,41],[65,41],[-18,24],[-86,-64]]){
      const start={f:faces.length,l:lines.length};
      for(const dx of [-.35,3])for(const dz of [1.7,5.8]){
        for(let i=0;i<18;i++){const a=i*Math.PI/9;line([x+dx,.95+.685*Math.cos(a),z+dz+.685*Math.sin(a)],[x+dx+.65,.95+.685*Math.cos(a+.07),z+dz+.685*Math.sin(a+.07)],'#6c7775',.055,'equipment');}
        for(let i=0;i<6;i++){const a=i*Math.PI/3;box(x+dx-.025,.95+.21*Math.cos(a),z+dz+.21*Math.sin(a),.04,.065,.065,'#d2d5c7','equipment');}
      }
      box(x-.1,1.03,z-.18,3.5,.22,.3,'#aebeb7','equipment');
      box(x+1.52,3,z-.09,.07,.9,.04,'#263f49','equipment');
      for(const dx of [0,3.3])line([x+dx,2.75,z+.12],[x+dx,2.75,z+2],'#7f9395',.045,'equipment');
      for(let k=0;k<7;k++)box(x+.35,1.88,z+2.6+k*.55,2.6,.07,.08,'#839691','equipment');
      cylinder(x+1.65,4.5,z+1,.16,.2,'#e0a65d','equipment',12);
      scaleVehicle(start,x,z);
    }
    // Delta Civil: shoring, reinforcement stock, formwork and work platforms.
    for(let x=-80;x<-36;x+=5){box(x,.08,-57,3.5,.22,1.6,'#a18b65','equipment');for(let j=0;j<6;j++)tube([x+j*.5,.38,-57],[x+j*.5,.38,-55.4],.035,'#727a74');}
    for(let z=-49;z<-13;z+=4){box(-87,.1,z,.18,1.1,3.7,'#a58d6b');tube([-87,1,z],[-89,.1,z],.07,'#83938b');}
    for(const x of [-80,-65]){box(x,7.4,-46,9,.15,1.2,'#b7a381','equipment');for(let k=0;k<9;k+=2)tube([x+k,7.5,-46],[x+k,8.5,-46],.04,'#b9c7bc');line([x,8.5,-46],[x+8,8.5,-46],'#c4cdbd',.07,'equipment');}
    // Meridian Roads: compaction passes, kerb beds, survey strings and barriers.
    for(let x=-48;x<3;x+=.8)line([x,.24,27],[x,.24,32.5],'#b7aa91',.04,'detail',true);
    for(let x=-49;x<5;x+=2){box(x,.1,32.8,1.85,.32,.5,'#d0cdbb');if(x%3===0){tube([x,0,35],[x,.8,35],.045,'#bd8b65');}}
    line([-49,.75,35],[5,.75,35],'#deae73',.025,'detail');
    // RoboPave: service bays, charging pedestals, bollards and spare screed assemblies.
    for(const x of [36,45,54,63]){for(const dx of [0,7])line([x+dx,.2,38],[x+dx,.2,54],'#e7dca5',.13,'ground',true);box(x+.7,.1,55,1,1.6,.65,'#63858d','equipment');box(x+.82,1.05,54.94,.7,.42,.07,'#b4d4ce','equipment');tube([x+1.7,1.1,55],[x+2.2,.2,52],.055,'#384d54');for(const dx of [.2,2.5])cylinder(x+dx,.1,54.5,.14,.8,'#cbab61','equipment');}
    for(let x=35;x<47;x+=3){box(x,.2,35,2.3,.2,1.3,'#b9ab8a','equipment');box(x+.1,.4,35.1,2.1,.45,1.1,'#789495','equipment');}
    // Construction truck mudguards, access steps, tie-downs and rear tow eyes.
    for(const [x,z] of [[37,41],[47,41],[65,41],[-18,24],[-86,-64]]){
      const start={f:faces.length,l:lines.length};
      for(const dx of [-.38,3.36]){for(const dz of [1.7,5.8])for(let j=0;j<12;j++){const a=j*Math.PI/12,b=(j+1)*Math.PI/12;line([x+dx,.95+.82*Math.sin(a),z+dz+.82*Math.cos(a)],[x+dx,.95+.82*Math.sin(b),z+dz+.82*Math.cos(b)],'#50636a',.10,'equipment');}
        box(x+dx,1.2,z+2,.3,.12,.7,'#9aaaa7','equipment');box(x+dx,1.65,z+2,.3,.12,.7,'#9aaaa7','equipment');
        for(let k=3;k<7;k++)line([x+dx,2.4,z+k],[x+dx,2.65,z+k],'#c7cdc0',.07,'equipment');}
      tube([x+1.3,1,z+7],[x+2,1,z+7],.1,'#718887');scaleVehicle(start,x,z);
    }
    // Crane winch drums and trolley sheaves; digger buckets get open side cheeks.
    tube([cx-7,29.5,cz-.6],[cx-7,29.5,cz+.6],.5,'#677e81');for(let j=0;j<10;j++)line([cx-7.5,29.5,cz-.5+j*.1],[cx-6.5,29.5,cz-.5+j*.1],'#b2beba',.03,'equipment');
    for(const [x,z] of [[-42,-9],[0,30]]){
      const start={f:faces.length,l:lines.length};for(const dx of [6,7.85])face([[x+dx,.3,z-5],[x+dx,1.5,z-4.4],[x+dx,1.3,z-3],[x+dx,.3,z-3]],'#777e70','equipment');
      line([x+3,4,z+2],[x+5,9.3,z-1],'#43575e',.09,'equipment');line([x+5,9.3,z-1],[x+7,2,z-4],'#43575e',.07,'equipment');scaleVehicle(start,x,z,.68,.68,.68);
    }
    // Area 4 crane: full-width triangulated jib, slewing ring and service decks.
    for(const dz of [-.65,.65]){
      beam([cx-10,29,cz+dz],[cx+27,29,cz+dz],.13,'#c8a458');
      beam([cx-10,31,cz+dz],[cx+27,31,cz+dz],.12,'#e1bf76');
      for(let x=-10;x<26;x+=2){beam([cx+x,29,cz+dz],[cx+x+2,31,cz+dz],.085,'#d8b367');beam([cx+x,31,cz+dz],[cx+x+2,29,cz+dz],.075,'#b99248');}
    }
    for(let x=-10;x<27;x+=2){beam([cx+x,29,cz-.65],[cx+x,29,cz+.65],.1,'#caa659');beam([cx+x,31,cz-.65],[cx+x,31,cz+.65],.09,'#d4b36c');}
    cylinder(cx,26.8,cz,1.45,.35,'#647b7d','equipment',32);cylinder(cx,27.15,cz,1.1,.35,'#b99a59','equipment',24);
    for(let j=0;j<20;j++){const a=j*Math.PI/10;cylinder(cx+1.27*Math.cos(a),27.16,cz+1.27*Math.sin(a),.055,.08,'#c6c9b4','equipment',6);}
    // Operator cabin: sloping windscreen, side glazing, seat and access handrails.
    face([[cx+.48,27.35,cz-1.35],[cx+2.32,27.35,cz-1.35],[cx+2.1,28.7,cz-1.35],[cx+.48,28.7,cz-1.35]],'#547b89','equipment');
    face([[cx+2.43,27.3,cz-1.2],[cx+2.43,27.3,cz+1.15],[cx+2.18,28.7,cz+1.15],[cx+2.18,28.7,cz-1.2]],'#87a6ad','equipment');
    box(cx+.35,29,cz-1.4,2.25,.12,2.8,'#d8b674','equipment');
    for(let y=2;y<27;y+=3)for(const dx of [-.72,.72]){beam([cx+dx,y,cz-.7],[cx+dx,y+3,cz+.7],.085,'#bf994d');beam([cx+dx,y,cz+.7],[cx+dx,y+3,cz-.7],.085,'#d1ae65');}
    for(let x=-9;x<-4;x+=1){box(cx+x,27,cz-.9,.86,1.9,1.8,'#8e9c93','equipment');line([cx+x,28.95,cz-.7],[cx+x+.8,28.95,cz-.7],'#617d7b',.1,'equipment');}
    for(const dz of [-.55,.55])for(const dx of [21,22.4])tube([cx+dx,28.6,cz+dz-.12],[cx+dx,28.6,cz+dz+.12],.22,'#4e6a71');
    for(const dx of [-1.6,1.6])for(const dz of [-1.6,1.6]){box(cx+dx-.22,.95,cz+dz-.22,.44,.12,.44,'#7b8f8a','equipment');cylinder(cx+dx,1.07,cz+dz,.075,.23,'#b7c5b6','equipment',8);}
    // Area 2 pump-house façade, louvers, controls and exterior pipe skid.
    for(let x=-.7;x<10.8;x+=.6)line([x,.2,-33.96],[x,5.8,-33.96],'#b5c7c0',.03);
    box(.2,.1,-33.9,2.1,3.2,.14,'#55737b');box(.35,1.7,-33.7,1.8,1.2,.06,'#8bb0b6');
    for(const x of [3.5,7]){box(x,2,-33.85,2.5,1.7,.18,'#617e82');for(let y=2.15;y<3.6;y+=.17)box(x+.12,y,-33.62,2.25,.06,.18,'#a6bcb4');}
    box(-1.1,6.4,-35,12.2,.13,.25,'#759392');tube([10.7,6.5,-34.9],[10.7,.15,-34.9],.09,'#879f98','structures');
    for(const x of [0,5]){box(x,.2,-32.6,3.6,.25,2,'#a5b7ad');tube([x+.5,1,-31.6],[x+2.5,1,-31.6],.4,'#6b929a','utilities',20);cylinder(x+2.65,.5,-31.6,.5,1.1,'#819f9e','utilities',16);tube([x+.5,1,-31.6],[x+.5,1,-29.7],.24,'#468ba0','utilities');}
    for(let x=19;x<24;x+=1.7){box(x,.2,-40,1.35,2,.7,'#b2c5bb');box(x+.18,1.3,-39.25,.9,.5,.04,'#416977');cylinder(x+.9,1,-39.2,.07,.06,'#b98a54','detail',8);}
    // Tank service catwalk with tread plates and continuous safety rail.
    box(6.7,5.9,-25.8,4.6,.16,1.5,'#829a95');
    for(let x=6.8;x<11.3;x+=.25)line([x,6.08,-25.7],[x,6.08,-24.4],'#c0cbbb',.035);
    for(const z of [-25.8,-24.3]){for(let x=6.8;x<11.4;x+=1.1)tube([x,6,z],[x,7,z],.045,'#a9bcb3','structures');line([6.8,7,z],[11.4,7,z],'#9eb4ad',.05);}
    // Waterfront alongside the utility zone: quay blocks, ladders, fenders and outfall.
    for(let z=-64;z<0;z+=3){line([82,.13,z],[87,.13,z],'#8caaa6',.055);box(86.8,-.3,z,.25,.45,2.8,'#718f94');}
    for(const z of [-48,-32,-8]){
      for(const dz of [-.4,.4])tube([87.18,-1.6,z+dz],[87.18,1,z+dz],.045,'#799695','structures');
      for(let y=-1.4;y<1;y+=.3)tube([87.2,y,z-.4],[87.2,y,z+.4],.035,'#b3c4b7','structures');
      box(87,-.5,z+1.2,.45,1.5,.75,'#344e58');cylinder(84.7,.1,z,.22,.55,'#5c7780');
    }
    for(let z=-60;z<-4;z+=8){box(77.5,.1,z,1.1,1.1,.8,'#b5c9bf');box(77.65,.6,z-.04,.8,.35,.06,'#719b9d');}
    tube([73,.5,-22],[88,.5,-22],.6,'#759ea3','utilities',24);tube([87.4,.5,-22],[88.2,.5,-22],.73,'#a7bcb1','utilities',24);
    for(let j=0;j<7;j++)line([88.22,.02+j*.16,-22.55],[88.22,.02+j*.16,-21.45],'#3d6570',.065,'utilities');
    // Crane working envelope: spreader beam, four-leg sling and staged precast load.
    beam([cx+20,5.9,cz],[cx+23,5.9,cz],.16,'#bc9957');
    for(const dx of [20,23]){line([cx+21.5,6.4,cz],[cx+dx,5.9,cz],'#4d6872',.055,'equipment');for(const dz of [-.8,.8])line([cx+dx,5.9,cz],[cx+dx,4.1,cz+dz],'#516b73',.055,'equipment');}
    box(cx+19.6,3.6,cz-1.1,3.8,.5,2.2,'#c5cabc','equipment');
    for(const dx of [20,23])for(const dz of [-.8,.8])cylinder(cx+dx,4.1,cz+dz,.075,.12,'#819992','equipment',8);
    for(const dx of [-3.1,3.1])for(const dz of [-3.1,3.1]){box(cx+dx-.45,.05,cz+dz-.45,.9,.3,.9,'#b2b9aa');tube([cx+dx,.35,cz+dz],[cx+dx,1.7,cz+dz],.045,'#b1965e');}
    for(const dz of [-3.1,3.1])line([cx-3.1,1.5,cz+dz],[cx+3.1,1.5,cz+dz],'#d1b77d',.08,'equipment');
    box(cx-4.5,.1,cz+1.3,1.1,1.5,.6,'#879f9a','equipment');box(cx-4.35,.8,cz+1.25,.8,.45,.05,'#506f79','equipment');
    for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;line([cx-4+.6*Math.cos(a),.2,cz+3+.6*Math.sin(a)],[cx-4+.6*Math.cos(b),.2,cz+3+.6*Math.sin(b)],'#455f68',.07,'equipment');}
    // Material stacks and survey tripod at the roadwork boundary.
    for(let j=0;j<3;j++)for(let i=0;i<4;i++)box(-41+i*1.15,.1+j*.3,36,1,.24,1.5,'#c1c8b8','equipment');
    for(const dx of [-.5,.5])tube([-35,1.7,36],[-35+dx,.1,36.4],.045,'#c6a762');tube([-35,1.7,36],[-35,.1,35.5],.045,'#c6a762');box(-35.2,1.7,35.8,.4,.25,.4,'#79958f','equipment');
    // Pump station roof maintenance route, grating, handrail and service access.
    for(let x=.2;x<10.3;x+=.35)line([x,6.43,-42.2],[x,6.43,-41.2],'#718e8b',.04);
    for(let x=0;x<11;x+=1.5){tube([x,6.4,-42.6],[x,7.25,-42.6],.04,'#a0b7ac','structures');}
    line([0,7.25,-42.6],[10.5,7.25,-42.6],'#9eb5ab',.05);
    for(let y=.3;y<6.7;y+=.35)tube([-1.12,y,-40.4],[-1.12,y,-39.6],.035,'#9fb6ad','structures',8);
    for(const z of [-40.4,-39.6])tube([-1.13,.1,z],[-1.13,7,z],.055,'#718f8d','structures');
    for(const x of [0,8]){box(x,.15,-17.5,3,.2,2.5,'#a6b9ad');box(x+.3,.35,-17.2,2.4,.09,1.9,'#4d7077');for(let j=0;j<9;j++)line([x+.35,.46,-17.1+j*.2],[x+2.65,.46,-17.1+j*.2],'#a8bcb0',.055);}
    // Quay safety and utility cabinets, loading hoses and timber rubbing strips.
    for(const z of [-50,-16]){box(78,.12,z,1.4,1.7,.75,'#b7c6b8');box(78.2,.6,z-.05,1,.9,.08,'#b97758');
      for(let j=0;j<20;j++){const a=j*Math.PI/10,b=(j+1)*Math.PI/10;line([78.7+.3*Math.cos(a),1+.3*Math.sin(a),z-.15],[78.7+.3*Math.cos(b),1+.3*Math.sin(b),z-.15],'#e4d4a7',.09);}}
    for(let z=-61;z<-3;z+=6)box(87.05,-.65,z,.3,1.1,3.5,'#746f5b');
    for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;line([80+1.1*Math.cos(a),.25,-28+1.1*Math.sin(a)],[80+1.1*Math.cos(b),.25,-28+1.1*Math.sin(b)],'#435f66',.16,'utilities');}
    // Road close inspection: patched asphalt, sealed joints, aggregate and drainage hardware.
    for(const [rx,rz,rw,rd] of [[-97,5,174,12],[-23,-65,11,69],[17,18,11,52]]){
      for(let n=0;n<700;n++){const x=rx+random()*rw,z=rz+random()*rd,r=.035+random()*.09;face([[x,.24,z],[x+r,.24,z+.025],[x+r*.4,.24,z+r]],n%3?'#73807e':'#465451','micro',true);}
      for(let t=5;t<Math.max(rw,rd)-3;t+=9){const x=rw>rd?rx+t:rx+1,z=rw>rd?rz+1:rz+t;
        slab(x,z,1.7,1.2,'#4e5b5a',.235,'ground');for(let k=0;k<5;k++)line([x+.08,.245,z+.15+k*.2],[x+1.55,.245,z+.15+k*.2],'#697774',.024,'micro',true);
        for(let k=0;k<8;k++)line([x+2+k*.12,.245,z],[x+2+k*.12,.245,z+.75],'#a4aaa1',.025,'micro',true);
      }
      for(let t=3;t<Math.max(rw,rd);t+=5){const x=rw>rd?rx+t:rx+.4,z=rw>rd?rz+.4:rz+t;box(x,.25,z,.22,.045,.13,'#ede1b7','detail');}
    }
    // Area 6: paver maintenance and calibration compound.
    for(const x of [35,45,65]){
      for(let z=52;z<63;z+=.8)line([x,.23,z],[x+6,.23,z],'#bcc5b8',.045,'detail',true);
      box(x,.25,59,2.3,1.55,1.1,'#607d86','equipment');box(x+.12,1.05,58.94,.7,.45,.08,'#263f4a','equipment');
      for(let k=0;k<6;k++)box(x+1.15, .55+k*.17,58.93,.9,.05,.09,'#a5b5ae','detail');
      for(const dx of [-.4,2.65]){cylinder(x+dx,.2,59,.12,1.35,'#e0b558','equipment',8);cylinder(x+dx,.85,59,.13,.18,'#465a5b','detail',8);}
      for(let j=0;j<24;j++){const a=j*Math.PI/12,b=(j+1)*Math.PI/12;line([x+3.5+.7*Math.cos(a),.3,60+.7*Math.sin(a)],[x+3.5+.7*Math.cos(b),.3,60+.7*Math.sin(b)],'#354f56',.07,'equipment');}
      box(x+.2,.2,63,4,.2,1.8,'#ae8d61','equipment');for(let k=0;k<8;k++)box(x+.35+k*.45,.4,63.15,.3,.25,1.5,'#6d8281','equipment');
    }
    for(let x=36;x<73;x+=3){box(x,.15,65.5,2.7,.14,.18,'#e3c67c','detail');box(x,.15,36,2.7,.14,.18,'#e3c67c','detail');}
    // Area 7: lighting bases, electrical commissioning equipment and cable installation.
    for(let x=44;x<73;x+=8){
      box(x+.4,1.01,-7.6,1.2,.13,1.2,'#6b8282','equipment');
      for(const dx of [.55,1.45])for(const dz of [-7.45,-6.55]){cylinder(x+dx,1.14,dz,.07,.18,'#d0cfb9','detail',8);cylinder(x+dx,1.31,dz,.11,.05,'#869993','detail',6);}
      box(x+.83,1.6,-7.19,.34,.65,.05,'#526f77','equipment');
      for(let j=0;j<4;j++)for(let k=0;k<6;k++)box(x+.36+k*.2,6.71,-7.43+j*.21,.17,.018,.18,'#294d69','detail');
      tube([x+1,5.6,-7],[x+2.4,5.6,-7],.09,'#92aaa5');box(x+2,5.45,-7.2,.65,.18,.4,'#c2cfbd','equipment');
      for(let j=0;j<4;j++)box(x+2.06+j*.14,5.44,-7.16,.1,.03,.31,'#f0e6c0','detail');
      box(x-.5,.1,-4,1.2,1.8,.7,'#94aba6','equipment');box(x-.35,.8,-4.06,.9,.7,.05,'#526e77','detail');
      for(let j=0;j<5;j++)box(x-.32,.28+j*.09,-4.08,.8,.028,.03,'#51676b','detail');
      line([x+.2,.18,-4],[x+1,.18,-6.1],'#d2a44d',.06,'utilities');
      cylinder(x+3,.15,-5, .8,.12,'#a68355','equipment',18);cylinder(x+3,.27,-5,.57,.7,'#465a60','equipment',18);cylinder(x+3,.97,-5,.8,.12,'#b99c6b','equipment',18);
    }
    for(let x=43;x<73;x+=1.4){box(x,.12,-2.1,1.3,.13,.75,'#aab7ac','utilities');for(let j=0;j<5;j++)line([x+.1+j*.24,.26,-2.02],[x+.1+j*.24,.26,-1.45],'#607877',.03,'detail');}
    for(const x of [46,61,71]){box(x,.1,-10,.55,.8,.55,'#d8924e','equipment');box(x+.04,.5,-9.96,.47,.12,.47,'#eee1be','detail');}
    // Close-range fabrication detail remains attached to buildings and equipment.
    function boltedFlange(a,b,r){
      tube(a,b,r,'#a9b9b2','utilities',16);
      const axis=b.map((v,i)=>v-a[i]),len=Math.hypot(...axis),d=axis.map(v=>v/len),ref=Math.abs(d[1])>.9?[1,0,0]:[0,1,0];
      let u=[d[1]*ref[2]-d[2]*ref[1],d[2]*ref[0]-d[0]*ref[2],d[0]*ref[1]-d[1]*ref[0]];const ul=Math.hypot(...u);u=u.map(v=>v/ul);const v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];
      for(let i=0;i<8;i++){const angle=i*Math.PI/4,p=a.map((n,k)=>n+r*.8*(u[k]*Math.cos(angle)+v[k]*Math.sin(angle)));tube(p,p.map((n,k)=>n+d[k]*(len+.055)),r*.075,'#546d72','micro',6);}
    }
    // Water plant: pipe joints, saddle supports, valve actuators and inspection panels.
    for(const tx of [2,16]){
      for(const zz of [-29,-31])boltedFlange([tx,2,zz-.08],[tx,2,zz+.08],.62);
      box(tx-.65,.1,-30.8,1.3,.18,1.6,'#b3bfb5','structures');for(const dx of [-.48,.48])tube([tx+dx,.3,-30],[tx+dx,1.85,-30],.055,'#8b9d95','utilities',8);
      box(tx-.24,2.4,-30.3,.48,.65,.6,'#548091','utilities');cylinder(tx,3.05,-30,.17,.13,'#bd9c63','utilities',12);
      for(let k=0;k<16;k++){const a=k*Math.PI/8,b=(k+1)*Math.PI/8;line([tx+.4*Math.cos(a),3.23,-30+.4*Math.sin(a)],[tx+.4*Math.cos(b),3.23,-30+.4*Math.sin(b)],'#a3744a',.045,'utilities');}
      for(let j=0;j<24;j++){const a=j*Math.PI/12;line([tx+4.73*Math.cos(a),.5,-25+4.73*Math.sin(a)],[tx+4.73*Math.cos(a),5.5,-25+4.73*Math.sin(a)],'#93a9a6',.02,'micro');}
    }
    // Building envelopes: panel joints, sill flashings, parapet caps and roof drainage.
    for(const [bx,bz,bw,bd,bh] of [[38,-60,34,9,8],[-1,-43,12,9,6],[-3,48,14,15,5]]){
      for(let t=1;t<bw;t+=1.5)for(const zz of [bz-.025,bz+bd+.025])line([bx+t,.4,zz],[bx+t,bh-.2,zz],'#b1bfb7',.018,'micro');
      for(const zz of [bz-.2,bz+bd+.2]){box(bx-.2,bh+.06,zz,bw+.4,.1,.12,'#d1d9ce','structures');for(let t=1;t<bw;t+=3)box(bx+t,bh+.15,zz-.06,.12,.045,.24,'#879e98','micro');}
      for(const xx of [bx+.3,bx+bw-.3]){tube([xx,bh,bz+bd+.15],[xx,.15,bz+bd+.15],.065,'#8aa29b','structures',8);for(let y=1;y<bh;y+=1.5)box(xx-.12,y,bz+bd+.1,.24,.08,.12,'#b9c5b9','detail');}
      for(let t=1;t<bw;t+=4){box(bx+t,bh+.12,bz+bd-1,.55,.15,.7,'#6f8885','structures');for(let k=0;k<5;k++)line([bx+t+.05+k*.1,bh+.29,bz+bd-.95],[bx+t+.05+k*.1,bh+.29,bz+bd-.35],'#bdcbbf',.025,'micro');}
    }
    // Crane: mast flange plates, fasteners, braced machinery deck and sheave guards.
    for(let y=3;y<28;y+=3){
      for(const dx of [-.9,.9])for(const dz of [-.9,.9]){box(cx+dx-.19,y,cz+dz-.19,.38,.12,.38,'#b5b8a7','equipment');for(const ox of [-.1,.1])for(const oz of [-.1,.1])cylinder(cx+dx+ox,y+.12,cz+dz+oz,.035,.05,'#556e73','micro',6);}
    }
    for(let x=cx-7;x<cx+2;x+=.38)line([x,29.65,cz-.9],[x,29.65,cz+.9],'#c3caba',.025,'detail');
    for(const zz of [cz-.95,cz+.95]){for(let x=cx-7;x<cx+2;x+=1)tube([x,29.6,zz],[x,30.5,zz],.025,'#b3c2b5','equipment',6);line([cx-7,30.5,zz],[cx+1.5,30.5,zz],'#b3c2b5',.03,'equipment');}
    // Civil frame: consistent slab-edge reveals and column construction joints.
    for(const bx of [-82,-67])for(const bz of [-48,-32,-16]){
      for(let x=bx+1;x<bx+10;x+=1.1){line([x,7.26,bz+.9],[x,7.26,bz+11],'#b0bab0',.018,'micro');}
      for(const dx of [1,9])for(const dz of [1,10])for(const y of [2.5,4.5,8.7,10.5]){line([bx+dx,y,bz+dz-.01],[bx+dx+.65,y,bz+dz-.01],'#a3afa6',.025,'micro');}
    }
    // Road fixtures: flush frame bolts, drain inlets and reflective kerb studs.
    for(let x=-88;x<70;x+=18){
      for(const z of [4.15,17.45]){box(x,.14,z,1.1,.12,.45,'#667d7e','structures');for(let k=0;k<7;k++)line([x+.1+k*.14,.27,z+.06],[x+.1+k*.14,.27,z+.39],'#c2ccc1',.03,'detail');}
      for(const dx of [0,1])for(const dz of [0,.35])cylinder(x+dx,.28,4.2+dz,.035,.035,'#d3d8ca','micro',6);
    }
    // Pier fittings: cap anchor plates, rubbing strips, tied bollards and boarding ladders.
    for(const pz of [-52,-15,25,57]){
      for(let x=90;x<111;x+=4)for(const zz of [pz+.55,pz+2.45]){box(x-.2,1.24,zz-.2,.4,.055,.4,'#98aaa2','detail');for(const dx of [-.13,.13])for(const dz of [-.13,.13])cylinder(x+dx,1.3,zz+dz,.035,.035,'#556e74','micro',6);}
      for(let x=88;x<112;x+=.5){box(x,.68,pz-.12,.5,.28,.12,'#776e59','structures');box(x,.68,pz+3,.5,.28,.12,'#776e59','structures');}
      for(const zz of [pz+.6,pz+1.4])tube([112.06,-.55,zz],[112.06,1.65,zz],.035,'#91a9a0','structures',8);
      for(let y=-.35;y<1.6;y+=.28)tube([112.1,y,pz+.6],[112.1,y,pz+1.4],.03,'#bac8b8','structures',8);
    }
    // Ship deck hardware: pipe flanges, hatch fasteners and rail footplates.
    for(const [sx,sz] of [[122,-43],[133,33]]){
      for(const dx of [-.65,0,.65])for(const dz of [-14,-6,3,9])boltedFlange([sx+dx,2.8,sz+dz-.06],[sx+dx,2.8,sz+dz+.06],.27);
      for(const dx of [-2.2,2.2])for(const dz of [-15,-8,-1,6])for(let k=0;k<12;k++){const a=k*Math.PI/6;cylinder(sx+dx+.85*Math.cos(a),2.66,sz+dz+.85*Math.sin(a),.035,.045,'#d5d8c5','micro',6);}
      for(const dx of [-3.75,3.75])for(let dz=-12;dz<21;dz+=3){box(sx+dx-.12,2.41,sz+dz-.12,.24,.06,.24,'#758f8d','detail');}
    }
    // Container hardware and service bay doors: locking rods, hinges and corner castings.
    for(const x of [36,45,54,63]){
      for(const dx of [.3,3.2]){tube([x+dx,.35,64.1],[x+dx,3.6,64.1],.035,'#a5b7ad','equipment',8);for(const y of [.5,2,3.3])box(x+dx-.09,y,64.08,.18,.12,.08,'#4f6a73','detail');}
      for(const dx of [.2,6.6])for(const y of [.2,3.7])box(x+dx,y,64.05,.22,.2,.13,'#b8c6b8','detail');
    }
    return {faces,lines,objects};
  }
  function create(canvas,onFrame){
    const camera={...home},layers={utilities:true,zones:true,equipment:true,landscape:true},scene=model();
    const context=canvas.getContext?.('2d');let width=1000,height=620,frame=0,dead=false;const pointers=new Map();let gesture=null;
    function render(){
      frame=0;if(dead)return;
      const rect=canvas.getBoundingClientRect?.();if(rect?.width&&rect?.height){width=rect.width;height=rect.height;}
      const scale=project([0,0,0],camera,width,height).scale;
      if(context){
        const dpr=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
        context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,width,height);context.fillStyle='#f0f5f4';context.fillRect(0,0,width,height);
        const drawables=[];
        for(const f of scene.faces){if(layers[f.layer]===false||(f.layer==='micro'&&camera.zoom<2))continue;const p=f.p.map(v=>project(v,camera,width,height));if(p.every(v=>v.x<0)||p.every(v=>v.x>width)||p.every(v=>v.y<0)||p.every(v=>v.y>height))continue;drawables.push({...f,p,depth:p.reduce((s,v)=>s+v.depth,0)/p.length});}
        for(const l of scene.lines){if(layers[l.layer]===false||(l.layer==='micro'&&camera.zoom<2))continue;const p=l.p.map(v=>project(v,camera,width,height));if(p.every(v=>v.x<0)||p.every(v=>v.x>width)||p.every(v=>v.y<0)||p.every(v=>v.y>height))continue;drawables.push({...l,p,depth:(p[0].depth+p[1].depth)/2+.03,line:true});}
        // Foundations paint first, followed by roads and markings, then raised geometry.
        const order=f=>f.layer==='base'?0:f.layer==='foundation'?1:f.ground?2:3;
        drawables.sort((a,b)=>order(a)-order(b)||a.depth-b.depth);
        for(const f of drawables){context.beginPath();context.moveTo(f.p[0].x,f.p[0].y);for(let i=1;i<f.p.length;i++)context.lineTo(f.p[i].x,f.p[i].y);if(f.line){context.strokeStyle=f.c;context.lineWidth=Math.max(.55,f.w*scale);context.stroke();}else{context.closePath();context.fillStyle=f.c;context.fill();}}
      }
      onFrame?.({width,height,project:p=>project(p,camera,width,height),camera:{...camera},objects:scene.objects,faces:scene.faces.length,scale});
    }
    function request(){if(!frame&&!dead){if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(render);else render();}}
    function zoom(factor){camera.zoom=clamp(camera.zoom*factor,.65,8);request();}
    function pan(dx,dy){const s=project([0,0,0],camera,width,height).scale,c=Math.cos(camera.yaw),sn=Math.sin(camera.yaw),rx=-dx/s,rz=-dy/(s*Math.max(.2,Math.sin(camera.pitch)));camera.x+=rx*c+rz*sn;camera.z+=-rx*sn+rz*c;}
    function resetGesture(){const p=[...pointers.values()];gesture=p.length>=2?{distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:null;}
    canvas.onpointerdown=e=>{canvas.focus();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,rotate:e.button===2||e.shiftKey});canvas.setPointerCapture?.(e.pointerId);canvas.classList.add('dragging');resetGesture();};
    canvas.onpointermove=e=>{
      const p=pointers.get(e.pointerId);if(!p)return;const old={...p};p.x=e.clientX;p.y=e.clientY;
      if(pointers.size>=2){const previous=gesture;resetGesture();if(previous&&gesture){camera.zoom=clamp(camera.zoom*gesture.distance/Math.max(previous.distance,1),.65,8);pan(gesture.x-previous.x,gesture.y-previous.y);}}
      else if(p.rotate){camera.yaw+=(p.x-old.x)*.007;camera.pitch=clamp(camera.pitch+(p.y-old.y)*.005,.26,Math.PI/2);}else pan(p.x-old.x,p.y-old.y);
      request();
    };
    const end=e=>{pointers.delete(e.pointerId);resetGesture();if(!pointers.size)canvas.classList.remove('dragging');};canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=end;
    canvas.oncontextmenu=e=>e.preventDefault();
    canvas.addEventListener?.('wheel',e=>{e.preventDefault();zoom(Math.exp(-clamp(e.deltaY,-200,200)*.0025));},{passive:false});
    canvas.onkeydown=e=>{let used=true;switch(e.key){case '+':case '=':zoom(1.25);break;case '-':zoom(.8);break;case 'ArrowLeft':if(e.shiftKey)pan(35,0);else camera.yaw-=.12;break;case 'ArrowRight':if(e.shiftKey)pan(-35,0);else camera.yaw+=.12;break;case 'ArrowUp':if(e.shiftKey)pan(0,35);else camera.pitch=clamp(camera.pitch-.1,.26,Math.PI/2);break;case 'ArrowDown':if(e.shiftKey)pan(0,-35);else camera.pitch=clamp(camera.pitch+.1,.26,Math.PI/2);break;case 'Home':Object.assign(camera,home);break;default:used=false;}if(used){e.preventDefault();request();}};
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(request):null;observer?.observe(canvas);
    return {refresh:request,zoom,fit(){Object.assign(camera,home);request();},orbit(amount){camera.yaw+=amount;request();},tilt(value){camera.pitch=clamp(value,.26,Math.PI/2);request();},view(mode){camera.pitch=mode==='plan'?Math.PI/2:home.pitch;camera.yaw=mode==='plan'?0:home.yaw;request();},focus(id){const p=positions[id];if(p){camera.x=p[0];camera.z=p[2];camera.zoom=3;request();}},layer(name,value){layers[name]=value;request();},snapshot(){return{...camera,layers:{...layers},objects:scene.objects,faces:scene.faces.length};},destroy(){dead=true;observer?.disconnect();if(frame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);pointers.clear();}};
  }
  return {create,project,placePins,positions,features,home};
})();

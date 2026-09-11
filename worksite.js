/* Project data and accessible controls for the three-dimensional worksite. */
const Worksite=(()=>{
  const ui={query:'',kind:'all',status:'all',utilities:true,zones:true,equipment:true,labels:true,expanded:false};
  let statuses={},scene=null,shown=[],all=[],pinSignature='';
  const colors={delayed:'#d63e5d',atrisk:'#b77919',done:'#21896f',ontrack:'#277cae',notstarted:'#718093',available:'#718093'};
  const labels={delayed:'Delayed',atrisk:'At risk',done:'Complete',ontrack:'On track',notstarted:'Standby',available:'Available'};
  const byId=id=>document.getElementById(id);
  const status=c=>statuses[c.id]||(c.status==='On site'?'ontrack':c.status==='Standby'?'notstarted':'available');
  const color=c=>colors[status(c)]||colors.available;
  const visible=c=>LOC[c.id]&&(ui.kind==='all'||c.kind===ui.kind)&&(ui.status==='all'||(ui.status==='attention'?['delayed','atrisk'].includes(status(c)):status(c)===ui.status))&&`${c.name} ${c.discipline} ${LOC[c.id].zone}`.toLowerCase().includes(ui.query.toLowerCase());
  const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  function render(s){
    statuses=s;
    if(!byId('mapCanvas')){
      byId('siteMap').innerHTML=`
        <div class="map-tools"><input id="mapSearch" aria-label="Search contractors or work zones" placeholder="Search contractor or work zone…"><select id="mapKind" aria-label="Contractor type"><option value="all">All contractors</option><option value="Human">Human crews</option><option value="Robot">Robotic fleets</option></select><select id="mapStatus" aria-label="Work status"><option value="all">All statuses</option><option value="attention">Needs attention</option><option value="done">Complete</option><option value="ontrack">On track</option><option value="notstarted">Standby</option><option value="available">Available</option></select></div>
        <div class="map-stage map-three" id="mapStage">
          <canvas id="mapCanvas" tabindex="0" role="img" aria-label="Interactive 3D worksite. Drag to move, Shift-drag to rotate, and scroll to zoom. Contractor selections are available in the numbered index below." aria-describedby="mapHelp">3D worksite model. Use the contractor index below to select a contractor.</canvas>
          <div class="map-pin-layer" id="mapPins" aria-label="Contractor locations"></div>
          <div class="map-view-switch" role="group" aria-label="Map view"><button id="map3D" aria-pressed="true">3D view</button><button id="mapPlan" aria-pressed="false">Top view</button></div>
          <div class="map-orientation" aria-hidden="true"><span id="mapCompass">↑</span><b>N</b></div>
          <div class="map-controls">
            <button id="zoomIn" title="Zoom in" aria-label="Zoom in">+</button><button id="zoomOut" title="Zoom out" aria-label="Zoom out">−</button>
            <button id="rotateLeft" title="Rotate left" aria-label="Rotate left">${icon('<path d="M3 8h5V3M3 8a9 9 0 1 1-1 8"/>')}</button>
            <button id="rotateRight" title="Rotate right" aria-label="Rotate right">${icon('<path d="M21 8h-5V3m5 5a9 9 0 1 0 1 8"/>')}</button>
            <button id="fitMap" title="Fit entire site" aria-label="Fit entire site">${icon('<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>')}</button>
            <button id="expandMap" title="Expand map" aria-label="Expand map" aria-pressed="false">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>')}</button>
          </div>
          <div class="map-camera-bar"><label for="mapTilt">Tilt</label><input id="mapTilt" type="range" min="15" max="90" value="45" aria-label="Viewing angle"><output id="mapTiltValue">45°</output><span class="map-zoom" id="mapZoom">1.0×</span></div>
          <time class="map-site-clock" id="mapSiteClock" aria-label="Site local time"></time>
          <div class="map-empty-result" id="mapEmpty" hidden>No matching contractors. Change or clear the filters.</div>
        </div>
        <div class="map-layers"><label><input type="checkbox" id="layerZones" checked>Work zones</label><label><input type="checkbox" id="layerUtilities" checked>Utilities</label><label><input type="checkbox" id="layerEquipment" checked>Equipment</label><label><input type="checkbox" id="layerLabels" checked>Contractor pins</label><small id="mapCount" aria-live="polite"></small></div>
        <div class="map-current" id="mapCurrent"></div>
        <div class="map-index-heading"><h3>Contractor index</h3><span>Choose a contractor to see their work zone</span></div><div class="map-index" id="mapIndex"></div>
        <div class="map-key"><span style="--key:#d63e5d">Delayed</span><span style="--key:#b77919">At risk</span><span style="--key:#21896f">Complete</span><span style="--key:#277cae">On track</span><span style="--key:#718093">Standby / available</span></div>
        <details class="map-drawing-feed"><summary>Live drawing revisions <span id="mapRevisionCount">0</span></summary><div id="mapDrawings"></div></details>
        <p class="map-hint" id="mapHelp">Drag to move freely · Scroll or pinch to zoom · Shift-drag or right-drag to rotate · Fit returns to the whole site. Keyboard: arrows rotate, Shift + arrows pan, + / − zoom, Home fits the site.</p>
        <p class="map-model-note">Illustrative 3D coordination model · Geometry is not survey data. Utility routes are shown above ground for visibility; drawing notes do not alter the model geometry.</p>`;
      const clockFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
      const updateClock=()=>{const now=new Date(),el=byId('mapSiteClock');if(el){el.textContent=clockFormat.format(now);el.setAttribute('datetime',now.toISOString());}};
      updateClock();window.setInterval?.(updateClock,1000);
      scene=Worksite3D.create(byId('mapCanvas'),updateProjection);
      byId('mapSearch').oninput=e=>{ui.query=e.target.value;draw();};
      byId('mapKind').onchange=e=>{ui.kind=e.target.value;draw();};byId('mapStatus').onchange=e=>{ui.status=e.target.value;draw();};
      for(const name of ['Zones','Utilities','Equipment','Labels'])byId('layer'+name).onchange=e=>{const key=name.toLowerCase();ui[key]=e.target.checked;if(key!=='labels')scene.layer(key,ui[key]);draw();};
      byId('zoomIn').onclick=()=>scene.zoom(1.25);byId('zoomOut').onclick=()=>scene.zoom(.8);byId('fitMap').onclick=()=>scene.fit();
      byId('rotateLeft').onclick=()=>scene.orbit(-Math.PI/8);byId('rotateRight').onclick=()=>scene.orbit(Math.PI/8);
      byId('map3D').onclick=()=>scene.view('3d');byId('mapPlan').onclick=()=>scene.view('plan');byId('mapTilt').oninput=e=>scene.tilt(Number(e.target.value)*Math.PI/180);
      byId('expandMap').onclick=toggleExpand;
      document.addEventListener('keydown',e=>{
        if(e.key==='Escape'&&ui.expanded){toggleExpand();byId('expandMap').focus();}
        if(e.key==='Tab'&&ui.expanded){const focusable=Array.from(byId('mapStage').querySelectorAll?.('button:not(:disabled), input, canvas, [tabindex="0"]')||[]).filter(el=>!el.hidden);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
      });
    }
    draw();
  }
  function toggleExpand(){ui.expanded=!ui.expanded;byId('mapStage').classList.toggle('expanded',ui.expanded);byId('expandMap').setAttribute('aria-pressed',String(ui.expanded));byId('expandMap').setAttribute('aria-label',ui.expanded?'Close expanded map':'Expand map');if(document.body)document.body.style.overflow=ui.expanded?'hidden':'';scene.refresh();}
  function updateProjection(frame){
    byId('zoomIn').disabled=frame.camera.zoom>=8;byId('zoomOut').disabled=frame.camera.zoom<=.65;
    byId('mapZoom').textContent=frame.camera.zoom.toFixed(1)+'×';byId('mapTilt').value=Math.round(frame.camera.pitch*180/Math.PI);byId('mapTiltValue').textContent=byId('mapTilt').value+'°';
    byId('map3D').setAttribute('aria-pressed',String(frame.camera.pitch<1.56));byId('mapPlan').setAttribute('aria-pressed',String(frame.camera.pitch>=1.56));
    byId('mapCompass').style.transform=`rotate(${-frame.camera.yaw*180/Math.PI}deg)`;
    const projected=shown.map(c=>({...frame.project(Worksite3D.positions[c.id]),id:c.id,selected:c.id===selMgmt}));
    const placed=ui.labels?Worksite3D.placePins(projected,frame.width,frame.height):[];
    const signature=placed.map(p=>p.id).join(',')+'|'+shown.map(c=>status(c)+(c.id===selMgmt)).join(',');
    if(signature!==pinSignature){pinSignature=signature;byId('mapPins').innerHTML=placed.map(p=>{const c=C(p.id),n=all.findIndex(v=>v.id===p.id)+1;return `<span class="map-pin-leader" id="mapLeader-${c.id}" aria-hidden="true"></span><button class="site-marker ${c.kind==='Robot'?'robot':''} ${p.selected?'selected':''}" id="mapPin-${c.id}" data-contractor="${c.id}" style="--pin:${color(c)}" aria-label="${n}. ${esc(c.name)}, ${esc(LOC[c.id].zone)}, ${labels[status(c)]}" aria-pressed="${p.selected}" title="${esc(c.name)} · ${esc(LOC[c.id].zone)}"><span>${n}</span></button>`;}).join('');document.querySelectorAll('#mapPins .site-marker').forEach(el=>{el.onclick=()=>selectMgmt(el.dataset.contractor);});}
    for(const p of placed){const el=byId('mapPin-'+p.id);if(el){el.style.left=p.x+'px';el.style.top=p.y+'px';}const leader=byId('mapLeader-'+p.id);if(leader){leader.style.left=p.anchorX+'px';leader.style.top=p.anchorY+'px';leader.style.width=Math.hypot(p.x-p.anchorX,p.y-p.anchorY)+'px';leader.style.transform=`rotate(${Math.atan2(p.y-p.anchorY,p.x-p.anchorX)}rad)`;}}
  }
  function draw(){
    all=state.contractors.filter(c=>LOC[c.id]&&Worksite3D.positions[c.id]);shown=all.filter(visible);
    const attention=all.filter(c=>['delayed','atrisk'].includes(status(c))).length,drawings=state.drawings||[];
    byId('mapCount').textContent=`${shown.length} of ${all.length} contractors shown`;byId('mapEmpty').hidden=shown.length>0;
    byId('mapIndex').innerHTML=shown.map(c=>`<button class="map-index-item ${c.id===selMgmt?'selected':''}" data-contractor="${c.id}" aria-pressed="${c.id===selMgmt}" style="--pin:${color(c)}"><span class="map-index-number ${c.kind==='Robot'?'robot':''}">${all.indexOf(c)+1}</span><span class="map-index-copy"><strong>${esc(c.name)}</strong><small>${esc(LOC[c.id].zone)}</small></span><span class="map-index-status">${labels[status(c)]}</span></button>`).join('')||'<p class="map-empty">No contractors match these filters.</p>';
    document.querySelectorAll('#mapIndex [data-contractor]').forEach(el=>el.onclick=()=>{const id=el.dataset.contractor;selectMgmt(id);scene.focus(id);});
    const selected=all.find(c=>c.id===selMgmt),revision=selected?drawings.filter(d=>d.contractor===selected.id).at(-1):null;
    byId('mapCurrent').innerHTML=selected?`<div><span class="map-current-label">Selected work zone</span><strong>${esc(selected.name)}</strong><span>${esc(LOC[selected.id].zone)} · ${labels[status(selected)]}</span>${revision?`<small>Latest drawing: ${esc(revision.revision)} · ${esc(revision.title)}</small>`:''}</div><button class="btn ghost sm" id="focusContractor">Focus on contractor</button>`:'<span>Select a numbered pin or a contractor below.</span>';
    if(byId('focusContractor'))byId('focusContractor').onclick=()=>scene.focus(selMgmt);
    if(selected)byId('mapCurrent').innerHTML=byId('mapCurrent').innerHTML.replace('</strong>','</strong><small>'+esc(Worksite3D.features[selected.id].detail)+'</small>');
    if(byId('focusContractor'))byId('focusContractor').onclick=()=>scene.focus(selMgmt);
    byId('mapRevisionCount').textContent=drawings.length;byId('mapDrawings').innerHTML=drawings.slice(-5).reverse().map(d=>`<div><strong>${esc(d.revision)} · ${esc(d.title)}</strong><span>${esc(C(d.contractor).name)} · ${esc(d.zone||LOC[d.contractor]?.zone||'Site')}</span><small>${esc(d.note||'')}</small></div>`).join('')||'<p>No drawing revisions published yet.</p>';
    scene.refresh();
  }
  return {render,inspect(){return{...scene?.snapshot(),shown:shown.map(c=>c.id),selected:selMgmt};},reset(){scene?.destroy();scene=null;pinSignature='';Object.assign(ui,{query:'',kind:'all',status:'all',utilities:true,zones:true,equipment:true,labels:true,expanded:false});if(document.body)document.body.style.overflow='';byId('siteMap').innerHTML='';}};
})();

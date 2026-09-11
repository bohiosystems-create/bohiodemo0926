const TenderReview=(()=>{
  let selected=null,contract=null,awardedOnly=false;
  const name=p=>p.alt||C(p.contractor).name;
  function analysis(t){
    const ranked=scoreTender(t),task=state.tasks.find(x=>x.id===t.taskId),schedule=consolidate();
    const metrics=[['price','Cost',.30,true],['durationDays','Duration',.28,true],['riskPct','Delivery risk',.20,true],['rating','Rating',.10,false],['available','Availability',.12,true]];
    const value=(p,k)=>k==='rating'?ratingOf(p.contractor):k==='available'?D(p.availableFrom).getTime():p[k];
    const rows=ranked.map(p=>{
      const breakdown=metrics.map(([key,label,weight,inverse])=>{const values=ranked.map(x=>value(x,key)),lo=key==='rating'?3.5:Math.min(...values),hi=key==='rating'?5:Math.max(...values);const v=value(p,key),n=hi===lo?1:inverse?1-(v-lo)/(hi-lo):(v-lo)/(hi-lo);return {label,weight,points:n*weight*100};});
      const predecessor=task.dep?schedule.byId[task.dep]:null;
      const start=iso(new Date(Math.max(D(p.availableFrom),D(state.project.dataDate),predecessor?D(predecessor.forecast):0)));
      const finish=iso(addD(start,p.durationDays));
      return {...p,breakdown,start,finish,slip:days(task.pe,finish),predecessor};
    });
    return {task,rows,winner:rows[0],runner:rows[1]};
  }
  function comparison(p,other){
    if(!other)return 'This is the only submitted bid; competitive comparisons are unavailable.';
    const price=Math.round(Math.abs(p.price-other.price)*1000000).toLocaleString('en-US');
    const duration=p.durationDays-other.durationDays,risk=p.riskPct-other.riskPct;
    return `Compared with ${name(other)}, this bid ${p.price===other.price?'matches the price':`costs $${price} ${p.price<other.price?'less':'more'}`}, takes ${Math.abs(duration)} ${Math.abs(duration)===1?'day':'days'} ${duration===0?'difference in duration':duration<0?'less':'longer'}, and has ${Math.abs(risk)} percentage points ${risk===0?'difference in':'lower'&&(risk<0?'lower':'higher')} stated delivery risk.`;
  }
  function report(t,p,a,index){
    const other=index===0?a.runner:a.winner;
    const drivers=p.breakdown.map((m,i)=>({label:m.label,delta:m.points-(other?.breakdown[i].points||0)})).sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
    const reviews=(state.feedback||[]).filter(f=>f.contractor===p.contractor);
    return `<details class="bid-report"><summary>See more <span>Detailed evaluation report</span></summary><div class="bid-report-body">
      <h3>${index===0?'Why this bidder ranks first':'Why this bidder is not ranked first'}</h3>
      <p>${esc(name(p))} ranks ${index+1} of ${a.rows.length}, with ${p.score}/100 weighted points.${other?` The rounded score is ${Math.abs(p.score-other.score)} points ${p.score>=other.score?'above':'below'} ${esc(name(other))}.`:''} ${esc(comparison(p,other))}</p>
      ${other?`<p>The largest scoring differences are ${drivers.slice(0,3).map(m=>`${m.label.toLowerCase()} (${m.delta>=0?'+':''}${m.delta.toFixed(1)} points)`).join(', ')}. ${p.score===other.score?'The rounded scores tie; inspect the unrounded contributions below before deciding.':'These contributions explain the ranking under the current weights.'}</p>`:''}
      <h3>Score breakdown</h3><div class="tbl-wrap"><table><thead><tr><th>Criterion</th><th>Weight</th><th>Earned points</th></tr></thead><tbody>${p.breakdown.map(m=>`<tr><td>${m.label}</td><td>${Math.round(m.weight*100)}%</td><td>${m.points.toFixed(1)} / ${Math.round(m.weight*100)}</td></tr>`).join('')}</tbody></table></div>
      <p class="report-note">Cost, duration, availability and risk are normalized against bids in this tender. Ratings use a 3.5–5 scale. Equal values receive full points for that criterion. The sum is rounded to the displayed score; this is a comparison score, not a probability of success.</p>
      <h3>Schedule and dependency impact</h3><p>Bid availability: <b>${fmt(p.availableFrom)}</b>. ${p.predecessor?`The predecessor, ${esc(p.predecessor.name)}, is forecast to finish on <b>${fmt(p.predecessor.forecast)}</b>.`:''} Starting no earlier than availability, the project data date and predecessor completion gives an earliest modeled start of <b>${fmt(p.start)}</b>. At ${p.durationDays} days, modeled completion is <b>${fmt(p.finish)}</b> — ${p.slip>0?`${p.slip} days after`:p.slip<0?`${Math.abs(p.slip)} days before`:'on'} the package target of ${fmt(a.task.pe)}.</p>
      <p>${p.predecessor&&p.start>p.availableFrom?'Earlier availability does not immediately create an earlier start: predecessor completion is the constraint. ':''}This scenario assumes the proposed duration is achievable and does not model shift calendars, partial handovers or resource conflicts. ${p.slip>0?'An award alone does not recover this delay; require a coordinated recovery plan.':'Confirm readiness before treating this forecast as a commitment.'}</p>
      <h3>Evidence and delivery confidence</h3><p>Bid statement: “${esc(p.note)}”</p><p>The effective contractor rating is <b>${ratingOf(p.contractor).toFixed(1)}/5</b>, based on the baseline (equivalent to four reviews) and ${reviews.length} recorded ${reviews.length===1?'review':'reviews'}. The ${p.riskPct}% delivery-risk value is supplied demo data, not an independently validated AI estimate.${p.alt?' This alternative uses the named contractor’s rating; separate evidence for the JV or alternate crew has not been supplied.':''}</p>
      ${reviews.length?`<ul>${reviews.slice(0,3).map(f=>`<li>${fmt(f.ts.slice(0,10))} · ${f.rating}/5 — ${esc(f.note||f.tags.join(', '))}</li>`).join('')}</ul>`:'<p>No written reviews are available for this contractor.</p>'}
      <h3>Conditions before award</h3><ul><li>Confirm the quoted scope, exclusions, taxes and mobilization costs; the dataset contains headline prices only.</li><li>Obtain a resource-loaded schedule supporting the proposed ${p.durationDays}-day duration and the dependency handover.</li><li>${C(p.contractor).kind==='Robot'?'Verify site compatibility, supervision, safety arrangements, calibration and a fallback plan for fleet downtime.':'Verify named crew availability, subcontractor commitments, supervision and shift capacity.'}</li><li>Validate the risk estimate and request evidence for quality, safety and comparable completed work.</li></ul>
      <h3>Decision</h3><p>${index===0?`Prefer ${esc(name(p))} under the current scoring policy, subject to the checks above.`:`Keep ${esc(name(p))} as an alternative. It trails the leading bid under the current scoring policy; choose it only if verified scope, readiness or delivery evidence outweighs the documented score differences.`} The model does not evaluate legal terms, insurance, financial stability or missing scope. The award remains a human decision.</p>
    </div></details>`;
  }

  const statusName=s=>({done:'Complete',delayed:'Delayed',atrisk:'At risk',ontrack:'On track',notstarted:'Not started'}[s]||s);
  const awardedBid=id=>{const t=state.tenders.find(t=>t.taskId===id);return t?.awardedProposal||null;};
  function contractsList(){
    const rows=consolidate().rows.filter(r=>r.contractor);
    return `<div class="tender-intro"><div><h1>Awarded contracts</h1><p>View contract details and delivery progress.</p></div><span class="pill done">${rows.length} contracts</span></div><div class="tender-list">${rows.map(r=>{const p=awardedBid(r.id);return `<button class="tender-choice" onclick="TenderReview.contract('${r.id}')"><span><b>${esc(r.name)}</b><small>${esc(p?.alt||C(r.contractor).name)} · ${r.pct}% complete</small></span><span class="tender-choice-end"><span class="pill ${r.status}">${statusName(r.status)}</span><strong>View contract →</strong></span></button>`;}).join('')||'<p>No awarded contracts yet.</p>'}</div>`;
  }
  function contractDetail(id){
    const r=consolidate().byId[id];if(!r?.contractor){contract=null;render();return;}
    const c=C(r.contractor),p=awardedBid(id);
    const reports=state.reports.filter(x=>x.contractor===r.contractor&&x.date<=state.project.dataDate&&x.lines.some(l=>l.taskId===id)).reverse().sort((a,b)=>b.date.localeCompare(a.date));
    document.getElementById('openTenders').innerHTML=`<button class="btn ghost sm" onclick="TenderReview.back()">← All contracts and tenders</button><div class="tender-intro"><div><h1>${esc(r.name)}</h1><p>${esc(p?.alt||c.name)} · ${esc(c.discipline)}</p></div><span class="pill ${r.status}">${statusName(r.status)}</span></div><div class="grid2"><section class="bid-card"><h2>Contract overview</h2><dl class="bid-metrics"><div><dt>Contractor</dt><dd>${esc(p?.alt||c.name)}</dd></div><div><dt>Contractor type</dt><dd>${c.kind}</dd></div><div><dt>Contract value</dt><dd>${p?money(p.price):'Not recorded'}</dd></div><div><dt>Contract reference</dt><dd>${esc(r.id.toUpperCase())}</dd></div><div><dt>Planned start</dt><dd>${fmt(r.ps)}</dd></div><div><dt>Planned completion</dt><dd>${fmt(r.pe)}</dd></div></dl><h3>Scope of work</h3><p class="bid-reason">${esc(r.name)}.${p?' '+esc(p.note):' Detailed scope and commercial terms have not been supplied for this demo contract.'}</p>${p?`<dl class="bid-metrics"><div><dt>Awarded duration</dt><dd>${p.durationDays} days</dd></div><div><dt>Bid delivery risk</dt><dd>${p.riskPct}%</dd></div></dl>`:''}<p class="bid-reason" style="margin-top:16px">Signed contract documents, payment terms and variations are not attached.</p></section><section class="bid-card"><h2>Delivery progress</h2><div class="tender-intro"><b style="font-size:32px">${r.pct}%</b><span>Reported complete</span></div><div class="mbar"><i style="width:${r.pct}%"></i></div><dl class="bid-metrics"><div><dt>Actual start</dt><dd>${fmt(r.aStart)}</dd></div><div><dt>${r.aFinish?'Actual completion':'Forecast completion'}</dt><dd>${fmt(r.aFinish||r.forecast)}</dd></div><div><dt>Variance to plan</dt><dd>${r.varDays>0?r.varDays+' days late':r.varDays<0?Math.abs(r.varDays)+' days early':'On plan'}</dd></div><div><dt>Predecessor</dt><dd>${esc(r.depName||'None')}</dd></div></dl><h3>Progress reports</h3><div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Date</th><th>Complete</th></tr></thead><tbody>${reports.map(x=>`<tr><td>${fmt(x.date)}</td><td>${x.lines.find(l=>l.taskId===id).percent}%</td></tr>`).join('')||'<tr><td colspan="2">No progress reports submitted.</td></tr>'}</tbody></table></div></section></div>`;
  }

  function render(){
    renderBody();
    const host=document.getElementById('openTenders');
    host.innerHTML=`<div class="toolbar" style="margin-bottom:22px"><button class="btn ${!awardedOnly&&!contract?'':'ghost'}" onclick="TenderReview.list(false)">Open tenders (${state.tenders.filter(t=>!t.awardedTo).length})</button><button class="btn ${awardedOnly||contract?'':'ghost'}" onclick="TenderReview.list(true)">Awarded contracts (${state.tasks.filter(t=>t.contractor).length})</button></div>`+host.innerHTML;
  }
  function renderBody(){
    if(contract){contractDetail(contract);return;}
    if(awardedOnly){document.getElementById('openTenders').innerHTML=contractsList();return;}
    const el=document.getElementById('openTenders'),open=state.tenders.filter(t=>!t.awardedTo);
    if(selected&&!open.some(t=>t.taskId===selected))selected=null;
    if(!open.length){el.innerHTML='<div class="tender-empty"><h3>All tenders have been awarded</h3><p>No open tenders remain.</p></div>';return;}
    if(!selected){el.innerHTML=`<div class="tender-intro"><div><h1>Open tenders</h1><p>Select a package to compare bidders and review the recommendation.</p></div><span class="pill tender">${open.length} open</span></div><div class="tender-list">${open.map(t=>{const task=state.tasks.find(x=>x.id===t.taskId);return `<button class="tender-choice" onclick="TenderReview.open('${t.taskId}')"><span class="tender-symbol">↗</span><span><b>${esc(task.name)}</b><small>${fmt(task.ps)} – ${fmt(task.pe)}</small></span><span class="tender-choice-end">${t.proposals.length} bidders <strong>View tender →</strong></span></button>`;}).join('')}</div>`;return;}
    const t=open.find(t=>t.taskId===selected),a=analysis(t);
    el.innerHTML=`<button class="btn ghost sm" onclick="TenderReview.back()">← All open tenders</button><div class="tender-intro"><div><h1>${esc(a.task.name)}</h1><p>${a.rows.length} competing bids · Target completion ${fmt(a.task.pe)}</p></div><span class="pill tender">Awaiting award</span></div>
      <section class="ai-assessment"><div class="ai-label">AI bid review <span>Demo analysis</span></div><h2>${esc(name(a.winner))} is the leading bid</h2><p>${esc(comparison(a.winner,a.runner))}</p><p>${a.winner.slip>0?`Schedule caveat: modeled completion is ${a.winner.slip} days after the package target. Resolve predecessor delays alongside the award.`:`Modeled completion is ${fmt(a.winner.finish)}. Verify resource and handover assumptions before award.`}</p><small>Generated from the demo’s bid data and transparent scoring rules. No live AI service is connected.</small></section>
      <div class="bid-comparison">${a.rows.map((p,i)=>`<article class="bid-card ${i===0?'leading':''}"><div class="bid-card-head"><span class="bid-rank">${String(i+1).padStart(2,'0')}</span><div><h2>${esc(name(p))}</h2><span class="tag ${C(p.contractor).kind.toLowerCase()}">${C(p.contractor).kind}</span></div><span class="bid-score">${p.score}<small>/100</small></span></div>${i===0?'<div class="bid-leading">Recommended · strongest weighted fit</div>':''}<dl class="bid-metrics"><div><dt>Price</dt><dd>${money(p.price)}</dd></div><div><dt>Duration</dt><dd>${p.durationDays} days</dd></div><div><dt>Delivery risk</dt><dd>${p.riskPct}%</dd></div><div><dt>Available</dt><dd>${fmt(p.availableFrom)}</dd></div></dl><p class="bid-reason">${esc(comparison(p,i===0?a.runner:a.winner))}</p>${report(t,p,a,i)}<button class="btn ${C(p.contractor).kind==='Robot'?'robot':''}" onclick="award('${t.taskId}','${p.contractor}',${p.proposalIndex})">Award to this bidder</button></article>`).join('')}</div>`;
  }
  return {render,analysis,list(awarded){awardedOnly=awarded;selected=null;contract=null;render();},open(id){awardedOnly=false;contract=null;selected=id;render();},contract(id){selected=null;contract=id;render();},back(){contract=null;selected=null;render();}};
})();


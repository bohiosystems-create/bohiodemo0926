/* Makes a change made on Monday visible in the Bohio UI.
 *
 * index.html renders from state.tasks and had no idea the shared record
 * existed, so a status changed on the board never appeared here. This polls
 * /api/sync, merges what it finds into state.tasks, and re-renders. It is
 * additive: it only annotates, and if the endpoint is unavailable the page
 * behaves exactly as before.
 */
(function(){
  var EVERY=20000,        /* read the shared record often — it is cheap */
      PULL_EVERY=300000,   /* reconcile against the board rarely — it is not */
      last='', lastPull=0;
  /* Monday's own status labels mapped onto the vocabulary this UI filters by */
  function mapStatus(label){
    var s=String(label||'').toLowerCase();
    if(/done|complete|finished/.test(s)) return 'done';
    if(/stuck|block|hold/.test(s))       return 'delayed';
    if(/risk/.test(s))                   return 'atrisk';
    if(/working|progress|started/.test(s))return 'ontrack';
    return '';
  }
  function merge(remote){
    if(!window.state||!Array.isArray(window.state.tasks)) return false;
    var touched=false;
    window.state.tasks.forEach(function(t){
      var r=remote[t.id]; if(!r) return;
      if(r.status){
        var m=mapStatus(r.status);
        if(m&&t.status!==m){ t.status=m; touched=true; }
        if(t.liveStatus!==r.status){ t.liveStatus=r.status; touched=true; }
      }
      if(r.plannedFinish&&r.plannedFinish!==t.pe){ t.pe=r.plannedFinish; touched=true; }
      if(r.origin&&t.liveOrigin!==r.origin){ t.liveOrigin=r.origin; touched=true; }
    });
    return touched;
  }
  function badge(n){
    var el=document.getElementById('scheduleSyncTime');
    if(el&&n) el.textContent=el.textContent.replace(/ · .*$/,'')+' · '+n+' from Monday';
  }
  async function tick(){
    try{
      var now=Date.now(), pull=(now-lastPull)>PULL_EVERY;
      if(pull) lastPull=now;
      var r=await fetch('/api/sync'+(pull?'?pull=1':''),{cache:'no-store',headers:{Accept:'application/json'}});
      if(r.ok){
        var p=await r.json();
        if(p&&p.ok&&p.state){
          var sig=JSON.stringify(p.state);
          if(sig!==last){
            last=sig;
            var changed=merge(p.state);
            var n=Object.keys(p.state).filter(function(k){return p.state[k].origin==='monday';}).length;
            badge(n);
            if(changed&&typeof window.renderAll==='function'){ try{ window.save&&window.save(); }catch(e){} window.renderAll(); }
          }
        }
      }
    }catch(e){/* offline or not configured; the page carries on unchanged */}
    finally{ setTimeout(tick,EVERY); }
  }
  /* a manual change made in Bohio, pushed to Monday and the shared record */
  window.bohioPush=async function(taskId,patch,actor){
    try{
      var r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({taskId,actor:actor||'Bohio user'},patch||{}))});
      return await r.json();
    }catch(e){ return {ok:false,error:e.message}; }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(tick,1500);});
  else setTimeout(tick,1500);
})();

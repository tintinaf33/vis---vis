/* Vis-à-vis : interface utilisateur */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ICON = {
    ok:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="8" cy="12.4" r="1.4" fill="currentColor"/></svg>',
    err:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.3 4.3 7.4 7.4m0-7.4-7.4 7.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    info:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4" r="1.4" fill="currentColor"/><path d="M8 7v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };
  const SEV_TXT = {ok:'conforme', warn:'à vérifier', err:'bloquant', info:'information'};
  const RANK = {err:3, warn:2, info:1, ok:0};
  const state = { manual: [], filter: 'all', last: null };

  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }

  /* Liste des constructeurs, alimentée par le registre */
  for(const s of ['A','B']){
    $('ven'+s).innerHTML='<option value="auto">Détection automatique</option>'+VAV.vendors.map(v=>`<option value="${esc(v.id)}">${esc(v.label)} (${esc(v.models)})</option>`).join('');
  }
  const placeholder='Collez ici la sortie de :\n'+VAV.vendors.map(v=>v.label+' : '+v.exportCommand).join('\n');
  $('cfgA').placeholder=placeholder; $('cfgB').placeholder=placeholder;

  /* Détection en direct */
  function describe(side){
    const txt=$('cfg'+side).value, ven=$('ven'+side).value, el=$('det'+side);
    el.classList.remove('bad');
    if(!txt.trim()){ el.textContent='Collez une configuration ou ouvrez un fichier.'; return; }
    let d=null; try{ d=VAV.parse(txt, ven); }catch(e){ d=null; }
    if(!d){ el.classList.add('bad'); el.textContent='Format non reconnu : choisissez le constructeur dans la liste.'; return; }
    const s=VAV.summary(d);
    const v=VAV.adapter(d).formatLabel(d);
    el.innerHTML=`<strong>${esc(d.hostname||'Nom d’hôte introuvable')}</strong>, ${esc(v)} : ${s.physC} port(s), ${s.l3} interface(s) IP${s.protos.length?', '+esc(s.protos.join(', ')):''}.`;
  }
  let deb={};
  for(const s of ['A','B']){
    $('cfg'+s).addEventListener('input',()=>{ clearTimeout(deb[s]); deb[s]=setTimeout(()=>describe(s),250); });
    $('ven'+s).addEventListener('change',()=>describe(s));
    $('file'+s).addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f) return;
      const r=new FileReader(); r.onload=()=>{ $('cfg'+s).value=r.result; describe(s); toast('Fichier « '+f.name+' » chargé.'); }; r.readAsText(f);
      e.target.value='';
    });
  }
  $('demo').onclick=()=>{ $('cfgA').value=VAV.samples.a; $('cfgB').value=VAV.samples.b; $('venA').value='auto'; $('venB').value='auto'; state.manual=[]; describe('A'); describe('B'); run(); };
  $('clear').onclick=()=>{ for(const s of ['A','B']){ $('cfg'+s).value=''; $('ven'+s).value='auto'; describe(s);} state.manual=[]; $('report').hidden=true; $('report').innerHTML=''; };
  $('swap').onclick=()=>{ const a=$('cfgA').value, va=$('venA').value; $('cfgA').value=$('cfgB').value; $('venA').value=$('venB').value; $('cfgB').value=a; $('venB').value=va; state.manual=state.manual.map(p=>[p[1],p[0]]); describe('A'); describe('B'); if(!$('report').hidden) run(); };
  $('run').onclick=()=>run(true);
  document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); run(true); } });

  function worst(checks){ return checks.reduce((w,c)=>RANK[c.sev]>RANK[w]?c.sev:w,'ok'); }
  function counts(checks){ const c={err:0,warn:0,ok:0,info:0}; checks.forEach(x=>c[x.sev]++); return c; }

  function rowHtml(c){
    return `<div class="row ${c.sev}" data-sev="${c.sev}">
      <div class="va">${esc(c.a)}</div>
      <div class="mid"><span class="lbl">${esc(c.label)}</span><span class="wire"><span class="node" title="${SEV_TXT[c.sev]}">${ICON[c.sev]}<span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${SEV_TXT[c.sev]}</span></span></span></div>
      <div class="vb">${esc(c.b)}</div>
      <p class="msg">${esc(c.msg)}</p>
    </div>`;
  }
  function rowsByCat(checks){
    let html='', cat=null;
    for(const c of checks){ if(c.cat!==cat){ cat=c.cat; html+=`<div class="cat">${esc(cat)}</div>`; } html+=rowHtml(c); }
    return html;
  }
  const HOW = { auto:'Lien trouvé automatiquement : adresses dans le même sous-réseau.', description:'Lien déduit des descriptions d’interfaces (chaque côté cite l’autre).', 'manuel':'Paire ajoutée à la main.' };

  function run(scroll){
    const A=$('cfgA').value, B=$('cfgB').value;
    if(!A.trim()||!B.trim()){ toast('Collez une configuration de chaque côté.'); (A.trim()?$('cfgB'):$('cfgA')).focus(); return; }
    let r;
    try{ r=VAV.analyze(A,B,$('venA').value,$('venB').value,state.manual); }
    catch(e){ console.error(e); toast('Erreur de lecture : '+e.message); return; }
    if(r.error){ toast(r.error==='both'?'Aucun des deux formats n’est reconnu.':'Format du côté '+r.error+' non reconnu : choisissez le constructeur.'); return; }
    state.last=r; render(r);
    if(scroll) $('report').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth', block:'start'});
  }

  function render(r){
    const nA=r.A.hostname||'Côté A', nB=r.B.hostname||'Côté B';
    const all=[...r.links.flatMap(l=>l.checks), ...r.sessions.flatMap(s=>s.checks), ...r.global];
    const c=counts(all);
    const title = c.err ? `${c.err} problème${c.err>1?'s':''} bloquant${c.err>1?'s':''}${c.warn?`, ${c.warn} point${c.warn>1?'s':''} à vérifier`:''}`
      : c.warn ? `Rien de bloquant, ${c.warn} point${c.warn>1?'s':''} à vérifier` : 'Les deux configurations concordent';
    const devHead = `<div class="devnames"><span>${esc(nA)}</span><span></span><span>${esc(nB)}</span></div>`;
    let idx='', blocks='';
    let n=0;
    const addBlock=(group, titleHtml, plain, meta, checks, isLink)=>{
      const id='b'+(++n); const w=worst(checks); const cc=counts(checks);
      const bad=cc.err+cc.warn;
      idx+=`${group}<a href="#${id}"><span class="dot ${w}"></span><span class="t">${esc(plain)}</span><span class="n">${bad?bad+' à voir':'OK'}</span></a>`;
      blocks+=`<section class="block" id="${id}"><header class="bhead ${w}">${titleHtml}${meta?`<p class="bmeta">${esc(meta)}</p>`:''}</header>${devHead}${rowsByCat(checks)}<p class="empty" hidden>Rien à signaler avec ce filtre.</p></section>`;
    };
    const linkTitle=(a,b)=>`<h3><span class="ea">${esc(a)}</span><span class="wire"></span><span class="eb">${esc(b)}</span></h3>`;
    if(r.links.length){
      r.links.forEach((l,i)=>addBlock(i===0?'<h3>Liens</h3>':'', linkTitle(l.a.name,l.b.name), `${l.a.name} ↔ ${l.b.name}`, HOW[l.how]||'', l.checks, true));
    } else {
      idx+='<h3>Liens</h3><p style="margin:0;color:var(--muted);font-size:.88rem">Aucun lien trouvé.</p>';
    }
    if(r.sessions.length){
      r.sessions.forEach((s,i)=>{
        const a=s.a?s.a.ip:'non déclarée', b=s.b?s.b.ip:'non déclarée';
        addBlock(i===0?'<h3>Sessions BGP</h3>':'', `<h3><span class="ea">neighbor ${esc(a)}</span><span class="wire"></span><span class="eb">peer ${esc(b)}</span></h3>`, `BGP ${s.a?s.a.ip:'?'} / ${s.b?s.b.ip:'?'}`, s.a&&s.a.group?'Groupe Junos : '+s.a.group:'', s.checks);
      });
    }
    addBlock('<h3>Équipements</h3>', `<p class="title">Contrôles globaux</p>`, 'Identifiants et doublons', '', r.global);

    const noLinkMsg = r.links.length ? '' : `<section class="block"><p class="empty" style="color:var(--ink)">Aucun lien n’a été trouvé automatiquement : aucune adresse IP des deux équipements ne partage un sous-réseau, et aucune description ne cite l’autre équipement. Pour un lien de niveau 2 ou une interface sans IP, désignez la paire ci-dessous.</p></section>`;
    const optsA=VAV.pairable(r.A).map(x=>`<option>${esc(x)}</option>`).join(''), optsB=VAV.pairable(r.B).map(x=>`<option>${esc(x)}</option>`).join('');
    const manual=`<section class="block manual-block" id="manual"><header class="bhead"><p class="title">Comparer une autre paire d’interfaces</p></header>
      <p class="intro">Utile pour un trunk, un port d’accès ou un agrégat de niveau 2 que l’outil ne peut pas relier par l’adressage IP.</p>
      <div class="manual"><label>Interface sur ${esc(nA)}<select id="mA">${optsA}</select></label><span class="x">↔</span><label>Interface sur ${esc(nB)}<select id="mB">${optsB}</select></label><button class="btn primary" id="mAdd" type="button">Comparer cette paire</button></div>
      ${state.manual.length?`<p class="intro" style="padding-bottom:16px">Paires ajoutées : ${state.manual.map((p,i)=>`<code>${esc(p[0])} ↔ ${esc(p[1])}</code> <button class="ghost" data-del="${i}" type="button">Retirer</button>`).join(' ')}</p>`:''}
    </section>`;
    const raw=`<section class="block"><details class="raw"><summary>Ce que l’outil a compris de chaque configuration</summary>${rawTable(r.A)}${rawTable(r.B)}</details></section>`;

    $('report').innerHTML=`
      <div class="verdict">
        <div><h2>${esc(title)}</h2>
          <p class="tally"><span><span class="dot err"></span><b>${c.err}</b> bloquant${c.err>1?'s':''}</span><span><span class="dot warn"></span><b>${c.warn}</b> à vérifier</span><span><span class="dot"></span><b>${c.ok}</b> conforme${c.ok>1?'s':''}</span><span><span class="dot info"></span><b>${c.info}</b> information${c.info>1?'s':''}</span><span>${r.links.length} lien${r.links.length>1?'s':''}, ${r.sessions.length} session${r.sessions.length>1?'s':''} BGP</span></p>
        </div>
        <div class="tools">
          <div class="seg" role="group" aria-label="Filtrer les contrôles">
            <button type="button" data-f="all" aria-pressed="${state.filter==='all'}">Tout</button>
            <button type="button" data-f="issues" aria-pressed="${state.filter==='issues'}">Problèmes</button>
            <button type="button" data-f="err" aria-pressed="${state.filter==='err'}">Bloquants</button>
          </div>
          <button class="btn" id="copy" type="button">Copier le rapport</button>
        </div>
      </div>
      <div class="layout"><nav class="index" aria-label="Sommaire du rapport">${idx}<h3>Outils</h3><a href="#manual"><span class="t" style="font-family:var(--font);font-size:.9rem">Comparer une autre paire</span></a></nav>
      <div id="blocks">${noLinkMsg}${blocks}${manual}${raw}</div></div>`;
    $('report').hidden=false;
    applyFilter();
    $('report').querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{ state.filter=b.dataset.f; $('report').querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed', x===b)); applyFilter(); });
    $('copy').onclick=()=>copyReport(r);
    $('mAdd').onclick=()=>{ const p=[$('mA').value,$('mB').value]; if(!state.manual.some(x=>x[0]===p[0]&&x[1]===p[1])) state.manual.push(p); run(false); setTimeout(()=>{ const blocksEls=[...document.querySelectorAll('#blocks .block')]; const t=blocksEls.find(b=>b.querySelector('.ea')&&b.querySelector('.ea').textContent===p[0]&&b.querySelector('.eb').textContent===p[1]); if(t) t.scrollIntoView({block:'start'}); else { const any=blocksEls.find(b=>b.querySelector('.ea')&&b.querySelector('.ea').textContent.startsWith(p[0])&&b.querySelector('.eb').textContent.startsWith(p[1])); if(any) any.scrollIntoView({block:'start'}); toast(any?'Paire comparée.':'Cette paire est déjà analysée plus haut.'); } },0); };
    $('report').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ state.manual.splice(+b.dataset.del,1); run(false); });
  }

  function applyFilter(){
    const box=$('blocks'); if(!box) return;
    box.classList.toggle('filtered', state.filter!=='all');
    box.classList.toggle('filtered-err', state.filter==='err');
    box.querySelectorAll('.block').forEach(bl=>{
      const rows=[...bl.querySelectorAll('.row')]; if(!rows.length) return;
      const vis=r=> state.filter==='all' || r.dataset.sev==='err' || (state.filter==='issues' && r.dataset.sev==='warn');
      bl.querySelectorAll('.cat').forEach(cat=>{
        let el=cat.nextElementSibling, any=false;
        while(el && el.classList.contains('row')){ if(vis(el)) any=true; el=el.nextElementSibling; }
        cat.classList.toggle('allhidden', !any);
      });
      const e=bl.querySelector('.empty'); if(e) e.hidden = rows.some(vis);
    });
  }

  function rawTable(d){
    const rows=VAV.ifTable(d);
    const nb=d.bgp.neighbors.map(n=>`<tr><td>${esc(n.ip)}</td><td>${esc(n.peerAs||'?')}</td><td>${esc(n.group||'')}</td><td>${esc(n.localAddress||n.connectIf||'')}</td><td>${esc(n.families&&n.families.size?[...n.families].join(', '):'défaut')}</td><td>${n.multihop?'oui':''}</td><td>${n.auth?'oui':''}</td><td>${esc(n.vrf||'')}</td></tr>`).join('');
    return `<div class="tablewrap"><h4 style="font-family:var(--cond);font-size:1.1rem;margin:8px 0">${esc(d.hostname||'?')} <span style="color:var(--muted);font-weight:500">(${esc(VAV.adapter(d).label)})</span></h4>
    <table><thead><tr><th>Interface</th><th>Description</th><th>Adresses</th><th>MTU IP</th><th>VLAN</th><th>Agrégat</th><th>OSPF</th><th>IS-IS</th><th>LDP</th></tr></thead><tbody>
    ${rows.map(x=>`<tr><td class="${x.off?'off':''}">${esc(x.name)}</td><td>${esc(x.desc)}</td><td>${esc(x.ip)}</td><td>${esc(x.mtu)}</td><td>${esc(x.vlan)}</td><td>${esc(x.lag)}</td><td>${esc(x.ospf)}</td><td>${esc(x.isis)}</td><td>${esc(x.ldp)}</td></tr>`).join('')}
    </tbody></table>
    ${nb?`<table style="margin-top:14px"><thead><tr><th>Voisin BGP</th><th>AS distant</th><th>Groupe</th><th>Source</th><th>Familles</th><th>Multihop</th><th>Auth</th><th>VRF</th></tr></thead><tbody>${nb}</tbody></table>`:''}</div>`;
  }

  function copyReport(r){
    const nA=r.A.hostname||'A', nB=r.B.hostname||'B';
    const tag={ok:'[OK]  ',warn:'[A VOIR]',err:'[ERREUR]',info:'[INFO]'};
    const keep=c=> state.filter==='all' || c.sev==='err' || (state.filter==='issues'&&c.sev==='warn');
    const L=[`Rapport Vis-à-vis : ${nA} (A) / ${nB} (B)`, `Généré le ${new Date().toLocaleString('fr-FR')}`, ''];
    const sec=(t,checks)=>{ const cs=checks.filter(keep); if(!cs.length) return; L.push('== '+t); cs.forEach(c=>{ L.push(`${tag[c.sev]} ${c.cat} / ${c.label}`); L.push(`    A : ${c.a}`); L.push(`    B : ${c.b}`); if(c.msg) L.push(`    ${c.msg}`); }); L.push(''); };
    r.links.forEach(l=>sec(`Lien ${l.a.name} <-> ${l.b.name}`, l.checks));
    r.sessions.forEach(s=>sec(`Session BGP ${s.a?s.a.ip:'-'} / ${s.b?s.b.ip:'-'}`, s.checks));
    sec('Contrôles globaux', r.global);
    const text=L.join('\n');
    const fallback=()=>{ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} ta.remove(); toast(ok?'Rapport copié.':'Copie impossible ici : sélectionnez le texte à la main.'); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>toast('Rapport copié.'), fallback); else fallback();
  }
})();

// TuGymPR Manual — app shell: routing, rendering, language + theme toggles, connectors.
// Section-agnostic: any section in MANUAL.sections with ready:true and a matching
// MANUAL[sectionId] screen array is rendered identically (Member / Trainer / Admin).
(function(){
  const LS_LANG = 'tugym-manual-lang';
  const LS_THEME = 'tugym-manual-theme';
  const state = {
    lang: localStorage.getItem(LS_LANG) || 'es',
    theme: localStorage.getItem(LS_THEME) || 'dossier',
  };

  const root = document.getElementById('page-root');
  const sidebarNav = document.getElementById('sidebar-nav');
  const crumbEl = document.getElementById('crumb');

  // ---------- helpers ----------
  const t = (obj) => obj ? (obj[state.lang] || obj.es || obj.en || '') : '';
  const sectionById = (id) => MANUAL.sections.find(s=>s.id===id);
  const isSection = (id) => !!sectionById(id);
  const readySections = () => MANUAL.sections.filter(s=>s.ready && Array.isArray(MANUAL[s.id]) && MANUAL[s.id].length);
  const screensOf = (secId) => (MANUAL[secId] || []).slice().sort((a,b)=>a.order-b.order);

  const docById = (id) => (MANUAL.docs || []).find(d=>d.id===id) || null;
  const REF_KINDS = ['numbers','alerts','glossary'];
  const REF_LABEL = { numbers:{es:'Tus Números',en:'Your Numbers'}, alerts:{es:'Alertas',en:'Alerts'}, glossary:{es:'Glosario',en:'Glossary'} };

  // BOOK — the single ordered spine of the whole manual, derived from MANUAL.book.
  // Every consumer (folios, sidebar, TOC, prev/next, print) reads from this.
  const BOOK = (() => {
    const seq = [{ type:'cover', key:'cover' }];
    (MANUAL.book || []).forEach(g => {
      if (g.kind === 'docs') (g.items || []).forEach(id => { if (docById(id)) seq.push({ type:'doc', id, key:'d/'+id, group:g }); });
      else if (g.kind === 'section') { const sec = sectionById(g.id); if (sec && sec.ready) screensOf(g.id).forEach(s => seq.push({ type:'screen', sec:g.id, id:s.id, key:g.id+'/'+s.id, group:g, screen:s })); }
      else if (g.kind === 'ref') REF_KINDS.forEach(k => seq.push({ type:'ref', kind:k, key:k, group:g }));
    });
    return seq;
  })();
  const PAGE_SEQUENCE = BOOK.map(e=>e.key);
  function folioFor(routeKey){
    const key = routeKey === '' ? 'cover' : routeKey;
    const i = PAGE_SEQUENCE.indexOf(key);
    return i < 0 ? null : { n: i+1, total: PAGE_SEQUENCE.length };
  }

  // Label + href for any routeKey — used by the continuous prev/next book nav.
  function routeMeta(routeKey){
    if (routeKey === 'cover') return { href:'#/', label:{es:'Portada',en:'Cover'} };
    if (REF_KINDS.includes(routeKey)) return { href:'#/'+routeKey, label: REF_LABEL[routeKey] };
    if (routeKey.slice(0,2) === 'd/'){ const d = docById(routeKey.slice(2)); return { href:'#/'+routeKey, label: d ? (d.navtitle||d.title) : {es:'',en:''} }; }
    const [secId, id] = routeKey.split('/');
    const screen = findScreen(secId, id);
    return { href:'#/'+routeKey, label: screen ? screen.title : {es:'',en:''} };
  }

  function renderSheetFooter(folio){
    return `<div class="sheet-footer">
      <div class="sf-brand"><span class="sf-mark" aria-hidden="true"></span><span class="mono">TuGymPR</span></div>
      <span class="mono">${state.lang==='es'?'Manual de la App':'App Manual'}</span>
      <span class="mono">${folio ? String(folio.n).padStart(2,'0') + ' / ' + folio.total : ''}</span>
    </div>`;
  }

  function wrapSheet(bodyHtml, folio, sheetClass){
    return `<div class="sheet ${sheetClass||''}"><div class="sheet-body">${bodyHtml}</div>${renderSheetFooter(folio)}</div>`;
  }
  const chunk = (arr,n) => { const r=[]; for(let i=0;i<arr.length;i+=n) r.push(arr.slice(i,i+n)); return r; };

  function findScreen(sectionId, screenId){
    if (!isSection(sectionId)) return null;
    return screensOf(sectionId).find(s=>s.id===screenId) || null;
  }

  // ---------- sidebar ----------
  function buildSidebar(){
    let html = `<a class="nav-ref-link" href="#/" data-route="cover">${state.lang==='es'?'Portada':'Cover'}</a>`;
    (MANUAL.book || []).forEach(g=>{
      if (g.kind === 'ref'){
        html += `<div class="nav-divider"></div>`;
        REF_KINDS.forEach(k=> html += `<a class="nav-ref-link" href="#/${k}" data-route="${k}">${t(REF_LABEL[k])}</a>`);
        return;
      }
      const isSec = g.kind === 'section';
      const items = isSec ? screensOf(g.id) : (g.items || []).map(docById).filter(Boolean);
      const ready = isSec ? (sectionById(g.id) && sectionById(g.id).ready && items.length) : items.length;
      const count = isSec ? sectionById(g.id).count : items.length;
      const label = g.label || (isSec ? sectionById(g.id).label : {es:'',en:''});
      html += `<div class="nav-group collapsed ${ready?'':'disabled'}" data-sec="${g.id}">
        <div class="nav-group-head" data-toggle="${g.id}"><span class="t">${t(label)}</span><span class="c">${count}</span></div>
        <div class="nav-group-body">`;
      if (ready){
        if (isSec) items.forEach(s=> html += `<a class="nav-link" href="#/${g.id}/${s.id}" data-route="${g.id}/${s.id}"><span class="n">${String(s.order).padStart(2,'0')}</span>${t(s.title)}</a>`);
        else items.forEach((d,i)=> html += `<a class="nav-link" href="#/d/${d.id}" data-route="d/${d.id}"><span class="n">${String(i+1).padStart(2,'0')}</span>${t(d.navtitle||d.title)}</a>`);
      } else html += `<div class="nav-soon">${state.lang==='es' ? 'Próximamente' : 'Coming soon'}</div>`;
      html += `</div></div>`;
    });
    sidebarNav.innerHTML = html;

    sidebarNav.querySelectorAll('[data-toggle]').forEach(headEl=>{
      headEl.addEventListener('click', ()=>{
        const group = headEl.closest('.nav-group');
        if (group.classList.contains('disabled')) return;
        group.classList.toggle('collapsed');
      });
    });
  }

  function setActiveNav(routeKey){
    sidebarNav.querySelectorAll('[data-route]').forEach(a=>{
      a.classList.toggle('active', a.dataset.route === routeKey);
    });
    const active = sidebarNav.querySelector('[data-route="'+(window.CSS && CSS.escape ? CSS.escape(routeKey) : routeKey)+'"]');
    if (active){ const gr = active.closest('.nav-group'); if (gr) gr.classList.remove('collapsed'); }
  }

  // ---------- wireframe + callouts ----------
  function renderAnnotRow(screen){
    const els = screen.elements;
    // Assign each element to a left or right callout column: by horizontal
    // position when clear, balanced by running count when centered/full-width.
    let leftCount = 0, rightCount = 0;
    const side = els.map(e=>{
      const cx = e.x + e.w/2;
      let s;
      if (cx < 45) s = 'left';
      else if (cx > 55) s = 'right';
      else s = leftCount <= rightCount ? 'left' : 'right';
      if (s==='left') leftCount++; else rightCount++;
      return s;
    });

    const wireHtml = els.map((e,i)=>{
      const anchorX = side[i]==='left' ? Math.max(e.x, 2) : Math.min(e.x + e.w, 98);
      const anchorY = e.y + e.h/2;
      return `<div class="el ${e.type}" style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%"></div>
        <div class="anchor" data-idx="${i}" style="left:${anchorX}%;top:${anchorY}%"></div>`;
    }).join('');

    function calloutsFor(want){
      const dot = '<div class="row-dot"></div>';
      const txt = (e)=>`<div class="txt"><b>${t(e.label)}</b><span>${t(e.desc)}</span></div>`;
      return els.map((e,i)=>({e,i})).filter(({i})=>side[i]===want)
        .sort((a,b)=>a.e.y - b.e.y)
        .map(({e,i})=>`<div class="callout-row" data-idx="${i}">
          ${want==='left' ? txt(e) + dot : dot + txt(e)}
        </div>`).join('');
    }

    return `<div class="annot-row">
      <svg class="connector-svg"></svg>
      <div class="callout-list side-left">${calloutsFor('left')}</div>
      <div class="phone-wire">
        <div class="phone-notch"></div>
        ${wireHtml}
        <div class="phone-home"></div>
      </div>
      <div class="callout-list side-right">${calloutsFor('right')}</div>
    </div>`;
  }

  // Desktop (admin) stage: a browser-framed wireframe with numbered regions
  // and a numbered legend below — cleaner than leader lines on a wide layout.
  function renderDesktop(screen){
    const els = screen.elements;
    const wire = els.map((e,i)=>
      `<div class="el ${e.type}" style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%"></div>
       <div class="el-num" style="left:${e.x}%;top:${e.y}%">${i+1}</div>`).join('');
    const legend = els.map((e,i)=>
      `<div class="legend-item"><span class="legend-num">${i+1}</span>
        <div class="txt"><b>${t(e.label)}</b><span>${t(e.desc)}</span></div></div>`).join('');
    return `<div class="desktop-stage">
      <div class="desktop-wire"><div class="desktop-chrome"><i></i><i></i><i></i></div>${wire}</div>
      <div class="legend-grid">${legend}</div>
    </div>`;
  }

  function renderStage(screen){
    return screen.aspect === 'desktop' ? renderDesktop(screen) : renderAnnotRow(screen);
  }

  function renderFactCards(screen){
    let html = '';
    if (screen.calculates){
      html += `<div class="fact-band"><div class="lbl">${state.lang==='es'?'Qué calcula':'What it calculates'}</div><p>${t(screen.calculates)}</p></div>`;
    }
    if (screen.alert){
      html += `<div class="fact-band"><div class="lbl">${state.lang==='es'?'Qué alerta dispara':'What alert it fires'}</div><p>${t(screen.alert)}</p></div>`;
    }
    return html ? `<div class="facts-grid">${html}</div>` : '';
  }

  function renderPlaybook(screen){
    if (!screen.usage) return '';
    return `<div class="playbook-box">
      <div class="lbl">${state.lang==='es'?'Uso recomendado':'Recommended use'}</div>
      <p>${t(screen.usage)}</p>
    </div>`;
  }

  function screenBody(sectionId, screen){
    const list = screensOf(sectionId);
    const secLabel = t(sectionById(sectionId).label);
    const caption = state.lang==='es'
      ? 'Marcador de pantalla — se reemplaza por la captura real.'
      : 'Screen placeholder — swapped for the real screenshot.';
    return `
      <div class="folio-mark" aria-hidden="true">${String(screen.order).padStart(2,'0')}</div>
      <div class="page-eyebrow">${secLabel} · ${String(screen.order).padStart(2,'0')} / ${list.length}</div>
      <h1 class="page-title">${t(screen.title)}</h1>
      <div class="what-block"><p>${t(screen.what)}</p></div>
      <div class="stage-panel">
        ${renderStage(screen)}
        <div class="stage-caption mono">${caption}</div>
      </div>
      ${renderPlaybook(screen)}
      ${renderFactCards(screen)}`;
  }
  function renderScreenPage(sectionId, screen){
    return wrapSheet(screenBody(sectionId, screen), folioFor(sectionId + '/' + screen.id));
  }

  // Continuous prev/next across the whole book (cover → sections → reference).
  function renderPageNav(routeKey){
    const i = PAGE_SEQUENCE.indexOf(routeKey);
    if (i < 0) return '';
    const prevKey = i > 0 ? PAGE_SEQUENCE[i-1] : null;
    const nextKey = i < PAGE_SEQUENCE.length-1 ? PAGE_SEQUENCE[i+1] : null;
    const link = (key, dir, cls) => {
      if (!key) return '<div></div>';
      const m = routeMeta(key);
      return `<a class="${cls}" href="${m.href}"><div class="dir">${dir}</div><div class="lbl">${t(m.label)}</div></a>`;
    };
    return `<div class="pagenav">
      ${link(prevKey, state.lang==='es'?'Anterior':'Previous', 'prev')}
      ${link(nextKey, state.lang==='es'?'Siguiente':'Next', 'next')}
    </div>`;
  }

  function renderCover(){
    const c = (MANUAL.front && MANUAL.front.cover) || {};
    const statCols = ['member','trainer','admin'].map(id=>{
      const sec = sectionById(id);
      return `<div class="stat-col"><div class="stat-num">${String(sec.count).padStart(2,'0')}</div><div class="stat-label">${t(sec.label)}</div><div class="stat-note">${state.lang==='es'?'recorrido completo':'full walkthrough'}</div></div>`;
    }).join('') + `<div class="stat-col"><div class="stat-num dash">+</div><div class="stat-label">${state.lang==='es'?'Referencia':'Reference'}</div><div class="stat-note">${state.lang==='es'?'Números · Alertas · Glosario':'Numbers · Alerts · Glossary'}</div></div>`;
    return `
      <div class="cover-hero">
        <div class="page-eyebrow">${t(c.eyebrow)}</div>
        <div class="cover-wordmark">TuGym<span class="accent">PR</span></div>
        <div class="cover-sub">${state.lang==='es'?'Manual de Implementación':'Implementation Manual'}</div>
        <div class="cover-meta mono">${t(c.meta)}</div>
      </div>
      <div class="cover-rule"></div>
      <p class="cover-lede">${t(c.lede)}</p>
      <div class="cover-stats">${statCols}</div>
      <div class="cover-version mono">${t(c.version)}</div>`;
  }

  // ---------- front-matter pages (user's Claude Design) ----------
  function frontHead(doc){
    return `<div class="folio-mark" aria-hidden="true">${doc.folioMark||''}</div>
      <div class="page-eyebrow">${t(doc.eyebrow)}</div>
      <h1 class="page-title">${t(doc.title)}</h1>`;
  }
  function renderMission(doc){
    const m = MANUAL.front.mission; const li = items => items.map(i=>`<li>${t(i)}</li>`).join('');
    return `${frontHead(doc)}
      <div class="mission-subhead">${t(m.subheadHtml)}</div>
      <p class="mission-para">${t(m.para[0])}</p>
      <p class="mission-para">${t(m.para[1])}</p>
      <div class="contrast-grid">
        <div class="contrast-card is-without"><div class="lbl">${t(m.without.label)}</div><ul>${li(m.without.items)}</ul></div>
        <div class="contrast-card is-with"><div class="lbl">${t(m.withSystem.label)}</div><ul>${li(m.withSystem.items)}</ul></div>
      </div>`;
  }
  function renderUsecaseCards(cards){
    return `<div class="usecase-grid">${cards.map((c,i)=>`<div class="usecase-card"><div class="num mono">0${i+1}</div><h3>${t(c.title)}</h3><ul>${c.items.map(it=>`<li>${t(it)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  function renderHowToUse(doc){
    const h = MANUAL.front.howToUse;
    return `${frontHead(doc)}
      <p class="page-lede">${t(h.lede)}</p>
      ${renderUsecaseCards(h.cards)}
      <div class="playbook-box"><div class="lbl">${state.lang==='es'?'Sugerencia':'Tip'}</div><p>${t(h.tip)}</p></div>`;
  }
  function renderRoles(doc){
    const r = MANUAL.front.roles;
    return `${frontHead(doc)}<p class="page-lede">${t(r.lede)}</p>${renderUsecaseCards(r.cards)}`;
  }
  function renderSystemLoop(doc){
    const s = MANUAL.front.systemLoop;
    const step = (st,i) => `<div class="loop-step"><div class="n mono">0${i+1}</div><h4>${t(st.title)}</h4><p>${t(st.sub)}</p></div>`;
    const arrow = `<div class="loop-arrow">&rarr;</div>`;
    const [s1,s2,s3,s4,s5,s6] = s.steps;
    return `${frontHead(doc)}
      <p class="page-lede">${t(s.lede)}</p>
      <div class="loop-block">
        <div class="loop-row">${step(s1,0)}${arrow}${step(s2,1)}${arrow}${step(s3,2)}</div>
        <div class="loop-row-arrow">&darr;</div>
        <div class="loop-row">${step(s4,3)}${arrow}${step(s5,4)}${arrow}${step(s6,5)}</div>
        <div class="loop-note mono">&#8635; ${t(s.loopNote)}</div>
      </div>
      <div class="loop-closing"><p>${t(s.closing)}</p></div>`;
  }

  // Chapter-style table of contents, built from the live BOOK (correct ready states + routes).
  function renderTOC(){
    const bullet = it => `<a class="toc-item is-link" href="${it.href}">${t(it.label)}</a>`;
    const rows = (MANUAL.book || []).map((g,gi)=>{
      let body;
      if (g.kind === 'section'){
        const sec = sectionById(g.id); const first = screensOf(g.id)[0];
        const note = { es: sec.count+' pantallas · recorrido completo', en: sec.count+' screens · full walkthrough' };
        body = `<h3><a href="#/${g.id}/${first.id}">${t(g.label)}</a></h3><div class="toc-note">${t(note)}</div>`;
      } else {
        const items = g.kind === 'ref'
          ? REF_KINDS.map(k=>({ href:'#/'+k, label:REF_LABEL[k] }))
          : (g.items||[]).map(docById).filter(Boolean).map(d=>({ href:'#/d/'+d.id, label:d.navtitle||d.title }));
        const mid = Math.ceil(items.length/2);
        body = `<h3>${t(g.label)}</h3><div class="toc-cols"><div class="toc-col">${items.slice(0,mid).map(bullet).join('')}</div><div class="toc-col">${items.slice(mid).map(bullet).join('')}</div></div>`;
      }
      return `<div class="toc-chapter"><div class="toc-num mono">${String(gi+1).padStart(2,'0')}</div><div class="toc-body">${body}</div></div>`;
    }).join('');
    return `<div class="toc-list">${rows}</div>`;
  }
  function renderContents(doc){ return `${frontHead(doc)}${renderTOC()}`; }

  // ---------- editorial (front matter, playbooks, scripts, closing) ----------
  function renderFlow(b){
    const steps = b.steps.map((s,i)=>`<div class="flow-step"><span class="fs-n">${String(i+1).padStart(2,'0')}</span><b>${t(s.title)}</b>${s.text?`<span>${t(s.text)}</span>`:''}</div>`);
    return `<div><div class="doc-flow">${steps.join('<div class="flow-arrow">&rarr;</div>')}</div>${b.loop?`<div class="flow-loop">&#8635; <b>${t(b.loop)}</b></div>`:''}</div>`;
  }

  function renderBlock(b){
    switch(b.type){
      case 'lede': return `<p class="doc-lede">${t(b.text)}</p>`;
      case 'statement': return `<div class="doc-statement">${t(b.text)}</div>`;
      case 'p': return `<p class="doc-p">${t(b.text)}</p>`;
      case 'h': return `<h2 class="doc-h">${t(b.text)}</h2>`;
      case 'list': return `<ul class="doc-list">${b.items.map(i=>`<li>${t(i)}</li>`).join('')}</ul>`;
      case 'numlist': return `<ol class="doc-numlist">${b.items.map(i=>`<li>${t(i)}</li>`).join('')}</ol>`;
      case 'checklist': return `<ul class="doc-check">${b.items.map(i=>`<li>${t(i)}</li>`).join('')}</ul>`;
      case 'cols': return `<div class="doc-cols">${b.cols.map(c=>`<div class="doc-col"><div class="doc-col-h">${t(c.head)}</div><ul>${c.items.map(i=>`<li>${t(i)}</li>`).join('')}</ul></div>`).join('')}</div>`;
      case 'timeline': return `<div class="doc-timeline">${b.rows.map(r=>`<div class="tl-row"><div class="tl-label">${t(r.label)}</div><div class="tl-body"><b>${t(r.title)}</b><span>${t(r.text)}</span></div></div>`).join('')}</div>`;
      case 'phases': return `<div class="doc-phases">${b.phases.map(p=>`<div class="phase-card"><div class="phase-tag">${t(p.tag)}</div><h3>${t(p.title)}</h3><ul>${p.items.map(x=>`<li>${t(x)}</li>`).join('')}</ul></div>`).join('')}</div>`;
      case 'script': return `<div class="doc-scripts">${b.scripts.map(s=>`<div class="script-card"><div class="script-when">${t(s.when)}</div><p class="script-text">${t(s.text)}</p></div>`).join('')}</div>`;
      case 'callout': return `<div class="playbook-box"><div class="lbl">${t(b.label || {es:'Qué hacer',en:'What to do'})}</div><p>${t(b.text)}</p></div>`;
      case 'kv': return `<div class="doc-kv">${b.rows.map(r=>`<div class="kv-row"><div class="kv-k">${t(r.k)}</div><div class="kv-v">${t(r.v)}</div></div>`).join('')}</div>`;
      case 'flow': return renderFlow(b);
      case 'toc': return renderTOC();
      default: return '';
    }
  }

  function renderBackCover(doc){
    return `<div class="backcover-inner">
      <div class="backcover-statement">${t(doc.statement)}</div>
      <div class="backcover-url">${t(doc.url || {es:'TuGymPR.com',en:'TuGymPR.com'})}</div>
    </div>`;
  }

  const FRONT_RENDERERS = { mission:renderMission, howToUse:renderHowToUse, systemLoop:renderSystemLoop, roles:renderRoles, contents:renderContents };
  function renderDoc(doc){
    if (doc.kind === 'backcover') return renderBackCover(doc);
    if (doc.front && FRONT_RENDERERS[doc.front]) return FRONT_RENDERERS[doc.front](doc);
    return `
      ${doc.folioMark ? `<div class="folio-mark" aria-hidden="true">${doc.folioMark}</div>` : ''}
      <div class="page-eyebrow">${t(doc.eyebrow || {es:'Manual',en:'Manual'})}</div>
      <h1 class="page-title doc-title">${t(doc.title)}</h1>
      <div class="doc-blocks">${(doc.blocks || []).map(renderBlock).join('')}</div>`;
  }

  function renderNumbers(items, opts){
    items = items || MANUAL.numbers; opts = opts || {};
    const cards = items.map(n=>`<div class="ref-card">
      <h3>${t(n.title)}</h3>${n.formula ? `<div class="ref-formula mono">${t(n.formula)}</div>` : ''}<p>${t(n.body)}</p>
    </div>`).join('');
    return `
      <div class="page-eyebrow">${state.lang==='es'?'Referencia':'Reference'}${opts.cont?' · cont.':''}</div>
      <h1 class="page-title">${state.lang==='es'?'Tus Números':'Your Numbers'}</h1>
      ${opts.cont ? '' : `<div class="page-lede">${state.lang==='es'
        ? 'Cada métrica que ves en la app, explicada — de dónde sale y qué significa.'
        : 'Every metric you see in the app, explained — where it comes from and what it means.'}</div>`}
      <div class="ref-list">${cards}</div>`;
  }

  function renderAlerts(items, opts){
    items = items || MANUAL.alerts; opts = opts || {};
    const cards = items.map(a=>`<div class="ref-card">
      <h3>${t(a.title)}</h3>
      <div class="k">${state.lang==='es'?'Qué lo dispara':'What triggers it'}</div><p>${t(a.trigger)}</p>
      <div class="k">${state.lang==='es'?'Qué hacer':'What to do'}</div><p>${t(a.action)}</p>
    </div>`).join('');
    return `
      <div class="page-eyebrow">${state.lang==='es'?'Referencia':'Reference'}${opts.cont?' · cont.':''}</div>
      <h1 class="page-title">${state.lang==='es'?'Alertas':'Alerts'}</h1>
      ${opts.cont ? '' : `<div class="page-lede">${state.lang==='es'
        ? 'Cada alerta del sistema: qué la activa y qué hacer al respecto.'
        : 'Every system alert: what triggers it and what to do about it.'}</div>`}
      <div class="ref-list">${cards}</div>`;
  }

  function renderGlossary(items, opts){
    items = items || MANUAL.glossary; opts = opts || {};
    const rows = items.map(g=>`<div class="glossary-row"><dt>${t(g.term)}</dt><dd>${t(g.def)}</dd></div>`).join('');
    return `
      <div class="page-eyebrow">${state.lang==='es'?'Referencia':'Reference'}${opts.cont?' · cont.':''}</div>
      <h1 class="page-title">${state.lang==='es'?'Glosario':'Glossary'}</h1>
      <dl class="glossary-list ref-list">${rows}</dl>`;
  }

  // ---------- connectors ----------
  function drawConnectors(scope){
    scope.querySelectorAll('.annot-row').forEach(row=>{
      const svg = row.querySelector('.connector-svg');
      if (!svg) return;
      const rowRect = row.getBoundingClientRect();
      svg.innerHTML = '';
      row.querySelectorAll('.anchor').forEach(a=>{
        const idx = a.dataset.idx;
        const targetDot = row.querySelector(`.callout-row[data-idx="${idx}"] .row-dot`);
        if (!targetDot) return;
        const ar = a.getBoundingClientRect();
        const tr = targetDot.getBoundingClientRect();
        const x1 = ar.left + ar.width/2 - rowRect.left;
        const y1 = ar.top + ar.height/2 - rowRect.top;
        const x2 = tr.left + tr.width/2 - rowRect.left;
        const y2 = tr.top + tr.height/2 - rowRect.top;
        const midX = x1 + (x2-x1)*0.55;
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class','connector-line');
        svg.appendChild(path);
        const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
        dot.setAttribute('cx', x1); dot.setAttribute('cy', y1); dot.setAttribute('r', 3);
        dot.setAttribute('class','connector-dot');
        svg.appendChild(dot);
      });
    });
  }

  // ---------- routing ----------
  function parseHash(){
    const h = location.hash.replace(/^#\/?/, '');
    return h.split('/').filter(Boolean);
  }

  function render(){
    const parts = parseHash();
    let html, routeKey = '', crumb = '';

    if (parts.length === 0){
      html = wrapSheet(renderCover(), folioFor('cover'), 'cover-sheet'); routeKey = 'cover';
      crumb = `<b>TuGymPR</b> / ${state.lang==='es'?'Manual':'Manual'}`;
    } else if (parts[0] === 'numbers'){
      html = wrapSheet(renderNumbers(), folioFor('numbers')); routeKey = 'numbers';
      crumb = `<b>${state.lang==='es'?'Tus Números':'Your Numbers'}</b>`;
    } else if (parts[0] === 'alerts'){
      html = wrapSheet(renderAlerts(), folioFor('alerts')); routeKey = 'alerts';
      crumb = `<b>${state.lang==='es'?'Alertas':'Alerts'}</b>`;
    } else if (parts[0] === 'glossary'){
      html = wrapSheet(renderGlossary(), folioFor('glossary')); routeKey = 'glossary';
      crumb = `<b>${state.lang==='es'?'Glosario':'Glossary'}</b>`;
    } else if (parts[0] === 'd' && parts[1]){
      const doc = docById(parts[1]);
      if (doc){
        html = wrapSheet(renderDoc(doc), folioFor('d/'+doc.id), doc.kind==='backcover' ? 'backcover' : '');
        routeKey = 'd/' + doc.id;
        crumb = `<b>${t(doc.title)}</b>`;
      }
    } else if (isSection(parts[0]) && parts[1]){
      const screen = findScreen(parts[0], parts[1]);
      if (screen){
        html = renderScreenPage(parts[0], screen);
        routeKey = parts[0] + '/' + screen.id;
        crumb = `${t(sectionById(parts[0]).label)} / <b>${t(screen.title)}</b>`;
      }
    }
    if (!html){ html = wrapSheet(renderCover(), folioFor('cover'), 'cover-sheet'); routeKey = 'cover'; crumb = `<b>TuGymPR</b> / ${state.lang==='es'?'Manual':'Manual'}`; }

    const navHtml = renderPageNav(routeKey);

    root.innerHTML = `${html}${navHtml}`;
    crumbEl.innerHTML = crumb;
    setActiveNav(routeKey);
    requestAnimationFrame(()=>drawConnectors(root));
    window.scrollTo(0,0);
  }

  // ---------- print ----------
  function buildPrintDoc(){
    const printRoot = document.getElementById('print-doc');
    const pages = [];
    const refMap = { numbers:[MANUAL.numbers,3,renderNumbers], alerts:[MANUAL.alerts,4,renderAlerts], glossary:[MANUAL.glossary,9,renderGlossary] };
    BOOK.forEach(e=>{
      if (e.type === 'cover') pages.push({ body: renderCover(), sheet:'cover-sheet' });
      else if (e.type === 'screen') pages.push({ body: screenBody(e.sec, e.screen) });
      else if (e.type === 'doc'){ const d = docById(e.id); if (!d) return;
        if (d.kind === 'backcover') pages.push({ body: renderDoc(d), sheet:'backcover' });
        else if (d.front) pages.push({ body: renderDoc(d), sheet: 'front-sheet' }); // fixed height so bottom-pinned cards land right
        else pages.push({ body: renderDoc(d), cls:'rp' }); }
      else if (e.type === 'ref'){ const [arr,per,fn] = refMap[e.kind];
        chunk(arr, per).forEach((sl,i)=> pages.push({ body: fn(sl,{cont:i>0}), cls:'rp' })); }
    });
    const total = pages.length;
    printRoot.innerHTML = pages.map((p,i)=>
      `<div class="print-page ${p.cls||''}">${wrapSheet(p.body, { n:i+1, total }, p.sheet)}</div>`).join('');
    drawConnectors(printRoot);
  }

  // ---------- toggles ----------
  function applyLang(lang){
    state.lang = lang; localStorage.setItem(LS_LANG, lang);
    document.documentElement.dataset.lang = lang;
    document.querySelectorAll('[data-lang-btn]').forEach(b=>b.classList.toggle('active', b.dataset.langBtn===lang));
    buildSidebar();
    render();
  }
  function applyTheme(theme){
    state.theme = theme; localStorage.setItem(LS_THEME, theme);
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-btn]').forEach(b=>b.classList.toggle('active', b.dataset.themeBtn===theme));
    requestAnimationFrame(()=>drawConnectors(root));
  }

  // ---------- init ----------
  document.documentElement.dataset.lang = state.lang;
  document.documentElement.dataset.theme = state.theme;
  buildSidebar();

  document.querySelectorAll('[data-lang-btn]').forEach(b=>{
    b.classList.toggle('active', b.dataset.langBtn===state.lang);
    b.addEventListener('click', ()=>applyLang(b.dataset.langBtn));
  });
  document.querySelectorAll('[data-theme-btn]').forEach(b=>{
    b.classList.toggle('active', b.dataset.themeBtn===state.theme);
    b.addEventListener('click', ()=>applyTheme(b.dataset.themeBtn));
  });

  window.addEventListener('hashchange', render);
  let resizeT;
  window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>drawConnectors(root), 120); });
  window.addEventListener('beforeprint', buildPrintDoc);

  render();
})();

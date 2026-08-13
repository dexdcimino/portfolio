// ══════════════════════════════════════════════════════
//  dexnote — EMOJI PICKER MODULE
// ══════════════════════════════════════════════════════

import { isGuest } from './auth.js';
import { _edUndoSnap } from './undo.js';

/* ══════════════════════════════════════
   EMOJI PICKER
══════════════════════════════════════ */

/* ── Emoji picker state ── */
const EMOJI_FREQ_KEY = 'dexnotes_emoji_freq';
const _defaultEmojis = ['😂','❤️','👍','😊','🔥','😍','🎉','✨','🙏'];
let _emojiData = null;
let _emojiLoading = false;
let _emojiFreq = {};
export let _emojiActiveCell = -1;
export function setEmojiActiveCell(v) { _emojiActiveCell=v; }
export let _emojiTarget = null;
export let _emojiIsInput = false;
export let _emojiColonIdx = -1;
export function setEmojiColonIdx(v) { _emojiColonIdx=v; }
export let _emojiTextNode = null;
export function setEmojiTextNode(v) { _emojiTextNode=v; }
export let _emojiCursorOffset = -1;
export function setEmojiCursorOffset(v) { _emojiCursorOffset=v; }

export function _loadEmojiFreq() {
  if (isGuest()) return;
  try { const raw=localStorage.getItem(EMOJI_FREQ_KEY); if (raw) _emojiFreq=JSON.parse(raw); } catch(e) {}
}
function _saveEmojiFreq() {
  if (isGuest()) return;
  try { localStorage.setItem(EMOJI_FREQ_KEY,JSON.stringify(_emojiFreq)); } catch(e) {}
}
function _bumpEmojiFreq(emoji) {
  _emojiFreq[emoji]=(_emojiFreq[emoji]||0)+1;
  _saveEmojiFreq();
}
function _topFreqEmojis(n) {
  return Object.entries(_emojiFreq).sort((a,b)=>b[1]-a[1]).slice(0,n).map(e=>e[0]);
}
function _loadEmojiData(cb) {
  if (_emojiData) { cb(_emojiData); return; }
  if (_emojiLoading) return;
  _emojiLoading=true;
  fetch('https://cdn.jsdelivr.net/npm/emojibase-data@15/en/compact.json')
    .then(r=>r.json())
    .then(data=>{ _emojiData=data.filter(e=>e.unicode&&e.group!==undefined); _emojiLoading=false; cb(_emojiData); })
    .catch(()=>{ _emojiLoading=false; });
}
const _customImageEmojis = [
  { id: 'flag-us', label: 'United States', tags: ['flag','united','states','america','usa','us','american'], src: 'assets/flag-us.svg', alt: '\u{1f1fa}\u{1f1f8}' }
];
function _searchEmojis(query,limit) {
  if (!query) return [];
  const q=query.toLowerCase();
  const scored=[];
  // Search custom image emojis first (e.g. US flag)
  for (const ce of _customImageEmojis) {
    let score=0;
    const words=ce.label.split(' ');
    if (words.some(w=>w===q)) score=10;
    else if (words.some(w=>w.startsWith(q))) score=9;
    else if (ce.tags.some(t=>t===q)) score=10;
    else if (ce.tags.some(t=>t.startsWith(q))) score=9;
    if (score>0) scored.push({unicode:'__flag__'+ce.id,label:ce.label,score,len:ce.label.length,order:-1,_custom:ce});
  }
  if (!_emojiData) return scored.slice(0,limit);
  for (const e of _emojiData) {
    let score=0;
    const label=e.label.toLowerCase();
    if (label===q) score=5;
    else if (label.split(' ').some(w=>w===q)) score=4.5;
    else if (label.startsWith(q)) score=4;
    else if (label.split(' ').some(w=>w.startsWith(q))) score=3;
    else if (label.includes(q)) score=2;
    else if (e.tags&&e.tags.some(t=>t.startsWith(q))) score=1;
    if (score>0) scored.push({unicode:e.unicode,label:e.label,score,len:label.length,order:e.order||0});
  }
  scored.sort((a,b)=>b.score-a.score||a.len-b.len||a.order-b.order);
  return scored.slice(0,limit);
}
export function _detectColonQuery(el) {
  if (el.tagName==='INPUT'||el.tagName==='TEXTAREA') {
    const pos=el.selectionStart;
    const before=el.value.slice(0,pos);
    const colonIdx=before.lastIndexOf(':');
    if (colonIdx===-1) return null;
    const query=before.slice(colonIdx+1);
    if (!/^[a-zA-Z]{0,20}$/.test(query)) return null;
    return {query,colonIdx,pos};
  } else {
    const sel=window.getSelection();
    if (!sel||!sel.rangeCount||!sel.isCollapsed) return null;
    const node=sel.anchorNode;
    if (!node||node.nodeType!==3) return null;
    const offset=sel.anchorOffset;
    const text=node.textContent.slice(0,offset);
    const colonIdx=text.lastIndexOf(':');
    if (colonIdx===-1) return null;
    const query=text.slice(colonIdx+1);
    if (!/^[a-zA-Z]{0,20}$/.test(query)) return null;
    return {query,colonIdx,pos:offset,textNode:node,cursorOffset:offset};
  }
}
export function _renderEmojiPicker(results,freqEmojis) {
  const pick=document.getElementById('emoji-pick'); if (!pick) return;
  const grid=document.createElement('div');
  grid.className='emoji-grid';
  const shown=new Set();
  // Main rows: search results or defaults (6 slots)
  const pool=results.length>0?results:_defaultEmojis.map(d=>{const m=_emojiData?.find(e=>e.unicode===d);return{unicode:d,label:m?.label||''};});
  const mainItems=pool.slice(0,6);
  mainItems.forEach(r=>{
    shown.add(r.unicode);
    const btn=document.createElement('button');
    btn.className='emoji-cell'; btn.type='button';
    if (r._custom) {
      btn.innerHTML=`<img src="${r._custom.src}" alt="${r._custom.alt}" class="emoji-flag" style="width:1.2em;height:1.2em;vertical-align:middle;object-fit:contain;" draggable="false">`;
      btn.dataset.emoji='__flag__'+r._custom.id;
    } else {
      btn.textContent=r.unicode;
      btn.dataset.emoji=r.unicode;
    }
    btn.dataset.tip=r.label||r.unicode;
    grid.appendChild(btn);
  });
  // Always show separator + 3 bottom cells (frequent or empty)
  const freq=freqEmojis.slice(0,3);
  const sep=document.createElement('div');sep.className='emoji-freq-sep';grid.appendChild(sep);
  for(let i=0;i<3;i++){
    const btn=document.createElement('button');btn.type='button';
    if(i<freq.length){
      const em=freq[i];
      btn.className='emoji-cell emoji-freq-cell';btn.dataset.emoji=em;
      if(em.startsWith('__flag__')){
        const ce=_customImageEmojis.find(c=>'__flag__'+c.id===em);
        if(ce)btn.innerHTML=`<img src="${ce.src}" alt="${ce.alt}" class="emoji-flag" style="width:1.2em;height:1.2em;vertical-align:middle;object-fit:contain;" draggable="false">`;
        btn.dataset.tip=ce?.label||'flag';
      } else {
        const emLabel=_emojiData?.find(e=>e.unicode===em)?.label||em;
        btn.textContent=em;btn.dataset.tip=emLabel;
      }
      const xBtn=document.createElement('span');xBtn.className='emoji-freq-x';xBtn.innerHTML='&times;';
      xBtn.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();});
      xBtn.addEventListener('click',e=>{
        e.stopPropagation();delete _emojiFreq[em];_saveEmojiFreq();
        const nf=_topFreqEmojis(3);const info=_emojiTarget?_detectColonQuery(_emojiTarget):null;
        const q=info?.query||'';const res=q.length>0?_searchEmojis(q,9):[];
        _renderEmojiPicker(res,nf);
      });
      btn.appendChild(xBtn);
    } else {
      btn.className='emoji-cell emoji-freq-cell emoji-freq-empty';btn.disabled=true;
    }
    grid.appendChild(btn);
  }
  pick.innerHTML='';
  pick.appendChild(grid);
  // Highlight: if no search results, highlight first most-used at bottom; else first result at top
  const allCells=grid.querySelectorAll('.emoji-cell');
  if (results.length===0&&freq.length>0) {
    _emojiActiveCell=mainItems.length; // first freq cell (after separator)
  } else {
    _emojiActiveCell=0;
  }
  if (_emojiActiveCell>=0&&_emojiActiveCell<allCells.length) {
    allCells[_emojiActiveCell].classList.add('active');
  }
  // Show expand toggle button below picker
  _showToggleBtn('expand');
}

/* ── Toggle buttons (appended to body, positioned below picker) ── */
function _ensureToggleBtn(id,svgHTML,tip){
  let btn=document.getElementById(id);
  if(!btn){
    btn=document.createElement('button');btn.id=id;btn.className='emoji-expand-toggle';btn.type='button';
    btn.innerHTML=svgHTML;btn.dataset.tip=tip;btn.dataset.tipPos='below';
    btn.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();});
    btn.addEventListener('click',e=>{e.stopPropagation();_toggleExpandedPicker();});
    document.body.appendChild(btn);
  }
  return btn;
}
const _expSVG='<svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="8" y="1" width="5" height="5" rx="1"/><rect x="1" y="8" width="5" height="5" rx="1"/><rect x="8" y="8" width="5" height="5" rx="1"/></svg>';
const _colSVG='<svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>';
function _showToggleBtn(mode){
  const expBtn=_ensureToggleBtn('emoji-expand-toggle-btn',_expSVG,'More emojis');
  const colBtn=_ensureToggleBtn('emoji-collapse-toggle-btn',_colSVG,'Compact view');
  if(mode==='expand'){expBtn.style.display='flex';colBtn.style.display='none';}
  else{expBtn.style.display='none';colBtn.style.display='flex';}
  requestAnimationFrame(()=>{
    const pick=document.getElementById('emoji-pick');if(!pick)return;
    const pr=pick.getBoundingClientRect();
    const active=mode==='expand'?expBtn:colBtn;
    active.style.position='fixed';active.style.zIndex='9501';
    const bw=active.offsetWidth||28,bh=active.offsetHeight||28;
    const btnLeft=pr.left-bw-4;
    if(btnLeft<4){active.style.left=pr.left+'px';active.style.top=(pr.bottom+4)+'px';}
    else{active.style.left=btnLeft+'px';active.style.top=(pr.bottom-bh)+'px';}
  });
}
function _positionToggleBtn(){
  const pick=document.getElementById('emoji-pick');if(!pick)return;
  const pr=pick.getBoundingClientRect();
  const btnId=_expandedPickerOpen?'emoji-collapse-toggle-btn':'emoji-expand-toggle-btn';
  const btn=document.getElementById(btnId);
  if(btn&&btn.style.display!=='none'){
    const bw=btn.offsetWidth||28,bh=btn.offsetHeight||28;
    const btnLeft=pr.left-bw-4;
    if(btnLeft<4){btn.style.left=pr.left+'px';btn.style.top=(pr.bottom+4)+'px';}
    else{btn.style.left=btnLeft+'px';btn.style.top=(pr.bottom-bh)+'px';}
  }
}
function _hideToggleBtns(){
  const e=document.getElementById('emoji-expand-toggle-btn');if(e)e.style.display='none';
  const c=document.getElementById('emoji-collapse-toggle-btn');if(c)c.style.display='none';
}

/* ── Expanded emoji panel ── */
let _expandedPickerOpen=false;
let _compactPickerPos=null;
let _savedRange=null;
let _expSearchHandler=null;
function _toggleExpandedPicker(){
  _expandedPickerOpen=!_expandedPickerOpen;
  const pick=document.getElementById('emoji-pick');if(!pick)return;
  if(_expandedPickerOpen){
    _compactPickerPos={left:pick.style.left,top:pick.style.top};
    // Save editor selection before expanded panel renders
    const sel=window.getSelection();
    if(sel&&sel.rangeCount&&_emojiTarget) _savedRange=sel.getRangeAt(0).cloneRange();
    _hideToggleBtns();
    _renderExpandedPanel(pick);
  } else{
    _hideToggleBtns();
    pick.classList.remove('emoji-expanded');
    const freq=_topFreqEmojis(3);
    if(_emojiTarget){
      const info=_detectColonQuery(_emojiTarget);
      const query=info?.query||'';
      _loadEmojiData(()=>{
        const results=query.length>0?_searchEmojis(query,9):[];
        _renderEmojiPicker(results,freq);
        if(_compactPickerPos){pick.style.left=_compactPickerPos.left;pick.style.top=_compactPickerPos.top;}
        else _positionEmojiPicker();
      });
    } else {
      _renderEmojiPicker([],freq);
      if(_compactPickerPos){pick.style.left=_compactPickerPos.left;pick.style.top=_compactPickerPos.top;}
    }
  }
}
function _renderExpandedPanel(pick){
  pick.innerHTML='';pick.classList.add('emoji-expanded');
  // Search bar
  const searchWrap=document.createElement('div');searchWrap.className='emoji-exp-search-wrap';
  const searchInput=document.createElement('input');searchInput.type='text';searchInput.className='emoji-exp-search';
  searchInput.placeholder='Search emojis...';searchInput.spellcheck=false;searchInput.autocomplete='off';
  searchWrap.appendChild(searchInput);pick.appendChild(searchWrap);
  // Category tabs
  const categories=[
    {id:0,label:'Faces',icon:'😀'},{id:1,label:'People',icon:'👋'},{id:3,label:'Animals',icon:'🐱'},
    {id:4,label:'Food',icon:'🍕'},{id:5,label:'Travel',icon:'🏠'},{id:6,label:'Activities',icon:'⚽'},
    {id:7,label:'Objects',icon:'💡'},{id:8,label:'Symbols',icon:'❤️'},{id:9,label:'Flags',icon:'🏁'},
    {id:-1,label:'Custom',icon:'⭐'}
  ];
  const tabBar=document.createElement('div');tabBar.className='emoji-exp-tabs';
  let activeGroup=0;
  categories.forEach(cat=>{
    const tab=document.createElement('button');tab.className='emoji-exp-tab';tab.type='button';
    tab.textContent=cat.icon;tab.dataset.tip=cat.label;tab.dataset.group=cat.id;
    if(cat.id===activeGroup)tab.classList.add('active');
    tab.addEventListener('click',e=>{
      e.stopPropagation();activeGroup=cat.id;
      tabBar.querySelectorAll('.emoji-exp-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      _renderExpandedGrid(gridContainer,cat.id,'');searchInput.value='';
    });
    tabBar.appendChild(tab);
  });
  pick.appendChild(tabBar);
  // Scrollable grid
  const gridContainer=document.createElement('div');gridContainer.className='emoji-exp-grid-wrap';
  pick.appendChild(gridContainer);
  _renderExpandedGrid(gridContainer,activeGroup,'');
  // Search handler
  searchInput.addEventListener('input',()=>{
    const q=searchInput.value.trim().toLowerCase();
    if(q.length>0){
      tabBar.querySelectorAll('.emoji-exp-tab').forEach(t=>t.classList.remove('active'));
      _renderExpandedGrid(gridContainer,-2,q);
    } else {
      tabBar.querySelector(`[data-group="${activeGroup}"]`)?.classList.add('active');
      _renderExpandedGrid(gridContainer,activeGroup,'');
    }
  });
  searchInput.addEventListener('mousedown',e=>e.stopPropagation());
  searchInput.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape')_toggleExpandedPicker();});
  // Save editor selection if user clicks search input
  searchInput.addEventListener('focus',()=>{
    const sel=window.getSelection();
    if(sel&&sel.rangeCount&&_emojiTarget) _savedRange=sel.getRangeAt(0).cloneRange();
  });
  // Forward keystrokes to search when expanded (editor keeps focus)
  if(_expSearchHandler)document.removeEventListener('keydown',_expSearchHandler,true);
  _expSearchHandler=function(e){
    if(!_expandedPickerOpen)return;
    if(e.key==='Escape'){e.preventDefault();_toggleExpandedPicker();return;}
    // Skip if search input is focused (it handles its own input)
    if(document.activeElement===searchInput)return;
    if(e.key==='Backspace'){e.preventDefault();searchInput.value=searchInput.value.slice(0,-1);searchInput.dispatchEvent(new Event('input'));return;}
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();searchInput.value+=e.key;searchInput.dispatchEvent(new Event('input'));return;}
  };
  document.addEventListener('keydown',_expSearchHandler,true);
  _positionEmojiPicker();
  requestAnimationFrame(()=>{_positionEmojiPicker();_showToggleBtn('collapse');requestAnimationFrame(_positionToggleBtn);});
}
function _renderExpandedGrid(container,groupId,searchQuery){
  container.innerHTML='';
  const grid=document.createElement('div');grid.className='emoji-exp-grid';
  let emojis=[];
  if(groupId===-1){
    _customImageEmojis.forEach(ce=>{
      const btn=document.createElement('button');btn.className='emoji-cell emoji-exp-cell';btn.type='button';
      btn.innerHTML=`<img src="${ce.src}" alt="${ce.alt}" class="emoji-flag" style="width:1.4em;height:1.4em;vertical-align:middle;object-fit:contain;" draggable="false">`;
      btn.dataset.emoji='__flag__'+ce.id;btn.dataset.tip=ce.label;
      btn.addEventListener('click',e=>{e.stopPropagation();if(_emojiTarget){_emojiTarget.focus({preventScroll:true});if(_savedRange){const s=window.getSelection();s.removeAllRanges();s.addRange(_savedRange);}}_insertEmoji(btn.dataset.emoji);_savedRange=null;_closeEmojiPicker();});
      grid.appendChild(btn);
    });
    if(!_customImageEmojis.length){const empty=document.createElement('div');empty.className='emoji-exp-empty';empty.textContent='No custom emojis yet';grid.appendChild(empty);}
  } else if(groupId===-2&&searchQuery){
    emojis=_searchEmojis(searchQuery,60);
  } else if(_emojiData){
    emojis=_emojiData.filter(e=>e.group===groupId).slice(0,200);
  }
  emojis.forEach(em=>{
    const btn=document.createElement('button');btn.className='emoji-cell emoji-exp-cell';btn.type='button';
    if(em._custom){
      btn.innerHTML=`<img src="${em._custom.src}" alt="${em._custom.alt}" class="emoji-flag" style="width:1.4em;height:1.4em;vertical-align:middle;object-fit:contain;" draggable="false">`;
      btn.dataset.emoji='__flag__'+em._custom.id;
    } else {
      btn.textContent=em.unicode||em;btn.dataset.emoji=em.unicode||em;
    }
    btn.dataset.tip=em.label||'';
    btn.addEventListener('click',e=>{e.stopPropagation();if(_emojiTarget){_emojiTarget.focus({preventScroll:true});if(_savedRange){const s=window.getSelection();s.removeAllRanges();s.addRange(_savedRange);}}_insertEmoji(btn.dataset.emoji);_savedRange=null;_closeEmojiPicker();});
    grid.appendChild(btn);
  });
  container.appendChild(grid);
}

function _positionEmojiPicker() {
  const pick=document.getElementById('emoji-pick'); if (!pick) return;
  pick.style.bottom=''; pick.style.transform='';
  let rect;
  if (_emojiIsInput) {
    rect=_emojiTarget?.getBoundingClientRect();
  } else {
    const sel=window.getSelection();
    if (sel&&sel.rangeCount) {
      const range=sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      rect=range.getBoundingClientRect();
      if (rect.width===0&&rect.height===0) rect=_emojiTarget?.getBoundingClientRect();
    } else {
      rect=_emojiTarget?.getBoundingClientRect();
    }
  }
  if (!rect) return;
  const isExp=pick.classList.contains('emoji-expanded');
  const pickW=pick.offsetWidth||(isExp?320:120),pickH=pick.offsetHeight||(isExp?380:140);
  const extraBot=36; // space for toggle button below
  let left=rect.left, top=rect.bottom+4;
  if (left+pickW>window.innerWidth-8) left=window.innerWidth-pickW-8;
  if (left<8) left=8;
  if (top+pickH+extraBot>window.innerHeight-8) {
    top=rect.top-pickH-extraBot-4;
    if (top<8) top=8;
  }
  pick.style.left=left+'px';
  pick.style.top=top+'px';
}
export function _closeEmojiPicker() {
  const pick=document.getElementById('emoji-pick');
  if (pick) { pick.classList.remove('open','emoji-expanded'); pick.style.left=''; pick.style.top=''; pick.style.bottom=''; pick.style.transform=''; }
  _expandedPickerOpen=false;_compactPickerPos=null;_savedRange=null;_hideToggleBtns();
  if(_expSearchHandler){document.removeEventListener('keydown',_expSearchHandler,true);_expSearchHandler=null;}
  _emojiActiveCell=-1; _emojiTarget=null; _emojiTextNode=null; _emojiColonIdx=-1; _emojiCursorOffset=-1;
}
export function _updateEmojiPicker(query,el,isInput) {
  _emojiTarget=el; _emojiIsInput=isInput;
  _loadEmojiData(()=>{
    const freq=_topFreqEmojis(3);
    const results=query.length>0?_searchEmojis(query,9):[];
    // Close only if searching and no matches found
    if (query.length>0&&results.length===0) { _closeEmojiPicker(); return; }
    _renderEmojiPicker(results,freq);
    _positionEmojiPicker();
    document.getElementById('emoji-pick')?.classList.add('open');
  });
}
export function _insertEmoji(emoji) {
  if (!_emojiTarget) return;
  if (_emojiIsInput) {
    const el=_emojiTarget;
    const before=el.value.slice(0,_emojiColonIdx);
    const after=el.value.slice(el.selectionStart);
    const ins=emoji.startsWith('__flag__')?'\u{1f1fa}\u{1f1f8}':emoji;
    el.value=before+ins+after;
    const newPos=before.length+ins.length;
    el.setSelectionRange(newPos,newPos);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  } else {
    // Undo snapshot before emoji insertion
    const _emojiEd=_emojiTarget?.closest?.('.note-ed');
    if(_emojiEd) _edUndoSnap(_emojiEd);
    // Use saved text node and colon index (more reliable than re-detecting,
    // especially for sec-title-el which can lose selection state)
    let node=_emojiTextNode;
    let colonIdx=_emojiColonIdx;
    // Fallback: try re-detecting if saved values are missing
    if (!node||colonIdx<0) {
      const info=_detectColonQuery(_emojiTarget);
      if (!info||!info.textNode) { _closeEmojiPicker(); return; }
      node=info.textNode;
      colonIdx=info.colonIdx;
    }
    _emojiTarget.focus();
    // endIdx = saved cursor position from when picker opened
    let endIdx=_emojiCursorOffset>=0?_emojiCursorOffset:colonIdx+1;
    if (endIdx<=colonIdx) {
      endIdx=colonIdx+1;
      const textContent=node.textContent||'';
      while(endIdx<textContent.length&&/[a-zA-Z0-9_]/.test(textContent[endIdx])) endIdx++;
    }
    const range=document.createRange();
    range.setStart(node,colonIdx);
    range.setEnd(node,endIdx);
    range.deleteContents();
    if (emoji.startsWith('__flag__')) {
      const ce=_customImageEmojis.find(c=>'__flag__'+c.id===emoji);
      if (ce) {
        const img=document.createElement('img');
        img.src=ce.src; img.alt=ce.alt; img.className='emoji-flag'; img.draggable=false;
        range.insertNode(img);
        range.setStartAfter(img);
      }
    } else {
      const emojiNode=document.createTextNode(emoji);
      range.insertNode(emojiNode);
      range.setStartAfter(emojiNode);
    }
    range.collapse(true);
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    _emojiTarget.dispatchEvent(new Event('input',{bubbles:true}));
    if(_emojiEd) _edUndoSnap(_emojiEd);
  }
  _bumpEmojiFreq(emoji);
  if (window._dexUnlockAch) window._dexUnlockAch('use_emoji');
  _closeEmojiPicker();
}

// ── Window bridges for play mode chat emoji ──
let _chatEmojiMode = false;

window._dexOpenChatEmoji = function(query, colonIdx) {
  _chatEmojiMode = true;
  _emojiTarget = null;
  _emojiIsInput = false;
  _emojiColonIdx = colonIdx;
  _loadEmojiData(() => {
    const freq = _topFreqEmojis(3);
    const results = query.length > 0 ? _searchEmojis(query, 9) : [];
    if (query.length > 0 && results.length === 0) { _closeEmojiPicker(); return; }
    _renderEmojiPicker(results, freq);
    const pick = document.getElementById('emoji-pick');
    if (pick) {
      pick.style.bottom = ''; pick.style.transform = '';
      pick.classList.add('open');
      const pickH = pick.offsetHeight;
      const chatCursor = window._dexGetChatCursorPos?.();
      if (chatCursor) {
        pick.style.left = chatCursor.x + 'px';
        pick.style.top = (chatCursor.y - pickH - 4) + 'px';
      } else {
        pick.style.left = '60px';
        pick.style.top = (window.innerHeight - 280) + 'px';
      }
    }
  });
};
window._dexCloseChatEmoji = function() { _closeEmojiPicker(); _chatEmojiMode = false; };
// General cross-module bridge so auth.js / init.js can close the picker without
// needing to import _closeEmojiPicker directly
window._dexCloseEmojiPicker = _closeEmojiPicker;
window._dexIsChatEmojiMode = function() { return _chatEmojiMode; };
window._dexHandleEmojiNav = function(e) {
  const cells = [...document.querySelectorAll('#emoji-pick .emoji-cell')];
  if (!cells.length) return;
  if (_emojiActiveCell >= 0) cells[_emojiActiveCell]?.classList.remove('active');
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') _emojiActiveCell = (_emojiActiveCell + 1) % cells.length;
  else _emojiActiveCell = (_emojiActiveCell - 1 + cells.length) % cells.length;
  cells[_emojiActiveCell]?.classList.add('active');
};
window._dexSelectActiveEmoji = function() {
  const cells = [...document.querySelectorAll('#emoji-pick .emoji-cell')];
  if (_emojiActiveCell >= 0 && _emojiActiveCell < cells.length) {
    const emoji = cells[_emojiActiveCell].dataset.emoji;
    if (emoji && window._dexInsertChatEmoji) window._dexInsertChatEmoji(emoji);
    _bumpEmojiFreq(emoji);
  }
  _closeEmojiPicker();
  _chatEmojiMode = false;
};
window._dexChatEmojiInserted = function(emoji) { _bumpEmojiFreq(emoji); };
window._dexBumpEmojiFreq = function(emoji) { _bumpEmojiFreq(emoji); };

'use strict';
const $ = id => document.getElementById(id);
const connectForm = $('connectForm'), connectBtn = $('connectBtn');
const versionSelect = $('version');
async function populateVersionList() {
  if (!versionSelect || !window.mcClient.getSupportedVersions) return;
  const previouslySelected = versionSelect.value;
  try {
    const versions = await window.mcClient.getSupportedVersions();
    if (!Array.isArray(versions) || !versions.length) return;
    versionSelect.replaceChildren();
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Auto detect (recommended)';
    versionSelect.appendChild(auto);
    const group = document.createElement('optgroup');
    group.label = 'Supported Minecraft releases';
    for (const version of versions) {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = version;
      group.appendChild(option);
    }
    versionSelect.appendChild(group);
    if ([...versionSelect.options].some(option => option.value === previouslySelected)) {
      versionSelect.value = previouslySelected;
    } else {
      versionSelect.value = 'auto';
    }
  } catch (err) {
    console.warn('Could not load supported Minecraft versions:', err);
  }
}

const worldFrame = $('worldFrame'), capture = $('capture');
const placeholder = document.querySelector('.world-placeholder');
let connected = false, locked = false, paused = false, yaw = 0, pitch = 0, sensitivity = 0.0022, selectedSlot = 0;
let latestState = {}, heldCodes = new Set(), chatOpen = false;
let targetYaw=0,targetPitch=0,renderYaw=0,renderPitch=0,lookFrame=0;
const keyControls = new Map([
  ['KeyW','forward'],['ArrowUp','forward'],['KeyS','back'],['ArrowDown','back'],
  ['KeyA','left'],['ArrowLeft','left'],['KeyD','right'],['ArrowRight','right'],
  ['Space','jump'],['ShiftLeft','sneak'],['ShiftRight','sneak'],
  ['ControlLeft','sprint'],['ControlRight','sprint']
]);
const itemSymbols = {stone:'▦',dirt:'▪',grass_block:'▩',oak_planks:'▤',cobblestone:'▧',diamond:'◆',diamond_pickaxe:'⛏',wooden_pickaxe:'⛏',iron_ingot:'●',apple:'●',bread:'▰',torch:'♨',oak_log:'▤',stick:'╱'};
function log(message, type='system') {
  const line=document.createElement('div'); line.className=`log-line ${type}`; line.textContent=String(message ?? ''); $('log').appendChild(line); $('log').scrollTop=$('log').scrollHeight;
}
function showToast(message) { const el=$('toast'); el.textContent=message; el.hidden=false; clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>el.hidden=true,2600); }
function setLoginStatus(message, isError=false) { $('connectStatus').textContent=message; $('connectStatus').classList.toggle('error',isError); }
function setControl(code, down) {
  const control=keyControls.get(code); if(!control) return;
  const was=heldCodes.has(code);
  if(down && !was) { heldCodes.add(code); window.mcClient.control(control,true); }
  else if(!down && was) {
    heldCodes.delete(code);
    if(![...heldCodes].some(k=>keyControls.get(k)===control)) window.mcClient.control(control,false);
  }
}
function releaseAll() { for(const code of [...heldCodes]) setControl(code,false); heldCodes.clear(); window.mcClient.releaseControls(); }
function lockPointer() { if(connected&&!paused) capture.requestPointerLock?.(); }
function setPaused(value) {
  if(!connected) return;
  paused=Boolean(value);
  $('pauseOverlay').hidden=!paused;
  if(paused) { releaseAll(); if(document.pointerLockElement) document.exitPointerLock(); $('pauseStatus').textContent=`Connected as ${latestState.username||$('username').value}`; }
  else { $('captureHint').classList.remove('hidden'); }
}
function showGame() { $('loginScreen').hidden=true; $('gameScreen').hidden=false; paused=false; $('pauseOverlay').hidden=true; }
function showLogin() {
  connected=false; paused=false; locked=false; chatOpen=false; releaseAll();
  if(document.pointerLockElement) document.exitPointerLock();
  $('gameScreen').hidden=true; $('loginScreen').hidden=false; $('pauseOverlay').hidden=true; $('chatOverlay').hidden=true;
  worldFrame.hidden=true; worldFrame.src='about:blank'; placeholder.hidden=false;
  $('gameHud').style.display='flex'; connectBtn.disabled=false;
}
function renderIcons(id,value,type) {
  const el=$(id); el.replaceChildren(); value=Math.max(0,Math.min(20,Number(value)||0));
  for(let i=0;i<10;i++) { const units=value-i*2; const span=document.createElement('span'); span.className=units>=2?'full':units===1?'half':'empty'; span.textContent=type==='heart'?'♥':'◆'; el.appendChild(span); }
}
function renderHotbar(s) {
  const bar=$('hotbar'); bar.replaceChildren(); const slots=s.quickbar||Array(9).fill(null);
  slots.forEach((item,i)=>{
    const slot=document.createElement('button'); slot.type='button'; slot.className='hotbar-slot'+(i===selectedSlot?' selected':''); slot.title=item?`${item.displayName} ×${item.count}`:`Slot ${i+1}`;
    if(item) { const sym=document.createElement('span'); sym.className='item-symbol'; sym.textContent=itemSymbols[item.name]||String(item.displayName||item.name).slice(0,3); slot.appendChild(sym); if(item.count>1){const count=document.createElement('span');count.className='count';count.textContent=item.count;slot.appendChild(count);} }
    slot.addEventListener('click',()=>{ selectedSlot=i; window.mcClient.selectHotbar(i); renderHotbar(latestState); }); bar.appendChild(slot);
  });
  $('heldName').textContent=s.heldItem?.displayName||'';
}
function renderState(s) {
  const mode = String(s.gameMode ?? s.gamemode ?? '').toLowerCase();
  const creative = mode === '1' || mode === 'creative' || mode === 'creative_mode';
  const bars = document.querySelector('.hud-bars');
  if (bars) bars.style.display = creative ? 'none' : 'flex';
  const xpLine = document.querySelector('.xp-line');
  if (xpLine) xpLine.style.display = creative ? 'none' : 'flex';
  const previousVehicle = latestState.vehicle?.name || null;
  latestState=s||{};
  const currentVehicle = latestState.vehicle?.name || null;
  if (currentVehicle && currentVehicle !== previousVehicle) showToast(`Riding: ${currentVehicle} · WASD to steer · Shift to dismount`);
  else if (!currentVehicle && previousVehicle) showToast('Dismounted.');
  if(Number.isFinite(s.health)) renderIcons('hearts',s.health,'heart');
  if(Number.isFinite(s.food)) renderIcons('foodIcons',s.food,'food');
  $('xpFill').style.width=`${Math.max(0,Math.min(1,s.experience||0))*100}%`; $('xpLevel').textContent=s.level||0;
  renderHotbar(s);
}
connectForm.addEventListener('submit',async e=>{
  e.preventDefault(); const cfg={host:$('host').value.trim(),port:$('port').value,username:$('username').value.trim(),version:$('version').value,auth:$('auth').value};
  connectBtn.disabled=true; setLoginStatus(`Connecting to ${cfg.host}:${cfg.port}…`);
  try { await window.mcClient.connect(cfg); } catch(err) { setLoginStatus(err.message||String(err),true); connectBtn.disabled=false; }
});
$('disconnectBtn').addEventListener('click',()=>{ releaseAll(); window.mcClient.disconnect(); showLogin(); setLoginStatus('Disconnected. Enter server details to join again.'); });
$('resumeBtn').addEventListener('click',()=>setPaused(false));
$('pauseOptionsBtn').addEventListener('click',()=>{ const el=$('pauseOptions'); el.hidden=!el.hidden; });
window.mcClient.onStatus(s=>{
  const status=s.status||'disconnected';
  if(status==='connecting') setLoginStatus(s.message||'Connecting…');
  if(status==='connected') {
    connected=true; connectBtn.disabled=true; setLoginStatus(s.message||'Connected.'); showGame();
    $('pauseStatus').textContent=`Connected as ${latestState.username||$('username').value}`;
    if(s.message?.includes('World loaded')) showToast('World loaded — click to capture mouse.');
  }
  if(status==='error') { if(!connected) { setLoginStatus(s.message||'Connection error',true); connectBtn.disabled=false; } else showToast(s.message||'Connection error'); }
  if(status==='disconnected') { showLogin(); setLoginStatus(s.message||'Disconnected.'); }
});
window.mcClient.onState(s=>{ if(s.connected) { connected=true; renderState(s); } });
window.mcClient.onViewer(url=>{ worldFrame.src=url; worldFrame.hidden=false; placeholder.hidden=true; });
document.addEventListener('pointerlockchange',()=>{
  locked=document.pointerLockElement===capture; capture.classList.toggle('locked',locked);
  $('captureHint').classList.toggle('hidden',locked||!connected||paused);
  if(!locked) releaseAll();
});
capture.addEventListener('click',()=>{ if(connected&&!paused&&!locked) lockPointer(); });
function smoothLook(){const alpha=0.42;renderYaw+=(targetYaw-renderYaw)*alpha;renderPitch+=(targetPitch-renderPitch)*alpha;if(Math.abs(targetYaw-renderYaw)>0.0001||Math.abs(targetPitch-renderPitch)>0.0001){window.mcClient.look(renderYaw,renderPitch);}lookFrame=requestAnimationFrame(smoothLook);}
lookFrame=requestAnimationFrame(smoothLook);
document.addEventListener('mousemove',e=>{
  if(!locked||!connected||paused) return; yaw-=e.movementX*sensitivity; pitch-=e.movementY*sensitivity;
  pitch=Math.max(-Math.PI/2+0.01,Math.min(Math.PI/2-0.01,pitch)); window.mcClient.look(yaw,pitch);
});
document.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement) {
    if(e.code==='Escape'&&chatOpen) { closeChat(); e.preventDefault(); } return;
  }
  if(!connected) return;
  if(e.code==='Escape') {
    e.preventDefault();
    if(chatOpen) { closeChat(); return; }
    if(paused) setPaused(false); else setPaused(true);
    return;
  }
  if(paused) return;
  if(e.code==='KeyT'&&!e.repeat) { openChat(); e.preventDefault(); return; }
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && latestState.vehicle && !e.repeat) { window.mcClient.dismount(); e.preventDefault(); return; }
  if(/^Digit[1-9]$/.test(e.code)) { selectedSlot=Number(e.code.slice(5))-1; window.mcClient.selectHotbar(selectedSlot); renderHotbar(latestState); e.preventDefault(); return; }
  if(keyControls.has(e.code)) { setControl(e.code,true); e.preventDefault(); }
});
document.addEventListener('keyup',e=>setControl(e.code,false));
window.addEventListener('blur',releaseAll); document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();}); window.addEventListener('beforeunload',releaseAll);
document.addEventListener('mousedown',e=>{ if(!connected||paused||!locked||$('hotbar').contains(e.target)) return; if(e.button===0) window.mcClient.dig('start'); else if(e.button===2) window.mcClient.dig('place'); });
document.addEventListener('contextmenu',e=>{if(connected) e.preventDefault();});
function openChat() { chatOpen=true; $('chatOverlay').hidden=false; $('chatInput').focus(); if(document.pointerLockElement) document.exitPointerLock(); releaseAll(); }
function closeChat() { chatOpen=false; $('chatOverlay').hidden=true; $('chatInput').value=''; $('chatInput').blur(); }
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const input=$('chatInput');const message=input.value.trim();if(message){window.mcClient.chat(message);log(`<${latestState.username||$('username').value}> ${message}`,'chat');}closeChat();});
document.addEventListener('wheel',e=>{ if(!connected||paused||!locked) return; selectedSlot=(selectedSlot+(e.deltaY>0?1:8))%9; window.mcClient.selectHotbar(selectedSlot); renderHotbar(latestState); },{passive:true});
populateVersionList();
updateInitial();
function updateInitial() { $('pauseOverlay').hidden=true; $('gameScreen').hidden=true; $('loginScreen').hidden=false; $('gameHud').style.display='flex'; window.mcClient.requestState(); }

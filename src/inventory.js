'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const panel=$('inventoryOverlay'), grid=$('inventoryGrid'), tabs=$('inventoryTabs'), title=$('inventoryTitle'), craftGrid=$('craftGrid');
  let mode='survival', tab='inventory', state={}, items=[], cursor=null, recipes=[], craftingTable=false;
  const symbols={stone:'▦',dirt:'▪',grass_block:'▩',oak_planks:'▤',cobblestone:'▧',diamond:'◆',diamond_pickaxe:'⛏',wooden_pickaxe:'⛏',iron_ingot:'●',apple:'●',bread:'▰',torch:'♨',oak_log:'▤',stick:'╱'};
  function show(open){panel.hidden=!open;if(open){render();window.mcClient.inventoryRequest();}}
  function slotButton(item,slot,kind='inventory'){
    const b=document.createElement('button');b.type='button';b.className='inv-slot';b.title=item?item.displayName+' ×'+item.count:'Empty slot';b.dataset.slot=slot;
    if(item){const icon=document.createElement('span');icon.className='inv-item-icon';icon.textContent=symbols[item.name]||String(item.displayName||item.name).slice(0,3);b.append(icon);if(item.count>1){const n=document.createElement('span');n.className='inv-count';n.textContent=item.count;b.append(n);}}
    b.addEventListener('click',()=>{if(mode==='creative'&&tab==='items'&&item){window.mcClient.inventoryGive(item.name,1);return;}window.mcClient.inventoryClick({slot:Number(slot),button:0,mode:0,kind});});
    b.addEventListener('contextmenu',e=>{e.preventDefault();if(mode==='creative'&&tab==='items'&&item){window.mcClient.inventoryGive(item.name,64);return;}window.mcClient.inventoryClick({slot:Number(slot),button:1,mode:0,kind});});
    return b;
  }
  function render(){
    const gm=String(state.gameMode??'').toLowerCase();mode=(gm==='1'||gm==='creative'||gm==='creative_mode')?'creative':'survival';
    title.textContent=mode==='creative'?'Creative Inventory':'Inventory';
    tabs.replaceChildren();grid.replaceChildren();craftGrid.replaceChildren();
    const makeTab=(id,label)=>{const b=document.createElement('button');b.className='inv-tab'+(tab===id?' active':'');b.textContent=label;b.onclick=()=>{tab=id;render();};tabs.append(b);};
    makeTab('inventory','Inventory');if(mode==='creative')makeTab('items','All Items');
    $('craftingArea').hidden=tab==='items';
    if(tab==='items'&&mode==='creative'){
      const search=document.createElement('input');search.id='itemSearch';search.placeholder='Search items…';search.value=$('itemSearch')?.value||'';search.className='item-search';search.oninput=()=>fillCreative(search.value);grid.append(search);
      const results=document.createElement('div');results.id='creativeItems';results.className='creative-items';grid.append(results);fillCreative(search.value);return;
    }
    const inv=state.inventory||[];
    const hotbar=state.quickbar||Array(9).fill(null);
    for(let i=9;i<36;i++)grid.append(slotButton(inv[i]||null,i,'inventory'));
    for(let i=0;i<9;i++)grid.append(slotButton(hotbar[i]||null,36+i,'inventory'));
    const armor=$('armorSlots');armor.replaceChildren();for(let i=0;i<4;i++)armor.append(slotButton(inv[5-i]||null,5-i,'inventory'));
    const offhand=$('offhandSlot');offhand.replaceChildren(slotButton(inv[45]||null,45,'inventory'));
    for(let i=0;i<4;i++)craftGrid.append(slotButton(null,i,'crafting'));
    craftGrid.append(slotButton(null,4,'crafting-result'));
    $('craftingLabel').textContent=craftingTable?'Crafting Table (3×3)':'Crafting (2×2)';
    $('craftingGrid').classList.toggle('table-crafting',craftingTable);
    $('craftingGrid').replaceChildren();
    const size=craftingTable?9:4;
    for(let i=0;i<size;i++)$('craftingGrid').append(slotButton(null,i,'crafting'));
    $('craftResult').onclick=()=>window.mcClient.inventoryCraft({craftingTable});
    $('craftResult').textContent='⇢';
  }
  function fillCreative(query=''){
    const el=$('creativeItems');if(!el)return;el.replaceChildren();
    const q=query.toLowerCase();const matches=items.filter(i=>(i.displayName+' '+i.name).toLowerCase().includes(q)).slice(0,500);
    for(const item of matches)el.append(slotButton(item,-1,'creative'));
    if(!matches.length){const p=document.createElement('p');p.textContent='No matching items found.';el.append(p);}
  }
  $('inventoryClose').addEventListener('click',()=>show(false));
  $('craftTableBtn').addEventListener('click',()=>{craftingTable=!craftingTable;tab='inventory';render();if(craftingTable)window.mcClient.inventoryOpenTable();});
  window.addEventListener('keydown',e=>{if(e.code==='KeyE'&&!e.repeat&&!e.target.matches('input,textarea,select')&&$('gameScreen')&&!$('gameScreen').hidden){e.preventDefault();show(panel.hidden);}if(e.code==='Escape'&&!panel.hidden){e.preventDefault();show(false);}});
  window.mcClient.onInventory(data=>{state=data.state||state;items=data.items||items;recipes=data.recipes||[];render();});
  window.mcClient.onState(s=>{state=s||state;if(!panel.hidden)render();});
  window.inventoryUI={show};
})();
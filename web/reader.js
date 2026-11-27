import {get,put,downloadCatalog,validCatalog} from './storage.js';
const $=id=>document.getElementById(id);
let snapshot=null, settings={font:28,speeds:{}}, selected=null, running=false, starting=false;
let startupTimer, manualTimer, toastTimer, wakeLock=null, shellReady=false, deferredInstall=null;
let touching=false, manual=false, down=null, moved=false, autoPosition=0, lastApplied=0, previousTime=0;
const area=$('scroll-area');
// Autoscroll is the primary function and remains user-controlled even with reduced motion.
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500); }
function report(error) { toast(error instanceof Error ? error.message : 'Не удалось выполнить действие.'); }
function currentSpeed(){return settings.speeds[selected?.id]??12;}
async function saveSettings(){try{await put('settings',settings);}catch{toast('Настройки действуют сейчас, но сохранить их на телефоне не удалось.');}}
function renderList(){
  const all=snapshot?.catalog.songs??[],query=$('search').value.trim().toLocaleLowerCase('ru');
  const songs=[...all].sort((a,b)=>a.title.localeCompare(b.title,'ru')).filter(s=>s.title.toLocaleLowerCase('ru').includes(query));
  $('songs').replaceChildren();$('count').textContent=all.length;
  for(const song of songs){
    const row=document.createElement('button');row.type='button';row.className='song-row';
    const note=document.createElement('span');note.className='song-note';note.textContent='♪';note.setAttribute('aria-hidden','true');
    const content=document.createElement('span'),title=document.createElement('strong'),preview=document.createElement('small');
    title.textContent=song.title;preview.textContent=song.text.split('\n').find(line=>line.trim())?.slice(0,70)||'Текст песни';content.append(title,preview);
    const open=document.createElement('span');open.className='song-open';open.textContent='▶';open.setAttribute('aria-hidden','true');
    row.append(note,content,open);row.addEventListener('click',()=>{location.hash=`song=${encodeURIComponent(song.id)}`;});$('songs').append(row);
  }
  $('empty').hidden=songs.length>0;
  $('empty').textContent=!snapshot?'Для загрузки песен нажмите «Обновить сборник».':query?'Ничего не найдено. Попробуйте другое название.':'В сборнике пока нет песен.';
  $('saved-info').textContent=snapshot?`Версия ${snapshot.catalog.version} · Получен ${new Date(snapshot.downloadedAt).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}`:'Сборник пока не сохранён';
  offlineStatus();
}
function offlineStatus(){
  $('offline-info').textContent=snapshot&&shellReady?'Готово к работе без интернета':snapshot?'Песни сохранены. Подготавливаем автономный запуск…':'Для первой загрузки нужен интернет.';
}
async function refresh(){
  $('update').disabled=true;$('update').textContent='Загружаем…';
  try{
    const {snapshot:next,unchanged}=await downloadCatalog(snapshot?.catalog);
    snapshot=next;renderList();toast(unchanged?'Сборник уже актуален':'Сборник обновлён и сохранён на телефоне');
    if(location.hash) route();
  }catch(e){renderList();report(e instanceof TypeError || e?.name==='TimeoutError' ? new Error('Нет связи с сервером. Сохранённые песни остаются на телефоне. Попробуйте позже.') : e);}
  finally{$('update').disabled=false;$('update').textContent='Обновить сборник';}
}
async function acquireWake(){
  if(!selected||document.hidden||wakeLock) return;
  try{
    if(!navigator.wakeLock) throw new Error('unsupported');
    const lock=await navigator.wakeLock.request('screen');
    if(!selected||document.hidden){await lock.release();return;}
    wakeLock=lock;$('wake-message').hidden=true;
    lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;if(selected&&!document.hidden){$('wake-message').textContent='Удержание экрана отключено системой. Коснитесь текста для повторной попытки.';$('wake-message').hidden=false;}});
  }catch{$('wake-message').textContent='Не удалось удержать экран включённым. Увеличьте время отключения экрана в настройках телефона.';$('wake-message').hidden=false;}
}
function releaseWake(){const lock=wakeLock;wakeLock=null;if(lock)lock.release().catch(()=>{});}
function clearStartup(){clearTimeout(startupTimer);starting=false;}
function controls(){
  const speed=currentSpeed();
  $('speed-value').textContent=`${speed} px/с`;$('font-value').textContent=settings.font;
  document.documentElement.style.setProperty('--font',`${settings.font/16}rem`);
  $('play').textContent=running?'Пауза':'Продолжить';$('play').setAttribute('aria-pressed',String(!running));
  $('play-state').textContent=starting?'Прокрутка начнётся через 2 секунды':running?'Плавная прокрутка · касание для паузы':'На паузе · коснитесь текста, чтобы продолжить';
  $('slower').disabled=speed<=2;$('faster').disabled=speed>=40;$('smaller').disabled=settings.font<=22;$('larger').disabled=settings.font>=44;
}
function toggle(){
  if(!selected)return;
  // During the opening countdown a tap means pause, rather than starting early.
  if(starting){clearStartup();running=false;}else{running=!running;}
  autoPosition=area.scrollTop;previousTime=0;controls();acquireWake();
}
function openSong(song){
  clearStartup();clearTimeout(manualTimer);touching=manual=false;down=null;
  selected=song;running=false;starting=true;
  $('song-title').textContent=song.title;$('lyrics').textContent=song.text;
  $('library').hidden=true;$('reader').hidden=false;document.body.style.overflow='hidden';document.title=`${song.title} — Песенник`;
  area.scrollTop=0;autoPosition=lastApplied=0;previousTime=0;controls();updateProgress();acquireWake();
  startupTimer=setTimeout(()=>{starting=false;if(selected&&!document.hidden){running=true;autoPosition=area.scrollTop;previousTime=0;}controls();},2000);
}
function closeSong(){
  clearStartup();clearTimeout(manualTimer);selected=null;running=false;touching=manual=false;releaseWake();
  $('reader').hidden=true;$('library').hidden=false;document.body.style.overflow='';document.title='Песенник — поём вместе';
}
function route(){
  const match=location.hash.match(/^#song=(.+)$/);let id;try{id=match?decodeURIComponent(match[1]):null;}catch{id=null;}
  const song=snapshot?.catalog.songs.find(s=>s.id===id);
  if(song){if(selected?.id!==song.id)openSong(song);}else{closeSong();if(match&&snapshot){history.replaceState(null,'',location.pathname);toast('Этой песни больше нет в сборнике.');}}
}
function updateProgress(){const max=area.scrollHeight-area.clientHeight;$('progress').textContent=`${max>0?Math.round(area.scrollTop/max*100):100}%`;}
function scheduleManualEnd(){clearTimeout(manualTimer);manualTimer=setTimeout(()=>{if(!touching){manual=false;autoPosition=area.scrollTop;previousTime=0;}},260);}
area.addEventListener('pointerdown',e=>{if(!e.isPrimary)return;area.setPointerCapture(e.pointerId);touching=true;manual=true;moved=false;down={x:e.clientX,y:e.clientY,time:performance.now()};clearTimeout(manualTimer);});
area.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>8)moved=true;});
area.addEventListener('pointerup',e=>{if(!down)return;touching=false;if(!moved&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<=8&&performance.now()-down.time<500)toggle();down=null;scheduleManualEnd();});
area.addEventListener('pointercancel',()=>{touching=false;down=null;scheduleManualEnd();});
area.addEventListener('wheel',()=>{manual=true;scheduleManualEnd();},{passive:true});
area.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key)){manual=true;scheduleManualEnd();}if(e.code==='Space'){e.preventDefault();toggle();}});
area.addEventListener('scroll',()=>{updateProgress();if(manual){scheduleManualEnd();}else if(Math.abs(area.scrollTop-lastApplied)>2){manual=true;scheduleManualEnd();}},{passive:true});
function frame(time){
  if(selected&&running&&!starting&&!touching&&!manual&&!document.hidden){
    const elapsed=previousTime?Math.min((time-previousTime)/1000,.1):0;
    autoPosition+=currentSpeed()*elapsed;area.scrollTop=autoPosition;lastApplied=area.scrollTop;
    if(area.scrollTop>=area.scrollHeight-area.clientHeight-1){running=false;autoPosition=area.scrollTop;controls();$('play-state').textContent='Конец песни';}
  }
  previousTime=time;requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearStartup();running=false;releaseWake();controls();}else if(selected){autoPosition=area.scrollTop;previousTime=0;acquireWake();}});
window.addEventListener('pagehide',()=>{clearStartup();running=false;releaseWake();});
window.addEventListener('pageshow',()=>{if(selected){controls();acquireWake();}});
window.addEventListener('resize',()=>{autoPosition=area.scrollTop;lastApplied=area.scrollTop;updateProgress();});
$('play').addEventListener('click',toggle);$('back').addEventListener('click',()=>{history.replaceState(null,'',location.pathname);closeSong();});
for(const [id,delta] of [['slower',-2],['faster',2]])$(id).addEventListener('click',()=>{if(!selected)return;settings.speeds[selected.id]=Math.max(2,Math.min(40,currentSpeed()+delta));controls();saveSettings();});
for(const [id,delta] of [['smaller',-2],['larger',2]])$(id).addEventListener('click',()=>{settings.font=Math.max(22,Math.min(44,settings.font+delta));controls();autoPosition=area.scrollTop;lastApplied=area.scrollTop;saveSettings();});
$('search').addEventListener('input',renderList);$('update').addEventListener('click',refresh);window.addEventListener('hashchange',route);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('install').hidden=false;});
$('install').addEventListener('click',async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;$('install').hidden=true;}});
async function prepareShell(){
  if(!('serviceWorker'in navigator)){ $('offline-info').textContent='Этот браузер не поддерживает автономный запуск.';return; }
  try{
    const root=new URL('./',import.meta.url);
    await navigator.serviceWorker.register(new URL('sw.js',root),{scope:root.href});
    const registration=await navigator.serviceWorker.ready;
    const channel=new MessageChannel();
    channel.port1.onmessage=e=>{shellReady=!!e.data.complete;offlineStatus();};
    registration.active?.postMessage('SHELL_STATUS',[channel.port2]);
  }catch{$('offline-info').textContent='Не удалось подготовить автономный запуск. Откройте приложение с интернетом ещё раз.';}
}
async function init(){
  try{
    const [saved,preferences]=await Promise.all([get('snapshot'),get('settings')]);
    if(saved&&validCatalog(saved.catalog))snapshot=saved;
    if(preferences){settings.font=Number.isFinite(preferences.font)?Math.min(44,Math.max(22,preferences.font)):28;settings.speeds={};for(const[id,speed]of Object.entries(preferences.speeds??{}))if(Number.isFinite(speed))settings.speeds[id]=Math.min(40,Math.max(2,speed));}
    renderList();route();prepareShell();
    // The only automatic catalog request is the initial download on a device with no snapshot.
    if(!snapshot)await refresh();
  }catch(e){renderList();report(e);}
  requestAnimationFrame(frame);
}
init();

const PAGE='https://c04u41125.github.io/KAI-981/bracket.html';
const json=(v,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
const admins=env=>(env.ADMIN_LINE_USER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
export async function bracketCommand(db,env,event,text,p){
 if(!admins(env).includes(event.source.userId))return p.commit('管理操作已拒絕：需要管理員白名單。');
 if(event.source.type!=='user')return p.commit('請私訊 Bot「建立賽程 賽事名稱」。編輯連結只提供給管理員，請勿貼到群組。');
 const create=text.match(/^建立賽程\s+(.+)$/);
 const renew=text.match(/^賽程授權\s+([a-f0-9-]{36})$/);
 const revoke=text.match(/^停用賽程編輯\s+([a-f0-9-]{36})$/);
 if(!create&&!renew&&!revoke)return p.commit('管理員私訊指令：建立賽程 賽事名稱／賽程授權 賽程ID／停用賽程編輯 賽程ID');
 const id=create?crypto.randomUUID():(renew||revoke)[1];
 if(create&&(create[1].trim().length>80||!create[1].trim()))return p.commit('賽事名稱請填入 1–80 字。');
 if(!create&&!await db.prepare('SELECT id FROM brackets WHERE id=?').bind(id).first())return p.commit('找不到賽程。');
 if(revoke){
  p.add(`UPDATE brackets SET edit_expires=0 WHERE id=? AND ${p.guard}`,id,event.webhookEventId);
 }else{
  const token=crypto.randomUUID()+crypto.randomUUID();
  const hash=await digest(token);
  if(create)p.add(`INSERT INTO brackets(id,title,owner_user_id,edit_hash,edit_expires) SELECT ?,?,?,?,unixepoch()+604800 WHERE ${p.guard}`,id,create[1].trim(),event.source.userId,hash,event.webhookEventId);
  else p.add(`UPDATE brackets SET owner_user_id=?,edit_hash=?,edit_expires=unixepoch()+604800 WHERE id=? AND ${p.guard}`,event.source.userId,hash,id,event.webhookEventId);
  p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`,event.webhookEventId,event.source.userId,'bracket_authorize',event.webhookEventId);
  return p.commit('賽程 ID：'+id+'\n專屬編輯連結（7 天有效，請勿轉傳）：\n'+PAGE+'?id='+id+'#edit='+token+'\n\n設定名單後按「發布賽程」，再使用網頁的「複製觀賽連結」分享。重新授權會使舊編輯連結失效。');
 }
 p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`,event.webhookEventId,event.source.userId,'bracket_revoke',event.webhookEventId);
 return p.commit('已停用此賽程編輯連結，公開觀賽仍可使用。');
}
// 種子位置分散輪空；未知勝者與真正輪空分開處理。
export function bracketRounds(players,results){
 if(!players.length)return [];
 let size=2;while(size<players.length)size*=2;
 let order=[1,2];while(order.length<size){const n=order.length*2+1;order=order.flatMap(x=>[x,n-x]);}
 let slots=order.map(n=>players[n-1]||null),rounds=[];
 while(slots.length>1){
  const round=[];
  for(let i=0;i<slots.length;i+=2){
   const a=slots[i],b=slots[i+1],key=rounds.length+'-'+i/2,r=results[key];
   const ready=a!==undefined&&b!==undefined;
   const score=ready&&a&&b&&r&&r.a===a.id&&r.b===b.id?r:null;
   const winner=!ready?undefined:!a?b:!b?a:score?(score.sa>score.sb?a:b):undefined;
   round.push({key,a:a||null,b:b||null,ready,bye:ready&&(!a||!b),score,winner:winner||null,done:winner!==undefined});
  }
  rounds.push(round);slots=round.map(m=>m.done?m.winner:undefined);
 }
 return rounds;
}
function view(row){const players=JSON.parse(row.players_json),results=JSON.parse(row.results_json);return {id:row.id,title:row.title,version:row.version,published:!!row.published,updated:row.updated_at,players,rounds:bracketRounds(players,results)};}
async function authorized(request,row,env){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1];
 return !!token&&row.edit_expires>Date.now()/1000&&admins(env).includes(row.owner_user_id)&&await digest(token)===row.edit_hash;
}
export async function bracketAPI(request,env,db){
 const url=new URL(request.url);
 if(request.method==='OPTIONS'){
  if(request.headers.get('Origin')!==env.PUBLIC_ORIGIN)return json({error:'來源不允許'},403);
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'}});
 }
 if(url.pathname==='/api/brackets'&&request.method==='GET')return json({brackets:(await db.prepare('SELECT id,title,updated_at FROM brackets WHERE published=1 ORDER BY updated_at DESC LIMIT 30').all()).results});
 const id=url.pathname.match(/^\/api\/brackets\/([a-f0-9-]{36})$/)?.[1];
 if(!id)return json({error:'找不到賽程'},404);
 const row=await db.prepare('SELECT * FROM brackets WHERE id=?').bind(id).first();
 if(!row)return json({error:'找不到賽程'},404);
 const canEdit=await authorized(request,row,env);
 if(request.method==='GET')return row.published||canEdit?json({...view(row),canEdit}):json({error:'尚未發布或編輯授權已失效'},404);
 if(request.method!=='POST')return json({error:'不支援此操作'},405);
 if(!canEdit)return json({error:'編輯授權失效，請管理員私訊 Bot 重新取得「賽程授權 '+id+'」。'},403);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN)return json({error:'來源不允許'},403);
 if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'需要 JSON'},415);
 // 限制實際串流大小，不能只信任 Content-Length。
 const reader=request.body?.getReader();let raw='',bytes=0;
 if(!reader)return json({error:'缺少內容'},400);
 const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768){await reader.cancel();return json({error:'內容過大'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let data;try{data=JSON.parse(raw);}catch{return json({error:'格式錯誤'},400);}
 if(!data||data.version!==row.version)return json({error:'其他操作已更新賽程，請重新整理後再操作。'},409);
 let players=JSON.parse(row.players_json),results=JSON.parse(row.results_json),title=row.title,published=row.published;
 if(data.action==='setup'){
  if(published)return json({error:'已發布後不能更換名單；請建立新賽程。'},400);
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>80||!Array.isArray(data.players)||data.players.length<2||data.players.length>128||data.players.some(n=>typeof n!=='string'||!n.trim()||n.length>40||/[\x00-\x1f]/.test(n)))return json({error:'請填寫賽名及 2–128 位選手，每人最多 40 字。'},400);
  const names=data.players.map(n=>n.trim().normalize('NFKC'));if(new Set(names).size!==names.length)return json({error:'選手名稱重複，請加上編號辨識。'},400);
  title=data.title.trim();players=names.map((name,i)=>({id:i+1,name}));results={};published=1;
 }else if(data.action==='score'){
  const match=bracketRounds(players,results).flat().find(m=>m.key===data.key);
  if(!published||!match?.ready||match.bye)return json({error:'此場尚未可登記'},400);
  if(data.clear===true)delete results[match.key];
  else{
   if(!Number.isInteger(data.sa)||!Number.isInteger(data.sb)||data.sa<0||data.sb<0||data.sa>99||data.sb>99||data.sa===data.sb)return json({error:'比分須為 0–99 整數，淘汰賽不能平手。'},400);
   results[match.key]={a:match.a.id,b:match.b.id,sa:data.sa,sb:data.sb};
  }
  // 上游勝者改變時，刪除受影響下游成績，避免沿用別人的勝負。
  const valid=bracketRounds(players,results).flat().filter(m=>m.score).map(m=>m.key);
  results=Object.fromEntries(Object.entries(results).filter(([k])=>valid.includes(k)));
 }else return json({error:'不支援此操作'},400);
 const saved=await db.prepare('UPDATE brackets SET title=?,players_json=?,results_json=?,published=?,version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND edit_hash=? AND edit_expires>unixepoch() RETURNING *').bind(title,JSON.stringify(players),JSON.stringify(results),published,id,row.version,row.edit_hash).first();
 return saved?json({...view(saved),canEdit:true}):json({error:'賽程或授權已更新，請重新整理。'},409);
}

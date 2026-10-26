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
  if(create)p.add(`INSERT INTO brackets(id,title,owner_user_id,edit_hash,edit_expires,short_code,layout) SELECT ?,?,?,?,unixepoch()+604800,lower(hex(randomblob(6))),'numbered' WHERE ${p.guard}`,id,create[1].trim(),event.source.userId,hash,event.webhookEventId);
  else p.add(`UPDATE brackets SET owner_user_id=?,edit_hash=?,edit_expires=unixepoch()+604800 WHERE id=? AND ${p.guard}`,event.source.userId,hash,id,event.webhookEventId);
  p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`,event.webhookEventId,event.source.userId,'bracket_authorize',event.webhookEventId);
  return p.commit('賽程 ID：'+id+'\n專屬編輯連結（7 天有效，請勿轉傳）：\n'+PAGE+'?id='+id+'#edit='+token+'\n\n設定名單後按「發布賽程」，再使用網頁的「複製觀賽連結」分享。重新授權會使舊編輯連結失效。');
 }
 p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`,event.webhookEventId,event.source.userId,'bracket_revoke',event.webhookEventId);
 return p.commit('已停用此賽程編輯連結，公開觀賽仍可使用。');
}
// 種子位置分散輪空；未知勝者與真正輪空分開處理。
export function bracketRounds(players,results,layout="seeded"){
 if(!players.length)return [];
 let size=2;while(size<Math.max(...players.map(p=>p.id)))size*=2;
 let order=[1,2];while(order.length<size){const n=order.length*2+1;order=order.flatMap(x=>[x,n-x]);}
 if(layout==='numbered')order=Array.from({length:size},(_,i)=>i+1);
 let slots=order.map(n=>players.find(p=>p.id===n)||null),rounds=[];
 while(slots.length>1){
  const round=[];
  for(let i=0;i<slots.length;i+=2){
   const a=slots[i],b=slots[i+1],key=rounds.length+'-'+i/2,r=results[key];
   const ready=a!==undefined&&b!==undefined;
   const score=ready&&a&&b&&r&&r.a===a.id&&r.b===b.id?r:null;
   const winner=!ready?undefined:!a?b:!b?a:score?(score.winner ? (score.winner===a.id?a:b) : (score.sa>score.sb?a:b)):undefined;
   round.push({key,a:a||null,b:b||null,ready,bye:ready&&(!a||!b),score,winner:winner||null,done:winner!==undefined});
  }
  rounds.push(round);slots=round.map(m=>m.done?m.winner:undefined);
 }
 return rounds;
}
function view(row){const players=JSON.parse(row.players_json),results=JSON.parse(row.results_json);return {id:row.id,shortCode:row.short_code,layout:row.layout,title:row.title,version:row.version,published:!!row.published,updated:row.updated_at,players,rounds:bracketRounds(players,results,row.layout)};}
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
 if(url.pathname==='/api/brackets'&&request.method==='GET')return json({brackets:(await db.prepare('SELECT id,short_code,title,updated_at FROM brackets WHERE published=1 ORDER BY updated_at DESC LIMIT 30').all()).results});
 const id=url.pathname.match(/^\/api\/brackets\/([a-f0-9-]{36}|[a-f0-9]{12})$/)?.[1];
 if(!id)return json({error:'找不到賽程'},404);
 const row=await db.prepare('SELECT * FROM brackets WHERE id=? OR short_code=?').bind(id,id).first();
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
 let players=JSON.parse(row.players_json),results=JSON.parse(row.results_json),title=row.title,published=row.published,layout=row.layout;
 if(data.action==='setup'||data.action==='roster'){
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>80||!Array.isArray(data.players)||data.players.length<2||data.players.length>128)return json({error:'請填寫賽名及 2–128 位選手。'},400);
  const roster=data.players.map((p,i)=>typeof p==='string'?{id:i+1,name:p}:p);
  if(roster.some(p=>!p||!Number.isInteger(p.id)||p.id<1||p.id>128||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||/[\x00-\x1f]/.test(p.name)))return json({error:'號碼須為 1–128，每位選手需有 1–40 字姓名。'},400);
  const names=roster.map(p=>p.name.trim().normalize('NFKC'));
  if(new Set(names).size!==names.length||new Set(roster.map(p=>p.id)).size!==roster.length)return json({error:'姓名或號碼重複，請修正後儲存。'},400);
  if(Object.keys(results).length&&!data.resetResults)return json({error:'已有晉級紀錄；修改名單必須確認清除全部結果。'},409);
  title=data.title.trim();players=roster.map((p,i)=>({id:p.id,name:names[i]})).sort((a,b)=>a.id-b.id);results={};published=1;layout='numbered';
 }else if(data.action==='winner'||data.action==='score'){
  const match=bracketRounds(players,results,layout).flat().find(m=>m.key===data.key);
  if(!published||!match?.ready||match.bye)return json({error:'此場尚未可登記'},400);
  if(data.clear===true)delete results[match.key];
  else if(data.action==='winner'){
   if(data.winner!==match.a.id&&data.winner!==match.b.id)return json({error:'請選擇此場選手'},400);
   results[match.key]={a:match.a.id,b:match.b.id,winner:data.winner};
  }else{
   if(!Number.isInteger(data.sa)||!Number.isInteger(data.sb)||data.sa<0||data.sb<0||data.sa>99||data.sb>99||data.sa===data.sb)return json({error:'比分須為 0–99 整數，淘汰賽不能平手。'},400);
   results[match.key]={a:match.a.id,b:match.b.id,sa:data.sa,sb:data.sb};
  }
  // 上游勝者改變時，刪除受影響下游成績，避免沿用別人的勝負。
  const valid=bracketRounds(players,results,layout).flat().filter(m=>m.score).map(m=>m.key);
  results=Object.fromEntries(Object.entries(results).filter(([k])=>valid.includes(k)));
 }else return json({error:'不支援此操作'},400);
 const saved=await db.prepare('UPDATE brackets SET title=?,players_json=?,results_json=?,published=?,layout=?,version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND edit_hash=? AND edit_expires>unixepoch() RETURNING *').bind(title,JSON.stringify(players),JSON.stringify(results),published,layout,row.id,row.version,row.edit_hash).first();
 return saved?json({...view(saved),canEdit:true}):json({error:'賽程或授權已更新，請重新整理。'},409);
}

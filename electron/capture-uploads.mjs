import {browserSource} from '../browser-extension/sources.js';
import {createHash} from 'node:crypto';
import {MAX_ARCHIVE_CHARACTERS,CAPTURE_CHUNK_CHARACTERS} from '../browser-extension/transfer.js';
export class CaptureUploads {
  constructor(store,importTranscript){
    this.store=store;this.db=store.db;this.importTranscript=importTranscript;
    this.db.exec('CREATE TABLE IF NOT EXISTS capture_uploads (id TEXT NOT NULL, owner TEXT NOT NULL, metadata TEXT NOT NULL, parts INTEGER NOT NULL, characters INTEGER NOT NULL, updated INTEGER NOT NULL, conversation_id TEXT, PRIMARY KEY(id,owner)); CREATE TABLE IF NOT EXISTS capture_chunks (id TEXT NOT NULL, owner TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(id,owner,part));');
  }
  owner(token){return createHash('sha256').update(token).digest('hex');}
  row(id,owner){const row=this.db.prepare('SELECT * FROM capture_uploads WHERE id=? AND owner=?').get(id,owner);if(!row)throw new Error('未找到保存任务，请重新点击保存');return row;}
  start(data,owner){
    if(!Number.isInteger(data.parts)||data.parts<1||data.parts>400||!Number.isInteger(data.characters)||data.characters<1||data.characters>MAX_ARCHIVE_CHARACTERS)throw new Error('保存任务大小无效');
    if(!/^[a-f0-9]{64}$/.test(data.contentHash||''))throw new Error('保存任务缺少内容校验信息');
    const metadata=JSON.stringify({title:data.title,url:data.url,note:data.note||'',contentHash:data.contentHash});
    if(typeof data.title!=='string'||!data.title.trim()||data.title.length>150||typeof data.note!=='string'&&data.note!==undefined||(data.note||'').length>20000)throw new Error('标题或笔记无效');
    // Expired incomplete transfers are never shown as saved conversations.
    this.store.transaction(()=>{
      const old=Date.now()-86400000;
      this.db.prepare('DELETE FROM capture_chunks WHERE EXISTS (SELECT 1 FROM capture_uploads u WHERE u.id=capture_chunks.id AND u.owner=capture_chunks.owner AND u.updated<? AND u.conversation_id IS NULL)').run(old);
      this.db.prepare('DELETE FROM capture_uploads WHERE updated<? AND conversation_id IS NULL').run(old);
    });
    let row=this.db.prepare('SELECT * FROM capture_uploads WHERE id=? AND owner=?').get(data.requestId,owner);
    if(row){
      if(row.metadata!==metadata||row.parts!==data.parts||row.characters!==data.characters)throw new Error('保存任务的内容已改变，请重新读取后保存');
      if(row.conversation_id)return {ok:true,conversationId:row.conversation_id};
    }else{
      const active=this.db.prepare('SELECT COUNT(*) AS n FROM capture_uploads WHERE owner=? AND conversation_id IS NULL').get(owner);
      if(active.n>=8)throw new Error('未完成的保存任务过多，请先完成已有保存');
      this.db.prepare('INSERT INTO capture_uploads(id,owner,metadata,parts,characters,updated) VALUES(?,?,?,?,?,?)').run(data.requestId,owner,metadata,data.parts,data.characters,Date.now());
    }
    const parts=this.db.prepare('SELECT part FROM capture_chunks WHERE id=? AND owner=? ORDER BY part').all(data.requestId,owner);
    let nextIndex=0;for(const item of parts){if(item.part!==nextIndex)break;nextIndex++;}
    return {ok:true,nextIndex};
  }
  chunk(data,owner){
    const row=this.row(data.requestId,owner);
    if(row.conversation_id)return {ok:true,conversationId:row.conversation_id};
    if(!Number.isInteger(data.index)||data.index<0||data.index>=row.parts||typeof data.text!=='string'||!data.text.length||data.text.length>CAPTURE_CHUNK_CHARACTERS)throw new Error('分批内容格式无效');
    const existing=this.db.prepare('SELECT content FROM capture_chunks WHERE id=? AND owner=? AND part=?').get(data.requestId,owner,data.index);
    if(existing){if(existing.content!==data.text)throw new Error('同一批次内容不一致，已拒绝覆盖');return {ok:true};}
    const size=this.db.prepare('SELECT COALESCE(SUM(length(content)),0) AS n FROM capture_chunks WHERE id=? AND owner=?').get(data.requestId,owner).n;
    if(size+data.text.length>MAX_ARCHIVE_CHARACTERS)throw new Error('保存任务超过容量上限');
    this.db.prepare('INSERT INTO capture_chunks(id,owner,part,content) VALUES(?,?,?,?)').run(data.requestId,owner,data.index,data.text);
    this.db.prepare('UPDATE capture_uploads SET updated=? WHERE id=? AND owner=?').run(Date.now(),data.requestId,owner);
    return {ok:true};
  }
  commit(data,owner){
    return this.store.transaction(()=>{
      const row=this.row(data.requestId,owner);
      if(row.conversation_id)return {ok:true,conversationId:row.conversation_id,repeated:true};
      const chunks=this.db.prepare('SELECT part,content FROM capture_chunks WHERE id=? AND owner=? ORDER BY part').all(data.requestId,owner);
      if(chunks.length!==row.parts||chunks.some((chunk,i)=>chunk.part!==i))throw new Error('对话尚未传完，请重新点击保存继续传送');
      const content=chunks.map(chunk=>chunk.content).join('');
      if(content.length!==row.characters)throw new Error('传送内容长度不一致，未保存不完整记录');
      const metadata=JSON.parse(row.metadata);
      if(createHash('sha256').update(content).digest('hex')!==metadata.contentHash)throw new Error('传送内容校验不一致，请重新读取后保存');
      const conversationId=this.importTranscript({title:metadata.title,content,note:metadata.note,product:browserSource(metadata.url).product,urls:[metadata.url]});
      this.db.prepare('UPDATE capture_uploads SET conversation_id=?,updated=? WHERE id=? AND owner=?').run(conversationId,Date.now(),data.requestId,owner);
      this.db.prepare('DELETE FROM capture_chunks WHERE id=? AND owner=?').run(data.requestId,owner);
      return {ok:true,conversationId};
    });
  }
}

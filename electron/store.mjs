import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export class Store {
  constructor(directory) {
    mkdirSync(directory,{recursive:true});
    this.db = new DatabaseSync(join(directory,'workbench.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;');
  }
  all(kind) { return this.db.prepare('SELECT data FROM entities WHERE kind=?').all(kind).map(row=>JSON.parse(row.data)); }
  get(kind,id) { const row=this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind,id); if(!row) throw new Error('记录不存在'); return JSON.parse(row.data); }
  put(kind,data) { this.db.prepare('INSERT INTO entities (id,kind,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE entities.kind=excluded.kind').run(data.id,kind,JSON.stringify(data)); return data; }
  remove(kind,id) { this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind,id); }
  secret(id) { return this.db.prepare('SELECT value FROM secrets WHERE id=?').get(id)?.value; }
  setSecret(id,value) { this.db.prepare('INSERT INTO secrets (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,value); }
  removeSecret(id) { this.db.prepare('DELETE FROM secrets WHERE id=?').run(id); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try {const result=fn(); this.db.exec('COMMIT'); return result;} catch(error) {this.db.exec('ROLLBACK'); throw error;} }
  close() { this.db.close(); }
}

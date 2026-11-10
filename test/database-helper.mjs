import {PGlite} from '@electric-sql/pglite';
export async function testDatabase(){
 const pg=new PGlite();await pg.waitReady;let tail=Promise.resolve();
 const query=async(sql,params)=>{if(sql.startsWith('SELECT pg_advisory'))return {rows:[],rowCount:1};const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 return {query,raw:pg,connect:async()=>{let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {query,release:()=>unlock()};},end:()=>pg.close()};
}

import http from 'node:http';
import { readFile } from 'node:fs/promises';
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const allowed = new Set(['index.html','app.js','styles.css','config.js']);
http.createServer(async(req,res)=>{
  const name = new URL(req.url,'http://localhost').pathname.split('/').pop() || 'index.html';
  if (!allowed.has(name)) { res.writeHead(404);res.end();return; }
  try { const content=await readFile(new URL('../docs/'+name,import.meta.url));res.setHeader('Content-Type',types[name.split('.').pop()]);res.end(content); }
  catch {res.writeHead(404);res.end();}
}).listen(5174,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:5174/'));

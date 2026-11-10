import http from 'node:http';
import { pool,migrate } from './database.mjs';
import { queue } from './queue-runtime.mjs';
import { createHandler } from './http.mjs';
import { runWatcher,stopWatcher } from './watcher.mjs';
import { stopQueueDelivery } from './alerts.mjs';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
await migrate();
const server=http.createServer(createHandler({db:pool,queue}));server.requestTimeout=15000;
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('endgame_backend_listening'));
runWatcher().catch(()=>console.error('watcher_stopped_unexpectedly'));
const cleanup=setInterval(()=>{
 const now=Date.now();Promise.all([
  pool.query('DELETE FROM q_session WHERE expires_at<$1',[now]),pool.query('DELETE FROM q_presence WHERE seen_at<$1',[now-86400000]),pool.query('DELETE FROM q_access WHERE expires_at<$1',[now]),
  pool.query('DELETE FROM q_email_verify WHERE expires_at<$1',[now]),pool.query('DELETE FROM watch_rate WHERE expires_at<now()')
 ]).catch(()=>console.error('cleanup_failed'));
},3600000);cleanup.unref();
async function shutdown(){clearInterval(cleanup);server.close();await stopWatcher();await stopQueueDelivery();await pool.end();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

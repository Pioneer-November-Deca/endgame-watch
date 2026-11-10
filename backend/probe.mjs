import { fetchCampaign } from './gamefound-api.mjs';
// Read-only probe. Never imports Mailgun, database, or alert-sending code.
try { const observation=await fetchCampaign();console.log(JSON.stringify({verified:true,...observation})); }
catch(error){console.error(JSON.stringify({verified:false,error:error.code||'source_request_failed'}));process.exitCode=2;}

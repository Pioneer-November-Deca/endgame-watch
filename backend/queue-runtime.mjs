import { pool } from './database.mjs';
import { createQueue } from './queue.mjs';
export const queue=createQueue({db:pool,...(process.env.ON_CALL_TEST_MODE==='true'?{onCallSeconds:540}:{})});

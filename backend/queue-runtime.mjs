import { pool } from './database.mjs';
import { createQueue } from './queue.mjs';
export const queue=createQueue({db:pool});

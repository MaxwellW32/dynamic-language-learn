import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from "./schema"
import dotenv from 'dotenv';

dotenv.config({ path: ".env.local" });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
});

export const db = drizzle(pool, { schema });
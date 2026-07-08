/**
 * ⚠️ Drops EVERYTHING in the database's public schema. Dev reset:
 *
 *   npm run db:wipe && npm run db:push && npm run db:seed
 */
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const { rows } = await pool.query(
        "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'",
    );
    console.log(`wiped — public schema now has ${rows[0].tables} tables`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

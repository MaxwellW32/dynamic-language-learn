/**
 * Read-only snapshot of the database: size, server version, and row counts.
 *
 *   npx tsx scripts/dbStatus.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
    const meta = await db.execute(sql`
        select version() as version,
               pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(meta.rows[0]);

    const extensions = await db.execute(sql`
        select name, installed_version
        from pg_available_extensions
        where name in ('vector', 'pg_trgm', 'unaccent')
        order by name
    `);
    console.log("extensions:", extensions.rows);

    // exact counts — pg_stat estimates read 0 until the first analyze
    const names = await db.execute<{ name: string }>(sql`
        select tablename as name from pg_tables where schemaname = 'public' order by tablename
    `);
    const counts: { table: string; rows: number }[] = [];
    for (const { name } of names.rows) {
        const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(name)}`);
        counts.push({ table: name, rows: result.rows[0].n });
    }
    console.table(counts);
    process.exit(0);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});

/**
 * ⚠️ Drops every game table and enum so the schema can be pushed fresh.
 * Accounts survive: users, their sign-in links and sessions are left alone.
 * The dictionary is kept unless --with-dictionary is passed (re-importing it
 * takes a few minutes).
 *
 *   npx tsx scripts/resetGame.ts [--with-dictionary]
 *   npm run db:push
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

const AUTH_TABLES = new Set(["users", "account", "session", "verificationToken", "authenticator"]);
const DICTIONARY_TABLES = new Set(["dict_entries", "dict_forms"]);

async function main() {
    const withDictionary = process.argv.includes("--with-dictionary");

    const tables = await db.execute<{ name: string }>(sql`
        select tablename as name from pg_tables where schemaname = 'public'
    `);
    const doomed = tables.rows
        .map((row) => row.name)
        .filter((name) => !AUTH_TABLES.has(name) && (withDictionary || !DICTIONARY_TABLES.has(name)));

    for (const name of doomed) {
        await db.execute(sql`drop table if exists ${sql.identifier(name)} cascade`);
        console.log(`dropped table ${name}`);
    }

    const enums = await db.execute<{ name: string }>(sql`
        select t.typname as name
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where t.typtype = 'e' and n.nspname = 'public'
    `);
    for (const { name } of enums.rows) {
        await db.execute(sql`drop type if exists ${sql.identifier(name)} cascade`);
        console.log(`dropped enum ${name}`);
    }

    // columns the old design kept on the user row; removing them here means the
    // schema push only ever has to *add* columns, which it can do without asking
    await db.execute(sql`alter table users drop column if exists sparks`);
    await db.execute(sql`alter table users drop column if exists "lessonProgress"`);
    await db.execute(sql`update users set "nativeLanguage" = 'en' where "nativeLanguage" = 'english'`);

    console.log("\nGame data cleared; accounts kept. Now run: npm run db:push");
    process.exit(0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

/**
 * What the storyteller has been costing: the most recent model calls, and
 * totals by task.
 *
 *   npx tsx scripts/usageReport.ts [--last=30] [--hours=24]
 */
import { desc, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage } from "../db/schema";

const flag = (name: string, fallback: number) =>
    Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);

const dollars = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;

async function main() {
    const last = await db.query.aiUsage.findMany({ orderBy: [desc(aiUsage.createdAt)], limit: flag("last", 30) });
    console.table(last.reverse().map((row) => ({
        at: row.createdAt.toISOString().slice(11, 19),
        task: row.task,
        model: row.model,
        seconds: (row.ms / 1000).toFixed(1),
        input: row.inputTokens,
        cached: row.cachedTokens,
        output: row.outputTokens,
        "tok/s": row.ms > 0 ? Math.round(row.outputTokens / (row.ms / 1000)) : 0,
        cost: dollars(row.costMicros),
        ok: row.ok,
    })));

    const since = new Date(Date.now() - flag("hours", 24) * 3_600_000);
    const byTask = await db.select({
        task: aiUsage.task,
        calls: sql<number>`count(*)::int`,
        seconds: sql<number>`round(avg(${aiUsage.ms}) / 1000.0, 1)::float8`,
        input: sql<number>`round(avg(${aiUsage.inputTokens}))::int`,
        cached: sql<number>`round(avg(${aiUsage.cachedTokens}))::int`,
        output: sql<number>`round(avg(${aiUsage.outputTokens}))::int`,
        each: sql<number>`round(avg(${aiUsage.costMicros}))::int`,
        total: sql<number>`sum(${aiUsage.costMicros})::float8`,
    }).from(aiUsage).where(gte(aiUsage.createdAt, since)).groupBy(aiUsage.task).orderBy(sql`sum(${aiUsage.costMicros}) desc`);

    console.log(`\nby task, last ${flag("hours", 24)}h (averages per call):`);
    console.table(byTask.map((row) => ({ ...row, each: dollars(row.each), total: dollars(row.total) })));
    console.log(`total: ${dollars(byTask.reduce((sum, row) => sum + row.total, 0))}`);
    process.exit(0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

/**
 * Give every landmark in every book the label it would be given today. Run it
 * after the dictionary has been re-imported or the labelling rules have
 * changed; books forged since then already have the right ones.
 *
 *   npx tsx --conditions=react-server scripts/relabel.ts            every book
 *   npx tsx --conditions=react-server scripts/relabel.ts --show     also print each language's labels
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { landmarks, regions } from "../db/schema";
import { isLangCode, LANG_CODES } from "../game/languages";
import { LANDMARK_KIND_LIST } from "../game/looks";
import { labelsForKinds } from "../server/services/worldWords";

async function main() {
    const show = process.argv.includes("--show");
    if (show) {
        for (const lang of LANG_CODES) {
            const labels = await labelsForKinds(lang, LANDMARK_KIND_LIST);
            console.log(`${lang}: ${LANDMARK_KIND_LIST.map((kind) => `${kind}=${labels.get(kind)?.text ?? "—"}`).join(", ")}`);
        }
    }

    const all = await db.query.books.findMany();
    let changed = 0;
    for (const book of all) {
        if (!isLangCode(book.targetLanguage)) continue;
        const places = await db.query.regions.findMany({ where: eq(regions.bookId, book.id) });
        if (places.length === 0) continue;
        const things = await db.query.landmarks.findMany({ where: inArray(landmarks.regionId, places.map((r) => r.id)) });
        const labels = await labelsForKinds(book.targetLanguage, [...new Set(things.map((t) => t.kind))]);
        for (const thing of things) {
            const entryId = labels.get(thing.kind)?.entryId ?? null;
            if (entryId === thing.labelEntryId) continue;
            await db.update(landmarks).set({ labelEntryId: entryId }).where(eq(landmarks.id, thing.id));
            changed++;
        }
    }
    console.log(`${all.length} book(s) checked, ${changed} label(s) changed`);
    process.exit(0);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

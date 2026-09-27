/**
 * Fetch the dictionary sources into data/dict-raw/ (gitignored, ~620 MB).
 * Files already present are skipped, so an interrupted run can simply be repeated.
 *
 *   npx tsx scripts/dict/download.ts            every language
 *   npx tsx scripts/dict/download.ts es ja      just these
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RAW_DIR, SOURCES } from "./sources";

async function resolveJmdictUrl(): Promise<string> {
    const response = await fetch("https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest", {
        headers: { "User-Agent": "wordbound-dictionary-import" },
    });
    if (!response.ok) throw new Error(`GitHub releases lookup failed: ${response.status}`);
    const release = await response.json() as { assets: { name: string; browser_download_url: string }[] };
    // the full English build, not the "common words only" one
    const asset = release.assets.find((a) => /^jmdict-eng-\d.*\.json\.tgz$/.test(a.name));
    if (!asset) throw new Error("No jmdict-eng .json.tgz asset in the latest release");
    return asset.browser_download_url;
}

async function download(url: string, file: string): Promise<void> {
    const target = join(RAW_DIR, file);
    if (existsSync(target) && statSync(target).size > 0) {
        console.log(`have   ${file} (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
        return;
    }
    const response = await fetch(url, { headers: { "User-Agent": "wordbound-dictionary-import" } });
    if (!response.ok || !response.body) throw new Error(`${url} → ${response.status}`);

    // write beside the target and rename, so a half-finished file is never mistaken for a whole one
    const partial = `${target}.part`;
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    renameSync(partial, target);
    console.log(`saved  ${file} (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
}

async function main() {
    mkdirSync(RAW_DIR, { recursive: true });
    const wanted = process.argv.slice(2);
    const sources = wanted.length > 0 ? SOURCES.filter((s) => wanted.includes(s.lang)) : SOURCES;

    for (const source of sources) {
        const url = source.url === "jmdict-latest" ? await resolveJmdictUrl() : source.url;
        await download(url, source.file);
        if (source.frequencyUrl && source.frequencyFile) await download(source.frequencyUrl, source.frequencyFile);
        for (const [extraUrl, extraFile] of source.extraFrequency ?? []) await download(extraUrl, extraFile);
    }
    console.log("done");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

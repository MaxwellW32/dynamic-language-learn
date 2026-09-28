/**
 * Give a card payment back: the gateway refunds the card, and the credit the
 * payment bought leaves the player's wallet. If they have spent some of it,
 * their balance goes below zero and the storyteller waits until it is made up.
 *
 *   npx tsx --conditions=react-server scripts/refundTopup.ts <topupId>          shows what would happen
 *   npx tsx --conditions=react-server scripts/refundTopup.ts <topupId> --yes    does it
 *
 * The top-up's id is in the address the player lands on after paying
 * (/wallet?topup=paid&id=…) and in the `topups` table.
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.development.local", ".env.local"], quiet: true });

async function main() {
    const [topupId, ...flags] = process.argv.slice(2);
    if (!topupId) throw new Error("Which top-up? Give its id.");

    const { eq } = await import("drizzle-orm");
    const { db } = await import("../db");
    const { topups, users } = await import("../db/schema");
    const { formatMoney } = await import("../server/ai/pricing");
    const { powerTranzByKey, refundPayment } = await import("../server/payments/powertranz");
    const { formatPrice, gatewaySays, isApproved, isCurrency } = await import("../server/payments/rules");
    const { markRefunded } = await import("../server/services/wallet");

    const topup = await db.query.topups.findFirst({ where: eq(topups.id, topupId) });
    if (!topup) throw new Error("There is no top-up with that id.");
    const owner = await db.query.users.findFirst({ where: eq(users.id, topup.userId) });
    const charged = topup.chargedMinor !== null && isCurrency(topup.chargedCurrency)
        ? formatPrice({ currency: topup.chargedCurrency, minor: topup.chargedMinor })
        : formatMoney(topup.paidCents * 10_000);

    console.log(`top-up   ${topup.id}`);
    console.log(`player   ${owner?.email ?? topup.userId}, wallet ${formatMoney(owner?.creditMicros ?? 0)}`);
    console.log(`paid     ${charged} through ${topup.provider} on ${topup.paidAt?.toISOString() ?? "—"}${topup.cardLast4 ? `, card ending ${topup.cardLast4}` : ""}`);
    console.log(`bought   ${formatMoney(topup.creditMicros)} of credit`);
    console.log(`status   ${topup.status}`);

    if (topup.status !== "paid") throw new Error(`Only a paid top-up can be given back; this one is ${topup.status}.`);
    const provider = powerTranzByKey(topup.provider);
    const config = provider?.config() ?? null;
    if (!config) throw new Error(`The gateway "${topup.provider}" is not set up here, so the card cannot be refunded from this machine.`);
    if (topup.chargedMinor === null) throw new Error("This top-up does not say what was charged.");

    if (!flags.includes("--yes")) {
        console.log(`\nNothing was done. To refund ${charged} to the card and take ${formatMoney(topup.creditMicros)} from the wallet, run again with --yes.`);
        return;
    }

    const answer = await refundPayment(config, topup.providerRef ?? topup.transactionId ?? "", { minor: topup.chargedMinor });
    if (!isApproved(answer)) throw new Error(`The gateway did not refund it: ${gatewaySays(answer)}. Nothing was changed.`);

    const result = await markRefunded(topup.id);
    console.log(`\nRefunded ${charged} to the card. The wallet now holds ${formatMoney(result.balanceMicros)}.`);
}

main().then(() => process.exit(0)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

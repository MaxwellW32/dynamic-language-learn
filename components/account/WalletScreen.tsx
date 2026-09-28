import Link from "next/link";
import { formatMoney } from "@/server/ai/pricing";
import type { walletActivityAction } from "@/server/actions/wallet";
import { SectionTitle } from "./PageShell";
import { LocalDate } from "./LocalDate";
import { TopupButton } from "./TopupButton";
import { reasonName, taskName } from "./names";

type WalletData = Extract<Awaited<ReturnType<typeof walletActivityAction>>, { ok: true }>["data"];

/**
 * The wallet page. Rendered on the server: only the top-up buttons need the
 * browser, and a top-up leaves the page and comes back, so a fresh render
 * shows the new balance with no client state to keep in step.
 */
export function WalletScreen({ data }: { data: WalletData }) {
    const { wallet, activity, usage, packages, checkout, outcome } = data;

    return (
        <div className="grid gap-10">
            {outcome && (
                <div
                    role="status"
                    className={`rounded-md border-2 px-4 py-3 text-center text-lg ${outcome.paid ? "border-moss/60 bg-moss/10 text-moss-deep" : "border-rose/50 bg-rose/10 text-ink"}`}
                >
                    {outcome.paid
                        ? <>Thank you — <strong>{formatMoney(outcome.creditMicros)}</strong> of storytelling has been added to your wallet.</>
                        : outcome.message}
                </div>
            )}

            <Balance wallet={wallet} />

            {wallet.mode === "credits" && (
                <section>
                    <SectionTitle aside={checkout.test ? <span className="text-sm text-ink-faint">test gateway: no card is charged</span> : undefined}>Add credit</SectionTitle>
                    <div className="grid gap-4 sm:grid-cols-3">
                        {packages.map((pkg) => (
                            // a phone lays each card on its side, so the three fit without a long scroll
                            <div key={pkg.key} className="flex items-center gap-4 sm:flex-col sm:items-stretch rounded-md border border-wood/35 bg-parchment-deep/50 shadow-card p-4 sm:text-center">
                                <div className="flex-1">
                                    <div className="font-display text-xl text-ink-soft">{pkg.name}</div>
                                    <div className="sm:mt-1 font-display text-3xl sm:text-4xl text-ink">{formatMoney(pkg.creditMicros)}</div>
                                    <div className="text-sm text-ink-soft">of storytelling</div>
                                    <p className="mt-1 sm:mt-2 font-hand text-xl leading-tight text-moss-deep">{pkg.blurb}</p>
                                </div>
                                <div className="w-32 shrink-0 sm:w-auto sm:mt-auto sm:pt-2">
                                    <TopupButton
                                        packageKey={pkg.key}
                                        packageName={pkg.name}
                                        price={checkout.prices[pkg.key] ?? formatMoney(pkg.paidCents * 10_000)}
                                        disabled={!checkout.available}
                                        needsCard={checkout.needsCard}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                    {checkout.available ? (
                        <p className="mt-3 text-center text-sm text-ink-faint">
                            Paid by card through PowerTranz. Your bank will ask you to confirm the payment. Credit is added the moment it goes through.
                        </p>
                    ) : (
                        <p className="mt-3 text-center text-ink-soft italic">Payments are not set up yet — credit cannot be added just now.</p>
                    )}
                </section>
            )}

            <section>
                <SectionTitle aside={<span className="text-sm text-ink-faint">the last 30 days</span>}>What it has written for you</SectionTitle>
                <p className="text-lg leading-relaxed">{usageSentence(usage, wallet.mode)}</p>
                {usage.byTask.length > 0 && (
                    <ul className="mt-4 max-w-md">
                        {groupTasks(usage.byTask).map((row) => (
                            <li key={row.name} className="flex items-baseline gap-3 border-b border-ink/15 py-1.5">
                                <span className="flex-1">{row.name}</span>
                                <span className="text-sm text-ink-faint whitespace-nowrap">{row.calls} {row.calls === 1 ? "time" : "times"}</span>
                                <span className="w-16 text-right tabular-nums">{formatMoney(row.chargedMicros)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <SectionTitle aside={<span className="text-sm text-ink-faint">newest first</span>}>The ledger</SectionTitle>
                {activity.length === 0 ? (
                    <p className="text-ink-soft italic">Nothing has been written in the ledger yet.</p>
                ) : (
                    <ol className="border-t-2 border-double border-ink/30">
                        {activity.map((line) => (
                            <li key={line.id} className="flex items-start gap-3 border-b border-ink/15 py-2">
                                <div className="flex-1">
                                    <div className="leading-snug">{reasonName(line.reason)}</div>
                                    <div className="text-sm text-ink-faint">
                                        <LocalDate iso={line.createdAt.toISOString()} />
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className={`tabular-nums leading-snug ${line.deltaMicros > 0 ? "text-moss-deep font-semibold" : "text-ink"}`}>
                                        {signedMoney(line.deltaMicros)}
                                    </div>
                                    <div className="text-sm text-ink-faint tabular-nums whitespace-nowrap">
                                        leaving {formatMoney(line.balanceAfterMicros)}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
        </div>
    );
}

function Balance({ wallet }: { wallet: WalletData["wallet"] }) {
    if (wallet.mode === "byok") {
        return (
            <section className="text-center">
                <div className="text-5xl" aria-hidden>🔑</div>
                <p className="mt-2 text-xl">The storyteller is powered by your own key.</p>
                <p className="mt-1 text-ink-soft">
                    Your OpenAI account pays for what is written. <Link href="/welcome" className="text-ember-deep underline decoration-dotted underline-offset-4 hover:text-ember">Switch to a wallet</Link>
                </p>
            </section>
        );
    }
    if (wallet.mode === null) {
        return (
            <section className="text-center">
                <p className="text-xl">You have not chosen how to pay the storyteller yet.</p>
                <Link href="/welcome" className="mt-2 inline-block font-display text-lg text-ember-deep underline decoration-dotted underline-offset-4 hover:text-ember">
                    Choose now
                </Link>
            </section>
        );
    }
    return (
        <section className="text-center">
            <div className="font-display text-ink-soft tracking-wide">In your wallet</div>
            <div className={`font-display text-6xl sm:text-7xl leading-none mt-1 tabular-nums ${wallet.low ? "text-ember-deep" : "text-ink"}`}>
                {formatMoney(wallet.balanceMicros)}
            </div>
            <p className={`mt-2 font-hand text-2xl ${wallet.low ? "text-ember-deep" : "text-ink-soft"}`}>
                {wallet.balanceMicros <= 0
                    ? "The ink has run dry — add credit to keep the story going."
                    : wallet.low
                        ? "Running low — enough for a few more conversations."
                        : `Enough for about ${conversations(wallet.balanceMicros)} conversation turns.`}
            </p>
        </section>
    );
}

/** a conversation turn costs about half a cent: a rough, honest sense of scale */
function conversations(micros: number): string {
    const turns = Math.floor(micros / 5_000);
    const rounded = turns >= 1000 ? Math.round(turns / 100) * 100 : turns >= 100 ? Math.round(turns / 10) * 10 : turns;
    return rounded.toLocaleString("en-US");
}

type Usage = WalletData["usage"];

function usageSentence(usage: Usage, mode: WalletData["wallet"]["mode"]): string {
    if (usage.calls === 0) return "The storyteller has not written anything for you in the last 30 days.";
    const times = `${usage.calls} ${usage.calls === 1 ? "time" : "times"}`;
    const cost = mode === "byok"
        ? `, which cost your own key about ${formatMoney(usage.costMicros)}`
        : ` and charged ${formatMoney(usage.chargedMicros)} in all`;
    const cached = Math.round(usage.cachedShare * 100);
    // the provider bills input it has cached at a tenth of the usual price (server/ai/pricing.ts)
    const memory = cached > 0
        ? ` ${cached}% of what it read was already in its memory, which costs a tenth as much.`
        : "";
    return `The storyteller wrote for you ${times}${cost}.${memory}`;
}

/** several task names share one plain name ("narrate-arrival", "narrate-examine"…): add them up */
function groupTasks(rows: Usage["byTask"]): { name: string; calls: number; chargedMicros: number }[] {
    const grouped = new Map<string, { name: string; calls: number; chargedMicros: number }>();
    for (const row of rows) {
        const name = taskName(row.task);
        const into = grouped.get(name) ?? { name, calls: 0, chargedMicros: 0 };
        into.calls += row.calls;
        into.chargedMicros += row.chargedMicros;
        grouped.set(name, into);
    }
    return [...grouped.values()].sort((a, b) => b.chargedMicros - a.chargedMicros || b.calls - a.calls);
}

/**
 * A ledger amount with its sign. formatMoney writes a sliver as "<$0.001",
 * which reads badly behind a minus sign, so a sliver is said in words.
 */
function signedMoney(micros: number): string {
    if (micros === 0) return formatMoney(0);
    if (Math.abs(micros) < 500) return micros > 0 ? "+ under $0.001" : "under $0.001";
    return micros > 0 ? `+${formatMoney(micros)}` : `−${formatMoney(-micros)}`;
}

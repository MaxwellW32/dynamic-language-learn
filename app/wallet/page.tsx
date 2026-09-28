import { redirect } from "next/navigation";
import { PageShell } from "@/components/account/PageShell";
import { WalletScreen } from "@/components/account/WalletScreen";
import { requireUser } from "@/server/auth";
import { walletActivityAction } from "@/server/actions/wallet";

export const metadata = { title: "Your wallet — Wordbound" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    // redirect() works by throwing, so it must stay outside the catch
    const me = await requireUser().catch(() => null);
    if (!me) redirect("/");

    // ?topup=…&id=… is how the player comes back from their bank
    const query = await searchParams;
    const result = await walletActivityAction({ outcome: one(query.topup), topupId: one(query.id) });
    return (
        <PageShell title="Your wallet" subtitle="What the storyteller has to write with, and what it has written.">
            {result.ok
                ? <WalletScreen data={result.data} />
                : <p className="text-center text-lg text-ink-soft italic py-6">{result.error}</p>}
        </PageShell>
    );
}

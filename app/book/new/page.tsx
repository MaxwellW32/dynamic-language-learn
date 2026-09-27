import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NewBookWizard } from "@/components/book/NewBookWizard";
import { requireUser } from "@/server/auth";
import { walletViewOf } from "@/server/services/walletRules";

export const metadata: Metadata = { title: "A new book — Wordbound" };

export default async function NewBookPage() {
    let found;
    try {
        found = await requireUser();
    } catch {
        redirect("/");
    }
    const { user } = found;
    if (!user.billingMode) redirect("/welcome");

    return <NewBookWizard defaultName={user.name?.split(" ")[0] ?? ""} wallet={walletViewOf(user)} />;
}

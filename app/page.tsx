import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth/auth";
import { Cover } from "@/components/shelf/Cover";
import { Shelf } from "@/components/shelf/Shelf";
import { mockScene } from "@/game/worldgen/mock";
import { requireUser } from "@/server/auth";
import { listBooks } from "@/server/services/overview";
import { walletViewOf } from "@/server/services/walletRules";

async function withGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
}

async function withEmail(formData: FormData) {
    "use server";
    await signIn("nodemailer", { email: String(formData.get("email") ?? ""), redirectTo: "/" });
}

async function leave() {
    "use server";
    await signOut({ redirectTo: "/" });
}

export default async function Home() {
    const session = await auth();

    if (!session?.user?.id) {
        // a village at golden hour behind the cover: the first thing a visitor sees is the world itself
        const scene = mockScene({
            seed: 23, kind: "settlement", biome: "autumn", timeOfDay: "golden", weather: "petals", styleKit: "timber",
        });
        return <Cover scene={scene} withGoogle={withGoogle} withEmail={withEmail} />;
    }

    const { user } = await requireUser();
    if (!user.billingMode) redirect("/welcome");

    return (
        <Shelf
            name={user.name?.split(" ")[0] ?? null}
            books={await listBooks(user.id)}
            wallet={walletViewOf(user)}
            leave={leave}
        />
    );
}

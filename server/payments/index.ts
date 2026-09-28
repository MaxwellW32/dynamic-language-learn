import "server-only";
import type { Topup, User } from "@/db/schema";
import type { Package } from "../services/wallet";
import { powerTranz, powerTranzTest } from "./powertranz";
import type { Card, Price } from "./rules";

/*
 * Top-ups go through a PaymentProvider. A provider only ever finds out that a
 * payment happened; crediting is always services/wallet.completeTopup, which
 * credits a top-up exactly once however many times it is told.
 */

/** where the browser goes next: to pay, or back to the wallet if there is nothing more to do */
export type Checkout = { url: string };

export interface PaymentProvider {
    key: string;
    /** configured, and meant for this player in this environment */
    availableTo(user: User): boolean;
    /** true when the player types their card into our own form; false when the gateway's page takes it */
    needsCard(): boolean;
    /** what the card is charged for a package, in the currency the merchant account takes */
    priceOf(pkg: Package): Price;
    startCheckout(input: { topup: Topup; pkg: Package; user: User; card: Card | null }): Promise<Checkout>;
}

/** the test gateway first: it only ever answers for a test account, which must never reach the real one */
const providers: PaymentProvider[] = [powerTranzTest, powerTranz];

export function providerFor(user: User): PaymentProvider | null {
    return providers.find((provider) => provider.availableTo(user)) ?? null;
}

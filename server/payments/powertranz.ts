import "server-only";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { topups, type Topup, type User } from "@/db/schema";
import { testModeEnabled } from "@/lib/testMode";
import { completeTopup, failTopup, parkHandoff, TopupError } from "../services/wallet";
import type { Checkout, PaymentProvider } from "./index";
import {
    answersFor, authenticationOf, cardExpiration, CURRENCY_NUMERIC, declineMessage, formatPrice, gatewaySays,
    isApproved, isCurrency, priceOf, toMajorUnits,
    type Card, type Currency, type ExpiryFormat, type GatewayResponse,
} from "./rules";

/*
 * PowerTranz (First Atlantic Commerce): card payments for a Jamaican merchant.
 *
 * The flow, "SPI" with 3-D Secure:
 *
 *   1. POST /spi/sale — the amount, and either a hosted page (PowerTranz shows
 *      the card form) or the card typed into our own form. The answer holds
 *      RedirectData: a page that takes the player to the card form or to their
 *      bank's verification.
 *   2. We keep that page on the top-up and send the browser to our handoff
 *      route, which serves it once. The player leaves for their bank.
 *   3. The bank sends the browser back to MerchantResponseUrl — our callback —
 *      with an SpiToken.
 *   4. POST /spi/payment with the SpiToken. ONLY THIS ANSWER moves money and
 *      only this answer is believed: what the browser posted can be written by
 *      anyone.
 *
 * NOT YET RUN AGAINST POWERTRANZ. It was written from the flow of the owner's
 * other projects and checked end to end against the test gateway in
 * app/api/dev/powertranz, which answers in the same shapes. Before taking real
 * money, run one payment on staging and confirm, in this order:
 *   - the expiry format for a typed card (POWERTRANZ_EXPIRY_FORMAT, YYMM assumed)
 *   - that /spi/payment takes the token as a bare JSON string
 *   - that the final answer carries RiskManagement.ThreeDSecure.AuthenticationStatus
 *   - the production host (POWERTRANZ_BASE_URL overrides the one below)
 *
 * Settings (all read from the environment, none ever logged):
 *   POWERTRANZ_ID, POWERTRANZ_PASSWORD     the merchant's credentials
 *   POWERTRANZ_ENV                         staging (default) | production
 *   POWERTRANZ_BASE_URL                    overrides the host
 *   POWERTRANZ_HOSTED_PAGE_SET / _NAME     a hosted payment page: PowerTranz takes the card
 *   POWERTRANZ_CARD_FORM=own               or: our own form takes it (see docs/ARCHITECTURE.md §8)
 *   POWERTRANZ_CURRENCY                    USD (default) | JMD
 *   POWERTRANZ_JMD_PER_USD                 the owner's rate, when charging JMD
 *   POWERTRANZ_REQUIRE_3DS                 true (default): a payment the bank did not verify is given back
 */

const STAGING_URL = "https://staging.ptranz.com/api";
const PRODUCTION_URL = "https://gateway.ptranz.com/api";
const TIMEOUT_MS = 30_000;

export type PowerTranzConfig = {
    id: string;
    password: string;
    baseUrl: string;
    hostedPage: { set: string; name: string } | null;
    currency: Currency;
    jmdPerUsd: number | null;
    requireAuthentication: boolean;
    expiryFormat: ExpiryFormat;
};

const env = (name: string) => process.env[name]?.trim() ?? "";

export function appUrl(path: string): string {
    return `${(process.env.AUTH_URL ?? "http://localhost:3011").replace(/\/+$/, "")}${path}`;
}

function sharedSettings(): Pick<PowerTranzConfig, "currency" | "jmdPerUsd" | "requireAuthentication" | "expiryFormat"> | null {
    const currency = env("POWERTRANZ_CURRENCY").toUpperCase() || "USD";
    if (!isCurrency(currency)) return null;
    const rate = Number(env("POWERTRANZ_JMD_PER_USD"));
    const jmdPerUsd = Number.isFinite(rate) && rate > 0 ? rate : null;
    if (currency === "JMD" && jmdPerUsd === null) return null;
    return {
        currency,
        jmdPerUsd,
        requireAuthentication: env("POWERTRANZ_REQUIRE_3DS").toLowerCase() !== "false",
        expiryFormat: env("POWERTRANZ_EXPIRY_FORMAT").toUpperCase() === "MMYY" ? "MMYY" : "YYMM",
    };
}

/** why card payments are off, for whoever runs the server; null when they are on */
export function whyNotConfigured(): string | null {
    if (!env("POWERTRANZ_ID") || !env("POWERTRANZ_PASSWORD")) return "POWERTRANZ_ID and POWERTRANZ_PASSWORD are not set.";
    const hosted = env("POWERTRANZ_HOSTED_PAGE_SET") && env("POWERTRANZ_HOSTED_PAGE_NAME");
    if (!hosted && env("POWERTRANZ_CARD_FORM").toLowerCase() !== "own") {
        return "Choose who takes the card: set POWERTRANZ_HOSTED_PAGE_SET and POWERTRANZ_HOSTED_PAGE_NAME, or POWERTRANZ_CARD_FORM=own.";
    }
    if (sharedSettings() === null) return "POWERTRANZ_CURRENCY must be USD or JMD, and JMD needs POWERTRANZ_JMD_PER_USD.";
    return null;
}

function liveConfig(): PowerTranzConfig | null {
    if (whyNotConfigured() !== null) return null;
    const shared = sharedSettings();
    if (!shared) return null;
    const set = env("POWERTRANZ_HOSTED_PAGE_SET");
    const name = env("POWERTRANZ_HOSTED_PAGE_NAME");
    const production = env("POWERTRANZ_ENV").toLowerCase() === "production";
    return {
        id: env("POWERTRANZ_ID"),
        password: env("POWERTRANZ_PASSWORD"),
        baseUrl: (env("POWERTRANZ_BASE_URL") || (production ? PRODUCTION_URL : STAGING_URL)).replace(/\/+$/, ""),
        hostedPage: set && name ? { set, name } : null,
        ...shared,
    };
}

/* ------------------------------------------------------------------ */
/* the test gateway                                                    */
/* ------------------------------------------------------------------ */

export const TEST_GATEWAY_ID = "wordbound-test";

/** the password the test gateway expects: derived from the test-mode secret, so it is never a literal in the code */
export function testGatewayPassword(): string {
    return createHmac("sha256", process.env.TEST_MODE_SECRET ?? "").update("powertranz-test-gateway").digest("hex");
}

/**
 * The same flow against app/api/dev/powertranz, for the seeded test accounts
 * in a development build. It takes the owner's currency settings, so that
 * charging in JMD can be walked through before a merchant account exists.
 */
function testConfig(): PowerTranzConfig | null {
    if (!testModeEnabled()) return null;
    const shared = sharedSettings() ?? { currency: "USD" as const, jmdPerUsd: null, requireAuthentication: true, expiryFormat: "YYMM" as const };
    return {
        id: TEST_GATEWAY_ID,
        password: testGatewayPassword(),
        baseUrl: appUrl("/api/dev/powertranz"),
        hostedPage: env("POWERTRANZ_CARD_FORM").toLowerCase() === "own" ? null : { set: "test", name: "test" },
        ...shared,
    };
}

/* ------------------------------------------------------------------ */
/* the wire                                                            */
/* ------------------------------------------------------------------ */

/** thrown when the gateway could not be reached or answered with nonsense: nothing is known about the payment */
export class GatewayUnreachable extends Error {}

async function post(config: PowerTranzConfig, path: string, body: unknown, withCredentials = true): Promise<GatewayResponse> {
    let response: Response;
    try {
        response = await fetch(`${config.baseUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(withCredentials ? { "PowerTranz-PowerTranzId": config.id, "PowerTranz-PowerTranzPassword": config.password } : {}),
            },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        // only the kind of failure: a fetch error can carry the url, never the body, but nothing is risked
        throw new GatewayUnreachable(error instanceof Error ? error.name : "network error");
    }

    const text = await response.text();
    let parsed: GatewayResponse;
    try {
        const value: unknown = text.length > 0 ? JSON.parse(text) : {};
        parsed = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as GatewayResponse) : {};
    } catch {
        if (response.status >= 500) throw new GatewayUnreachable(`gateway answered ${response.status}`);
        parsed = { ResponseMessage: `unreadable answer (${response.status})` };
    }
    parsed.httpStatus = response.status;
    return parsed;
}

/** finish a sale; the token goes as a bare JSON string, first without credentials as the specification has it */
async function completePayment(config: PowerTranzConfig, spiToken: string): Promise<GatewayResponse> {
    const first = await post(config, "/spi/payment", spiToken, false);
    if (first.httpStatus === 401 || first.httpStatus === 403) return post(config, "/spi/payment", spiToken, true);
    return first;
}

async function voidPayment(config: PowerTranzConfig, transactionId: string): Promise<boolean> {
    try {
        return isApproved(await post(config, "/void", { TransactionIdentifier: transactionId }));
    } catch {
        return false;
    }
}

export async function refundPayment(config: PowerTranzConfig, transactionId: string, price: { minor: number }): Promise<GatewayResponse> {
    return post(config, "/refund", {
        TransactionIdentifier: transactionId,
        TotalAmount: toMajorUnits(price.minor),
        Refund: true,
    });
}

export async function gatewayAlive(config: PowerTranzConfig): Promise<boolean> {
    try {
        const response = await fetch(`${config.baseUrl}/alive`, {
            headers: { "PowerTranz-PowerTranzId": config.id, "PowerTranz-PowerTranzPassword": config.password },
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* the provider                                                        */
/* ------------------------------------------------------------------ */

export type Outcome = {
    paid: boolean;
    /** the top-up it was about, when that could be told */
    topupId: string | null;
    /** for the player */
    message: string;
};

export type PowerTranz = PaymentProvider & {
    config(): PowerTranzConfig | null;
    /** the browser has come back from the bank: find out from the gateway what happened, and act on that alone */
    settle(posted: GatewayResponse): Promise<Outcome>;
};

function provider(key: string, config: () => PowerTranzConfig | null, serves: (user: User) => boolean): PowerTranz {
    const log = (text: string, ...more: unknown[]) => console.error(`[payments] ${key}: ${text}`, ...more);

    /** the gateway has said yes and the answer is about this top-up: credit it, once */
    async function credit(topup: Topup, answer: GatewayResponse): Promise<Outcome> {
        const providerRef = answer.TransactionIdentifier ?? topup.transactionId ?? topup.id;
        const suffix = (answer.CardSuffix ?? answer.CardPan ?? "").replace(/\D/g, "").slice(-4);
        try {
            await completeTopup({
                topupId: topup.id, provider: key, providerRef,
                card: { brand: answer.CardBrand ?? null, last4: suffix.length === 4 ? suffix : null, authCode: answer.AuthorizationCode ?? null },
            });
        } catch (error) {
            // the card has been charged and the wallet has not been credited: this needs a person, today
            log(`PAID BUT NOT CREDITED — top-up ${topup.id}, gateway transaction ${providerRef}`, error instanceof TopupError ? error.message : error);
            return { paid: false, topupId: topup.id, message: "Your payment went through but the credit has not arrived. Please contact us — nothing is lost." };
        }
        return { paid: true, topupId: topup.id, message: "Your credit has been added." };
    }

    return {
        key,
        config,

        availableTo(user) {
            return config() !== null && serves(user);
        },

        needsCard() {
            const current = config();
            return current !== null && current.hostedPage === null;
        },

        priceOf(pkg) {
            const current = config();
            if (!current) throw new Error("Card payments are not set up yet.");
            return priceOf(pkg.paidCents, current.currency, current.jmdPerUsd);
        },

        async startCheckout({ topup, user, card }): Promise<Checkout> {
            const current = config();
            if (!current || !serves(user) || topup.userId !== user.id) throw new Error("Card payments are not set up yet.");
            if (!topup.transactionId || topup.chargedMinor === null || !isCurrency(topup.chargedCurrency)) {
                throw new Error("This payment could not be prepared. Please try again.");
            }
            if (current.hostedPage === null && card === null) throw new Error("Enter your card details.");

            const request: Record<string, unknown> = {
                TransactionIdentifier: topup.transactionId,
                TotalAmount: toMajorUnits(topup.chargedMinor),
                CurrencyCode: CURRENCY_NUMERIC[topup.chargedCurrency],
                ThreeDSecure: true,
                OrderIdentifier: topup.id,
                AddressMatch: false,
                ...(user.email ? { BillingAddress: { EmailAddress: user.email } } : {}),
                ExtendedData: {
                    // 5 is the full window: the player is sent to their bank as a page of its own, not in a frame
                    ThreeDSecure: { ChallengeWindowSize: 5, ChallengeIndicator: "01" },
                    MerchantResponseUrl: appUrl(`/api/payments/${key}/callback`),
                    ...(current.hostedPage ? { HostedPage: { PageSet: current.hostedPage.set, PageName: current.hostedPage.name } } : {}),
                },
                ...(current.hostedPage === null && card !== null ? { Source: sourceOf(card, current.expiryFormat) } : {}),
            };

            let answer: GatewayResponse;
            try {
                answer = await post(current, "/spi/sale", request);
            } catch (error) {
                log(`could not start top-up ${topup.id}`, error instanceof Error ? error.message : error);
                await failTopup(topup.id, "The payment could not be started.");
                throw new Error("The payment page could not be reached. Nothing was charged — please try again.");
            }

            if (typeof answer.RedirectData === "string" && answer.RedirectData.trim().length > 0) {
                const handoffKey = await parkHandoff(topup.id, answer.RedirectData);
                return { url: `/api/payments/${key}/handoff?t=${encodeURIComponent(topup.id)}&k=${handoffKey}` };
            }

            // With 3-D Secure asked for, a sale is never finished by /spi/sale itself. Should a gateway do so
            // all the same, the answer is its own and is believed like any other final answer.
            if (isApproved(answer) && answersFor(topup, answer).ok) {
                const outcome = await credit(topup, answer);
                return { url: `/wallet?topup=${outcome.paid ? "paid" : "failed"}&id=${encodeURIComponent(topup.id)}` };
            }

            log(`top-up ${topup.id} was refused at the start: ${gatewaySays(answer)}`);
            const message = declineMessage(answer);
            await failTopup(topup.id, message);
            throw new Error(message);
        },

        async settle(posted): Promise<Outcome> {
            const current = config();
            if (!current) return { paid: false, topupId: null, message: "Card payments are not set up yet." };

            const hint = typeof posted.OrderIdentifier === "string" ? posted.OrderIdentifier : null;
            const spiToken = typeof posted.SpiToken === "string" ? posted.SpiToken.trim() : "";
            if (spiToken.length === 0 || spiToken.length > 4000) {
                return { paid: false, topupId: hint, message: "The payment was not confirmed. Nothing was charged." };
            }

            // What the browser posted is not believed, but it is not ignored either: if it says the bank did not
            // verify the card, the sale is left unfinished — and so nothing is charged.
            const postedCode = (posted.IsoResponseCode ?? "").toString().toUpperCase();
            if ((postedCode.startsWith("3D") && postedCode !== "3D0") || (current.requireAuthentication && authenticationOf(posted) === "failed")) {
                return { paid: false, topupId: hint, message: "Your bank could not verify the card. Nothing was charged." };
            }

            let answer: GatewayResponse;
            try {
                answer = await completePayment(current, spiToken);
            } catch (error) {
                // nothing is known: the top-up stays pending, and a second return from the bank may still settle it
                log(`could not finish a payment (top-up ${hint ?? "unknown"})`, error instanceof Error ? error.message : error);
                return { paid: false, topupId: hint, message: "We could not confirm the payment with the bank. If you were charged, contact us and we will put it right." };
            }

            // from here on only the gateway's own answer is used, including which top-up this is
            const orderId = typeof answer.OrderIdentifier === "string" ? answer.OrderIdentifier : "";
            const topup = orderId ? await db.query.topups.findFirst({ where: eq(topups.id, orderId) }) : undefined;

            if (!topup || topup.provider !== key) {
                if (isApproved(answer) && answer.TransactionIdentifier) {
                    const released = await voidPayment(current, answer.TransactionIdentifier);
                    log(`an approved payment matches no top-up (order "${orderId.slice(0, 60)}"); ${released ? "it was voided" : "VOID FAILED — refund it by hand"}`);
                }
                return { paid: false, topupId: null, message: "The payment did not go through. Nothing was charged." };
            }
            if (topup.status === "paid") return { paid: true, topupId: topup.id, message: "Your credit has been added." };

            if (!isApproved(answer)) {
                log(`top-up ${topup.id} was declined: ${gatewaySays(answer)}`);
                const message = declineMessage(answer);
                await failTopup(topup.id, message);
                return { paid: false, topupId: topup.id, message };
            }

            const match = answersFor(topup, answer);
            const unverified = current.requireAuthentication && authenticationOf(answer) === "failed";
            if (!match.ok || unverified) {
                // money has been taken that must not be kept: give it back at once
                const released = answer.TransactionIdentifier ? await voidPayment(current, answer.TransactionIdentifier) : false;
                log(`top-up ${topup.id} was approved but ${match.ok ? "the bank did not verify the cardholder" : match.why}; ${released ? "it was voided" : "VOID FAILED — refund it by hand"}`);
                const message = match.ok
                    ? "Your bank could not verify the card, so the payment was cancelled."
                    : "The payment could not be matched to your order, so it was cancelled.";
                await failTopup(topup.id, message);
                return { paid: false, topupId: topup.id, message };
            }

            return credit(topup, answer);
        },
    };
}

function sourceOf(card: Card, format: ExpiryFormat): Record<string, string> {
    return {
        CardPan: card.pan,
        CardCvv: card.cvv,
        CardExpiration: cardExpiration(card, format),
        CardholderName: card.name,
    };
}

/**
 * Real cards, once the merchant's credentials are in place — for everyone but
 * the seeded test accounts of a development build, which are kept to the test
 * gateway so that a test run can never put a charge on a real card.
 */
export const powerTranz = provider("powertranz", liveConfig, (user) => !(user.isTest && testModeEnabled()));

/** the test gateway, for the seeded test accounts, in development only */
export const powerTranzTest = provider("powertranz-test", testConfig, (user) => user.isTest);

export function powerTranzByKey(key: string): PowerTranz | null {
    return [powerTranz, powerTranzTest].find((one) => one.key === key) ?? null;
}

export { formatPrice };

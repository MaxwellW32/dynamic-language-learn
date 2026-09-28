/*
 * The rules of taking a card payment that need no network and no database:
 * what a package costs in the merchant's currency, whether a card could be
 * real, what the gateway's answer means. Kept apart from powertranz.ts
 * (which is server-only and talks to the gateway) so the unit tests can
 * import them with plain `tsx --test`.
 */

/* ------------------------------------------------------------------ */
/* money                                                               */
/* ------------------------------------------------------------------ */

export type Currency = "USD" | "JMD";

/** ISO 4217 numeric codes, which is what the gateway speaks */
export const CURRENCY_NUMERIC: Record<Currency, string> = { USD: "840", JMD: "388" };

export type Price = {
    currency: Currency;
    /** in the smallest unit of the currency: cents */
    minor: number;
};

export function isCurrency(value: unknown): value is Currency {
    return value === "USD" || value === "JMD";
}

/**
 * What the card is charged for something priced in US cents. Packages are
 * priced in US dollars because what they buy (model tokens) is; a merchant
 * account that only takes Jamaican dollars charges the same value at the
 * owner's rate, rounded up to a whole dollar.
 */
export function priceOf(paidUsCents: number, currency: Currency, jmdPerUsd: number | null): Price {
    if (!Number.isSafeInteger(paidUsCents) || paidUsCents <= 0) throw new Error("A price must be a whole number of cents.");
    if (currency === "USD") return { currency, minor: paidUsCents };
    if (jmdPerUsd === null || !Number.isFinite(jmdPerUsd) || jmdPerUsd <= 0) {
        throw new Error("Charging in JMD needs POWERTRANZ_JMD_PER_USD.");
    }
    // the epsilon keeps 6.00 × 160 = 960.0000000001 from becoming 961
    const dollars = Math.ceil((paidUsCents / 100) * jmdPerUsd - 1e-6);
    return { currency, minor: dollars * 100 };
}

export function formatPrice(price: Price): string {
    const amount = price.minor / 100;
    if (price.currency === "JMD") return `J$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return `$${amount.toFixed(2)}`;
}

/** the gateway takes decimal major units (12.34), never cents */
export function toMajorUnits(minor: number): number {
    return Math.round(minor) / 100;
}

/* ------------------------------------------------------------------ */
/* a card typed into our own form                                      */
/* ------------------------------------------------------------------ */

export type CardInput = { name: string; number: string; expiry: string; cvv: string };

export type Card = {
    name: string;
    pan: string;
    /** 1–12 */
    month: number;
    /** two digits */
    year: number;
    cvv: string;
};

export function passesLuhn(digits: string): boolean {
    if (!/^\d+$/.test(digits)) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let digit = digits.charCodeAt(i) - 48;
        if (double) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        double = !double;
    }
    return sum % 10 === 0;
}

/**
 * Check what was typed before it goes anywhere. The messages never repeat
 * what was typed: they may be logged or shown, and a card number must not be.
 */
export function readCard(input: unknown, now: Date): { ok: true; card: Card } | { ok: false; message: string } {
    if (input === null || typeof input !== "object") return { ok: false, message: "Enter your card details." };
    const raw = input as Partial<Record<keyof CardInput, unknown>>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");

    const name = text(raw.name).trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) return { ok: false, message: "Enter the name as it is written on the card." };

    const pan = text(raw.number).replace(/[\s-]/g, "");
    if (!/^\d{13,19}$/.test(pan) || !passesLuhn(pan)) return { ok: false, message: "That card number does not look right." };

    const expiry = text(raw.expiry).replace(/\s/g, "");
    const parts = /^(\d{2})\/?(\d{2})$/.exec(expiry);
    if (!parts) return { ok: false, message: "Enter the expiry date as MM/YY." };
    const month = Number(parts[1]);
    const year = Number(parts[2]);
    if (month < 1 || month > 12) return { ok: false, message: "Enter the expiry date as MM/YY." };
    // a card is good until the end of the month written on it
    const thisYear = now.getUTCFullYear() % 100;
    const thisMonth = now.getUTCMonth() + 1;
    if (year < thisYear || (year === thisYear && month < thisMonth)) return { ok: false, message: "That card has expired." };
    if (year > thisYear + 20) return { ok: false, message: "Enter the expiry date as MM/YY." };

    const cvv = text(raw.cvv).trim();
    if (!/^\d{3,4}$/.test(cvv)) return { ok: false, message: "Enter the 3 or 4 digit security code." };

    return { ok: true, card: { name, pan, month, year, cvv } };
}

export type ExpiryFormat = "YYMM" | "MMYY";

export function cardExpiration(card: Pick<Card, "month" | "year">, format: ExpiryFormat): string {
    const mm = String(card.month).padStart(2, "0");
    const yy = String(card.year).padStart(2, "0");
    return format === "YYMM" ? `${yy}${mm}` : `${mm}${yy}`;
}

/* ------------------------------------------------------------------ */
/* what the gateway says                                               */
/* ------------------------------------------------------------------ */

export type GatewayResponse = {
    TransactionType?: number;
    Approved?: boolean;
    AuthorizationCode?: string;
    TransactionIdentifier?: string;
    TotalAmount?: number;
    CurrencyCode?: string;
    IsoResponseCode?: string;
    ResponseMessage?: string;
    RRN?: string;
    CardBrand?: string;
    CardSuffix?: string;
    CardPan?: string;
    SpiToken?: string;
    RedirectData?: string;
    OrderIdentifier?: string;
    RiskManagement?: { ThreeDSecure?: { AuthenticationStatus?: string; Eci?: string; ResponseCode?: string } };
    Errors?: { Code?: string; Message?: string }[];
    /** the HTTP status the answer came with; set by our own client */
    httpStatus?: number;
    [key: string]: unknown;
};

export function isApproved(response: GatewayResponse): boolean {
    if (response.Approved === true) return true;
    return response.Approved === undefined && response.IsoResponseCode === "00";
}

/**
 * Whether the cardholder's bank verified them (3-D Secure). "Y" is verified,
 * "A" is an attempt the bank stands behind; both move the liability for fraud
 * to the bank. Anything else does not. "unknown" when the answer does not say.
 */
export function authenticationOf(response: GatewayResponse): "passed" | "failed" | "unknown" {
    const status = response.RiskManagement?.ThreeDSecure?.AuthenticationStatus;
    if (typeof status !== "string" || status.trim() === "") return "unknown";
    const code = status.trim().toUpperCase();
    return code === "Y" || code === "A" ? "passed" : "failed";
}

const DECLINES: Record<string, string> = {
    "05": "Your bank declined the payment. Nothing was charged.",
    "51": "There are not enough funds on that card. Nothing was charged.",
    "54": "That card has expired.",
    "14": "That card number was not recognised.",
    "N7": "The security code did not match.",
    "82": "The security code did not match.",
    "57": "That card is not allowed to make this kind of payment. Your bank can switch online payments on.",
    "61": "That payment is over the card's limit.",
    "65": "That payment is over the card's limit.",
    "91": "Your bank could not be reached. Please try again in a little while.",
    "96": "Your bank could not be reached. Please try again in a little while.",
};

/** why it was not paid, in words for the player — never the gateway's own text, which is written for engineers */
export function declineMessage(response: GatewayResponse): string {
    const code = (response.IsoResponseCode ?? "").trim().toUpperCase();
    if (code.startsWith("3D") && code !== "3D0") return "Your bank could not verify the card. Nothing was charged.";
    return DECLINES[code] ?? "The payment did not go through. Nothing was charged.";
}

/** the gateway's own account of what went wrong, for the server log */
export function gatewaySays(response: GatewayResponse): string {
    const errors = (response.Errors ?? []).map((e) => e.Message ?? e.Code).filter(Boolean).join("; ");
    return [response.IsoResponseCode, errors || response.ResponseMessage].filter(Boolean).join(" ").slice(0, 300) || "no reason given";
}

/**
 * Whatever is posted to the merchant response url: a form with one field,
 * "Response", holding JSON; or JSON itself; or fields in the query string.
 * Nothing read here is trusted with money — see settle() in powertranz.ts.
 */
export function parseCallback(contentType: string, rawBody: string, query: URLSearchParams): GatewayResponse {
    let parsed: GatewayResponse = {};
    const asObject = (text: string): GatewayResponse => {
        try {
            const value: unknown = JSON.parse(text);
            return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as GatewayResponse) : {};
        } catch {
            return {};
        }
    };

    if (contentType.includes("application/json")) {
        parsed = asObject(rawBody);
    } else if (rawBody.length > 0) {
        const form = new URLSearchParams(rawBody);
        const nested = form.get("Response");
        if (nested !== null) parsed = asObject(nested);
        for (const [key, value] of form.entries()) {
            if (key !== "Response" && parsed[key] === undefined) parsed[key] = value;
        }
    }
    for (const [key, value] of query.entries()) {
        if (parsed[key] === undefined) parsed[key] = value;
    }
    return parsed;
}

/**
 * Is the gateway's final answer about this top-up, for this amount? An
 * approval that is not is money nobody can be credited for.
 */
export function answersFor(
    topup: { id: string; transactionId: string | null; chargedMinor: number | null; chargedCurrency: string | null },
    answer: GatewayResponse,
): { ok: true } | { ok: false; why: string } {
    if (answer.OrderIdentifier !== topup.id) return { ok: false, why: "the order is not this top-up" };
    if (!topup.transactionId || (answer.TransactionIdentifier ?? "").toLowerCase() !== topup.transactionId.toLowerCase()) {
        return { ok: false, why: "the transaction is not the one that was started" };
    }
    if (topup.chargedMinor === null || typeof answer.TotalAmount !== "number"
        || Math.abs(answer.TotalAmount - toMajorUnits(topup.chargedMinor)) > 0.005) {
        return { ok: false, why: "the amount is not the one that was asked for" };
    }
    if (answer.CurrencyCode !== undefined && isCurrency(topup.chargedCurrency)
        && String(answer.CurrencyCode) !== CURRENCY_NUMERIC[topup.chargedCurrency]) {
        return { ok: false, why: "the currency is not the one that was asked for" };
    }
    return { ok: true };
}

/** more attempts than this in an hour and the player is asked to wait: a stolen-card tester tries many */
export const MAX_ATTEMPTS_PER_HOUR = 6;

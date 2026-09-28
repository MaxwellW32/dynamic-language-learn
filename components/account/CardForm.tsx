"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { readCard } from "@/server/payments/rules";

/**
 * The card, typed into our own form. Used only where the merchant has chosen
 * to take cards this way; the usual way is the gateway's own page, which this
 * app never sees.
 *
 * What is typed lives in this component and nowhere else: it is sent once,
 * over the secure connection, and wiped when the form closes. It is not put
 * in the address bar, in storage, or in any message.
 */
export function CardForm({ title, busy, onPay, onClose }: {
    title: string;
    busy: boolean;
    /** resolves to what went wrong, or null when the browser is on its way to the bank */
    onPay: (card: { name: string; number: string; expiry: string; cvv: string }) => Promise<string | null>;
    onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [number, setNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvv, setCvv] = useState("");
    const [problem, setProblem] = useState<string | null>(null);
    const first = useRef<HTMLInputElement>(null);

    useEffect(() => {
        first.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const typed = { name, number, expiry, cvv };
        // the same check the server makes, made here first so that a slip costs no round trip
        const read = readCard(typed, new Date());
        if (!read.ok) {
            setProblem(read.message);
            return;
        }
        setProblem(null);
        const failed = await onPay(typed);
        if (failed) setProblem(failed);
    };

    const field = "w-full rounded-md border border-wood/40 bg-[#fffaf0] px-3 py-2 text-lg text-ink placeholder:text-ink-faint focus:outline-none focus:border-ember";

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-night/60 backdrop-blur-sm p-3 animate-fade" onClick={onClose}>
            <form
                onSubmit={submit}
                onClick={(event) => event.stopPropagation()}
                className="parchment wood-frame w-full max-w-md px-5 sm:px-7 py-6 text-left animate-page-in"
                role="dialog"
                aria-label="Pay by card"
                autoComplete="on"
            >
                <h2 className="font-display text-2xl leading-tight">Pay by card</h2>
                <p className="text-ink-soft">{title}</p>

                <div className="mt-4 grid gap-3">
                    <label className="grid gap-1">
                        <span className="text-sm text-ink-soft">Name on the card</span>
                        <input ref={first} className={field} value={name} autoComplete="cc-name" maxLength={60}
                            onChange={(e) => setName(e.target.value)} disabled={busy} />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-sm text-ink-soft">Card number</span>
                        <input className={`${field} tabular-nums`} value={number} inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456"
                            onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "))} disabled={busy} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="grid gap-1">
                            <span className="text-sm text-ink-soft">Expires</span>
                            <input className={`${field} tabular-nums`} value={expiry} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY"
                                onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                                    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
                                }} disabled={busy} />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-sm text-ink-soft">Security code</span>
                            <input className={`${field} tabular-nums`} value={cvv} inputMode="numeric" autoComplete="cc-csc" placeholder="123" type="password"
                                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} disabled={busy} />
                        </label>
                    </div>
                </div>

                {problem && <p className="mt-3 text-rose" role="alert">{problem}</p>}

                <p className="mt-4 text-sm text-ink-faint leading-snug">
                    Your bank will ask you to confirm the payment. Wordbound does not keep your card: it is passed to the payment
                    gateway over a secure connection and forgotten.
                </p>

                <div className="mt-5 flex items-center justify-between gap-3">
                    <button type="button" onClick={onClose} disabled={busy} className="text-ink-soft underline underline-offset-2 cursor-pointer hover:text-ink disabled:opacity-50">
                        Not now
                    </button>
                    <Button variant="primary" type="submit" disabled={busy}>{busy ? "Contacting your bank…" : "Pay"}</Button>
                </div>
            </form>
        </div>
    );
}

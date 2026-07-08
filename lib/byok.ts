"use client";

/**
 * The player's own OpenAI key lives ONLY on their device: a cookie (so it
 * rides along to server actions) mirrored in localStorage (so a lapsed cookie
 * can be restored silently). It is never written to the database.
 */

const COOKIE = "wb_byok";
const STORAGE = "wordbound.byok";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function storeByokKey(key: string): void {
    document.cookie = `${COOKIE}=${encodeURIComponent(key)}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`;
    localStorage.setItem(STORAGE, key);
}

export function clearByokKey(): void {
    document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    localStorage.removeItem(STORAGE);
}

function cookiePresent(): boolean {
    return document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`) && c.length > COOKIE.length + 1);
}

/**
 * True when the key is available (restoring the cookie from localStorage if
 * needed); false means the device has no key and the player must re-enter it.
 */
export function ensureByokKey(): boolean {
    if (cookiePresent()) return true;
    const backup = localStorage.getItem(STORAGE);
    if (backup) {
        storeByokKey(backup);
        return true;
    }
    return false;
}

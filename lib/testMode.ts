/**
 * TEST MODE — sign in as a seeded test account without Google or an email
 * link, so every screen can be checked end to end in a real browser.
 *
 * It only ever works when ALL of these hold:
 *   1. this is not a production build (`next start` / pm2 always run as
 *      production, so the deployed site can never use it)
 *   2. TEST_MODE_SECRET is set (16+ characters, in .env.development.local)
 *      and the request carries the same value
 *   3. the account is one of the seeded test accounts below — a real user can
 *      never be signed in this way
 *
 *   set up:   npm run test:seed      create / reset the accounts
 *   sign in:  /api/test-login?as=player|newcomer&secret=<TEST_MODE_SECRET>&to=/some/path
 *   remove:   npm run test:clean     delete them and everything they created
 */

export const TEST_EMAIL_DOMAIN = "@wordbound.test";

export const TEST_ROLES = ["player", "newcomer"] as const;
export type TestRole = (typeof TEST_ROLES)[number];

export const testAccounts: Record<TestRole, { email: string; name: string; about: string }> = {
    player: {
        email: `claude.player${TEST_EMAIL_DOMAIN}`,
        name: "Claude",
        about: "onboarded, pays with wallet credit, keeps its books between runs",
    },
    newcomer: {
        email: `claude.newcomer${TEST_EMAIL_DOMAIN}`,
        name: "Newcomer",
        about: "has never onboarded — reset to that state on every seed",
    },
};

export function isTestEmail(email: string | null | undefined): boolean {
    return typeof email === "string" && email.toLowerCase().endsWith(TEST_EMAIL_DOMAIN);
}

export function isTestRole(value: unknown): value is TestRole {
    return typeof value === "string" && (TEST_ROLES as readonly string[]).includes(value);
}

export function testModeEnabled(): boolean {
    return process.env.NODE_ENV !== "production" && (process.env.TEST_MODE_SECRET ?? "").length >= 16;
}

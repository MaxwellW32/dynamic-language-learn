import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { isTestEmail, isTestRole, testAccounts, testModeEnabled, TEST_ROLES } from "@/lib/testMode";

const SESSION_HOURS = 12;

/**
 * Dev-only sign in for the seeded test accounts — see lib/testMode.ts for the
 * rules. Auth uses database sessions, so "signing in" is just a session row
 * plus the normal session cookie.
 */
export async function GET(request: NextRequest) {
    // looks like any other missing page unless test mode is on
    if (!testModeEnabled()) return new NextResponse("Not found", { status: 404 });

    const query = request.nextUrl.searchParams;
    const given = Buffer.from(query.get("secret") ?? "");
    const expected = Buffer.from(process.env.TEST_MODE_SECRET ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return new NextResponse("Not found", { status: 404 });
    }

    const as = query.get("as") ?? "";
    if (!isTestRole(as)) {
        return NextResponse.json({ error: `as must be one of: ${TEST_ROLES.join(", ")}` }, { status: 400 });
    }

    const user = await db.query.users.findFirst({ where: eq(users.email, testAccounts[as].email) });
    if (!user) {
        return NextResponse.json({ error: "Test accounts are not seeded — run: npm run test:seed" }, { status: 404 });
    }
    // belt and braces: never hand out a session for anything but a flagged test account
    if (!isTestEmail(user.email) || !user.isTest) {
        return NextResponse.json({ error: "Test account is out of shape — run: npm run test:seed" }, { status: 409 });
    }

    const sessionToken = crypto.randomUUID();
    const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

    // ?to=/book/123 lands on a specific page (same-site paths only)
    const to = query.get("to") ?? "";
    const destination = to.startsWith("/") && !to.startsWith("//") ? to : "/";

    const response = NextResponse.redirect(new URL(destination, request.url));
    // the cookie Auth.js itself sets on http (test mode never runs on the https production site)
    response.cookies.set("authjs.session-token", sessionToken, { httpOnly: true, sameSite: "lax", path: "/", expires });
    return response;
}

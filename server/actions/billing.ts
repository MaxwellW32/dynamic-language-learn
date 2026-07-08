"use server";

import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "../auth";
import {
    billingStatusOf, recentLedger, setBillingMode, validateOpenAiKey,
    type BillingStatus,
} from "../services/billing";

export async function setBillingModeAction(mode: "byok" | "credits"): Promise<void> {
    const { userId } = await requireUser();
    await setBillingMode(userId, z.enum(["byok", "credits"]).parse(mode));
}

/**
 * Proves a player's key works before their device keeps it. The key is used
 * for one free list call and immediately forgotten — it is never persisted.
 */
export async function validateByokKeyAction(key: string): Promise<{ valid: boolean }> {
    await requireUser();
    const parsed = z.string().min(20).max(300).parse(key.trim());
    return { valid: await validateOpenAiKey(parsed) };
}

export async function getBillingStatusAction(): Promise<BillingStatus> {
    const { userId } = await requireUser();
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error("Account not found.");
    return billingStatusOf(user);
}

export async function getLedgerAction(): Promise<{ id: string; delta: number; reason: string; balanceAfter: number; at: string }[]> {
    const { userId } = await requireUser();
    const rows = await recentLedger(userId);
    return rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        balanceAfter: r.balanceAfter,
        at: r.createdAt.toISOString(),
    }));
}

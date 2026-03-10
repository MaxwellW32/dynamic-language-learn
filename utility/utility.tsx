import z from "zod"
import { eq, gte, sql, SQLWrapper } from "drizzle-orm";
import { PgNumeric, PgInteger, PgTableWithColumns, PgEnumColumn } from 'drizzle-orm/pg-core'

export function makeWhereClauses<T extends Object>(schema: z.Schema, filter: T, dbSchema: PgTableWithColumns<any>) {
    // Validate filter
    schema.parse(filter);

    //keys and values will have string, number, boolean, object/array with extra info
    //if array - see if wants to check exists - items greater than 1
    //return true
    //maje filter for same
    //itll pass schema check for all else expect object

    const whereClauses: SQLWrapper[] = [];

    // Dynamically process filters
    for (const [keyPre, value] of Object.entries(filter)) {
        const key = keyPre as keyof T

        if (value === undefined || value === null) continue;

        // @ts-expect-error type
        const columnPre = dbSchema[key as keyof typeof dbSchema];
        if (!columnPre) continue;

        const column = columnPre as SQLWrapper

        if (typeof value === "string") {
            if (column instanceof PgNumeric || column instanceof PgInteger || column instanceof PgEnumColumn) {
                whereClauses.push(eq(column, value));

            } else {
                whereClauses.push(sql`LOWER(${column}) LIKE LOWER(${`%${value}%`})`);
            }

        } else if (typeof value === "number") {
            whereClauses.push(eq(column, value));

        } else if (typeof value === "boolean") {
            whereClauses.push(eq(column, value));

        } else if (value instanceof Date) {
            // Match only date
            whereClauses.push(gte(
                column,
                new Date(value)
            ));

        } else if (Array.isArray(value)) {
            //check if array has items
            whereClauses.push(sql`${column}::text != '[]'`);

        } else {
            // fallback or skip unknown types
            continue;
        }
    }

    return whereClauses
}

export function deepClone<T>(object: T): T {
    return JSON.parse(JSON.stringify(object))
}
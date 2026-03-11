import { relations } from "drizzle-orm";
import { boolean, timestamp, pgTable, text, primaryKey, integer, index, json } from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "@auth/core/adapters"
import { areaConnectionType, bookType, characterType, goalType, locationType, sectionType, userType } from "@/types";
import { defaultText } from "@/lib/defaultData";

export const users = pgTable("users", {
    //defaults
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    languageSettings: json("languageSettings").$type<userType["languageSettings"]>().default({
        native: { name: "english", dialect: "american" },
        targets: [],
    }).notNull(),
    lessonProgress: json("lessonProgress").$type<userType["lessonProgress"]>().default({}).notNull(),

    //regular

    //null
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("emailVerified", { mode: "date" }), //convert to obj on server whenever used
    image: text("image"),
})
export const userRelations = relations(users, ({ many }) => ({
    books: many(books),
}));




export const books = pgTable("books", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    dateCreated: timestamp("dateCreated", { mode: "date" }).notNull().defaultNow(),
    name: text("name").notNull().default(defaultText),
    targetLanguages: json("targetLanguages").$type<bookType["targetLanguages"][]>().default([]).notNull(),
    readyToRead: boolean("readyToRead").notNull().default(false),
    storyPremise: text("storyPremise").notNull().default(defaultText),
    locations: json("locations").$type<locationType[]>().default([]).notNull(),
    characters: json("characters").$type<characterType[]>().default([]).notNull(),
    goals: json("goals").$type<goalType[]>().default([]).notNull(),
    areaConnections: json("areaConnections").$type<areaConnectionType[]>().default([]).notNull(),
    currentChapterId: text("currentChapterId").notNull().default(""),

    userId: text("userId").notNull().references(() => users.id),
},
    (table) => {
        return {
            bookUserIdIndex: index("bookUserIdIndex").on(table.userId),
        };
    })
export const bookRelations = relations(books, ({ one, many }) => ({
    fromUser: one(users, {
        fields: [books.userId],
        references: [users.id]
    }),
    chapters: many(chapters),
}));




export const chapters = pgTable("chapters", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    bookId: text("bookId").notNull().references(() => books.id),

    name: text("name").notNull(),
    index: integer("index").notNull(),
    sections: json("sections").$type<sectionType[]>().default([]).notNull(),
    shortSummary: text("shortSummary").notNull(),
},
    (table) => {
        return {
            chapterIdIndex: index("chapterIdIndex").on(table.id),
            chapterBookIdIndex: index("chapterBookIdIndex").on(table.bookId),
        };
    })
export const chapterRelations = relations(chapters, ({ one }) => ({
    fromBook: one(books, {
        fields: [chapters.bookId],
        references: [books.id]
    }),
}));



















export const accounts = pgTable("account",
    {
        userId: text("userId")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: text("type").$type<AdapterAccountType>().notNull(),
        provider: text("provider").notNull(),
        providerAccountId: text("providerAccountId").notNull(),
        refresh_token: text("refresh_token"),
        access_token: text("access_token"),
        expires_at: integer("expires_at"),
        token_type: text("token_type"),
        scope: text("scope"),
        id_token: text("id_token"),
        session_state: text("session_state"),
    },
    (account) => [
        {
            compoundKey: primaryKey({
                columns: [account.provider, account.providerAccountId],
            }),
        },
    ]
)

export const sessions = pgTable("session", {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable("verificationToken",
    {
        identifier: text("identifier").notNull(),
        token: text("token").notNull(),
        expires: timestamp("expires", { mode: "date" }).notNull(),
    },
    (verificationToken) => [
        {
            compositePk: primaryKey({
                columns: [verificationToken.identifier, verificationToken.token],
            }),
        },
    ]
)

export const authenticators = pgTable("authenticator",
    {
        credentialID: text("credentialID").notNull().unique(),
        userId: text("userId")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        providerAccountId: text("providerAccountId").notNull(),
        credentialPublicKey: text("credentialPublicKey").notNull(),
        counter: integer("counter").notNull(),
        credentialDeviceType: text("credentialDeviceType").notNull(),
        credentialBackedUp: boolean("credentialBackedUp").notNull(),
        transports: text("transports"),
    },
    (authenticator) => [
        {
            compositePK: primaryKey({
                columns: [authenticator.userId, authenticator.credentialID],
            }),
        },
    ]
)
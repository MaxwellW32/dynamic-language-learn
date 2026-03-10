import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/db";
import dotenv from 'dotenv';
import Google from "next-auth/providers/google";
import Email from "next-auth/providers/nodemailer"
import { accounts, authenticators, sessions, users, verificationTokens } from "@/db/schema";

dotenv.config({ path: ".env.local" });

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        //when ready to use professional email
        // Email({
        //     server: {
        //         host: "smtp.hostinger.com",
        //         port: 465,
        //         secure: true,
        //         auth: {
        //             user: process.env.EMAIL,
        //             pass: process.env.EMAIL_PASS,
        //         },
        //     },
        //     from: process.env.EMAIL,
        // }),
        Email({
            server: {
                service: "gmail",
                auth: {
                    user: process.env.EMAIL,
                    pass: process.env.EMAIL_PASS,
                }
            },
            from: process.env.EMAIL
        }),
        Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!
        })
    ],
    callbacks: {
        jwt({ token, user }) {
            if (user) {
                token.id = user.id; // Store user ID in the token
            }

            return token;
        },
        session({ session, token }) {
            if (token?.id) {
                session.user.id = token.id; // Pass the user ID to the session
            }

            return session;
        }
    },
    adapter: DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
        authenticatorsTable: authenticators
    }),
})
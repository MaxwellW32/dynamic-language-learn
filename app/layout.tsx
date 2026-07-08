import type { Metadata } from "next";
import { Caveat, Crimson_Pro, IM_Fell_English } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import { auth } from "@/auth/auth";

const imFell = IM_Fell_English({
    variable: "--font-im-fell",
    weight: "400",
    subsets: ["latin"],
});

const crimson = Crimson_Pro({
    variable: "--font-crimson",
    subsets: ["latin"],
});

const caveat = Caveat({
    variable: "--font-caveat",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Wordbound — a storybook that teaches you its language",
    description: "Step into a living storybook, befriend its people, and learn a language by adventuring through it.",
};

export default async function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    const session = await auth();

    return (
        <html lang="en">
            <body className={`${imFell.variable} ${crimson.variable} ${caveat.variable} antialiased min-h-full`}>
                <SessionProvider session={session}>
                    <Toaster
                        position="top-center"
                        toastOptions={{
                            style: {
                                background: "var(--color-parchment)",
                                color: "var(--color-ink)",
                                border: "1px solid var(--color-wood)",
                                fontFamily: "var(--font-body)",
                            },
                        }}
                    />
                    {children}
                </SessionProvider>
            </body>
        </html>
    );
}

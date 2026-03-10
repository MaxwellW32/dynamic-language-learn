"use server"
import nodemailer from "nodemailer"

require('dotenv').config()
const email = process.env.EMAIL
const pass = process.env.EMAIL_PASS

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: email,
        pass: pass,
    },
});

export async function sendEmail(input: {
    sendTo: string,
    replyTo: string | undefined,
    subject: string,
    body: {
        type: "text" | "html",
        text: string
    },
}) {
    await transporter.sendMail({
        from: email,
        to: input.sendTo,
        subject: input.subject,
        text: input.body.type === "text" ? input.body.text : undefined,
        html: input.body.type === "html" ? input.body.text : undefined,
        replyTo: input.replyTo
    });
}
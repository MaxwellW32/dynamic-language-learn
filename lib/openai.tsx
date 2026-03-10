import OpenAI from "openai";
import dotenv from 'dotenv';

dotenv.config({ path: ".env.local" });

const apiKey = process.env.OPENAI_API_KEY
export const openai = new OpenAI({
    apiKey: apiKey
});

export const chosenGptModel = "gpt-5.2" as const
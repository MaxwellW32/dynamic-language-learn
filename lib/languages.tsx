import { languageOptionType } from "@/types";

export const languageOptions: languageOptionType[] = [
    {
        name: "english",
        dialects: ["american", "british", "australian"]
    },
    {
        name: "spanish",
    },
    {
        name: "french",
    },
    {
        name: "german",
    },
    {
        name: "portuguese",
    },
    {
        name: "italian",
    },
    {
        name: "japanese",
    },
    {
        name: "korean",
        dialects: ["seoul", "busan"]
    },
    {
        name: "mandarin",
    },
    {
        name: "cantonese",
    },
    {
        name: "arabic",
        dialects: ["modern_standard", "egyptian", "levantine", "gulf"]
    },
    {
        name: "hebrew",
        dialects: ["modern", "biblical"]
    },
    {
        name: "russian",
    },
    {
        name: "hindi",
    },
    {
        name: "bengali",
    },
    {
        name: "turkish",
    },
    {
        name: "thai",
    },
    {
        name: "vietnamese",
    },
    {
        name: "indonesian",
    },
] as const
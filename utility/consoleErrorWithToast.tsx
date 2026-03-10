import { toast } from "react-hot-toast";
import { ZodError } from 'zod';

export function consoleAndToastError(error: unknown, userErrorText?: string): void {
    const combinedErrorText = errorZodErrorAsString(error)

    toast.error(userErrorText === undefined ? combinedErrorText : userErrorText)
    console.log("$Error", userErrorText === undefined ? combinedErrorText : userErrorText)
}

export function errorZodErrorAsString(error: unknown): string {
    let seenAsZod = false

    //check if zod error
    try {
        JSON.parse(`${error}`)
        seenAsZod = true

    } catch (error) {
    }

    if (seenAsZod) {
        // Handle ZodError
        const seenErr = error as ZodError
        let combinedErrorStr = ""

        seenErr.issues.forEach((err) => {
            combinedErrorStr += `${err.message}\n`
        });

        return combinedErrorStr

    } else {
        // Handle standard JavaScript Error
        const seenErr = error as Error

        return seenErr.message
    }
}
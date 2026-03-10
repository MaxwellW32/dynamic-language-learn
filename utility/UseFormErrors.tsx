"use client"
import { useState } from 'react'
import z from 'zod'

export default function UseFormErrors<T>({ schema }: { schema: z.Schema }) {
    const [formErrors, formErrorsSet] = useState<Partial<{ [key in keyof T]: string }>>({})

    function checkIfValid(seenFormObj: Partial<T>, seenName: keyof T) {
        //@ts-expect-error type
        const testSchema = schema.pick({ [seenName]: true }).safeParse(seenFormObj);

        if (testSchema.success) {//worked
            formErrorsSet(prevObj => {
                const newObj = { ...prevObj }
                delete newObj[seenName]

                return newObj
            })

        } else {
            formErrorsSet(prevObj => {
                const newObj = { ...prevObj }

                let errorMessage = ""

                JSON.parse(testSchema.error.message).forEach((eachErrorObj: Error) => {
                    errorMessage += ` ${eachErrorObj.message}`
                })

                newObj[seenName] = errorMessage

                return newObj
            })
        }
    }

    return { formErrors, checkIfValid }
}
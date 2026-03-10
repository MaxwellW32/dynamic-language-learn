"use client"
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useSession } from 'next-auth/react'
import UseFormErrors from '@/utility/UseFormErrors'
import { bookSchema, bookType, newBookSchema, updateBookSchema } from '@/types'
import { initialNewBookObj } from '@/lib/initialFormData'
import TextInput from '../inputs/textInput/TextInput'
import { addBook, updateBook } from '@/serverFunctions/handleBooks'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import { deepClone } from '@/utility/utility'
import { useRouter } from 'next/navigation'

export default function AddEditBookForm({ sentBook, submissionAction }: { sentBook?: bookType, submissionAction?: () => void }) {
    const { data: session } = useSession()
    const router = useRouter()

    const [formObj, formObjSet] = useState<Partial<bookType>>(deepClone(sentBook === undefined ? initialNewBookObj : updateBookSchema.partial().parse(sentBook)))

    const { formErrors, checkIfValid } = UseFormErrors<bookType>({ schema: bookSchema.partial() })

    // //handle changes from above
    // useEffect(() => {
    //     if (sentBook === undefined) return

    //     formObjSet(deepClone(updateBookSchema.partial().parse(sentBook)))

    // }, [sentBook])

    //set user id on new book
    useEffect(() => {
        const search = async () => {
            if (session === null || sentBook !== undefined) return

            //set
            formObjSet(prevFormObj => {
                const newFormObj = { ...prevFormObj }
                newFormObj.userId = session.user.id

                return newFormObj
            })
        }
        search()
    }, [session])

    async function handleSubmit() {
        try {
            toast.success("submittting")

            //new book
            if (sentBook === undefined) {
                const validatedNewBook = newBookSchema.parse(formObj)

                //send up to server
                const addedBook = await addBook(validatedNewBook)

                toast.success("submitted")

                //visit url
                router.push(`/books/read/${addedBook.id}/${addedBook.name}`)

                //reset
                formObjSet(deepClone(initialNewBookObj))

            } else {
                //validate
                const validatedUpdatedBook = updateBookSchema.partial().parse(formObj)

                //update
                const updatedBook = await updateBook(sentBook.id, validatedUpdatedBook)

                toast.success("book updated")

                //set to updated
                formObjSet(updatedBook)
            }

            if (submissionAction !== undefined) {
                submissionAction()
            }

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    return (
        <form action={() => { }}>
            <label>Generate Story</label>

            {formObj.name !== undefined && (
                <>
                    <TextInput
                        name={"name"}
                        value={`${formObj.name}`}
                        type={"text"}
                        label={"book name"}
                        placeHolder={"enter book name"}
                        onChange={(e) => {
                            formObjSet(prevFormObj => {
                                const newFormObj = { ...prevFormObj }
                                if (newFormObj.name === undefined) return prevFormObj

                                newFormObj.name = e.target.value

                                return newFormObj
                            })
                        }}
                        onBlur={() => { checkIfValid(formObj, "name") }}
                        errors={formErrors["name"]}
                    />
                </>
            )}

            <button className='button1' style={{ justifySelf: "center" }}
                onClick={handleSubmit}
            >{sentBook !== undefined ? "update" : "submit"}</button>
        </form>
    )
}
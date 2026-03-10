"use client"
import { initialNewBookObj } from '@/lib/initialFormData'
import { addBook } from '@/serverFunctions/handleBooks'
import { newBookSchema } from '@/types'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import { deepClone } from '@/utility/utility'
import { Session } from 'next-auth'
import { useRouter } from 'next/navigation'
import { HTMLAttributes } from 'react'
import toast from 'react-hot-toast'

export default function AddBookButton({ session, ...elProps }: { session: Session | null } & HTMLAttributes<HTMLDivElement>) {
    const router = useRouter()

    return (
        <div {...elProps}>
            <button className='button1'
                onClick={async () => {
                    try {
                        if (session === null) throw new Error("not seeing session")

                        const newBook = deepClone(initialNewBookObj)

                        //add user id
                        newBook.userId = session.user.id
                        const validatedNewBook = newBookSchema.parse(newBook)

                        //send up to server
                        const addedBook = await addBook(validatedNewBook)

                        toast.success("created")

                        //visit url
                        router.push(`/books/read/${addedBook.id}/${addedBook.name}`)

                    } catch (error) {
                        consoleAndToastError(error)
                    }
                }}
            >add book</button>
        </div>
    )
}

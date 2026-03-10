import ReadBook from "@/components/books/ReadBook"
import { getSpecificBook } from "@/serverFunctions/handleBooks"

export default async function Page({ params }: { params: Promise<{ id: string[] }> }) {
    const { id } = await params
    const bookId = id[0]

    const seenBook = await getSpecificBook(bookId)
    if (seenBook === undefined) return (<p>not seeing book by id</p>)

    return (
        <ReadBook seenBook={seenBook} />
    )
}
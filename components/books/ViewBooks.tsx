import { bookType } from '@/types'
import Link from 'next/link'

export default function ViewBooks({ books }: { books: bookType[] }) {
    return (
        <div className='gridColumn snap'>
            {books.map(eachBook => {
                return (
                    <div key={eachBook.id} className='simpleContainer'>
                        <h3>{eachBook.name}</h3>

                        <Link href={`books/read/${eachBook.id}/${eachBook.name}`}>
                            <button className='button2'>Read</button>
                        </Link>
                    </div>
                )
            })}
        </div>
    )
}
import { auth } from "@/auth/auth";
import AddBookButton from "@/components/books/AddBookButton";
import ViewBooks from "@/components/books/ViewBooks";
import { getBooks } from "@/serverFunctions/handleBooks";
import { bookType } from "@/types";

export default async function Home() {
  const session = await auth();

  const books: bookType[] = session === null ? [] : await getBooks({ userId: session.user.id })

  return (
    <main>
      {session === null ? (
        <>
          <h1>home</h1>

          <p>Sign in gang</p>
        </>
      ) : (
        <>
          <h2>Recent Books</h2>
          <AddBookButton session={session} style={{ justifySelf: "flex-end" }} />

          {books.length > 0 ? (
            <ViewBooks books={books} />
          ) : (
            <p>no books yet</p>
          )}
        </>
      )}
    </main>
  );
}
"use client"
import { useRouter } from 'next/navigation'

export default function LogButton({ option }: { option: "login" | "logout" }) {
  const router = useRouter()

  return (
    <button className='button2'
      onClick={() => {
        router.push(option === "login" ? "/api/auth/signin" : "/api/auth/signout")
      }}
    >
      {option === "login" ? "login" : "logout"}
    </button>
  )
}
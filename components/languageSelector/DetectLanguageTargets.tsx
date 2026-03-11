"use client"
import { showingLanguageSelectionGlobal } from '@/utility/globalState'
import { useAtom } from 'jotai'
import { Session } from 'next-auth'
import { useEffect } from 'react'
import LanguageSelector from './LanguageSelector'

export default function DetectLanguageTargets({ session }: { session: Session | null }) {
    const [showingLanguageSelection, showingLanguageSelectionSet] = useAtom(showingLanguageSelectionGlobal)

    //open if no targets
    useEffect(() => {
        if (session === null) return

        if (session.user.languageSettings.targets.length === 0) {
            showingLanguageSelectionSet(true)
        }

    }, [session?.user.languageSettings.targets])

    if (session === null) return null

    return (
        <>
            {showingLanguageSelection && <LanguageSelector session={session} />}
        </>
    )
}

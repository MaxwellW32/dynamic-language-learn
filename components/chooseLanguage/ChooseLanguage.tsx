"use client"

import styles from "./style.module.css"
import { Session } from "next-auth"
import { useState } from "react"
import { languageOptions } from "@/lib/languages"
import { languageOptionChosenType, userType } from "@/types"
import { updateUser } from "@/serverFunctions/handleUsers"
import toast from "react-hot-toast"
import { useAtom } from "jotai"
import { showingLanguageSelectionGlobal } from "@/utility/globalState"
import { useRouter } from "next/navigation"

export default function ChooseLanguage({ session }: { session: Session }) {
    const router = useRouter()

    const [showingLanguageSelection, showingLanguageSelectionSet] = useAtom(showingLanguageSelectionGlobal)
    const [userLanguageSettings, userLanguageSettingsSet] = useState<userType["languageSettings"]>(session.user.languageSettings)

    function setNative(language: languageOptionChosenType) {
        userLanguageSettingsSet(prev => ({
            ...prev,
            native: language
        }))
    }

    function toggleTarget(language: languageOptionChosenType) {
        userLanguageSettingsSet(prev => {
            const exists = prev.targets.find(
                t => t.name === language.name && t.dialect === language.dialect
            )

            let updatedTargets

            if (exists) {
                updatedTargets = prev.targets.filter(
                    t => !(t.name === language.name && t.dialect === language.dialect)
                )

            } else {
                updatedTargets = [...prev.targets, language]
            }

            return {
                ...prev,
                targets: updatedTargets
            }
        })
    }

    function isTargetSelected(name: string, dialect?: string) {
        return userLanguageSettings.targets.some(
            t => t.name === name && t.dialect === dialect
        )
    }

    async function save() {
        await updateUser(session.user.id, {
            languageSettings: userLanguageSettings
        })

        toast.success("language settings saved!")

        showingLanguageSelectionSet(false)

        router.refresh()
    }

    return (
        <>
            {showingLanguageSelection && (
                <div className={styles.overlay}>
                    <h2>Language Settings</h2>

                    <section>
                        <h3>Native Language</h3>

                        <div className={styles.languageGrid}>
                            {languageOptions.map(eachLanguageOption => {

                                return (
                                    <div key={eachLanguageOption.name}>
                                        {eachLanguageOption.dialects === undefined ? (
                                            <>
                                                <button className={userLanguageSettings.native.name === eachLanguageOption.name ? styles.selected : ""}
                                                    onClick={() => setNative({ name: eachLanguageOption.name })}
                                                >
                                                    {eachLanguageOption.name}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <p>{eachLanguageOption.name}</p>

                                                <div className="simpleFlex">
                                                    {eachLanguageOption.dialects.map(eachDialect => {
                                                        const selected = userLanguageSettings.native.name === eachLanguageOption.name && userLanguageSettings.native.dialect === eachDialect

                                                        return (
                                                            <button
                                                                key={eachDialect}
                                                                className={selected ? styles.selected : ""}
                                                                onClick={() =>
                                                                    setNative({
                                                                        name: eachLanguageOption.name,
                                                                        dialect: eachDialect
                                                                    })
                                                                }
                                                            >
                                                                {eachDialect}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </section>

                    <section>
                        <h3>Target Languages</h3>

                        <div className={styles.languageGrid}>
                            {languageOptions.map(eachTargetLanguageOption => {
                                let seenDialects = eachTargetLanguageOption.dialects

                                // If same language as native
                                if (eachTargetLanguageOption.name === userLanguageSettings.native.name) {

                                    // If there are no dialects we can't distinguish them → hide
                                    if (eachTargetLanguageOption.dialects === undefined) return null

                                    // Otherwise filter out the native dialect
                                    seenDialects = eachTargetLanguageOption.dialects.filter(
                                        d => d !== userLanguageSettings.native.dialect
                                    )

                                    // If nothing remains don't render
                                    if (seenDialects.length === 0) return null
                                }

                                const selected = isTargetSelected(eachTargetLanguageOption.name)

                                return (
                                    <div key={eachTargetLanguageOption.name}>
                                        {seenDialects === undefined ? (
                                            <>
                                                <button className={selected ? styles.selected : ""}
                                                    onClick={() => {
                                                        toggleTarget({ name: eachTargetLanguageOption.name })
                                                    }}

                                                >
                                                    {eachTargetLanguageOption.name}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <p>{eachTargetLanguageOption.name}</p>

                                                <div className="simpleFlex">
                                                    {seenDialects.map(eachDialect => {
                                                        const selected = isTargetSelected(eachTargetLanguageOption.name, eachDialect)

                                                        return (
                                                            <button key={eachDialect} className={selected ? styles.selected : ""}
                                                                onClick={() =>
                                                                    toggleTarget({
                                                                        name: eachTargetLanguageOption.name,
                                                                        dialect: eachDialect
                                                                    })
                                                                }
                                                            >
                                                                {eachDialect}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </section>

                    <div className="simpleFlex">
                        <button onClick={() => showingLanguageSelectionSet(false)}>
                            Cancel
                        </button>

                        <button onClick={save}>
                            Save
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
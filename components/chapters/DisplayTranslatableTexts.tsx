"use client"
import { dictionaryJSONType, languageLessonType, translatableTextType, userType } from '@/types'
import { makeNativeTargetKey } from '@/utility/contextHelpers'
import React, { useEffect, useRef, useState } from 'react'

export default function DisplayTranslatableTexts({ user, translatableTexts, languageLessons }: { user: userType, translatableTexts: translatableTextType[], languageLessons: { [key: string]: languageLessonType } }) {
  return (
    <div className='simpleFlex'>
      {translatableTexts.map((eachTranslatableText, eachTranslatableTextIndex) => {
        let foundWord: undefined | dictionaryJSONType["key"] = undefined

        if (typeof eachTranslatableText === "object") {
          const combinedKey = makeNativeTargetKey(user.languageSettings.native, { name: eachTranslatableText.languageName, dialect: eachTranslatableText.languageDialect === null ? undefined : eachTranslatableText.languageDialect })

          if (languageLessons[combinedKey] !== undefined) {
            foundWord = languageLessons[combinedKey].dictionary[eachTranslatableText.id]
          }
        }

        //search up word from id - need dictionary
        return (
          <React.Fragment key={eachTranslatableTextIndex}>
            {typeof eachTranslatableText === "object" ? (
              <>
                {foundWord !== undefined ? (
                  <WordReveal word={foundWord} />
                ) : (
                  <p>not seeing word</p>
                )}
              </>
            ) : (
              <p>{eachTranslatableText}</p>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function WordReveal({ word }: { word: dictionaryJSONType["KEY"] }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // calculate safe popup position
  useEffect(() => {
    if (!open) return
    if (!triggerRef.current || !popupRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const popupRect = popupRef.current.getBoundingClientRect()

    let top = triggerRect.bottom + 8
    let left = triggerRect.left + triggerRect.width / 2 - popupRect.width / 2

    // flip above if bottom overflow
    if (top + popupRect.height > window.innerHeight) {
      top = triggerRect.top - popupRect.height - 8
    }

    // clamp left
    if (left < 8) left = 8

    // clamp right
    if (left + popupRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popupRect.width - 8
    }

    setStyle({
      position: "fixed",
      top,
      left
    })
  }, [open])

  return (
    <>
      <span
        ref={triggerRef}
        onClick={() => {
          //open
          setOpen(!open)

          //check if mastered - assign seen
          //get user obj = see if there, if not add with mastery 1

        }}
        style={{
          cursor: "pointer",
          color: "var(--c1)",
          borderBottom: "1px dashed var(--c1)",
          fontWeight: 500
        }}
      >
        {word.word}
      </span>

      {open && (
        <div
          ref={popupRef}
          style={{
            ...style,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: "8px",
            padding: "10px 12px",
            boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
            minWidth: "180px",
            zIndex: 1000
          }}
        >
          <div style={{ fontWeight: 600 }}>{word.word}</div>

          <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
            {word.prnc}
          </div>

          <div style={{ marginTop: "6px" }}>
            {word.mng}
          </div>
        </div>
      )}
    </>
  )
}
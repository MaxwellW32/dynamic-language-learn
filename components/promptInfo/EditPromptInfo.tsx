"use client"
import { promptInfoType } from '@/types'
import React, { Dispatch, SetStateAction } from 'react'
import TextArea from '../inputs/textArea/TextArea'
import { consoleAndToastError, errorZodErrorAsString } from '@/utility/consoleErrorWithToast'
import toast from 'react-hot-toast'
import ShowMore from '../showMore/ShowMore'

export default function EditPromptInfo({ name, promptInfo, promptInfoSet, searchFunc, show = {} }: {
    name: string, promptInfo: promptInfoType, promptInfoSet: Dispatch<SetStateAction<promptInfoType>>, searchFunc: () => Promise<void>,
    show?: {
        prompt?: boolean,
        baseInstructions?: boolean,
    }
}) {

    return (
        <div className='simpleGrid'>
            {show.baseInstructions !== false && (
                <ShowMore
                    label='base Instructions'
                    content={(
                        <TextArea
                            name={`${name}baseInstructions`}
                            value={promptInfo.baseInstructions}
                            placeHolder={"enter the baseInstructions"}
                            onChange={(e) => {
                                promptInfoSet(prevFormObj => {
                                    const newFormObj = { ...prevFormObj }
                                    newFormObj.baseInstructions = e.target.value

                                    return newFormObj
                                })
                            }}
                            onBlur={() => { }}
                        />
                    )}
                />
            )}

            {show.prompt !== false && (
                <TextArea
                    name={`${name}prompt`}
                    label='Prompt'
                    value={promptInfo.prompt}
                    placeHolder={"enter your prompt"}
                    onChange={(e) => {
                        promptInfoSet(prevFormObj => {
                            const newFormObj = { ...prevFormObj }
                            newFormObj.prompt = e.target.value

                            return newFormObj
                        })
                    }}
                    onBlur={() => { }}
                />
            )}

            <button className='button2'
                onClick={async () => {
                    try {
                        promptInfoSet(prevFormObj => {
                            const newFormObj = { ...prevFormObj }
                            newFormObj.loading = true
                            newFormObj.result = undefined

                            return newFormObj
                        })

                        toast.success("loading!")

                        await searchFunc()

                        toast.success("success")

                        promptInfoSet(prevFormObj => {
                            const newFormObj = { ...prevFormObj }
                            newFormObj.result = {
                                type: "success",
                                msg: ""
                            }

                            return newFormObj
                        })

                    } catch (error) {
                        const seenError = errorZodErrorAsString(error)
                        consoleAndToastError(error)

                        promptInfoSet(prevFormObj => {
                            const newFormObj = { ...prevFormObj }

                            newFormObj.result = {
                                type: "error",
                                msg: seenError
                            }

                            return newFormObj
                        })

                    } finally {
                        promptInfoSet(prevFormObj => {
                            const newFormObj = { ...prevFormObj }
                            newFormObj.loading = false

                            return newFormObj
                        })
                    }
                }}
            >Generate</button>

            {promptInfo.result !== undefined && (
                <>
                    {promptInfo.result.type === "error" && (
                        <p className='errorText'>{promptInfo.result.msg}</p>
                    )}
                </>
            )}
        </div>
    )
}

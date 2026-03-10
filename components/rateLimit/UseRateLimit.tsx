"use client"
import { useRef } from 'react'

export default function UseRateLimit({ concurrencyLimitVal = 5, checkInTime = 1_000 }: { concurrencyLimitVal?: number, checkInTime?: number }) {
    const concurrencyLimit = useRef(concurrencyLimitVal)
    const amtInQueue = useRef(0)
    const amtRunning = useRef(0)

    async function rateLimit(funcToRun: () => Promise<void>) {
        //increase amt in queue
        amtInQueue.current++

        return await new Promise(resolve => {
            async function runCheck() {
                if (amtInQueue.current > 0) {
                    //run if able
                    if (amtRunning.current < concurrencyLimit.current) {
                        //increase amt running
                        amtRunning.current++

                        //wait for function
                        await funcToRun()

                        //running finished - clean up
                        amtRunning.current--
                        if (amtRunning.current < 0) amtRunning.current = 0 //ensure in bounds

                        amtInQueue.current--
                        if (amtInQueue.current < 0) amtInQueue.current = 0 //ensure in bounds

                        //resolve
                        if (amtInQueue.current === 0) {
                            resolve(true)
                        }

                    } else {
                        //keep checking in until available
                        setTimeout(runCheck, checkInTime)
                    }
                } else {
                    console.log(`$zero in queue`);
                }
            }
            runCheck()
        })
    }

    return { rateLimit }
}
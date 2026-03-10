"use client"
import { areaConnectionType, areaType, bookType, locationType } from '@/types'
import { consoleAndToastError } from '@/utility/consoleErrorWithToast'
import { getAreaFromId, getLinkedAreaConnections, getPlayer, getPlayerArea } from '@/utility/contextHelpers'
import { sectionLoadersGlobal } from '@/utility/globalState'
import { useAtom } from 'jotai'
import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function ViewLocations({ book, locations, areaConnections }: { book: bookType, locations: locationType[], areaConnections: areaConnectionType[] }) {
    const [, sectionLoadersSet] = useAtom(sectionLoadersGlobal)

    const [currentlySelectedAreaId, currentlySelectedAreaIdSet] = useState<areaType["id"]>("")
    const currentlySelectedArea = useMemo<areaType | undefined>(() => {
        let foundArea: areaType | undefined = undefined

        locations.map(eachLocation => {
            eachLocation.places.map(eachPlace => {
                eachPlace.areas.map(eachArea => {
                    if (eachArea.id === currentlySelectedAreaId) {
                        foundArea = eachArea
                    }
                })
            })
        })

        return foundArea

    }, [currentlySelectedAreaId])

    const [scale, scaleSet] = useState(0.1)
    const [selectedScreen, selectedScreenSet] = useState<"map" | "area">("map")

    const centerButtonClickedOnce = useRef(false)
    const centerButtonClickedDebounce = useRef<NodeJS.Timeout | undefined>(undefined)

    const contRef = useRef<HTMLDivElement | null>(null)

    const seenPlayer = useMemo(() => {
        return getPlayer(book)
    }, [book.characters])
    const currentArea = useMemo<areaType | undefined>(() => {
        if (seenPlayer === undefined) return undefined

        const foundArea: areaType | undefined = getPlayerArea(book, seenPlayer)

        return foundArea

    }, [book.locations, seenPlayer?.location.type])

    const linkedAreaConnections = useMemo<areaConnectionType[] | undefined>(() => {
        if (currentArea === undefined) return undefined

        return getLinkedAreaConnections(book, currentArea.id)

    }, [book.areaConnections, currentArea])

    //center container
    useEffect(() => {
        centerCont("cont")
    }, [])

    function centerCont(option: "player" | "cont" | "area", newAreaId?: areaType["id"]) {
        try {
            if (contRef.current === null) return

            if (option === "cont") {
                //center scroll bars
                centerToXY(0, 0)

            } else if (option === "player") {
                //player
                if (currentArea === undefined) return

                //center
                centerToXY(currentArea.coordinates.x, currentArea.coordinates.y)

            } else if (option === "area") {
                if (newAreaId === undefined) throw new Error("not seeing newAreaId")

                const seenArea = getAreaFromId(book, newAreaId)
                if (seenArea === undefined) throw new Error("not seeing area for id")

                //center
                centerToXY(seenArea.coordinates.x, seenArea.coordinates.y)
            }

            function centerToXY(x: number, y: number) {
                if (contRef.current === null) return

                const areaX = meterToPixels(x) / contRef.current.scrollWidth
                const areaY = meterToPixels(y) / contRef.current.scrollHeight

                const decimalMovingX = 0.5 + areaX
                const decimalMovingY = 0.5 + areaY

                //take the center - then minus the x coordinate
                contRef.current.scrollLeft = (contRef.current.scrollWidth * decimalMovingX) - (contRef.current.clientWidth / 2)
                contRef.current.scrollTop = (contRef.current.scrollHeight * decimalMovingY) - (contRef.current.clientHeight / 2)
            }

        } catch (error) {
            consoleAndToastError(error)
        }
    }

    function meterToPixels(meters: number) {
        //scale levels .02, 0.1, 0.8, 1
        //1 meter is 0.1px
        const pixels = meters * scale
        return pixels
    }

    return (
        <div style={{ display: "grid", overflow: "auto", gridTemplateRows: "auto 1fr" }}>
            <div className='simpleFlex' style={{ justifyContent: "center" }}>
                <button
                    onClick={() => {
                        selectedScreenSet(prev => {
                            return prev === "area" ? "map" : "area"
                        })
                    }}
                >
                    O
                </button>

                {selectedScreen === "map" && (
                    <>
                        <button
                            onClick={() => {
                                centerButtonClickedOnce.current = !centerButtonClickedOnce.current

                                if (centerButtonClickedDebounce.current) clearTimeout(centerButtonClickedDebounce.current)
                                centerButtonClickedDebounce.current = setTimeout(() => {
                                    if (centerButtonClickedOnce.current) {
                                        //center player
                                        centerCont("player")

                                    } else {
                                        //center
                                        centerCont("cont")
                                    }

                                    centerButtonClickedOnce.current = false
                                }, 500);

                            }}
                        >center</button>

                        <div style={{ display: "flex", alignItems: "center", gap: "vaR(--spacingS)" }}>
                            <input style={{ width: "100%" }}
                                type="range"
                                min={.02}
                                max={1}
                                step={.02}
                                value={scale}
                                onChange={(e) => scaleSet(Number(e.target.value))}
                            />

                            <p style={{ width: "1rem" }}>{scale}x</p>
                        </div>
                    </>
                )}
            </div>

            <div ref={contRef} style={{ display: "grid", overflow: "auto" }}>
                {selectedScreen === "area" && currentArea !== undefined && linkedAreaConnections !== undefined && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "300px", gridTemplateRows: "1fr" }}>
                        <div className='gridColumn snap' style={{ gridAutoColumns: "100%", gridTemplateRows: "1fr" }}>
                            {linkedAreaConnections.map((eachLinkedAreaConnection, eachLinkedAreaConnectionIndex) => {
                                const areaIdLinked = eachLinkedAreaConnection.firstId === currentArea.id ? eachLinkedAreaConnection.secondId : eachLinkedAreaConnection.firstId
                                const foundLinkedArea = getAreaFromId(book, areaIdLinked)

                                if (foundLinkedArea === undefined) return null

                                return (
                                    <div key={eachLinkedAreaConnectionIndex} className='simpleContainer' style={{ overflow: "auto" }}>
                                        <p>Move to:
                                            <b> {foundLinkedArea.name}</b>
                                        </p>

                                        <button className='button1'
                                            onClick={() => {
                                                sectionLoadersSet({
                                                    wantedAreaId: foundLinkedArea.id
                                                })
                                            }}
                                        >travel</button>

                                        <div style={{ overflow: "auto" }}>
                                            <p>{eachLinkedAreaConnection.travelDescription}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className='simpleContainer' style={{ overflow: "auto" }}>
                            <p>Current area:
                                <b> {currentArea.name}</b>
                            </p>

                            <div style={{ overflow: "auto" }}>
                                <p>{currentArea.visualDescription}</p>
                            </div>
                        </div>
                    </div>
                )}

                {selectedScreen === "map" && (
                    <div style={{ position: "relative", width: 100000, height: 100000, background: "#111" }}>
                        <div style={{ top: "50%", left: "50%", position: "absolute" }}>
                            {locations.map(eachLocation => {//locations

                                return (
                                    <div key={eachLocation.id}
                                        style={{
                                            position: "absolute",
                                            top: meterToPixels(eachLocation.coordinates.y),
                                            left: meterToPixels(eachLocation.coordinates.x),
                                            width: meterToPixels(eachLocation.size),
                                            height: meterToPixels(eachLocation.size),
                                            borderRadius: "50%",
                                            translate: "-50% -50%",
                                            background: "rgba(37,139,255,0.2)",
                                            border: "2px solid #258bff",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: 0,
                                                fontSize: meterToPixels(eachLocation.size / 40),
                                                color: "white",
                                                translate: "0 -100%",
                                            }}
                                        >
                                            {eachLocation.name}
                                        </div>
                                    </div>
                                )
                            })}

                            {locations.map(eachLocation => {
                                return eachLocation.places.map(eachPlace => {//places
                                    return (
                                        <div key={eachPlace.id} title={eachPlace.name}
                                            style={{
                                                position: "absolute",
                                                top: meterToPixels(eachPlace.coordinates.y),
                                                left: meterToPixels(eachPlace.coordinates.x),
                                                width: meterToPixels(eachPlace.size),
                                                height: meterToPixels(eachPlace.size),
                                                translate: "-50% -50%",
                                                background: "#ff9900"
                                            }}
                                        >
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: "0",
                                                    left: "50%",
                                                    translate: "-50% -100%",
                                                    textAlign: "center",
                                                    fontSize: meterToPixels(eachPlace.size / 15),
                                                    color: "white",
                                                    whiteSpace: "nowrap"
                                                }}
                                            >
                                                {eachPlace.name}
                                            </div>
                                        </div>
                                    )
                                })
                            })}

                            {locations.map(eachLocation => {
                                return eachLocation.places.map(eachPlace => {
                                    return eachPlace.areas.map(eachArea => {//areas
                                        const seenConnections = areaConnections.filter(eachAreaConnection => {
                                            return (eachAreaConnection.firstId === eachArea.id) || (eachAreaConnection.secondId === eachArea.id)
                                        })

                                        return (
                                            <div key={eachArea.id} title={eachArea.name} id={eachArea.id}
                                                style={{
                                                    position: "absolute",
                                                    top: meterToPixels(eachArea.coordinates.y),
                                                    left: meterToPixels(eachArea.coordinates.x),
                                                    width: meterToPixels(eachArea.size),
                                                    height: meterToPixels(eachArea.size),
                                                    translate: "-50% -50%",
                                                    background: currentlySelectedArea !== undefined && currentlySelectedArea.id === eachArea.id ? "#00ff00" :
                                                        currentArea !== undefined && currentArea.id === eachArea.id ? "#f00" : "#ffffff"
                                                }}
                                                onClick={() => {
                                                    console.log(`$area id`, eachArea.id);
                                                    console.log(`$seenConnections`, seenConnections);

                                                    currentlySelectedAreaIdSet(eachArea.id)
                                                }}
                                            >
                                                {seenConnections.map((eachSeenConnection, eachSeenConnectionIndex) => {//area connecions
                                                    return (
                                                        <div key={eachSeenConnectionIndex}
                                                            style={{
                                                                position: "absolute",
                                                                left: "50%",
                                                                width: meterToPixels(30),
                                                                height: meterToPixels(30),
                                                                translate: `-50% ${(-100 * eachSeenConnectionIndex) - 100}%`,

                                                                background: "#005eff"
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation()

                                                                //if in first choose 2nd
                                                                //if in second choose first
                                                                const linkedAreaId = eachSeenConnection.firstId === eachArea.id ? eachSeenConnection.secondId : eachSeenConnection.firstId

                                                                currentlySelectedAreaIdSet(linkedAreaId)

                                                                //center
                                                                centerCont("area", linkedAreaId)
                                                            }}
                                                        ></div>
                                                    )
                                                })}

                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        bottom: "0",
                                                        left: "50%",
                                                        translate: "-50% 100%",
                                                        textAlign: "center",
                                                        fontSize: meterToPixels(eachArea.size / 2),
                                                        color: "white",
                                                        pointerEvents: "none"
                                                    }}
                                                >
                                                    {eachArea.name}
                                                </div>
                                            </div>
                                        )
                                    })
                                })
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
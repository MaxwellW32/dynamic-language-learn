"use client"
import React, { HTMLAttributes, useState } from "react"
import styles from "./styles.module.css"

type allAttributesType = {
    mainDiv: HTMLAttributes<HTMLDivElement>,
    labelDiv: HTMLAttributes<HTMLDivElement>,
    contentDiv: HTMLAttributes<HTMLDivElement>,
    svg: React.SVGProps<SVGSVGElement>,
}

export default function ShowMore({ label, content, startShowing, allAttributes = { mainDiv: {}, labelDiv: {}, contentDiv: {}, svg: {} } }: { label: string, content: React.JSX.Element, startShowing?: boolean, allAttributes?: allAttributesType }) {
    const [showing, showingSet] = useState(startShowing === undefined ? false : startShowing)

    return (
        <div {...allAttributes.mainDiv} className={`${styles.main} ${allAttributes.mainDiv.className ?? ""}`} style={{ ...allAttributes.mainDiv.style }}>
            <div  {...allAttributes.labelDiv} style={{ display: "flex", gap: "var(--spacingS)", alignItems: "center", cursor: "pointer", ...allAttributes.labelDiv.style }}
                onClick={() => {
                    showingSet(prev => !prev)
                }}
            >
                <label>{label}</label>

                <div style={{ rotate: showing ? "90deg" : "", transition: "rotate 400ms" }}>
                    <svg  {...allAttributes.svg} style={{ fill: "var(--shade1)", ...allAttributes.svg.style }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path d="M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z" /></svg>
                </div>
            </div>

            <div style={{ display: !showing ? "none" : "grid", alignContent: "flex-start", overflow: "clip" }}>
                <div {...allAttributes.contentDiv} className={`${showing ? styles.animateIn : ""} ${allAttributes.contentDiv.className ?? ""}`} style={{ display: "grid", alignContent: "flex-start", ...allAttributes.contentDiv.style }} >
                    {content}
                </div>
            </div>
        </div>
    )
}
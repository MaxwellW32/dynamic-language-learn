"use client"

import React, { useState } from 'react'
import styles from "./styles.module.css"

export default function MoreItemsMenu({ top, bottom }: { top: React.JSX.Element, bottom: React.JSX.Element }) {
    const [showing, showingSet] = useState(false)

    return (
        <div style={{ position: "relative" }}>
            <div
                onClick={() => {
                    showingSet(prev => !prev)
                }}
            >
                {top}
            </div>

            <ul className={styles.moreItemsMenu} style={{ display: showing ? "" : "none" }}>
                {bottom}
            </ul>
        </div>
    )
}

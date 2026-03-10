import React, { HTMLAttributes } from 'react'

export default function FormToggleButton({ label, value, onClick, buttonText, errors, buttonProps = {} }: { label: string, value: boolean, onClick: () => void, buttonText?: string, errors?: string, buttonProps?: HTMLAttributes<HTMLButtonElement> }) {
    return (
        <div style={{ display: "grid", alignContent: "flex-start", gap: "var(--spacingR)" }}>
            <label>{label}</label>

            <button type="button" {...buttonProps} className={`button1 ${buttonProps.className ?? ""}`} style={{ ...buttonProps.style }}
                onClick={onClick}
            >{buttonText === undefined ? value.toString() : buttonText}</button>

            {errors !== undefined && (
                <>
                    <p className='errorText'>{errors}</p>
                </>
            )}
        </div>
    )
}
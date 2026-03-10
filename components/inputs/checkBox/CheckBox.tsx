export default function CheckBox({ name, checked, onChange, label, id, errors, onBlur, placeHolder, ...elProps }: { name: string, checked: boolean, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, onBlur?: (e: React.FocusEvent<HTMLInputElement, Element>) => void, label?: string, id?: string, errors?: string, placeHolder?: string } & React.HTMLAttributes<HTMLSpanElement>) {
    return (
        <span {...elProps} style={{ display: "grid", alignContent: "flex-start", gap: "var(--spacingR)", ...elProps?.style }}>
            {label !== undefined && <label htmlFor={id !== undefined ? id : name}>{label}</label>}

            <input id={id !== undefined ? id : name} type={"checkbox"} name={name} checked={checked} placeholder={placeHolder ?? ""} onChange={onChange} onBlur={(e) => { if (onBlur !== undefined) onBlur(e) }} />

            {errors !== undefined && <p className="errorText">{errors}</p>}
        </span>
    )
}
export default function TextArea({ name, value, onChange, label, id, errors, onBlur, placeHolder, isOptionalText, rows, required, ...elProps }: { name: string, value: string, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void, onBlur?: (e: React.FocusEvent<HTMLTextAreaElement, Element>) => void, label?: string, id?: string, errors?: string, placeHolder?: string, isOptionalText?: string, rows?: number, required?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">) {
    return (
        <div {...elProps} style={{ display: "grid", alignContent: "flex-start", ...elProps?.style }}>
            {label !== undefined && <label htmlFor={id !== undefined ? id : name}>{label}{required !== undefined && required === "" ? "*" : required}</label>}

            <textarea rows={rows !== undefined ? rows : 5} id={id !== undefined ? id : name} name={name} value={value} placeholder={placeHolder ?? ""} onChange={onChange} onBlur={(e) => { if (onBlur !== undefined) onBlur(e) }} ></textarea>

            {errors !== undefined && <p className="errorText">{errors}</p>}
        </div>
    )
}
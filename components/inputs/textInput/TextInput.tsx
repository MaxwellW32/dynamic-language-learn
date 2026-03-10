export default function TextInput({
    name, value, onChange, label, type, id, errors, onBlur, placeHolder, required, ...elProps }: {
        name: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, onBlur?: (e: React.FocusEvent<HTMLInputElement, Element>) => void, label?: string, type?: string, id?: string, errors?: string, placeHolder?: string, required?: string
    } & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">) {
    return (
        <div {...elProps} style={{ display: "grid", alignContent: "flex-start", ...elProps?.style }}>
            {label !== undefined && <label htmlFor={id !== undefined ? id : name}>{label}{required !== undefined && required === "" ? "*" : required}</label>}

            <input id={id !== undefined ? id : name} type={type === undefined ? "text" : type} name={name} value={value} placeholder={placeHolder ?? ""} onChange={onChange} onBlur={(e) => { if (onBlur !== undefined) onBlur(e) }} />

            {errors !== undefined && <p className="errorText">{errors}</p>}
        </div>
    )
}
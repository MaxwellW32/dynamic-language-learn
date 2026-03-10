export default function Select<T extends string>({
    name, value, valueOptions, onChange, label, id, errors, ...elProps }: {
        name: string, value: T, valueOptions: readonly T[], onChange: (value: T) => void, label?: string, id?: string, errors?: string,
    } & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>) {
    return (
        <div {...elProps} style={{ display: "grid", alignContent: "flex-start", gap: "var(--spacingR)", ...elProps?.style }}>
            {label !== undefined && <label htmlFor={id !== undefined ? id : name}>{label}</label>}

            <select value={value} id={id !== undefined ? id : name} name={name}
                onChange={event => {
                    const eachValue = event.target.value as T

                    onChange(eachValue)
                }}
            >
                {valueOptions.map(eachValue => {

                    return (
                        <option key={eachValue} value={eachValue}
                        >{eachValue}</option>
                    )
                })}
            </select>

            {errors !== undefined && <p className="errorText">{errors}</p>}
        </div>
    )
}

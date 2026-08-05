import "./Button.scss"

export type ButtonType = "primary" | "critical" | "success" | "warning" | "info" | "default";

export const Button = (props: { children: any, large?: boolean, onClick?: any, type?: ButtonType }) => {
    return (
        <button onClick={props.onClick} className={`${props.large && 'large'} ${props.type?.toString()}`}>
            {props.children}
        </button>
    );
}

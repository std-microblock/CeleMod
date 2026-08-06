import type { ButtonHTMLAttributes } from 'react';
import './Button.scss';

export type ButtonType = "primary" | "critical" | "success" | "warning" | "info" | "default";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
    large?: boolean;
    type?: ButtonType;
};

export const Button = ({ children, large, type, className = '', ...props }: ButtonProps) => {
    return (
        <button {...props} className={`${large ? 'large' : ''} ${type ?? ''} ${className}`.trim()}>
            {children}
        </button>
    );
};

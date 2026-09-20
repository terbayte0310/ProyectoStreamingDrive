import type { InputHTMLAttributes, ReactNode } from "react";

export function Switch({ children, small = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { children?: ReactNode; small?: boolean }) {
  return (
    <label className={`switch${small ? " switch-sm" : ""}`}>
      <input role="switch" type="checkbox" {...props} />
      <span aria-hidden="true" className="switch-track" />
      {children}
    </label>
  );
}

"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string };

export function PasswordInput({ label, className = "field", ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return <label className="block">
    <span className="label">{label}</span>
    <span className="relative block">
      <input {...props} className={`${className} pr-12`} type={visible ? "text" : "password"} />
      <button className="absolute inset-y-0 right-1 my-auto grid size-10 place-items-center rounded-lg text-black/50 hover:bg-black/5 hover:text-brand" type="button" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  </label>;
}

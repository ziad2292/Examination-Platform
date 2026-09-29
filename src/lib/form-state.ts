export type FormActionState = {
  ok: boolean;
  message: string;
};

export const initialFormState: FormActionState = { ok: false, message: "" };

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button, Field, Input } from "../components/ui.tsx";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { meQueryKey } from "../lib/session.ts";
import { APP_NAME, usePageTitle } from "../lib/title.ts";

export function LoginPage() {
  usePageTitle("Sign in");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.details.length) setFieldErrors(err.fieldErrors());
    else setFormError(errorMessage(err));
  };

  const requestCode = useMutation({
    mutationFn: () => api.requestOtp(email),
    onMutate: () => {
      setFieldErrors({});
      setFormError(null);
    },
    onSuccess: (res) => {
      setDevHint(res.devCodeHint);
      setStep("code");
    },
    onError: handleError,
  });

  const verify = useMutation({
    mutationFn: () => api.verifyOtp(email, code),
    onMutate: () => {
      setFieldErrors({});
      setFormError(null);
    },
    onSuccess: (me) => {
      qc.setQueryData(meQueryKey, me);
      void navigate({ to: "/" });
    },
    onError: handleError,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "email") requestCode.mutate();
    else verify.mutate();
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-4">
          <span className="text-3xl font-semibold tracking-tight text-ink">YourCompany</span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{APP_NAME}</h1>
            <p className="text-sm text-muted">Sign in with a one-time code</p>
          </div>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-xl border border-line bg-white p-6">
          {step === "email" ? (
            <Field label="Work email" error={fieldErrors.email}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!fieldErrors.email}
                  placeholder="you@company.com"
                />
              )}
            </Field>
          ) : (
            <>
              <p className="text-sm text-muted">
                If <span className="font-medium text-ink">{email}</span> has an account, a 6-digit code is on its way. It expires in 10
                minutes.
              </p>
              <Field
                label="Login code"
                error={fieldErrors.code}
                hint={
                  devHint ? (
                    <>
                      Development mode: code <span className="font-mono font-medium text-ink">{devHint}</span> always works.
                    </>
                  ) : undefined
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    aria-invalid={!!fieldErrors.code}
                    className="font-mono tracking-[0.4em]"
                    placeholder="••••••"
                  />
                )}
              </Field>
            </>
          )}
          {formError && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" loading={requestCode.isPending || verify.isPending}>
            {step === "email" ? "Send code" : "Sign in"}
          </Button>
          {step === "code" && (
            <button
              type="button"
              className="text-sm text-muted hover:text-ink"
              onClick={() => {
                setStep("email");
                setCode("");
                setFormError(null);
              }}
            >
              Use a different email
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

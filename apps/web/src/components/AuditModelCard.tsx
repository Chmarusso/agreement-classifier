import { type AuditModelSettingsDto, type LlmProviderDto, ReasoningDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, ErrorState, Field, Input, Select, SkeletonRows } from "../components/ui.tsx";
import { api, formErrorHandler } from "../lib/api.ts";

const providerLabels: Record<LlmProviderDto, string> = {
  openrouter: "OpenRouter",
  "claude-cli": "Claude CLI on the worker host",
  "claude-bridge": "Claude via host bridge",
  stub: "Stub (no model calls)",
};
const claudeModels = ["opus", "sonnet", "haiku"];
const modelSuggestions: Record<LlmProviderDto, string[]> = {
  openrouter: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5-5", "anthropic/claude-haiku-4-5"],
  "claude-cli": claudeModels,
  "claude-bridge": claudeModels,
  stub: [],
};
const reasoningLabels: Record<ReasoningDto, string> = {
  off: "Off (fastest, cheapest)",
  low: "Low",
  "provider-default": "Provider default",
};

/** Admin form that decides which model the worker uses for the next audits. */
export function AuditModelCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["audit-model-settings"], queryFn: api.auditModelSettings });
  const [provider, setProvider] = useState<LlmProviderDto>("openrouter");
  const [model, setModel] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningDto>("off");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setProvider(s.current.provider);
    setModel(s.current.provider === "stub" ? "" : s.current.model);
    setReasoning(s.current.reasoning);
    setErrors({});
  }, [settings.data]);

  const done = (s: AuditModelSettingsDto, msg: string) => {
    qc.setQueryData(["audit-model-settings"], s);
    toast.success(msg);
  };
  const onError = formErrorHandler(setErrors);
  const save = useMutation({
    mutationFn: () =>
      api.setAuditModel({
        provider,
        model: model.trim() || null,
        reasoning: provider === "openrouter" ? reasoning : null,
        version: settings.data?.version ?? 0,
      }),
    onSuccess: (s) => done(s, `Audits now use ${s.current.label}`),
    onError,
  });
  const reset = useMutation({
    mutationFn: () => api.resetAuditModel(settings.data?.version ?? 0),
    onSuccess: (s) => done(s, `Back to the environment default ${s.current.label}`),
    onError,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const s = settings.data;
  const busy = save.isPending || reset.isPending;

  return (
    <Card title="Audit model">
      {settings.isPending ? (
        <SkeletonRows rows={3} />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : s ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-5">
          <p className="text-sm">
            <span className="text-muted">Currently </span>
            <span className="font-mono text-xs">{s.current.label}</span>{" "}
            <Badge tone={s.current.source === "admin" ? "brand" : "neutral"}>
              {s.current.source === "admin" ? "set by an admin" : "environment default"}
            </Badge>
          </p>
          <Field label="Provider" error={errors.provider} hint="Credentials stay in the server environment.">
            {(id) => (
              <Select
                id={id}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as LlmProviderDto);
                  setModel("");
                }}
              >
                {s.providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {providerLabels[p.id]}
                    {p.available ? "" : ` (${p.reason})`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {provider !== "stub" && (
            <Field label="Model" error={errors.model} hint={`Leave empty for the provider default (${s.environmentDefault.model}).`}>
              {(id) => (
                <>
                  <Input id={id} list={`${id}-models`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
                  <datalist id={`${id}-models`}>
                    {[...new Set([s.environmentDefault.model, ...modelSuggestions[provider]])].map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          )}
          {provider === "openrouter" && (
            <Field label="Reasoning" error={errors.reasoning} hint="Thinking on some models doubles cost and latency.">
              {(id) => (
                <Select id={id} value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningDto)}>
                  {ReasoningDto.options.map((r) => (
                    <option key={r} value={r}>
                      {reasoningLabels[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => reset.mutate()} disabled={busy || s.current.source !== "admin"}>
              Use environment default
            </Button>
            <Button type="submit" size="sm" loading={save.isPending} disabled={busy}>
              Save model
            </Button>
          </div>
          <p className="text-xs text-muted">Applies to audits requested from now on. Running and queued audits keep their model.</p>
        </form>
      ) : null}
    </Card>
  );
}

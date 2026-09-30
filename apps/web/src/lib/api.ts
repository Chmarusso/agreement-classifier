import type {
  AgreementDetailDto,
  AgreementDto,
  AgreementPageDto,
  AgreementStatusFilter,
  AgreementTextDto,
  AgreementTypeDto,
  AnonymizationConfigDto,
  AnonymizationPreviewDto,
  AnonymizationSettingsDto,
  AuditActorDto,
  AuditLogPage,
  AuditModelBody,
  AuditModelSettingsDto,
  AuditRunDetailDto,
  AuditRunSummaryDto,
  CostsDto,
  CreateUserBody,
  DashboardDto,
  ErrorEnvelope,
  EventTypesDto,
  HealthDto,
  LanguageDto,
  MeDto,
  OtpRequestResponse,
  PromptAttemptDto,
  RoleDto,
  RuleBody,
  RuleDetailDto,
  RuleDto,
  TextViewDto,
  UserDto,
} from "@app/contracts";
import { toast } from "sonner";

export interface AgreementListParams {
  q?: string;
  status?: AgreementStatusFilter;
  type?: AgreementTypeDto;
  language?: LanguageDto;
  page?: number;
  pageSize?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; message: string }[],
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field → message map for form errors. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

export class NetworkError extends Error {
  constructor() {
    super("Cannot reach the server. Check your connection and try again.");
    this.name = "NetworkError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const isForm = body instanceof FormData;
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined || isForm ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const env = json as ErrorEnvelope | undefined;
    throw new ApiError(
      res.status,
      env?.error?.code ?? "INTERNAL",
      env?.error?.message ?? `Request failed with status ${res.status}`,
      env?.error?.details ?? [],
      env?.error?.requestId ?? res.headers.get("x-request-id"),
    );
  }
  return json as T;
}

export interface AuditLogFilters {
  from?: string;
  to?: string;
  eventType?: string;
  streamType?: string;
  actorId?: string;
  includeReads?: boolean;
}

export function auditLogQueryString(f: AuditLogFilters, cursor?: number | null, limit = 50): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", new Date(f.from).toISOString());
  if (f.to) p.set("to", new Date(f.to).toISOString());
  if (f.eventType) p.set("eventType", f.eventType);
  if (f.streamType) p.set("streamType", f.streamType);
  if (f.actorId) p.set("actorId", f.actorId);
  if (f.includeReads) p.set("includeReads", "true");
  if (cursor) p.set("cursor", String(cursor));
  p.set("limit", String(limit));
  return p.toString();
}

export const api = {
  me: () => request<MeDto>("GET", "/auth/me"),
  requestOtp: (email: string) => request<OtpRequestResponse>("POST", "/auth/otp/request", { email }),
  verifyOtp: (email: string, code: string) => request<MeDto>("POST", "/auth/otp/verify", { email, code }),
  logout: () => request<void>("POST", "/auth/logout"),

  health: () => request<HealthDto>("GET", "/health"),
  dashboard: () => request<DashboardDto>("GET", "/dashboard"),
  eventTypes: () => request<EventTypesDto>("GET", "/system/event-types"),

  auditLog: (f: AuditLogFilters, cursor?: number | null) => request<AuditLogPage>("GET", `/audit-log?${auditLogQueryString(f, cursor)}`),
  auditActors: () => request<AuditActorDto[]>("GET", "/audit-log/actors"),

  users: () => request<UserDto[]>("GET", "/users"),
  createUser: (body: CreateUserBody) => request<UserDto>("POST", "/users", body),
  changeRole: (id: string, role: RoleDto, version: number) => request<UserDto>("PATCH", `/users/${id}/role`, { role, version }),
  deactivate: (id: string, version: number, reason: string | null) =>
    request<UserDto>("POST", `/users/${id}/deactivate`, { version, reason }),
  reactivate: (id: string, version: number) => request<UserDto>("POST", `/users/${id}/reactivate`, { version }),

  rules: () => request<RuleDto[]>("GET", "/rules"),
  rule: (id: string) => request<RuleDetailDto>("GET", `/rules/${id}`),
  createRule: (body: RuleBody) => request<RuleDto>("POST", "/rules", body),
  updateRule: (id: string, body: RuleBody & { version: number }) => request<RuleDto>("PATCH", `/rules/${id}`, body),
  archiveRule: (id: string, version: number) => request<RuleDto>("POST", `/rules/${id}/archive`, { version }),
  restoreRule: (id: string, version: number) => request<RuleDto>("POST", `/rules/${id}/restore`, { version }),

  agreements: (q: AgreementListParams = {}) => {
    const qs = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)]])));
    return request<AgreementPageDto>("GET", `/agreements${qs.size ? `?${qs}` : ""}`);
  },
  agreement: (id: string) => request<AgreementDetailDto>("GET", `/agreements/${id}`),
  agreementText: (id: string, view: TextViewDto = "original") => request<AgreementTextDto>("GET", `/agreements/${id}/text?view=${view}`),
  uploadAgreement: (file: File, agreementType: AgreementTypeDto, title: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("agreementType", agreementType);
    if (title.trim()) form.set("title", title.trim());
    return request<AgreementDto>("POST", "/agreements", form);
  },
  requestAudit: (agreementId: string) => request<AuditRunSummaryDto>("POST", `/agreements/${agreementId}/audits`, {}),

  audits: (limit?: number) => request<AuditRunSummaryDto[]>("GET", `/audits${limit ? `?limit=${limit}` : ""}`),
  audit: (id: string, view: TextViewDto = "original") => request<AuditRunDetailDto>("GET", `/audits/${id}?view=${view}`),
  auditPrompts: (id: string) => request<PromptAttemptDto[]>("GET", `/audits/${id}/prompts`),
  cancelAudit: (id: string, version: number) => request<AuditRunSummaryDto>("POST", `/audits/${id}/cancel`, { version }),
  retryAudit: (id: string, version: number) => request<AuditRunSummaryDto>("POST", `/audits/${id}/retry`, { version }),
  costs: () => request<CostsDto>("GET", "/audits/costs"),

  auditModelSettings: () => request<AuditModelSettingsDto>("GET", "/settings/audit-model"),
  anonymizationSettings: () => request<AnonymizationSettingsDto>("GET", "/settings/anonymization"),
  saveAnonymizationSettings: (config: AnonymizationConfigDto, version: number) =>
    request<AnonymizationSettingsDto>("PUT", "/settings/anonymization", { ...config, version }),
  resetAnonymizationSettings: (version: number) => request<AnonymizationSettingsDto>("POST", "/settings/anonymization/reset", { version }),
  previewAnonymization: (text: string, config: AnonymizationConfigDto) =>
    request<AnonymizationPreviewDto>("POST", "/settings/anonymization/preview", { text, config }),
  setAuditModel: (body: AuditModelBody) => request<AuditModelSettingsDto>("PUT", "/settings/audit-model", body),
  resetAuditModel: (version: number) => request<AuditModelSettingsDto>("POST", "/settings/audit-model/reset", { version }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return "Something went wrong.";
}

/** Mutation error handler for forms: field errors go to the form, everything else to a toast. */
export const formErrorHandler = (setErrors: (errors: Record<string, string>) => void) => (err: unknown) => {
  if (err instanceof ApiError && err.details.length) setErrors(err.fieldErrors());
  else toast.error(errorMessage(err));
};

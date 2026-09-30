import {
  AnonymizationPreviewBody,
  type AnonymizationPreviewDto,
  type AnonymizationServiceDto,
  AnonymizationSettingsBody,
  type AnonymizationSettingsDto,
  AuditModelBody,
  type AuditModelSettingsDto,
  ResetAnonymizationBody,
  ResetAuditModelBody,
} from "@app/contracts";
import { executeCommand, loadAnonymizationSetting, SettingsAggregate } from "@app/db";
import {
  ANONYMIZATION_SETTINGS_STREAM_ID,
  AnonymizationConfig,
  AppError,
  type AuditModelConfig,
  anonymizationLabels,
  defaultAnonymizationConfig,
  SETTINGS_STREAM_ID,
} from "@app/domain";
import { resolveAuditModel } from "@app/llm";
import { Hono } from "hono";
import { currentAuditModel } from "../lib/audit-model.ts";
import { requireRole } from "../lib/auth.ts";
import { type Deps, type Env, metaFrom } from "../lib/context.ts";
import { parseJson } from "../lib/validate.ts";

export function settingsRoutes(deps: Deps) {
  const { db } = deps.database;
  const settingsDto = async (): Promise<AuditModelSettingsDto> => {
    const { resolved, version } = await currentAuditModel(deps);
    return { current: resolved, environmentDefault: deps.config.environmentAuditModel, providers: deps.config.providers, version };
  };

  const anonymizer = deps.anonymizer ?? null;
  /** Until an admin saves settings, the keep list comes from ANONYMIZER_KEEP, as in the worker. */
  const envKeep = () =>
    (deps.config.llmEnv.ANONYMIZER_KEEP ?? "")
      .split(";")
      .map((k) => k.trim())
      .filter(Boolean);
  const service = async (): Promise<AnonymizationServiceDto> => {
    if (!anonymizer)
      return {
        reachable: false,
        url: null,
        error: "ANONYMIZER_URL is not set, so the worker sends text as extracted.",
        engine: null,
        nerModels: {},
        nerDefaultModels: {},
      };
    try {
      const h = await anonymizer.health();
      return {
        reachable: h.ok,
        url: anonymizer.url,
        error: null,
        engine: h.engine,
        nerModels: h.nerModels,
        nerDefaultModels: h.nerDefaultModels,
      };
    } catch (err) {
      return {
        reachable: false,
        url: anonymizer.url,
        error: err instanceof Error ? err.message : String(err),
        engine: null,
        nerModels: {},
        nerDefaultModels: {},
      };
    }
  };
  const anonymizationDto = async (): Promise<AnonymizationSettingsDto> => {
    const { config, version } = await loadAnonymizationSetting(db);
    return {
      config: config ?? defaultAnonymizationConfig(envKeep()),
      isDefault: config === null,
      version,
      labels: [...anonymizationLabels],
      service: await service(),
    };
  };
  const parseConfig = (raw: unknown) => {
    const parsed = AnonymizationConfig.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "VALIDATION_FAILED",
        "Some settings are invalid.",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    return { ...parsed.data, keep: [...new Set(parsed.data.keep)] };
  };

  return (
    new Hono<Env>()
      .use(requireRole("admin"))
      .get("/anonymization", async (c) => c.json(await anonymizationDto()))
      .put("/anonymization", async (c) => {
        const { version, ...raw } = await parseJson(c, AnonymizationSettingsBody);
        const config = parseConfig(raw);
        await executeCommand(
          db,
          SettingsAggregate,
          ANONYMIZATION_SETTINGS_STREAM_ID,
          { type: "ConfigureAnonymization", config },
          metaFrom(c),
          {
            expectedVersion: version,
          },
        );
        return c.json(await anonymizationDto());
      })
      .post("/anonymization/reset", async (c) => {
        const { version } = await parseJson(c, ResetAnonymizationBody);
        await executeCommand(db, SettingsAggregate, ANONYMIZATION_SETTINGS_STREAM_ID, { type: "ResetAnonymization" }, metaFrom(c), {
          expectedVersion: version,
        });
        return c.json(await anonymizationDto());
      })
      /** Runs the draft settings on pasted text without saving anything or recording the text. */
      .post("/anonymization/preview", async (c) => {
        const body = await parseJson(c, AnonymizationPreviewBody);
        if (!anonymizer) throw new AppError("CONFLICT", "The anonymizer is not configured (ANONYMIZER_URL).");
        const out = await anonymizer.anonymize(body.text, { config: parseConfig(body.config) }).catch((err: Error) => {
          throw new AppError("CONFLICT", err.message);
        });
        const res: AnonymizationPreviewDto = { text: out.text, language: out.language, engine: out.engine, entities: out.entities };
        return c.json(res);
      })
      .get("/audit-model", async (c) => c.json(await settingsDto()))
      .put("/audit-model", async (c) => {
        const { version, provider, model, reasoning } = await parseJson(c, AuditModelBody);
        const availability = deps.config.providers.find((p) => p.id === provider);
        if (!availability?.available) {
          throw new AppError("VALIDATION_FAILED", `The ${provider} provider is not available: ${availability?.reason ?? "unknown"}.`, [
            { path: "provider", message: availability?.reason ?? "Not available" },
          ]);
        }
        const config: AuditModelConfig = { provider, model, reasoning: provider === "openrouter" ? reasoning : null };
        const label = resolveAuditModel(deps.config.llmEnv, config).label;
        await executeCommand(db, SettingsAggregate, SETTINGS_STREAM_ID, { type: "ConfigureAuditModel", config, label }, metaFrom(c), {
          expectedVersion: version,
        });
        return c.json(await settingsDto());
      })
      .post("/audit-model/reset", async (c) => {
        const { version } = await parseJson(c, ResetAuditModelBody);
        await executeCommand(
          db,
          SettingsAggregate,
          SETTINGS_STREAM_ID,
          { type: "ResetAuditModel", label: deps.config.environmentAuditModel.label },
          metaFrom(c),
          { expectedVersion: version },
        );
        return c.json(await settingsDto());
      })
  );
}

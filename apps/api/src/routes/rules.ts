import { RuleBody, type RuleDetailDto, RuleStatusBody, UpdateRuleBody } from "@app/contracts";
import { executeCommand, RuleAggregate, rules, ruleVersions } from "@app/db";
import { AppError, slugify } from "@app/domain";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireRole, requireUser } from "../lib/auth.ts";
import { type Deps, type Env, metaFrom } from "../lib/context.ts";
import { toRuleDto } from "../lib/dto.ts";
import { parseJson, parseUuidParam } from "../lib/validate.ts";
import { recordView } from "../lib/views.ts";

export function ruleRoutes(deps: Deps) {
  const { db } = deps.database;
  const load = async (id: string) => {
    const [r] = await db.select().from(rules).where(eq(rules.id, id));
    if (!r) throw new AppError("NOT_FOUND", "Rule not found.");
    return r;
  };

  return new Hono<Env>()
    .use(requireUser)
    .get("/", async (c) => {
      const status = c.req.query("status");
      const rows = await db
        .select()
        .from(rules)
        .where(status === "active" || status === "archived" ? eq(rules.status, status) : undefined)
        .orderBy(asc(rules.title));
      return c.json(rows.map(toRuleDto));
    })
    .post("/", requireRole("admin"), async (c) => {
      const body = await parseJson(c, RuleBody);
      const slug = slugify(body.title);
      const [dup] = await db.select({ id: rules.id }).from(rules).where(eq(rules.slug, slug));
      if (dup)
        throw new AppError("CONFLICT", "A rule with this title already exists.", [
          { path: "title", message: "Already used by another rule" },
        ]);
      const id = crypto.randomUUID();
      await executeCommand(db, RuleAggregate, id, { type: "CreateRule", slug, ...body }, metaFrom(c));
      return c.json(toRuleDto(await load(id)), 201);
    })
    .get("/:id", async (c) => {
      const id = parseUuidParam(c, "id");
      await load(id);
      await recordView(deps, c, RuleAggregate, id, { type: "ViewRule" }, "RuleViewed");
      const r = await load(id);
      const versions = await db.select().from(ruleVersions).where(eq(ruleVersions.ruleId, id)).orderBy(desc(ruleVersions.contentVersion));
      const body: RuleDetailDto = {
        ...toRuleDto(r),
        versions: versions.map((v) => ({
          contentVersion: v.contentVersion,
          title: v.title,
          description: v.description,
          severity: v.severity,
          category: v.category,
          appliesTo: v.appliesTo as RuleDetailDto["appliesTo"],
          languages: v.languages,
          createdAt: v.createdAt.toISOString(),
        })),
      };
      return c.json(body);
    })
    .patch("/:id", requireRole("admin"), async (c) => {
      const id = parseUuidParam(c, "id");
      const { version, ...content } = await parseJson(c, UpdateRuleBody);
      await executeCommand(db, RuleAggregate, id, { type: "UpdateRule", ...content }, metaFrom(c), { expectedVersion: version });
      return c.json(toRuleDto(await load(id)));
    })
    .post("/:id/archive", requireRole("admin"), async (c) => {
      const id = parseUuidParam(c, "id");
      const body = await parseJson(c, RuleStatusBody);
      await executeCommand(db, RuleAggregate, id, { type: "ArchiveRule", reason: body.reason }, metaFrom(c), {
        expectedVersion: body.version,
      });
      return c.json(toRuleDto(await load(id)));
    })
    .post("/:id/restore", requireRole("admin"), async (c) => {
      const id = parseUuidParam(c, "id");
      const body = await parseJson(c, RuleStatusBody);
      await executeCommand(db, RuleAggregate, id, { type: "RestoreRule" }, metaFrom(c), { expectedVersion: body.version });
      return c.json(toRuleDto(await load(id)));
    });
}

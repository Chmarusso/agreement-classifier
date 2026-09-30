import { ChangeRoleBody, CreateUserBody, DeactivateUserBody, ReactivateUserBody } from "@app/contracts";
import { executeCommand, UserAggregate, users } from "@app/db";
import { AppError } from "@app/domain";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireRole } from "../lib/auth.ts";
import { type Deps, type Env, metaFrom } from "../lib/context.ts";
import { toUserDto } from "../lib/dto.ts";
import { parseJson, parseUuidParam } from "../lib/validate.ts";

export function userRoutes(deps: Deps) {
  const { db } = deps.database;
  const load = async (id: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw new AppError("NOT_FOUND", "User not found.");
    return toUserDto(u);
  };
  const notSelf = (targetId: string, currentId: string, what: string) => {
    if (targetId === currentId) throw new AppError("CONFLICT", `You cannot ${what} your own account.`);
  };

  return new Hono<Env>()
    .use(requireRole("admin"))
    .get("/", async (c) => {
      const rows = await db.select().from(users).orderBy(asc(users.email));
      return c.json(rows.map(toUserDto));
    })
    .post("/", async (c) => {
      const body = await parseJson(c, CreateUserBody);
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
      if (existing) {
        throw new AppError("CONFLICT", "A user with this email already exists.", [{ path: "email", message: "Already registered" }]);
      }
      const id = crypto.randomUUID();
      await executeCommand(db, UserAggregate, id, { type: "RegisterUser", ...body, invitedBy: c.get("user")!.id }, metaFrom(c));
      return c.json(await load(id), 201);
    })
    .patch("/:id/role", async (c) => {
      const id = parseUuidParam(c, "id");
      const body = await parseJson(c, ChangeRoleBody);
      notSelf(id, c.get("user")!.id, "change the role of");
      await executeCommand(db, UserAggregate, id, { type: "ChangeUserRole", role: body.role }, metaFrom(c), {
        expectedVersion: body.version,
      });
      return c.json(await load(id));
    })
    .post("/:id/deactivate", async (c) => {
      const id = parseUuidParam(c, "id");
      const body = await parseJson(c, DeactivateUserBody);
      notSelf(id, c.get("user")!.id, "deactivate");
      await executeCommand(db, UserAggregate, id, { type: "DeactivateUser", reason: body.reason }, metaFrom(c), {
        expectedVersion: body.version,
      });
      return c.json(await load(id));
    })
    .post("/:id/reactivate", async (c) => {
      const id = parseUuidParam(c, "id");
      const body = await parseJson(c, ReactivateUserBody);
      await executeCommand(db, UserAggregate, id, { type: "ReactivateUser" }, metaFrom(c), {
        expectedVersion: body.version,
      });
      return c.json(await load(id));
    });
}

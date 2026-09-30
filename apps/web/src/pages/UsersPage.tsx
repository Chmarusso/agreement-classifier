import type { RoleDto, UserDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  relativeTime,
  Select,
  SkeletonRows,
  Spinner,
} from "../components/ui.tsx";
import { ApiError, api, errorMessage, formErrorHandler } from "../lib/api.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";

const roles: RoleDto[] = ["admin", "auditor", "viewer"];

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", displayName: "", role: "viewer" as RoleDto });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onMutate: () => setErrors({}),
    onSuccess: (u) => {
      toast.success(`Invited ${u.email}`);
      void qc.invalidateQueries({ queryKey: ["users"] });
      setForm({ email: "", displayName: "", role: "viewer" });
      onClose();
    },
    onError: formErrorHandler(setErrors),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Invite user">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Email" error={errors.email}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoFocus
              value={form.email}
              aria-invalid={!!errors.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          )}
        </Field>
        <Field label="Name" error={errors.displayName}>
          {(id) => (
            <Input
              id={id}
              value={form.displayName}
              aria-invalid={!!errors.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Role"
          error={errors.role}
          hint="Viewers read only. Auditors upload and run audits. Admins also manage rules and users."
        >
          {(id) => (
            <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RoleDto })}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Send invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function UserRow({ user, isSelf }: { user: UserDto; isSelf: boolean }) {
  const qc = useQueryClient();
  const onDone = (u: UserDto, msg: string) => {
    qc.setQueryData<UserDto[]>(["users"], (old) => old?.map((x) => (x.id === u.id ? u : x)));
    toast.success(msg);
  };
  const onFail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "CONFLICT") void qc.invalidateQueries({ queryKey: ["users"] });
    toast.error(errorMessage(err));
  };
  const role = useMutation({
    mutationFn: (r: RoleDto) => api.changeRole(user.id, r, user.version),
    onSuccess: (u) => onDone(u, `${u.email} is now ${u.role}`),
    onError: onFail,
  });
  const toggle = useMutation({
    mutationFn: () => (user.status === "active" ? api.deactivate(user.id, user.version, null) : api.reactivate(user.id, user.version)),
    onSuccess: (u) => onDone(u, `${u.email} ${u.status === "active" ? "reactivated" : "deactivated"}`),
    onError: onFail,
  });

  return (
    <tr className={user.status === "deactivated" ? "text-muted" : undefined}>
      <td className="px-5 py-3">
        <div className="font-medium text-ink">{user.displayName}</div>
        <div className="text-xs text-muted">{user.email}</div>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Role for ${user.email}`}
            value={user.role}
            disabled={isSelf || role.isPending || user.status !== "active"}
            onChange={(e) => role.mutate(e.target.value as RoleDto)}
            className="h-8 w-32"
          >
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          {role.isPending && <Spinner size={14} label="Saving role" />}
        </div>
      </td>
      <td className="px-5 py-3">
        <Badge tone={user.status === "active" ? "good" : "bad"}>{user.status}</Badge>
      </td>
      <td className="px-5 py-3 text-muted">{user.lastLoginAt ? relativeTime(user.lastLoginAt) : "never"}</td>
      <td className="px-5 py-3 text-right">
        {isSelf ? (
          <span className="text-xs text-muted">you</span>
        ) : (
          <Button
            variant={user.status === "active" ? "danger" : "secondary"}
            size="sm"
            loading={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {user.status === "active" ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function UsersPage() {
  usePageTitle("Users");
  const me = useMe();
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const [inviting, setInviting] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted">Who can sign in and what they can do.</p>
        </div>
        <Button onClick={() => setInviting(true)}>Invite user</Button>
      </div>
      <Card>
        {users.isPending ? (
          <SkeletonRows rows={4} />
        ) : users.error ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} retrying={users.isFetching} title="Could not load users" />
        ) : users.data.length === 0 ? (
          <EmptyState title="No users yet" action={<Button onClick={() => setInviting(true)}>Invite the first user</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last login</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.data.map((u) => (
                  <UserRow key={u.id} user={u} isSelf={u.id === me.data?.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}

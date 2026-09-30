import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, cx } from "../components/ui.tsx";
import { usePageTitle } from "../lib/title.ts";

/**
 * Mockup of the ways other tools could reach Eone. Nothing here is implemented yet:
 * the examples show the intended shape so teams can say which integration they need.
 */

type Tab = "mcp" | "email" | "http" | "cli";

function Code({ children, label }: { children: string; label: string }) {
  const copy = () =>
    navigator.clipboard
      .writeText(children)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Could not copy"));
  return (
    <figure className="overflow-hidden rounded-md border border-line">
      <figcaption className="flex items-center justify-between border-b border-line bg-canvas px-3 py-1.5 text-xs text-muted">
        {label}
        <button type="button" onClick={copy} className="font-medium text-link hover:underline">
          Copy
        </button>
      </figcaption>
      <pre className="overflow-x-auto bg-white px-3 py-3 font-mono text-[13px] leading-relaxed text-ink">{children}</pre>
    </figure>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
            {i + 1}
          </span>
          <span className="text-ink/90">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Capabilities({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([name, body]) => (
        <div key={name} className="rounded-md border border-line px-3 py-2">
          <dt className="font-mono text-xs text-brand">{name}</dt>
          <dd className="mt-0.5 text-sm text-muted">{body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function IntegrationsPage() {
  usePageTitle("Integrations");
  const [tab, setTab] = useState<Tab>("mcp");
  const origin = typeof window === "undefined" ? "https://eone.example.com" : window.location.origin;
  const apiKey = "eone_live_•••••••••••••••••";
  const mailbox = `audit@${new URL(origin).hostname === "localhost" ? "eone.example.com" : new URL(origin).hostname}`;

  const tabs: { id: Tab; title: string; blurb: string }[] = [
    { id: "mcp", title: "MCP server", blurb: "Claude and other AI assistants" },
    { id: "email", title: "Email", blurb: "Forward an agreement, get a report" },
    { id: "http", title: "HTTP API", blurb: "Your systems and workflows" },
    { id: "cli", title: "CLI", blurb: "Scripts and CI pipelines" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            Integrations <Badge tone="warn">Preview</Badge>
          </h1>
          <p className="text-sm text-muted">
            Audit agreements from the tools you already use. Every channel runs the same rules and anonymization.
          </p>
        </div>
        <Button variant="secondary" disabled title="API keys are not available yet">
          Create API key
        </Button>
      </div>

      <p role="note" className="rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
        These integrations are a design preview and are not connected yet. The examples show how they will work; tell the Eone team which
        one you need first.
      </p>

      <div role="tablist" aria-label="Integration" className="grid gap-3 sm:grid-cols-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cx(
              "rounded-xl border bg-white px-4 py-3 text-left transition-colors",
              tab === t.id ? "border-brand ring-2 ring-brand/15" : "border-line hover:border-brand/40",
            )}
          >
            <span className="block text-sm font-semibold">{t.title}</span>
            <span className="block text-xs text-muted">{t.blurb}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-6">
        {tab === "mcp" && (
          <>
            <Card title="Connect Claude to Eone">
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted">
                  The Eone MCP server lets Claude Desktop, Claude Code or any MCP client upload agreements, run audits and read reports on
                  your behalf. Personal data is anonymized on Eone before any model sees it, including the model you chat with.
                </p>
                <Steps
                  items={[
                    "Create an API key above (scoped to your role: viewers can read reports, auditors can also upload).",
                    "Add the server to your MCP client configuration.",
                    "Restart the client and ask Claude to audit an agreement.",
                  ]}
                />
                <Code label="Claude Desktop · claude_desktop_config.json">{`{
  "mcpServers": {
    "eone": {
      "command": "npx",
      "args": ["-y", "@eone/mcp-server"],
      "env": {
        "EONE_URL": "${origin}",
        "EONE_API_KEY": "${apiKey}"
      }
    }
  }
}`}</Code>
                <Code label="Claude Code">{`claude mcp add eone \\
  --env EONE_URL=${origin} \\
  --env EONE_API_KEY=${apiKey} \\
  -- npx -y @eone/mcp-server`}</Code>
                <Code label="Remote (streamable HTTP) for clients that support it">{`{
  "mcpServers": {
    "eone": { "type": "http", "url": "${origin}/mcp", "headers": { "Authorization": "Bearer ${apiKey}" } }
  }
}`}</Code>
              </div>
            </Card>
            <Card title="Tools the server offers">
              <div className="flex flex-col gap-4 p-5">
                <Capabilities
                  items={[
                    ["upload_agreement", "Upload a PDF, DOCX, TXT or MD file with its type; the audit starts automatically."],
                    ["get_audit_report", "Verdict, findings with quoted clauses, and what to fix, with real names put back."],
                    ["list_agreements", "Search and filter by status, type and language, like the Agreements page."],
                    ["list_rules", "The active rules for a type and language, so Claude can explain a finding."],
                    ["rerun_audit", "Audit again after the rules changed."],
                    ["preview_anonymization", "Show what would be sent to a model for a given text."],
                  ]}
                />
                <Code label="Example prompt">{`Audit ~/Downloads/NDA-Wisla-Data.pdf as an NDA with Eone.
When it's done, list the failed rules with the clause that causes each one
and draft a reply to the counterparty asking for the changes.`}</Code>
              </div>
            </Card>
          </>
        )}

        {tab === "email" && (
          <>
            <Card title="Audit by email">
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted">
                  Forward an agreement to your team's Eone mailbox. Eone audits every attachment and replies in the same thread with the
                  verdict and a link to the full report. Only senders from allowed domains are accepted.
                </p>
                <Steps
                  items={[
                    <>
                      Send or forward the agreement to <span className="font-mono text-brand">{mailbox}</span>.
                    </>,
                    "Put the agreement type in the subject in square brackets, for example [NDA]. Without it Eone guesses the type.",
                    "Wait for the reply, usually within two minutes. Reply with “rerun” to audit again.",
                  ]}
                />
                <Code label="Your email">{`To: ${mailbox}
Subject: [NDA] Wisła Data Solutions – please check before signing
Attachment: NDA-Wisla-Data.pdf

Language is detected automatically (Polish or English).`}</Code>
                <Code label="Eone's reply">{`From: Eone <${mailbox}>
Subject: Re: [NDA] Wisła Data Solutions – please check before signing

Verdict: FAIL (1 critical, 0 high)

✕ Polish governing law – no governing-law clause found.
✓ Liability is capped – §6 caps liability at PLN 200,000.
✓ Confidentiality survives 3 years – §4: five (5) years.

Full report: ${origin}/audits/3f8c…
Personal data was anonymized before the audit.`}</Code>
              </div>
            </Card>
            <Card title="Mailbox settings (admin)">
              <div className="grid gap-3 p-5 text-sm sm:grid-cols-3">
                <p>
                  <span className="block text-xs text-muted">Allowed sender domains</span>northwind.example
                </p>
                <p>
                  <span className="block text-xs text-muted">Reply with</span>verdict + failed rules
                </p>
                <p>
                  <span className="block text-xs text-muted">Attachments per email</span>up to 5, 20 MB each
                </p>
              </div>
            </Card>
          </>
        )}

        {tab === "http" && (
          <>
            <Card title="HTTP API">
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted">
                  A JSON API over HTTPS for document management systems, CLM tools and workflow engines. Authenticate with an API key in the
                  Authorization header. The same endpoints power this web app.
                </p>
                <Code label="1. Upload an agreement">{`curl -X POST ${origin}/api/v1/agreements \\
  -H "Authorization: Bearer $EONE_API_KEY" \\
  -F file=@NDA-Wisla-Data.pdf \\
  -F agreementType=NDA`}</Code>
                <Code label="Response · 201 Created">{`{
  "id": "0b6f2c1e-5d0a-4a7e-9a55-3f1b2c7d8e90",
  "title": "NDA Wisla Data",
  "agreementType": "NDA",
  "extractionStatus": "pending",
  "latestRunStatus": null
}`}</Code>
                <Code label="2. Read the result when the audit completes">{`curl ${origin}/api/v1/agreements/0b6f2c1e-… \\
  -H "Authorization: Bearer $EONE_API_KEY"

curl ${origin}/api/v1/audits/{latestRunId} \\
  -H "Authorization: Bearer $EONE_API_KEY"`}</Code>
                <Code label="3. Or get a webhook instead of polling">{`POST https://your-system.example/hooks/eone
X-Eone-Signature: sha256=…

{
  "event": "audit.completed",
  "agreementId": "0b6f2c1e-…",
  "runId": "3f8c…",
  "verdict": "fail",
  "failedRules": ["governing-law"],
  "reportUrl": "${origin}/audits/3f8c…"
}`}</Code>
              </div>
            </Card>
            <Card title="Endpoints">
              <div className="p-5">
                <Capabilities
                  items={[
                    ["POST /agreements", "Upload a file; extraction, anonymization and the audit follow."],
                    ["GET /agreements?status=fail&q=nda", "Search, filter and page through agreements."],
                    ["GET /audits/{id}", "Verdict, summary and findings with evidence."],
                    ["POST /agreements/{id}/audits", "Run another audit, optionally with chosen rules."],
                    ["GET /rules", "Active rules with types and languages."],
                    ["POST /webhooks", "Subscribe to audit.completed and audit.failed."],
                  ]}
                />
              </div>
            </Card>
          </>
        )}

        {tab === "cli" && (
          <>
            <Card title="Command-line tool">
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted">
                  For scripts, batch uploads and CI checks. Exit codes follow the verdict, so a pipeline can stop when an agreement fails.
                </p>
                <Code label="Install and sign in">{`npm install -g @eone/cli
eone login --url ${origin}        # opens the browser, or pass --api-key`}</Code>
                <Code label="Audit a file and wait for the verdict">{`$ eone audit NDA-Wisla-Data.pdf --type NDA --wait
Uploading NDA-Wisla-Data.pdf … done (Polish, 13 items anonymized)
Auditing against 6 rules … done in 38 s

FAIL  Polish governing law        critical  no governing-law clause
PASS  Liability is capped         critical  §6
PASS  Confidentiality survives    high      §4

Report: ${origin}/audits/3f8c…
$ echo $?
2`}</Code>
                <Code label="More commands">{`eone agreements list --status fail --type MSA
eone report 3f8c… --format markdown > report.md
eone audit contracts/*.docx --type Employment --json > results.json
eone anonymize contract.docx --format side   # local preview, nothing uploaded`}</Code>
              </div>
            </Card>
            <Card title="Exit codes">
              <div className="p-5">
                <Capabilities
                  items={[
                    ["0", "Pass"],
                    ["1", "Needs review"],
                    ["2", "Fail"],
                    ["3", "Error: upload, extraction or audit failed"],
                  ]}
                />
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export interface OtpDelivery {
  readonly channel: "console" | "email";
  send(email: string, code: string): Promise<void>;
}

/** Version 1 delivery: prints the code to the API log. Production provider is undecided. */
export class ConsoleOtpDelivery implements OtpDelivery {
  readonly channel = "console" as const;
  async send(email: string, code: string): Promise<void> {
    console.info(`[otp] login code for ${email}: ${code}`);
  }
}

/** Captures codes in memory; used by tests. */
export class MemoryOtpDelivery implements OtpDelivery {
  readonly channel = "console" as const;
  readonly sent: { email: string; code: string }[] = [];
  async send(email: string, code: string): Promise<void> {
    this.sent.push({ email, code });
  }
  lastCodeFor(email: string): string | undefined {
    return this.sent.filter((s) => s.email === email).at(-1)?.code;
  }
}

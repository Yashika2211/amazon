import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type { Alert, Household, Member } from "@kinloop/core";
import { log } from "../log.js";

export interface Notifier {
  /** Sends an alert to every caregiver in the household. Never throws. */
  send(alert: Alert, household: Household, caregivers: Member[]): Promise<{ channels: string[] }>;
}

const SAFETY = "KinLoop is not a medical device and does not replace emergency services.";

export function formatAlert(alert: Alert, household: Household): { subject: string; body: string } {
  const prefix = alert.severity === "urgent" ? "URGENT" : alert.severity === "warning" ? "Heads up" : "KinLoop";
  const details = Object.entries(alert.details)
    .filter(([k]) => k !== "symptomId")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return {
    subject: `${prefix}: ${alert.reason}`.slice(0, 99),
    body: `${alert.reason}\n\n${details}\n\nHousehold: ${household.name}\nTime: ${new Date(alert.createdAt).toLocaleString("en-IN", { timeZone: household.timezone })}\n\n${SAFETY}`,
  };
}

/** Collects every alert in memory. Used for local runs and tests, and as the live feed for the simulator. */
export class ConsoleNotifier implements Notifier {
  sent: Array<{ alert: Alert; to: string[] }> = [];
  async send(alert: Alert, household: Household, caregivers: Member[]) {
    const { subject } = formatAlert(alert, household);
    this.sent.push({ alert, to: caregivers.map((c) => c.name) });
    log.info("alert.sent", { channel: "console", subject: subject.replace(/".*"/, '"[redacted]"'), kind: alert.kind });
    return { channels: ["console"] };
  }
}

export interface SnsNotifierOptions {
  topicArn?: string;
  smsEnabled: boolean;
  telegramBotToken?: () => Promise<string | undefined>;
  client?: SNSClient;
}

/**
 * Amazon SNS: one publish to the household topic (email subscribers) and, when enabled, a direct SMS
 * to each caregiver's phone. Telegram is an optional extra channel.
 */
export class SnsNotifier implements Notifier {
  private sns: SNSClient;
  constructor(private opts: SnsNotifierOptions) {
    this.sns = opts.client ?? new SNSClient({});
  }

  async send(alert: Alert, household: Household, caregivers: Member[]) {
    const { subject, body } = formatAlert(alert, household);
    const channels: string[] = [];
    const tasks: Array<Promise<void>> = [];

    if (this.opts.topicArn) {
      tasks.push(
        this.sns
          .send(
            new PublishCommand({
              TopicArn: this.opts.topicArn,
              Subject: subject,
              Message: body,
              MessageAttributes: {
                householdId: { DataType: "String", StringValue: household.id },
                severity: { DataType: "String", StringValue: alert.severity },
              },
            }),
          )
          .then(() => void channels.push("sns-email")),
      );
    }
    if (this.opts.smsEnabled) {
      for (const c of caregivers.filter((c) => c.phone)) {
        tasks.push(
          this.sns
            .send(
              new PublishCommand({
                PhoneNumber: c.phone,
                Message: `KinLoop: ${alert.reason}`.slice(0, 300),
                MessageAttributes: {
                  "AWS.SNS.SMS.SMSType": {
                    DataType: "String",
                    StringValue: alert.severity === "urgent" ? "Transactional" : "Promotional",
                  },
                },
              }),
            )
            .then(() => void channels.push("sns-sms")),
        );
      }
    }
    const token = await this.opts.telegramBotToken?.();
    if (token) {
      for (const c of caregivers.filter((c) => c.telegramChatId)) {
        tasks.push(
          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: c.telegramChatId, text: `${subject}\n\n${body}` }),
          }).then((r) => {
            if (!r.ok) throw new Error(`telegram ${r.status}`);
            channels.push("telegram");
          }),
        );
      }
    }

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "rejected") log.error("alert.channel_failed", { kind: alert.kind, error: String(r.reason) });
    }
    log.info("alert.sent", { kind: alert.kind, severity: alert.severity, channels });
    return { channels };
  }
}

/** Fans out to several notifiers, so the console feed keeps working next to SNS. */
export class MultiNotifier implements Notifier {
  constructor(private notifiers: Notifier[]) {}
  async send(alert: Alert, household: Household, caregivers: Member[]) {
    const results = await Promise.all(this.notifiers.map((n) => n.send(alert, household, caregivers)));
    return { channels: results.flatMap((r) => r.channels) };
  }
}

import type {
  Alert,
  CheckIn,
  Digest,
  DoseLog,
  FamilyMessage,
  Household,
  Medication,
  Member,
  Role,
  Symptom,
} from "@kinloop/core";
import type { Item, Table } from "./table.js";

/** Health records are kept for 90 days, OAuth artifacts until they expire. Stated on the privacy page. */
export const HEALTH_RETENTION_DAYS = 90;

export interface Appointment {
  id: string;
  householdId: string;
  /** Local "YYYY-MM-DD". */
  date: string;
  /** Local "HH:MM". */
  time: string;
  title: string;
}

export interface Credential {
  username: string;
  householdId: string;
  memberId: string;
  /** scrypt hash, "salt:hash" hex. */
  pinHash: string;
}

export interface AuthCodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
  scope: string;
  householdId: string;
  memberId: string;
  role: Role;
  expiresAt: number;
}

export interface TokenRecord {
  clientId: string;
  scope: string;
  resource?: string;
  householdId: string;
  memberId: string;
  role: Role;
  expiresAt: number;
}

const hh = (id: string) => `HH#${id}`;
const ttlFromNow = (days: number, from = Date.now()) => Math.floor(from / 1000) + days * 86400;
const healthTtl = () => ttlFromNow(HEALTH_RETENTION_DAYS);

function strip<T>(item: Item | undefined): T | undefined {
  if (!item) return undefined;
  const { pk: _pk, sk: _sk, ttl: _ttl, ...rest } = item;
  return rest as T;
}

function stripAll<T>(items: Item[]): T[] {
  return items.map((i) => strip<T>(i)!);
}

/**
 * Domain repository over a single table. Every household-scoped method takes the household ID
 * explicitly; callers pass the ID from the verified access token, never from tool arguments.
 */
export class Store {
  constructor(private table: Table) {}

  // ---- households & members ----
  async putHousehold(h: Household): Promise<void> {
    await this.table.put({ pk: hh(h.id), sk: "META", ...h });
    await this.table.put({ pk: "HOUSEHOLDS", sk: hh(h.id), householdId: h.id });
  }

  async getHousehold(id: string): Promise<Household | undefined> {
    return strip<Household>(await this.table.get(hh(id), "META"));
  }

  async listHouseholdIds(): Promise<string[]> {
    return (await this.table.query("HOUSEHOLDS", "HH#")).map((i) => i.householdId as string);
  }

  async putMember(m: Member): Promise<void> {
    await this.table.put({ pk: hh(m.householdId), sk: `MEMBER#${m.id}`, ...m });
  }

  async getMember(householdId: string, id: string): Promise<Member | undefined> {
    return strip<Member>(await this.table.get(hh(householdId), `MEMBER#${id}`));
  }

  async listMembers(householdId: string): Promise<Member[]> {
    return stripAll<Member>(await this.table.query(hh(householdId), "MEMBER#"));
  }

  // ---- medications ----
  async putMedication(m: Medication): Promise<void> {
    await this.table.put({ pk: hh(m.householdId), sk: `MED#${m.id}`, ...m });
  }

  async listMedications(householdId: string): Promise<Medication[]> {
    return stripAll<Medication>(await this.table.query(hh(householdId), "MED#"));
  }

  // ---- dose logs (idempotent: one item per date+medication+slot) ----
  async putDoseLogIfAbsent(log: DoseLog): Promise<boolean> {
    return this.table.put(
      { pk: hh(log.householdId), sk: `DOSE#${log.date}#${log.medicationId}#${log.slot}`, ...log, ttl: healthTtl() },
      { ifAbsent: true },
    );
  }

  async listDoseLogs(householdId: string, fromDate: string, toDate: string): Promise<DoseLog[]> {
    const items = await this.table.query(hh(householdId), "DOSE#");
    return stripAll<DoseLog>(items).filter((l) => l.date >= fromDate && l.date <= toDate);
  }

  // ---- check-ins (latest of the day wins) ----
  async putCheckIn(c: CheckIn): Promise<void> {
    await this.table.put({ pk: hh(c.householdId), sk: `CHECKIN#${c.date}`, ...c, ttl: healthTtl() });
  }

  async listCheckIns(householdId: string, fromDate: string): Promise<CheckIn[]> {
    const items = await this.table.query(hh(householdId), "CHECKIN#");
    return stripAll<CheckIn>(items).filter((c) => c.date >= fromDate);
  }

  // ---- symptoms ----
  async putSymptom(s: Symptom): Promise<void> {
    await this.table.put({ pk: hh(s.householdId), sk: `SYM#${s.at}#${s.id}`, ...s, ttl: healthTtl() });
  }

  async listSymptoms(householdId: string, fromDate: string): Promise<Symptom[]> {
    const items = await this.table.query(hh(householdId), "SYM#");
    return stripAll<Symptom>(items).filter((s) => s.date >= fromDate);
  }

  // ---- messages (family notes + gentle reminders) ----
  /** Returns false if a message with this ID already exists (used to dedupe reminders). */
  async putMessage(m: FamilyMessage): Promise<boolean> {
    return this.table.put({ pk: hh(m.householdId), sk: `MSG#${m.id}`, ...m, ttl: ttlFromNow(30) }, { ifAbsent: true });
  }

  async listMessages(householdId: string): Promise<FamilyMessage[]> {
    const items = stripAll<FamilyMessage>(await this.table.query(hh(householdId), "MSG#"));
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async markHeard(householdId: string, ids: string[], at: string): Promise<void> {
    for (const id of ids) {
      const item = await this.table.get(hh(householdId), `MSG#${id}`);
      if (item) await this.table.put({ ...item, heardAt: at });
    }
  }

  // ---- alerts (deduplicated per incident key) ----
  async putAlertIfAbsent(a: Alert): Promise<boolean> {
    return this.table.put({ pk: hh(a.householdId), sk: `ALERT#${a.incidentKey}`, ...a, ttl: healthTtl() }, { ifAbsent: true });
  }

  async listAlerts(householdId: string, sinceIso?: string): Promise<Alert[]> {
    const items = stripAll<Alert>(await this.table.query(hh(householdId), "ALERT#"));
    return items
      .filter((a) => !sinceIso || a.createdAt >= sinceIso)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async acknowledgeAlert(householdId: string, incidentKey: string, at: string): Promise<boolean> {
    const item = await this.table.get(hh(householdId), `ALERT#${incidentKey}`);
    if (!item) return false;
    await this.table.put({ ...item, acknowledgedAt: at });
    return true;
  }

  /** Every incident key already raised (alerts + reminder messages), for the escalation dedupe. */
  async incidentKeys(householdId: string): Promise<Set<string>> {
    const [alerts, msgs] = await Promise.all([
      this.table.query(hh(householdId), "ALERT#"),
      this.table.query(hh(householdId), "MSG#reminder:"),
    ]);
    return new Set([...alerts.map((a) => a.incidentKey as string), ...msgs.map((m) => m.id as string)]);
  }

  // ---- appointments ----
  async putAppointment(a: Appointment): Promise<void> {
    await this.table.put({ pk: hh(a.householdId), sk: `APPT#${a.date}#${a.time}#${a.id}`, ...a, ttl: healthTtl() });
  }

  async listAppointments(householdId: string, date: string): Promise<Appointment[]> {
    return stripAll<Appointment>(await this.table.query(hh(householdId), `APPT#${date}#`));
  }

  // ---- last activity (lets readers tell whether the stored digest is stale) ----
  async touchActivity(householdId: string, at: string): Promise<void> {
    await this.table.put({ pk: hh(householdId), sk: "ACTIVITY", at });
  }

  async lastActivity(householdId: string): Promise<string | undefined> {
    return (await this.table.get(hh(householdId), "ACTIVITY"))?.at as string | undefined;
  }

  // ---- digests ----
  async putDigest(d: Digest): Promise<void> {
    await this.table.put({ pk: hh(d.householdId), sk: `DIGEST#${d.date}`, ...d, ttl: healthTtl() });
  }

  async getDigest(householdId: string, date: string): Promise<Digest | undefined> {
    return strip<Digest>(await this.table.get(hh(householdId), `DIGEST#${date}`));
  }

  // ---- credentials (household login) ----
  async putCredential(c: Credential): Promise<boolean> {
    return this.table.put({ pk: `CRED#${c.username.toLowerCase()}`, sk: "CRED", ...c }, { ifAbsent: true });
  }

  async getCredential(username: string): Promise<Credential | undefined> {
    return strip<Credential>(await this.table.get(`CRED#${username.toLowerCase()}`, "CRED"));
  }

  // ---- OAuth (all keyed by SHA-256 of the secret, never the secret itself) ----
  async putAuthCode(hash: string, rec: AuthCodeRecord): Promise<void> {
    await this.table.put({ pk: `OAUTH#CODE#${hash}`, sk: "OAUTH", ...rec, ttl: Math.ceil(rec.expiresAt / 1000) });
  }

  /** Deletes and returns the code. A second redemption gets nothing. */
  async consumeAuthCode(hash: string): Promise<AuthCodeRecord | undefined> {
    const rec = strip<AuthCodeRecord>(await this.table.delete(`OAUTH#CODE#${hash}`, "OAUTH"));
    return rec && rec.expiresAt > Date.now() ? rec : undefined;
  }

  async putAccessToken(hash: string, rec: TokenRecord): Promise<void> {
    await this.table.put({ pk: `OAUTH#AT#${hash}`, sk: "OAUTH", ...rec, ttl: Math.ceil(rec.expiresAt / 1000) });
  }

  async getAccessToken(hash: string): Promise<TokenRecord | undefined> {
    const rec = strip<TokenRecord>(await this.table.get(`OAUTH#AT#${hash}`, "OAUTH"));
    return rec && rec.expiresAt > Date.now() ? rec : undefined;
  }

  async putRefreshToken(hash: string, rec: TokenRecord): Promise<void> {
    await this.table.put({ pk: `OAUTH#RT#${hash}`, sk: "OAUTH", ...rec, ttl: Math.ceil(rec.expiresAt / 1000) });
  }

  /** Refresh tokens rotate: redeeming one deletes it. */
  async consumeRefreshToken(hash: string): Promise<TokenRecord | undefined> {
    const rec = strip<TokenRecord>(await this.table.delete(`OAUTH#RT#${hash}`, "OAUTH"));
    return rec && rec.expiresAt > Date.now() ? rec : undefined;
  }
}

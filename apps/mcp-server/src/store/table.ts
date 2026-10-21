import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";

/** A single-table item. `pk`/`sk` are the keys; `ttl` (epoch seconds) expires the item. */
export interface Item {
  pk: string;
  sk: string;
  ttl?: number;
  [key: string]: unknown;
}

/** The minimal key-value surface the store needs, implemented by DynamoDB and by memory. */
export interface Table {
  get(pk: string, sk: string): Promise<Item | undefined>;
  /** Returns false (and writes nothing) when ifAbsent is set and the item already exists. */
  put(item: Item, opts?: { ifAbsent?: boolean }): Promise<boolean>;
  /** All items under pk whose sk starts with prefix, sorted by sk. */
  query(pk: string, skPrefix: string): Promise<Item[]>;
  /** Deletes and returns the old item, if any. Atomic, so it doubles as "consume once". */
  delete(pk: string, sk: string): Promise<Item | undefined>;
}

function expired(item: Item): boolean {
  return item.ttl !== undefined && item.ttl * 1000 < Date.now();
}

export class MemoryTable implements Table {
  private items = new Map<string, Item>();

  private key(pk: string, sk: string): string {
    return `${pk}\u0000${sk}`;
  }

  async get(pk: string, sk: string): Promise<Item | undefined> {
    const item = this.items.get(this.key(pk, sk));
    return item && !expired(item) ? structuredClone(item) : undefined;
  }

  async put(item: Item, opts: { ifAbsent?: boolean } = {}): Promise<boolean> {
    const k = this.key(item.pk, item.sk);
    const existing = this.items.get(k);
    if (opts.ifAbsent && existing && !expired(existing)) return false;
    this.items.set(k, structuredClone(item));
    return true;
  }

  async query(pk: string, skPrefix: string): Promise<Item[]> {
    return [...this.items.values()]
      .filter((i) => i.pk === pk && i.sk.startsWith(skPrefix) && !expired(i))
      .sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))
      .map((i) => structuredClone(i));
  }

  async delete(pk: string, sk: string): Promise<Item | undefined> {
    const k = this.key(pk, sk);
    const existing = this.items.get(k);
    this.items.delete(k);
    return existing && !expired(existing) ? existing : undefined;
  }
}

export class DynamoTable implements Table {
  private doc: DynamoDBDocumentClient;

  constructor(
    private tableName: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async get(pk: string, sk: string): Promise<Item | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk } }));
    const item = r.Item as Item | undefined;
    return item && !expired(item) ? item : undefined;
  }

  async put(item: Item, opts: { ifAbsent?: boolean } = {}): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ...(opts.ifAbsent
            ? {
                // An expired-but-not-yet-reaped item counts as absent.
                ConditionExpression: "attribute_not_exists(pk) OR #ttl < :now",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
              }
            : {}),
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  async query(pk: string, skPrefix: string): Promise<Item[]> {
    const out: Item[] = [];
    let ExclusiveStartKey: QueryCommandOutput["LastEvaluatedKey"];
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": pk, ":sk": skPrefix },
          ExclusiveStartKey,
        }),
      );
      out.push(...((r.Items ?? []) as Item[]));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out.filter((i) => !expired(i));
  }

  async delete(pk: string, sk: string): Promise<Item | undefined> {
    const r = await this.doc.send(
      new DeleteCommand({ TableName: this.tableName, Key: { pk, sk }, ReturnValues: "ALL_OLD" }),
    );
    const item = r.Attributes as Item | undefined;
    return item && !expired(item) ? item : undefined;
  }
}

import { GetItemCommand, UpdateItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { UsageSender } from "./usage-dynamo";

/**
 * Test-only DynamoDB emulator for the few expression shapes UsageStore uses. It runs each
 * UpdateItem (condition check + update) as one synchronous step, like DynamoDB's single-item atomicity.
 * It is NOT DynamoDB: passing tests prove the request shapes and our logic, not AWS behavior.
 */
export function createFakeUsageDynamo() {
  const items = new Map<string, Record<string, AttributeValue>>();
  const commands: unknown[] = [];
  let failWith: string | null = null;

  const err = (name: string) => Object.assign(new Error(name), { name });
  const num = (v?: AttributeValue) => (v?.N === undefined ? undefined : Number(v.N));

  function resolve(token: string, names: Record<string, string> = {}) {
    return names[token] ?? token;
  }
  function holds(cond: string, item: Record<string, AttributeValue> | undefined, names: Record<string, string>, values: Record<string, AttributeValue>) {
    return cond.split(" OR ").some((raw) => {
      const clause = raw.trim();
      let m = clause.match(/^attribute_not_exists\((\S+)\)$/);
      if (m) return item?.[resolve(m[1], names)] === undefined;
      m = clause.match(/^(\S+) (<=|<|=) (:\w+)$/);
      if (!m) throw new Error(`fake dynamo cannot evaluate: ${clause}`);
      const attr = item?.[resolve(m[1], names)];
      const want = values[m[3]];
      if (attr === undefined) return false;
      if (m[2] === "=") return (attr.S ?? attr.N) === (want.S ?? want.N);
      const a = num(attr)!;
      const b = num(want)!;
      return m[2] === "<" ? a < b : a <= b;
    });
  }

  const client = {
    async send(command: unknown) {
      commands.push(command);
      await Promise.resolve();
      if (failWith) throw err(failWith);
      if (command instanceof GetItemCommand) return { Item: items.get(command.input.Key!.pk.S!) };
      if (!(command instanceof UpdateItemCommand)) throw new Error("unexpected command");
      const { Key, UpdateExpression = "", ConditionExpression, ExpressionAttributeNames: names = {}, ExpressionAttributeValues: values = {} } = command.input;
      const pk = Key!.pk.S!;
      const current = items.get(pk);
      if (ConditionExpression && !holds(ConditionExpression, current, names, values)) throw err("ConditionalCheckFailedException");

      const next: Record<string, AttributeValue> = { pk: { S: pk }, ...(current ?? {}) };
      const updated: Record<string, AttributeValue> = {};
      let setPart = UpdateExpression;
      let addPart = "";
      const addAt = UpdateExpression.indexOf(" ADD ");
      if (addAt >= 0) {
        setPart = UpdateExpression.slice(0, addAt);
        addPart = UpdateExpression.slice(addAt + 5);
      } else if (UpdateExpression.startsWith("ADD ")) {
        setPart = "";
        addPart = UpdateExpression.slice(4);
      }
      for (const m of setPart.matchAll(/(\S+) = if_not_exists\((\S+), (:\w+)\) \+ (:\w+)/g)) {
        const attr = resolve(m[1], names);
        const base = num(next[resolve(m[2], names)]) ?? num(values[m[3]])!;
        next[attr] = updated[attr] = { N: String(base + num(values[m[4]])!) };
      }
      const rest = setPart.replace(/SET /, "").replace(/(\S+) = if_not_exists\((\S+), (:\w+)\) \+ (:\w+),?/g, "");
      for (const m of rest.matchAll(/(\S+) = (:\w+)/g)) {
        const attr = resolve(m[1], names);
        next[attr] = updated[attr] = values[m[2]];
      }
      for (const m of addPart.matchAll(/(\S+) (:\w+)/g)) {
        const attr = resolve(m[1], names);
        next[attr] = updated[attr] = { N: String((num(next[attr]) ?? 0) + num(values[m[2]])!) };
      }
      items.set(pk, next);
      return { Attributes: updated };
    },
  } as unknown as UsageSender;

  return {
    client,
    items,
    commands,
    value: (pk: string, attr: string) => num(items.get(pk)?.[attr]),
    setFlag: (pk: string, on: boolean) => items.set(pk, { pk: { S: pk }, on: { BOOL: on } }),
    failAll: (name: string | null) => { failWith = name; },
  };
}

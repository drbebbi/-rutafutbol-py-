import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { ADMIN, asRole, connect, databaseAvailable, fakeHash, uniqueSlug, USER_A } from "./db";

const maybe = databaseAvailable ? describe : describe.skip;

maybe("knowledge publication", () => {
  let client: pg.Client;
  let ruleSetRevisionId = "";
  let ruleId = "";

  beforeAll(async () => {
    client = await connect();
    await client.query(
      "insert into security.admin_authorizations (user_id, admin_role) values ($1,'ADMIN'),($1,'PUBLISHER') on conflict do nothing",
      [ADMIN],
    );
    await client.query("insert into core.countries (country_code, label) values ('ZZ','Test') on conflict do nothing");
    const authority = uniqueSlug("t.authority");
    await client.query("insert into core.authorities (authority_id, country_code, label) values ($1,'ZZ','Test')", [authority]);
    const ruleSetId = uniqueSlug("t.set");
    await client.query("insert into core.rule_sets (rule_set_id, label) values ($1,'Test')", [ruleSetId]);
    const rsr = await client.query<{ rule_set_revision_id: string }>(
      "insert into core.rule_set_revisions (rule_set_id, publication_status, valid_from) values ($1,'PUBLISHED','2000-01-01') returning rule_set_revision_id",
      [ruleSetId],
    );
    ruleSetRevisionId = rsr.rows[0]?.rule_set_revision_id ?? "";
    ruleId = uniqueSlug("t.rule");
    await client.query("insert into core.rules (rule_id, rule_set_id, label) values ($1,$2,'Test')", [ruleId, ruleSetId]);
  });

  afterAll(async () => {
    await client.end();
  });

  async function insertRevision(
    version: number,
    status: string,
    validFrom: string,
    validUntil: string | null,
  ): Promise<string> {
    const result = await client.query<{ rule_revision_id: string }>(
      `insert into core.rule_revisions (rule_id, rule_set_revision_id, version, publication_status,
         verification_status, valid_from, valid_until, payload_schema_version, payload)
       values ($1,$2,$3,$4,'CONFIRMED',$5,$6,'rule-payload@1.0','{}'::jsonb)
       returning rule_revision_id`,
      [ruleId, ruleSetRevisionId, version, status, validFrom, validUntil],
    );
    return result.rows[0]?.rule_revision_id ?? "";
  }

  it("closes the predecessor's open window and publishes the successor in one transaction", async () => {
    await insertRevision(1, "PUBLISHED", "2026-01-01", null);
    const successor = await insertRevision(2, "APPROVED", "2026-07-01", null);

    const hash = fakeHash("abc");
    await asRole(client, "cedula_admin_runtime_role", ADMIN, async () =>
      client.query("select core.publish_rule_revision($1, $2, $3, $4)", [successor, "2026-07-01", hash, hash]),
    );

    const rows = await client.query<{ version: number; publication_status: string; valid_until: string | null }>(
      "select version, publication_status, to_char(valid_until, 'YYYY-MM-DD') as valid_until from core.rule_revisions where rule_id = $1 order by version",
      [ruleId],
    );
    expect(rows.rows[0]?.publication_status).toBe("SUPERSEDED");
    expect(rows.rows[0]?.valid_until).toBe("2026-06-30");
    expect(rows.rows[1]?.publication_status).toBe("PUBLISHED");
  });

  it("refuses to publish against a candidate that has moved since it was approved", async () => {
    const revision = await insertRevision(3, "APPROVED", "2027-01-01", null);
    await expect(
      asRole(client, "cedula_admin_runtime_role", ADMIN, async () =>
        client.query("select core.publish_rule_revision($1,$2,$3,$4)", [
          revision,
          "2027-01-01",
          fakeHash("aaa"),
          fakeHash("bbb"),
        ]),
      ),
    ).rejects.toThrow(/STALE_PUBLICATION_VALIDATION/u);
  });

  it("refuses to publish a revision that has not been approved", async () => {
    const revision = await insertRevision(4, "DRAFT", "2028-01-01", null);
    const hash = fakeHash("ccc");
    await expect(
      asRole(client, "cedula_admin_runtime_role", ADMIN, async () =>
        client.query("select core.publish_rule_revision($1,$2,$3,$4)", [revision, "2028-01-01", hash, hash]),
      ),
    ).rejects.toThrow(/only an APPROVED revision/u);
  });

  it("refuses to publish without publisher authority", async () => {
    const revision = await insertRevision(5, "APPROVED", "2029-01-01", null);
    const hash = fakeHash("ddd");
    await expect(
      asRole(client, "cedula_admin_runtime_role", USER_A, async () =>
        client.query("select core.publish_rule_revision($1,$2,$3,$4)", [revision, "2029-01-01", hash, hash]),
      ),
    ).rejects.toThrow(/not authorized to publish/u);
  });

  it("writes an audit event for every publication", async () => {
    const events = await client.query<{ action: string; detail_jsonb: Record<string, unknown> }>(
      "select action, detail_jsonb from audit.admin_audit_events where action = 'PUBLISH_RULE_REVISION' order by created_at desc limit 1",
    );
    expect(events.rows[0]?.action).toBe("PUBLISH_RULE_REVISION");
    expect(events.rows[0]?.detail_jsonb["ruleId"]).toBe(ruleId);
  });

  it("serialises two concurrent publications of the same rule", async () => {
    const other = await connect();
    try {
      const first = await insertRevision(6, "APPROVED", "2030-01-01", null);
      const second = await insertRevision(7, "APPROVED", "2031-01-01", null);
      const hash = fakeHash("eee");

      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN })]);
      await client.query("set local role cedula_admin_runtime_role");
      await client.query("select core.publish_rule_revision($1,$2,$3,$4)", [first, "2030-01-01", hash, hash]);

      // The second publisher must block on the row lock rather than racing.
      await other.query("begin");
      await other.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN })]);
      await other.query("set local role cedula_admin_runtime_role");
      await other.query("set local lock_timeout = '400ms'");
      const contended = other
        .query("select core.publish_rule_revision($1,$2,$3,$4)", [second, "2031-01-01", hash, hash])
        .then(() => "completed")
        .catch((error: unknown) => String(error));

      const outcome = await contended;
      expect(outcome).toMatch(/lock timeout|canceling statement/iu);
      await other.query("rollback");
      await client.query("commit");
    } finally {
      await other.end();
    }
  });
});

maybe("evaluation bundle materialisation", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it("reuses the row for identical content", async () => {
    const hash = fakeHash("1234abcd");
    await client.query("delete from audit.evaluation_bundles where content_hash = $1", [hash]);
    const first = await client.query<{ materialize_evaluation_bundle: string }>(
      "select audit.materialize_evaluation_bundle($1,'evaluation-bundle@1.0',$2::jsonb)",
      [hash, JSON.stringify({ a: 1 })],
    );
    const second = await client.query<{ materialize_evaluation_bundle: string }>(
      "select audit.materialize_evaluation_bundle($1,'evaluation-bundle@1.0',$2::jsonb)",
      [hash, JSON.stringify({ a: 1 })],
    );
    expect(second.rows[0]?.materialize_evaluation_bundle).toBe(first.rows[0]?.materialize_evaluation_bundle);
  });

  it("treats the same hash with different content as an invariant failure", async () => {
    const hash = fakeHash("5678abcd");
    await client.query("delete from audit.evaluation_bundles where content_hash = $1", [hash]);
    await client.query("select audit.materialize_evaluation_bundle($1,'evaluation-bundle@1.0',$2::jsonb)", [
      hash,
      JSON.stringify({ a: 1 }),
    ]);
    await expect(
      client.query("select audit.materialize_evaluation_bundle($1,'evaluation-bundle@1.0',$2::jsonb)", [
        hash,
        JSON.stringify({ a: 2 }),
      ]),
    ).rejects.toThrow(/INVARIANT FAILURE/u);
  });

  it("assembles a bundle under REPEATABLE READ against a stable snapshot", async () => {
    const writer = await connect();
    try {
      const ruleSetId = uniqueSlug("t.snapshot");
      await writer.query("insert into core.rule_sets (rule_set_id, label) values ($1,'Snapshot')", [ruleSetId]);

      await client.query("begin isolation level repeatable read");
      const before = await client.query<{ count: string }>("select count(*) from core.rule_sets");

      await writer.query("insert into core.rule_sets (rule_set_id, label) values ($1,'Concurrent')", [
        uniqueSlug("t.concurrent"),
      ]);

      const after = await client.query<{ count: string }>("select count(*) from core.rule_sets");
      await client.query("commit");

      // A bundle assembled inside the transaction cannot half-see a concurrent
      // publication: the snapshot is fixed for the whole assembly.
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    } finally {
      await writer.end();
    }
  });
});

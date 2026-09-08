import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { ADMIN, asRole, connect, databaseAvailable, USER_A, USER_B, fakeHash } from "./db";

const maybe = databaseAvailable ? describe : describe.skip;

maybe("row level security matrix", () => {
  let client: pg.Client;
  let caseA = "";
  let caseB = "";
  let bundleId = "";

  beforeAll(async () => {
    client = await connect();
    await client.query("delete from app.user_cases where owner_user_id in ($1, $2)", [USER_A, USER_B]);
    await client.query(
      "insert into security.admin_authorizations (user_id, admin_role) values ($1, 'ADMIN'), ($1, 'PUBLISHER') on conflict do nothing",
      [ADMIN],
    );
    const a = await client.query<{ id: string }>(
      "insert into app.user_cases (owner_user_id, facts_schema_version, facts_jsonb) values ($1, 'user-case-facts@1.0', '{}') returning id",
      [USER_A],
    );
    const b = await client.query<{ id: string }>(
      "insert into app.user_cases (owner_user_id, facts_schema_version, facts_jsonb) values ($1, 'user-case-facts@1.0', '{}') returning id",
      [USER_B],
    );
    caseA = a.rows[0]?.id ?? "";
    caseB = b.rows[0]?.id ?? "";
    const bundle = await client.query<{ id: string }>(
      `insert into audit.evaluation_bundles (content_hash, schema_version, bundle_content_jsonb)
       values ($1, 'evaluation-bundle@1.0', '{"a":1}') on conflict (content_hash) do update set schema_version = excluded.schema_version returning id`,
      [fakeHash("abc123")],
    );
    bundleId = bundle.rows[0]?.id ?? "";
  });

  afterAll(async () => {
    await client.query("delete from app.user_cases where owner_user_id in ($1, $2)", [USER_A, USER_B]);
    await client.end();
  });

  it("lets an authenticated user read only their own case", async () => {
    const rows = await asRole(client, "authenticated", USER_A, async () =>
      (await client.query<{ id: string }>("select id from app.user_cases")).rows,
    );
    expect(rows.map((row) => row.id)).toEqual([caseA]);
  });

  it("denies an authenticated user another user's case (IDOR)", async () => {
    const rows = await asRole(client, "authenticated", USER_A, async () =>
      (await client.query("select id from app.user_cases where id = $1", [caseB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("refuses to let one user write into another user's case", async () => {
    await expect(
      asRole(client, "authenticated", USER_A, async () => {
        await client.query("update app.user_cases set facts_jsonb = '{\"x\":1}' where id = $1", [caseB]);
        const affected = await client.query("select facts_jsonb from app.user_cases where id = $1", [caseB]);
        expect(affected.rows).toEqual([]);
        return null;
      }),
    ).resolves.toBeNull();

    const untouched = await client.query<{ facts_jsonb: unknown }>(
      "select facts_jsonb from app.user_cases where id = $1",
      [caseB],
    );
    expect(untouched.rows[0]?.facts_jsonb).toEqual({});
  });

  it("refuses to let a user create a case owned by somebody else", async () => {
    await expect(
      asRole(client, "authenticated", USER_A, async () =>
        client.query(
          "insert into app.user_cases (owner_user_id, facts_schema_version, facts_jsonb) values ($1, 'user-case-facts@1.0', '{}')",
          [USER_B],
        ),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("gives anonymous users no access to any case", async () => {
    await expect(
      asRole(client, "anon", null, async () => client.query("select id from app.user_cases")),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("lets anonymous users read published knowledge", async () => {
    const rows = await asRole(client, "anon", null, async () =>
      (await client.query("select country_code from core.countries")).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("does not let a client insert an evaluation directly", async () => {
    await expect(
      asRole(client, "authenticated", USER_A, async () =>
        client.query(
          `insert into app.case_evaluations (owner_user_id, user_case_id, evaluated_at, jurisdiction_time_zone,
             effective_local_date, engine_version, input_schema_version, input_hash, input_snapshot_jsonb,
             evaluation_bundle_id, evaluation_schema_version, decision_jsonb)
           values ($1, $2, now(), 'America/Asuncion', current_date, '1.0.0', 'user-case-facts@1.0', $3, '{}', $4, 'case-evaluation-decision@1.0', '{}')`,
          [USER_A, caseA, fakeHash("dd"), bundleId],
        ),
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("writes an evaluation through the authorized server path and then refuses to change it", async () => {
    const evaluationId = await asRole(client, "authenticated", USER_A, async () => {
      const result = await client.query<{ record_case_evaluation: string }>(
        `select app.record_case_evaluation($1, now(), 'America/Asuncion', current_date, '1.0.0',
           'user-case-facts@1.0', $2, '{}'::jsonb, $3, 'case-evaluation-decision@1.0', '{}'::jsonb)`,
        [caseA, fakeHash("ee"), bundleId],
      );
      return result.rows[0]?.record_case_evaluation ?? "";
    });
    expect(evaluationId).not.toBe("");

    const readBack = await asRole(client, "authenticated", USER_A, async () =>
      (await client.query("select id from app.case_evaluations where id = $1", [evaluationId])).rows,
    );
    expect(readBack).toHaveLength(1);

    const otherUser = await asRole(client, "authenticated", USER_B, async () =>
      (await client.query("select id from app.case_evaluations where id = $1", [evaluationId])).rows,
    );
    expect(otherUser).toEqual([]);

    await expect(
      client.query("update app.case_evaluations set decision_jsonb = '{\"x\":1}' where id = $1", [evaluationId]),
    ).rejects.toThrow(/append-only/iu);
  });

  it("refuses to record an evaluation for a case the caller does not own", async () => {
    await expect(
      asRole(client, "authenticated", USER_B, async () =>
        client.query(
          `select app.record_case_evaluation($1, now(), 'America/Asuncion', current_date, '1.0.0',
             'user-case-facts@1.0', $2, '{}'::jsonb, $3, 'case-evaluation-decision@1.0', '{}'::jsonb)`,
          [caseA, fakeHash("ff"), bundleId],
        ),
      ),
    ).rejects.toThrow(/not authorized/iu);
  });

  it("erases a case with its evaluations and records the erasure without personal content", async () => {
    const caseId = (
      await client.query<{ id: string }>(
        "insert into app.user_cases (owner_user_id, facts_schema_version, facts_jsonb) values ($1, 'user-case-facts@1.0', '{}') returning id",
        [USER_A],
      )
    ).rows[0]?.id as string;

    await asRole(client, "authenticated", USER_A, async () =>
      client.query(
        `select app.record_case_evaluation($1, now(), 'America/Asuncion', current_date, '1.0.0',
           'user-case-facts@1.0', $2, '{"personal":"data"}'::jsonb, $3, 'case-evaluation-decision@1.0', '{}'::jsonb)`,
        [caseId, fakeHash("ab"), bundleId],
      ),
    );

    await asRole(client, "authenticated", USER_A, async () =>
      client.query("select app.erase_user_case($1)", [caseId]),
    );

    const remainingCases = await client.query("select id from app.user_cases where id = $1", [caseId]);
    const remainingEvaluations = await client.query("select id from app.case_evaluations where user_case_id = $1", [caseId]);
    expect(remainingCases.rows).toEqual([]);
    expect(remainingEvaluations.rows).toEqual([]);

    // The shared knowledge the evaluation referenced survives: destroying it
    // would make every other user's stored evaluation unexplainable.
    const bundle = await client.query("select id from audit.evaluation_bundles where id = $1", [bundleId]);
    expect(bundle.rows).toHaveLength(1);

    const journal = await client.query<Record<string, unknown>>(
      "select * from security.erasure_journal where deleted_subject_id = $1 order by erased_at desc limit 1",
      [USER_A],
    );
    expect(journal.rows[0]?.["operation_status"]).toBe("COMPLETED");
    expect(Object.keys(journal.rows[0] ?? {})).toEqual(
      expect.arrayContaining(["deleted_subject_id", "erased_at", "operation_status", "scope"]),
    );
    expect(JSON.stringify(journal.rows[0])).not.toContain("personal");
  });

  it("refuses to erase another user's case", async () => {
    const caseId = (
      await client.query<{ id: string }>(
        "insert into app.user_cases (owner_user_id, facts_schema_version, facts_jsonb) values ($1, 'user-case-facts@1.0', '{}') returning id",
        [USER_B],
      )
    ).rows[0]?.id as string;
    await expect(
      asRole(client, "authenticated", USER_A, async () => client.query("select app.erase_user_case($1)", [caseId])),
    ).rejects.toThrow(/not authorized/iu);
  });

  it("keeps the research, audit and security schemas out of reach of a browser session", async () => {
    for (const statement of [
      "select 1 from research.research_claims",
      "select 1 from audit.admin_audit_events",
      "select 1 from security.admin_authorizations",
      "select 1 from security.erasure_journal",
    ]) {
      await expect(
        asRole(client, "authenticated", USER_A, async () => client.query(statement)),
      ).rejects.toThrow(/permission denied/iu);
    }
  });
});

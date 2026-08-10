"use strict";

const {after, before, beforeEach, describe, test} = require("node:test");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {get, ref, set, update} = require("firebase/database");

const PROJECT_ID = "demo-drill-instructor";
const DATABASE_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const DATABASE_URL =
  `http://127.0.0.1:9000?ns=${DATABASE_NAMESPACE}`;

let testEnv;

function dbFor(uid) {
  return testEnv.authenticatedContext(uid).database(DATABASE_URL);
}

function anonymousDb() {
  return testEnv.unauthenticatedContext().database(DATABASE_URL);
}

async function seedDatabase() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.database(DATABASE_URL);
    await set(ref(database), {
      users: {
        alice: {
          uid: "alice-uid",
          firstName: "Alice",
          email: "alice@example.test",
          stats: {sessionOne: {correct: 8, attempted: 10}},
          testdata: {act: {license: {signature: "server-only"}}},
        },
      },
      educators: {
        teacher: {
          uid: "teacher-uid",
          schoolID: "school-one",
          approvalStatus: "approved",
        },
      },
      schools: {
        "school-one": {
          educatorDrills: {drillOne: {answerKey: "server-only"}},
        },
      },
      challenges: {
        challengeOne: {participantsCustomIds: {alice: true}},
      },
      studentDrills: {
        alice: {sessionOne: {answerKey: "server-only"}},
      },
      accessCodes: {monthly: {SECRET_CODE: true}},
      roles: {alice: "student"},
      designations: {"school-one": "educator"},
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {host: "127.0.0.1", port: 9000},
  });
});

beforeEach(async () => {
  await testEnv.clearDatabase();
  await seedDatabase();
});

after(async () => {
  await testEnv.cleanup();
});

describe("Realtime Database is server-only", () => {
  test("anonymous clients cannot read or write", async () => {
    const database = anonymousDb();
    await assertFails(get(ref(database)));
    await assertFails(set(ref(database, "users/anonymous"), {uid: "none"}));
  });

  test("students cannot directly read their own profile or history", async () => {
    const database = dbFor("alice-uid");
    await assertFails(get(ref(database, "users/alice")));
    await assertFails(get(ref(database, "users/alice/stats")));
    await assertFails(get(ref(database, "users/alice/testdata/act/license")));
  });

  test("students cannot directly edit profiles, roles, or licenses", async () => {
    const database = dbFor("alice-uid");
    await assertFails(update(ref(database, "users/alice"), {firstName: "Alicia"}));
    await assertFails(set(ref(database, "roles/alice"), "educator"));
    await assertFails(set(ref(database, "users/alice/testdata/act/license"), {
      signature: "forged",
    }));
  });

  test("educators cannot directly read profiles, schools, or drills", async () => {
    const database = dbFor("teacher-uid");
    await assertFails(get(ref(database, "educators/teacher")));
    await assertFails(get(ref(database, "schools/school-one")));
    await assertFails(get(ref(database, "schools/school-one/educatorDrills/drillOne")));
  });

  test("authenticated clients cannot bypass Functions for shared data", async () => {
    const database = dbFor("alice-uid");
    await assertFails(get(ref(database, "challenges/challengeOne")));
    await assertFails(get(ref(database, "studentDrills/alice/sessionOne")));
    await assertFails(get(ref(database, "designations/school-one")));
  });

  test("authenticated clients cannot read or consume access codes", async () => {
    const database = dbFor("alice-uid");
    await assertFails(get(ref(database, "accessCodes/monthly/SECRET_CODE")));
    await assertFails(set(ref(database, "accessCodes/monthly/SECRET_CODE"), false));
  });
});

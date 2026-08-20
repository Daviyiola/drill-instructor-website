# Riverview High School Demo Dataset

This scenario creates an isolated ACT demonstration school without modifying
existing users, schools, educators, or statistics.

## Scenario

- Seed ID: `riverview-v1`
- School ID: `riverview_demo_2026`
- School: Riverview High School, Tennessee, United States
- Timezone: `America/New_York`
- Content version: ACT `2026.08.4`
- Students: 14
- Educators: three regular educators and one superadmin
- Auth accounts: all four educators, Grace Holloway, and Ethan Brooks
- Profile emails: `firstname_lastname@riverview.demo` for all 18 identities
- Auth password: supplied locally through `RIVERVIEW_DEMO_PASSWORD`
- Group: Demo Squad, containing all 14 students
- Completed sessions: 255 at the fixed-anchor acceptance fixture
- Assignments: three
- Completed squad challenges: two, shared across Grace and Ethan

The scenario uses the active ACT question bank, `gradeSession()`,
`analyticsAttemptFromResult()`, canonical `statsIndex` attempts, compact Test
Records, and full `studentDrills` result snapshots. It never writes an
`analyticsAttempts` branch.

## Commands

Run these from the repository root.

```powershell
npm.cmd run demo:riverview -- --mode dry-run
$env:RIVERVIEW_DEMO_PASSWORD = "<choose-a-demo-password>"
npm.cmd run demo:riverview -- --mode seed --project drill-instructor-pro --apply --confirm RIVERVIEW_DEMO_V1
npm.cmd run demo:riverview -- --mode validate --project drill-instructor-pro
npm.cmd run demo:riverview -- --mode remove --project drill-instructor-pro --apply --confirm REMOVE_RIVERVIEW_DEMO_V1
```

Dry-run is the default. Seed and remove operations refuse to run without their
exact confirmation tokens. A rerun reuses the original production anchor. Use
`--reanchor` only when intentionally rebuilding the same owned scenario around
a new date.

## Local emulator validation

The Firebase configuration includes Database and Auth emulators. Use a local,
non-production license salt for the emulator only:

```powershell
$env:DEMO_LICENSE_SALT = "riverview-emulator-only-salt"
$env:RIVERVIEW_DEMO_PASSWORD = "<choose-a-demo-password>"
firebase.cmd emulators:exec --only database,auth --project demo-drill-instructor "npm.cmd run demo:riverview -- --mode seed --project demo-drill-instructor --apply --confirm RIVERVIEW_DEMO_V1"
```

To seed and validate during the same emulator lifetime:

```powershell
$env:DEMO_LICENSE_SALT = "riverview-emulator-only-salt"
$env:RIVERVIEW_DEMO_PASSWORD = "<choose-a-demo-password>"
firebase.cmd emulators:exec --only database,auth --project demo-drill-instructor "npm.cmd run demo:riverview -- --mode seed --project demo-drill-instructor --apply --confirm RIVERVIEW_DEMO_V1 && npm.cmd run demo:riverview -- --mode validate --project demo-drill-instructor"
```

## Local private artifacts

The tool creates these ignored files:

- `.demo-seed/riverview-v1-credentials.json`
- `.demo-seed/riverview-v1-report.json`
- `.demo-seed/riverview-v1-<project>-preseed-backup.json`

`LICENSE_SALT` is never printed. The credential file remains the canonical
account handoff and must not be committed or shared in a public channel.

## Safety behavior

- The local ACT version must equal `2026.08.4`.
- Production seeding additionally requires the active content registry to
  equal `2026.08.4`.
- Existing RTDB paths are rejected unless the seed manifest already owns them.
- Existing Auth UIDs are rejected unless their custom claims identify this
  seed.
- RTDB data is written one bounded root at a time.
- `demoSeeds/riverview-v1` records the exact owned paths and Auth UIDs.
- Removal deletes only those manifest-owned paths and Auth users.
- Student and educator registration is closed for this fictional school.
- The school is excluded from public discovery but contributes to Tennessee
  and United States rankings. Set the Riverview unit's
  `platoonPermissions` to `false` to exclude those points again without
  reopening registration.

## Expected demo narrative

- School-wide accuracy remains in the 74–79% range.
- Reading → Inference and Implication at a 60% threshold reports 10 meeting,
  three below, and one no-data student.
- Grace improves across the old, middle, and recent periods.
- Grace has a current Mathematics coaching signal (60.4% across 53 recent
  attempts) so subject-level Suggested Practice is demonstrable.
- Caleb declines recently in Mathematics.
- Zoe and Noah expose different Science weaknesses.
- Priya falls below the overall comprehension threshold.
- Lena has naturally insufficient evidence and Owen has no evidence.
- The active Science assignment supplies a legitimate pending-score example.

# QML to Web Route and API Inventory

Last updated: 2026-07-24

This is the working contract map for the migration. The web route names are
stable targets; implementation advances one student vertical slice at a time.

## Shared onboarding and account routing

| QML workflow | Current backend/data | Web target | Migration state |
|---|---|---|---|
| `Onboard/SignInPage.qml` | Firebase Authentication REST, `resolveSignInAccountHttps` | `/app/sign-in` | Foundation implemented with Firebase Web SDK |
| `Onboard/ForgotPassword.qml` | Firebase Authentication REST | `/app/sign-in` reset action | Foundation implemented |
| `Onboard/StudentSignUp.qml` | Firebase Auth plus `bootstrapAccountHttps` | `/app/register` | Planned |
| `Onboard/InstructorSignUp.qml` | Firebase Auth plus `bootstrapEducatorAccountHttps` | `/app/educator/register` | Deferred until educator phase |
| `Instructor/PendingApproval.qml` | Direct approval polling plus `checkEducatorApprovalStatusHttps` | `/app/educator/pending` | Deferred until educator phase |

## Student experience

| QML workflow | Current/new backend | Web target | Migration state |
|---|---|---|---|
| `Shared/Bootcamps.qml` | `getMyBootcampsHttps`, `setBootcampVisibilityHttps` | `/app` | Read foundation implemented; management next |
| `Student/Bootcamps/Home.qml` | Local streak cache and bootcamp metadata | `/app/bootcamps/[bootcamp]` | Implemented student foundation |
| `Student/Bootcamps/Drills.qml` | New server drill catalog/create APIs | `/app/bootcamps/[bootcamp]/drills` | Implemented |
| `Student/Bootcamps/Questions.qml` | New session/progress/submit APIs | `/app/drills/[sessionId]` | Implemented with autosave/resume |
| `Student/Bootcamps/Results.qml` | Result, squad profile, and challenge APIs | `/app/drills/[sessionId]/results` | Implemented with post-test squad challenge sending |
| `Student/Bootcamps/Review.qml` | Result and bookmark APIs | `/app/drills/[sessionId]/corrections` | Implemented as a separate filterable view |
| `Student/Bootcamps/TestRecords.qml` | `getStudentDrillHistoryHttps`, `statsIndex`, `stats` fallback | `/app/bootcamps/[bootcamp]/records` | Implemented |
| `Student/Bootcamps/TestandBookmarks.qml` | Bookmark, result, squad profile, and challenge APIs | `/app/bootcamps/[bootcamp]/bookmarks` | Implemented with search, groups, filters, flashcards, and challenge-deck foundation |
| `Student/Bootcamps/Analytics.qml` | Existing stats plus future projection API | `/app/progress` | Planned |
| `Student/Bootcamps/Subscriptions.qml` | Subscription/access-code Functions | `/app/bootcamps/[bootcamp]/access` | Planned |
| `Student/UserProfile.qml` | Owner profile read and limited direct edits | `/app/profile` | Planned; edits should move to a Function |
| `Shared/Ranks.qml` | User rank and points data | `/app/ranks` | Implemented with Recruit-to-General progression |
| `Shared/Leaderboards.qml` | Squad membership/profile APIs and `getUnitRankingsHttps` | `/app/leaderboards` | Implemented with squad discovery and Squad/Battalion/Corps views |
| `Student/Bootcamps/SquadDrills.qml` | Participant-scoped challenge list/detail/session APIs plus existing decision/completion Functions | `/app/bootcamps/[bootcamp]/squad` | Incoming/accepted/completed student flow implemented |

## Server-owned student drill contract

The web client must use these endpoints rather than shipping question banks or
answer keys:

1. `getStudentDrillCatalogHttps`
2. `createStudentDrillHttps`
3. `getStudentDrillSessionHttps`
4. `saveStudentDrillProgressHttps`
5. `submitStudentDrillHttps`
6. `getStudentDrillResultHttps`
7. `getStudentDrillHistoryHttps`
8. `setStudentBookmarkHttps`
9. `getStudentBookmarksHttps`
10. `setStudentBookmarkGroupsHttps`
11. `getStudentChallengesHttps`
12. `getStudentChallengeHttps`
13. `createStudentChallengeSessionHttps`

## Educator experience

The educator routes will live under `/app/educator`. Existing Functions already
cover approval, roster, groups, drill drafts, assignment publishing,
submissions, and analytics. Their UI migration begins only after the complete
student experience is functional.

## Direct RTDB retirement list

- Keep owner profile/status reads temporarily for released QML compatibility.
- Move student and educator profile edits behind authenticated Functions.
- Migrate the QML challenge inbox/detail/scoreboard reads to the new
  participant-scoped challenge APIs, then make raw `challenges`,
  `challengeResults`, and `userChallenges` reads server-only.
- Never expose `studentDrills`, access codes, rate limits, UID mappings, answer
  keys, license state, or grading records directly to the web client.


const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {applicationDefault} = require("firebase-admin/app");

const admin = require("firebase-admin");

const CHALLENGE_SIGNING_SECRET = defineSecret("CHALLENGE_SIGNING_SECRET");
const LICENSE_SALT = defineSecret("LICENSE_SALT");
const CONTENT_PACK_GRANT_SECRET = defineSecret("CONTENT_PACK_GRANT_SECRET");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const SUPPORT_FROM_EMAIL = defineSecret("SUPPORT_FROM_EMAIL");
const SUPPORT_TO_EMAIL = defineSecret("SUPPORT_TO_EMAIL");

admin.initializeApp({
  credential: applicationDefault(), // optional if already configured in env
  databaseURL: "https://drill-instructor-pro-default-rtdb.firebaseio.com/",
  storageBucket: "drill-instructor-pro.firebasestorage.app",
});

const publicStudentOptions = {
  cors: true,
  cpu: "gcf_gen1",
  invoker: "public",
  maxInstances: 1,
  memory: "256MiB",
  region: "us-central1",
  timeoutSeconds: 60,
};

exports.verifyAccessCodeHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [LICENSE_SALT, RESEND_API_KEY, SUPPORT_FROM_EMAIL],
      timeoutSeconds: 90,
    },
    require("./handlers/verifyAccessCodeHttps"),
);

exports.sendAccountVerificationHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [RESEND_API_KEY, SUPPORT_FROM_EMAIL],
    },
    require("./handlers/sendAccountVerificationHttps").handler,
);

exports.createChallengeHttps = onRequest(
    {secrets: [CHALLENGE_SIGNING_SECRET,
      LICENSE_SALT],
    region: "us-central1",
    timeoutSeconds: 60},
    require("./handlers/createChallengeHttps").handler,
);

exports.acceptChallengeHttps = onRequest(
    {secrets: [LICENSE_SALT],
      region: "us-central1",
      timeoutSeconds: 60},
    require("./handlers/acceptChallengeHttps").handler,
);

exports.decideChallengeHttps = onRequest(
    {secrets: [LICENSE_SALT],
      region: "us-central1",
      timeoutSeconds: 60},
    require("./handlers/decideChallengeHttps").handler,
);

exports.completeChallengeHttps = onRequest(
    {
      cors: true,
      cpu: "gcf_gen1",
      invoker: "public",
      maxInstances: 1,
      memory: "256MiB",
      secrets: [CHALLENGE_SIGNING_SECRET, LICENSE_SALT],
      region: "us-central1",
      timeoutSeconds: 60,
    },
    require("./handlers/completeChallengeHttps").handler,
);

exports.submitSessionSnapshotHttps = onRequest(
    {secrets: [LICENSE_SALT],
      region: "us-central1",
      timeoutSeconds: 30},
    require("./handlers/submitSessionSnapshotHttps").handler,
);

exports.bootstrapAccountHttps = onRequest(
    {region: "us-central1", timeoutSeconds: 60},
    require("./handlers/bootstrapAccountHttps").handler,
);

exports.bootstrapEducatorAccountHttps = onRequest(
    {region: "us-central1", timeoutSeconds: 60},
    require("./handlers/bootstrapEducatorAccountHttps").handler,
);

exports.resolveSignInAccountHttps = onRequest(
    {
      cors: true,
      invoker: "public",
      region: "us-central1",
      timeoutSeconds: 60,
      memory: "256MiB",
      cpu: 1,
      concurrency: 40,
      maxInstances: 5,
    },
    require("./handlers/resolveSignInAccountHttps").handler,
);

exports.submitSupportRequestHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [RESEND_API_KEY, SUPPORT_FROM_EMAIL, SUPPORT_TO_EMAIL],
    },
    require("./handlers/submitSupportRequestHttps").handler,
);

const studentSocialOptions = publicStudentOptions;

exports.searchUsersByPrefixHttps = onRequest(
    studentSocialOptions,
    require("./handlers/searchUsersByPrefixHttps").handler,
);

exports.getMySquadMemberIdsHttps = onRequest(
    studentSocialOptions,
    require("./handlers/getMySquadMemberIdsHttps").handler,
);

exports.getSquadProfilesHttps = onRequest(
    studentSocialOptions,
    require("./handlers/getSquadProfilesHttps").handler,
);

exports.addSquadMemberHttps = onRequest(
    studentSocialOptions,
    require("./handlers/addSquadMemberHttps").handler,
);

exports.removeSquadMemberHttps = onRequest(
    studentSocialOptions,
    require("./handlers/removeSquadMemberHttps").handler,
);

exports.cleanupExpiredChallenges =
  require("./handlers/cleanupExpiredChallenges").cleanupExpiredChallenges;

exports.aggregateUnitPoints =
  require("./handlers/aggregateUnitPoints").aggregateUnitPoints;

exports.listSchoolsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/listSchoolsHttps").handler,
);

exports.joinUnitHttps = onRequest(
    publicStudentOptions,
    require("./handlers/joinUnitHttps").handler,
);

exports.getEducatorRosterHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorRosterHttps").handler,
);

exports.getEducatorWorkspaceHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorWorkspaceHttps").handler,
);

exports.updateEducatorProfileHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateEducatorProfileHttps").handler,
);

exports.createEducatorGroupHttps = onRequest(
    publicStudentOptions,
    require("./handlers/createEducatorGroupHttps").handler,
);

exports.updateEducatorGroupHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateEducatorGroupHttps").handler,
);

exports.deleteEducatorGroupHttps = onRequest(
    publicStudentOptions,
    require("./handlers/deleteEducatorGroupHttps").handler,
);

exports.getSchoolAdminSnapshotHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getSchoolAdminSnapshotHttps").handler,
);

exports.updateSchoolEducatorAccessHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateSchoolEducatorAccessHttps").handler,
);

exports.getSchoolAdminAuditLogsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getSchoolAdminAuditLogsHttps").handler,
);

exports.getEducatorAnalyticsGatewayHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorAnalyticsGatewayHttps").handler,
);

exports.getEducatorStudentAnalyticsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorStudentAnalyticsHttps").handler,
);

exports.getEducatorGroupAnalyticsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorGroupAnalyticsHttps").handler,
);

exports.getEducatorDrillsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorDrillsHttps").handler,
);

exports.setEducatorDrillArchivedHttps = onRequest(
    publicStudentOptions,
    require("./handlers/setEducatorDrillArchivedHttps").handler,
);

exports.getEducatorDrillDraftHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorDrillDraftHttps").handler,
);

exports.duplicateEducatorDrillHttps = onRequest(
    publicStudentOptions,
    require("./handlers/duplicateEducatorDrillHttps").handler,
);

exports.saveEducatorDrillDraftHttps = onRequest(
    publicStudentOptions,
    require("./handlers/saveEducatorDrillDraftHttps").handler,
);

exports.deleteEducatorDrillDraftHttps = onRequest(
    publicStudentOptions,
    require("./handlers/deleteEducatorDrillDraftHttps").handler,
);

exports.publishEducatorDrillAssignmentHttps = onRequest(
    {...publicStudentOptions, timeoutSeconds: 120},
    require("./handlers/publishEducatorDrillAssignmentHttps").handler,
);

exports.getStudentEducatorDrillAssignmentsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getStudentEducatorDrillAssignmentsHttps").handler,
);

exports.getStudentEducatorDrillAssignmentHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getStudentEducatorDrillAssignmentHttps").handler,
);

exports.submitEducatorDrillAttemptHttps = onRequest(
    publicStudentOptions,
    require("./handlers/submitEducatorDrillAttemptHttps").handler,
);

exports.getEducatorDrillSubmissionsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorDrillSubmissionsHttps").handler,
);

exports.getEducatorDrillAnalyticsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorDrillAnalyticsHttps").handler,
);

exports.getEducatorDrillSubmissionDetailHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getEducatorDrillSubmissionDetailHttps").handler,
);

exports.deleteAccountHttps = onRequest(
    publicStudentOptions,
    require("./handlers/deleteAccountHttps").handler,
);

exports.updateStudentProfileHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateStudentProfileHttps").handler,
);

exports.syncStudentSessionSnapshotsHttps = onRequest(
    {region: "us-central1", timeoutSeconds: 60},
    require("./handlers/syncStudentSessionSnapshotsHttps").handler,
);

exports.updateEducatorDrillSettingsHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateEducatorDrillSettingsHttps").handler,
);

exports.updateEducatorDrillStatusHttps = onRequest(
    publicStudentOptions,
    require("./handlers/updateEducatorDrillStatusHttps").handler,
);

exports.releaseEducatorAssignmentHttps = onRequest(
    publicStudentOptions,
    require("./handlers/releaseEducatorAssignmentHttps").handler,
);

exports.getStudentEducatorDrillResultHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getStudentEducatorDrillResultHttps").handler,
);

exports.checkEducatorApprovalStatusHttps = onRequest(
    {
      region: "us-central1",
      timeoutSeconds: 60,
    },
    require("./handlers/checkEducatorApprovalStatusHttps").handler,
);

exports.getSubscriptionStatusHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [LICENSE_SALT],
    },
    require("./handlers/getSubscriptionStatusHttps"),
);

exports.createStripeCheckoutSessionHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [STRIPE_SECRET_KEY],
      timeoutSeconds: 90,
    },
    require("./handlers/createStripeCheckoutSessionHttps").handler,
);

exports.createStripeBillingPortalSessionHttps = onRequest(
    {
      ...publicStudentOptions,
      secrets: [STRIPE_SECRET_KEY],
    },
    require("./handlers/createStripeBillingPortalSessionHttps").handler,
);

exports.getStudentSubscriptionHistoryHttps = onRequest(
    publicStudentOptions,
    require("./handlers/getStudentSubscriptionHistoryHttps").handler,
);

exports.stripeWebhookHttps = onRequest(
    {
      ...publicStudentOptions,
      cors: false,
      secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, LICENSE_SALT,
        RESEND_API_KEY, SUPPORT_FROM_EMAIL],
      timeoutSeconds: 90,
    },
    require("./handlers/stripeWebhookHttps").handler,
);

exports.reconcileStripeSubscriptions =
  require("./handlers/reconcileStripeSubscriptions")
      .reconcileStripeSubscriptions;

exports.getMyBootcampsHttps = onRequest(
    {
      cors: true,
      region: "us-central1",
      timeoutSeconds: 60,
    },
    require("./handlers/getMyBootcampsHttps"),
);

exports.setBootcampVisibilityHttps = onRequest(
    {
      cors: true,
      region: "us-central1",
      timeoutSeconds: 60,
    },
    require("./handlers/setBootcampVisibilityHttps"),
);

exports.getUnitRankingsHttps = onRequest(
    {
      region: "us-central1",
      timeoutSeconds: 60,
    },
    require("./handlers/getUnitRankingsHttps").handler,
);

exports.closeExpiredEducatorDrills =
    require("./handlers/closeExpiredEducatorDrills")
        .closeExpiredEducatorDrills;

const studentDrills = require("./handlers/studentDrillsHttps");
const studentChallenges = require("./handlers/studentChallengesHttps");
const studentContentPacks = require("./handlers/studentContentPacksHttps");
const educatorQuestionBank = require("./handlers/educatorQuestionBankHttps");
const educatorBookmarks = require("./handlers/educatorBookmarksHttps");
const studentDrillOptions = {
  cors: true,
  cpu: "gcf_gen1",
  invoker: "public",
  // Bookmark/history views can legitimately issue a couple of parallel reads
  // during a native or web refresh. Keep single-request CPU semantics but do
  // not reject those reads before their CORS handler can run.
  maxInstances: 3,
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "512MiB",
};
const studentDrillLicensedOptions = {
  ...studentDrillOptions,
  secrets: [LICENSE_SALT],
};

exports.getStudentDrillCatalogHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.getCatalog,
);

exports.createStudentDrillHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.createDrill,
);

exports.getStudentDrillSessionHttps = onRequest(
    studentDrillOptions,
    studentDrills.getSession,
);

exports.saveStudentDrillProgressHttps = onRequest(
    studentDrillOptions,
    studentDrills.saveProgress,
);

exports.submitStudentDrillHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.submitDrill,
);

exports.getStudentDrillResultHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.getResult,
);

exports.getStudentDrillHistoryHttps = onRequest(
    studentDrillOptions,
    studentDrills.getHistory,
);

exports.getStudentAnalyticsHttps = onRequest(
    studentDrillOptions,
    require("./handlers/getStudentAnalyticsHttps").handler,
);

exports.setStudentBookmarkHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.setBookmark,
);

exports.getStudentBookmarksHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.getBookmarks,
);

exports.setStudentBookmarkGroupsHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.setBookmarkGroups,
);

exports.deleteStudentBookmarkGroupHttps = onRequest(
    studentDrillLicensedOptions,
    studentDrills.deleteBookmarkGroup,
);

exports.getStudentChallengesHttps = onRequest(
    studentDrillLicensedOptions,
    studentChallenges.getChallenges,
);

exports.getStudentChallengeHttps = onRequest(
    studentDrillLicensedOptions,
    studentChallenges.getChallenge,
);

exports.reinviteStudentChallengeParticipantHttps = onRequest(
    studentDrillLicensedOptions,
    studentChallenges.reinviteParticipant,
);

exports.createStudentChallengeSessionHttps = onRequest(
    studentDrillLicensedOptions,
    studentChallenges.createChallengeSession,
);

exports.createStudentAssignmentSessionHttps = onRequest(
    studentDrillOptions,
    require("./handlers/studentAssignmentsHttps").createAssignmentSession,
);

exports.getStudentContentPackHttps = onRequest(
    {
      ...studentDrillOptions,
      secrets: [LICENSE_SALT, CONTENT_PACK_GRANT_SECRET],
      timeoutSeconds: 90,
    },
    studentContentPacks.getContentPack,
);

exports.submitOfflineStudentDrillHttps = onRequest(
    {
      ...studentDrillOptions,
      secrets: [CONTENT_PACK_GRANT_SECRET],
      timeoutSeconds: 120,
    },
    studentContentPacks.submitOfflineDrill,
);

exports.getEducatorQuestionBankHttps = onRequest(
    {...studentDrillOptions, timeoutSeconds: 90},
    educatorQuestionBank.getQuestionBank,
);

exports.buildEducatorDrillBlueprintHttps = onRequest(
    {...studentDrillOptions, timeoutSeconds: 90},
    educatorQuestionBank.buildBlueprint,
);

exports.getEducatorBookmarksHttps = onRequest(
    studentDrillOptions,
    educatorBookmarks.getBookmarks,
);

exports.setEducatorBookmarkHttps = onRequest(
    studentDrillOptions,
    educatorBookmarks.setBookmark,
);

exports.setEducatorBookmarkGroupsHttps = onRequest(
    studentDrillOptions,
    educatorBookmarks.setBookmarkGroups,
);

exports.deleteEducatorBookmarkGroupHttps = onRequest(
    studentDrillOptions,
    educatorBookmarks.deleteBookmarkGroup,
);

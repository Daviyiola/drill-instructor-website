export interface LegalSection {
  title: string;
  body: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  introduction: string[];
  sections: LegalSection[];
}

export const termsDocument: LegalDocument = {
  title: "Terms of Use",
  updated: "August 18, 2026",
  introduction: [
    "These Terms of Use govern your access to and use of Drill Instructor, a service of Davola Technologies LLC, including our websites, mobile applications, question banks, assignments, analytics, social practice features, subscriptions, and related services.",
    "By creating an account, accessing the service, redeeming an access code, joining a school, completing practice, or assigning work, you agree to these Terms and our Privacy Policy. If you do not agree, do not use Drill Instructor.",
  ],
  sections: [
    {title: "1. The Service", body: [
      "Drill Instructor is an educational exam-preparation platform. Students can build and complete practice drills, review permitted results, save bookmarks, participate in friendly challenges, and track progress. Authorized educators and schools can create assignments, manage groups, monitor submissions, and review performance.",
      "The service may support different exam tracks and may change as content and features are added. Drill Instructor is not an official testing body and does not guarantee a test score, admission decision, scholarship, certification, placement, or other academic outcome.",
    ]},
    {title: "2. Eligibility, Minors, and Authority", body: [
      "You must be legally able to agree to these Terms. Direct-to-consumer accounts are not intended for children under 13. A child under 13 may use Drill Instructor only through a school-authorized or parent- or guardian-authorized arrangement that satisfies applicable law.",
      "If you accept these Terms for a child, school, or organization, you confirm that you have authority to do so. Schools are responsible for obtaining required notices, permissions, or consents and for using student data only for authorized educational purposes.",
    ]},
    {title: "3. Accounts and Verification", body: [
      "Provide accurate information, keep your credentials secure, and notify us if you suspect unauthorized access. You may not impersonate another person, share credentials to evade account controls, or access another user's account without authorization.",
      "Some actions require a verified email address. Educator access may also require a valid school code, school approval, and assigned permissions. Account features may vary by role, school authorization, bootcamp access, subscription, device, or region.",
    ]},
    {title: "4. Schools, Educators, and Assignments", body: [
      "Educators and administrators must have a legitimate educational reason and sufficient permission to access a student, group, assignment, submission, or analytics view. Schools must keep rosters and educator permissions accurate and promptly remove access that is no longer appropriate.",
      "Assignments may include due dates, timers, question order, attempt limits, and separate score and correction release rules. A student may see an assignment score or corrections only when the applicable release rule allows it. Closing an assignment, late submission, or offline completion may affect how and when a result appears.",
    ]},
    {title: "5. Practice, Scoring, and Estimated Readiness", body: [
      "Drill Instructor may calculate scores, accuracy, points, timing, pace, coverage, streaks, subject and module performance, and recommendations. Accuracy generally uses answered questions rather than unanswered questions unless a feature expressly states otherwise.",
      "The Drill Instructor Readiness Index (DIRI) is an estimated readiness measure based on recent practice evidence. It is not an official score prediction, professional assessment, or guarantee. Analytics can be incomplete, delayed, or affected by limited sample size, device timing, offline synchronization, content changes, or user behavior, and must not be the sole basis for a high-stakes academic decision.",
    ]},
    {title: "6. Social Features and Privacy Choices", body: [
      "Students may choose who can send friendly challenges, create squads, block accounts, and control profile discovery. Challenge participants may see participant identity, completion status, and aggregate performance made available by the feature, but not another student's complete question-by-question answers unless separately authorized.",
      "Making a profile private removes it from supported discovery and public or unit leaderboard views. It does not automatically remove existing squad relationships, shared challenge history, or information already visible within an active shared activity. Blocking prevents supported search, squad invitations, and new challenges between the accounts, but may not erase historical records that must remain for integrity or safety.",
    ]},
    {title: "7. Points, Ranks, and Leaderboards", body: [
      "Points, military-themed ranks, squads, battalions, corps, streaks, and leaderboards are motivational features with no cash value. We may correct, recalculate, delay, reset, restrict, or remove them to address errors, abuse, fairness, content changes, or product updates.",
    ]},
    {title: "8. Offline Use and Synchronization", body: [
      "The native app may download content packs and store active drills, answers, bookmarks, images, provisional results, and pending submissions on a device. A locally graded result remains provisional until the server accepts and grades the submission. Server-confirmed records control cloud analytics, DIRI, points, streaks, and rankings.",
      "Offline data may be lost if an app is uninstalled, device storage is cleared, files are removed, or a device fails. You should reconnect periodically so pending work can synchronize. We do not guarantee that every feature, assignment, challenge, correction, or content update is available offline.",
    ]},
    {title: "9. Subscriptions, Access Codes, and Billing", body: [
      "Plans may be offered monthly, annually, through a school or vendor, by access code, or through a platform store. Features, prices, taxes, renewal terms, and availability may vary by bootcamp, platform, country, promotion, or agreement.",
      "Subscriptions continue until canceled through the provider that billed them. Cancellation normally stops renewal while access continues through the paid period. Refunds are governed by the payment provider, applicable law, and the remaining entitlement state. Deleting a Drill Instructor account does not automatically cancel an Apple App Store or Google Play subscription.",
      "Access codes may be limited by bootcamp, duration, school, role, region, activation count, or expiration. Codes may be revoked if duplicated, resold without authorization, fraudulently obtained, or misused. Redeemed codes are non-refundable unless applicable law or a written agreement requires otherwise.",
    ]},
    {title: "10. Content and Intellectual Property", body: [
      "Drill Instructor and its licensors retain their rights in the software, branding, designs, question-bank compilations, original questions, explanations, passages, images, analytics systems, and other proprietary materials. Exam names and third-party marks belong to their respective owners; their use does not imply endorsement or affiliation.",
      "You receive a limited, personal, non-exclusive, non-transferable right to use the service for permitted educational purposes. You may not scrape, bulk export, reproduce, publish, sell, sublicense, reverse engineer, defeat access controls, or build a competing question bank or service from protected content without written permission.",
    ]},
    {title: "11. Content You Provide", body: [
      "You retain rights you hold in content you provide, such as drill titles, instructions, group names, support messages, and responses. You grant us a limited license to host, process, transmit, display, analyze, and retain that content as needed to operate, secure, support, and improve the service and fulfill school instructions.",
      "Do not submit unlawful, abusive, discriminatory, sexually explicit, infringing, deceptive, harassing, or harmful content, or personal information you are not authorized to provide.",
    ]},
    {title: "12. Acceptable Use", body: [
      "Do not bypass assignment or subscription controls, manipulate points or rankings, harass or repeatedly target another user, interfere with the service, probe for vulnerabilities, upload harmful code, scrape content, misuse access codes, expose student information, or use Drill Instructor for fraud, unlawful conduct, or academic dishonesty.",
    ]},
    {title: "13. Third-Party Services and Platforms", body: [
      "We use service providers for functions such as authentication, hosting, databases, file storage, email, payments, app distribution, and diagnostics. Their services may be governed by additional terms. Apple, Google, Stripe, and other payment or distribution providers are responsible for the transactions and platform services they provide.",
    ]},
    {title: "14. Account Deletion, Suspension, and Termination", body: [
      "You may initiate account deletion in the app or at drillinstructorprep.com/account-deletion. Deletion is permanent once completed. You remain responsible for canceling externally billed subscriptions. Some records may be retained where required for law, billing, fraud prevention, security, dispute resolution, backups, or school-controlled education records, as explained in the Privacy Policy.",
      "We may restrict or terminate access for violations, security risk, fraud, nonpayment, abuse, school revocation, legal requirements, or harm to users or the service. Schools may request removal of accounts or permissions connected to them.",
    ]},
    {title: "15. Availability and Changes", body: [
      "The service may be interrupted, delayed, inaccurate, or unavailable because of maintenance, networks, devices, content updates, third-party providers, bugs, or circumstances outside our control. We may add, change, or discontinue features, content, plans, and supported platforms.",
      "We may revise these Terms. If a change is material, we will provide notice where required. The updated Terms apply from their stated effective date; continued use after that date means you accept them.",
    ]},
    {title: "16. Disclaimers and Liability", body: [
      "Drill Instructor is provided on an 'as is' and 'as available' basis. To the fullest extent permitted by law, we disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, availability, and reliability.",
      "To the fullest extent permitted by law, Davola Technologies LLC and its personnel and providers are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, including lost data, educational opportunity, test outcomes, profits, or reputation. Our aggregate liability for claims relating to the service will not exceed the amount paid for the affected service during the preceding 12 months, or $100 if no amount was paid directly, except where applicable law does not permit that limitation.",
    ]},
    {title: "17. Governing Law", body: [
      "These Terms are governed by the laws of Tennessee, USA, without regard to conflict-of-law principles, unless applicable law requires otherwise. Disputes will be brought in a court with jurisdiction in Tennessee unless a written agreement or applicable law provides otherwise.",
    ]},
    {title: "18. Contact", body: [
      "Questions about these Terms may be sent to Davola Technologies LLC at support@drillinstructorprep.com.",
    ]},
  ],
};

export const privacyDocument: LegalDocument = {
  title: "Privacy Policy",
  updated: "August 18, 2026",
  introduction: [
    "This Privacy Policy explains how Davola Technologies LLC collects, uses, stores, discloses, and protects information through Drill Instructor's websites, mobile applications, school tools, and related services.",
    "Drill Instructor serves students, educators, and schools. We do not sell personal information, use student information for targeted advertising, or allow third-party behavioral advertising in student accounts.",
  ],
  sections: [
    {title: "1. Scope and Responsibility", body: [
      "This Policy applies to Drill Instructor services that link to it. It does not govern an app store, payment processor, school system, or third-party site operating under its own policy.",
      "Davola Technologies LLC generally operates Drill Instructor. When a school directs how school-connected education records are used, the school may be responsible for those records and we process them to provide the authorized educational service.",
    ]},
    {title: "2. Information We Collect", body: [
      "Account and profile information may include name, email address, account identifier, authentication and verification status, role, avatar, school and unit affiliations, privacy settings, challenge preferences, blocked-account relationships, educator approval, and access permissions.",
      "Learning information may include bootcamps, subjects, modules and practice tests selected; session and assignment identifiers; questions attempted; selected answers; correct, incorrect, and unanswered counts; scores; accuracy; timing; activity dates; points; streaks; ranks; bookmarks; test records; challenges; assignments; release status; and analytics such as DIRI.",
      "School and educator information may include school identity, plans and seats, rosters, groups, educator permissions, drill drafts and blueprints, assignments, recipients, due dates, submissions, release actions, and administrative audit records.",
      "Subscription information may include provider, bootcamp, plan, status, entitlement dates, access-code activation, transaction identifiers, and limited billing metadata. Stripe, Apple, Google, or another provider processes payment details; we do not ordinarily receive full card numbers or store credentials.",
      "Technical and support information may include app and operating-system version, device type, timestamps, request and security logs, IP-derived network information, sync and content-pack status, error or diagnostic details, and the contents of support requests and attachments you choose to provide.",
    ]},
    {title: "3. How Information Is Collected", body: [
      "We collect information you enter, activity generated while you use the service, records supplied or authorized by a school, data returned by authentication and payment providers, and technical information produced when our apps communicate with our servers.",
      "The native app also creates local SQLite records and files to support offline practice, downloaded content, cached images, bookmarks, resumable sessions, provisional results, and queued synchronization.",
    ]},
    {title: "4. How We Use Information", body: [
      "We use information to register and verify accounts; authenticate users; deliver questions and content packs; save progress; grade submissions; provide results, corrections, bookmarks, challenges, points, ranks, streaks, analytics, and DIRI; manage school rosters and permissions; operate assignments and release controls; process entitlements; respond to support; send service messages; secure and troubleshoot the service; prevent abuse; enforce our Terms; and comply with law.",
      "We may use aggregated or de-identified information to understand performance, calibrate educational metrics, improve content and reliability, and plan product features. We do not attempt to re-identify information that has been properly de-identified.",
    ]},
    {title: "5. Student and School Data", body: [
      "Authorized educators may see assignment recipients, progress, submissions, selected answers, scores, timing, subject and module breakdowns, and question-level performance for assignments they are permitted to manage. Student-facing scores and corrections remain subject to the assignment's release settings.",
      "A student's separate school-learning permission controls whether the joined school may assign work and view supported learning analytics outside the school's own submitted assignments. Profile discovery is a different setting and does not expose private answers or detailed analytics.",
      "Educator access is limited by school approval and configured bootcamp, subject, student, group, or administrative scope. Schools are responsible for granting appropriate access and telling us when it should change.",
    ]},
    {title: "6. Social Features, Rankings, and Blocking", body: [
      "When profile discovery is enabled, supported search and leaderboard features may display limited profile information such as your name, rank image, school where available, and ranking position. Battalion and corps views may display aggregated unit standings.",
      "A private profile is excluded from supported discovery and public or unit leaderboards, but existing squad members may continue to see the profile and changing rank within their squad. Friendly challenge participants may see names, completion status, and aggregate subject or module results. They do not receive another participant's full question-by-question answers through the challenge view.",
      "Challenge preferences control who may send new challenges. Blocking an account prevents supported discovery, squad invitations, and new challenges between those users. Historical challenge or moderation records may remain where needed for integrity, safety, or dispute handling.",
    ]},
    {title: "7. Local Storage, Downloads, and Offline Sync", body: [
      "Downloaded content packs, cached question assets, active drill snapshots, answers, flags, bookmarks, settings, provisional results, and pending submissions may remain on a device. Downloaded paid content can remain stored after an entitlement ends, although paid practice may be locked until access is renewed.",
      "When connectivity returns, the app may send queued submissions and bookmark changes to our servers. Server grading and canonical records may replace provisional local results. Analytics, DIRI, points, streaks, and rankings generally update after successful server synchronization.",
      "Local data may be removed when you delete downloaded content, sign out where indicated, delete your account, uninstall the app, clear storage, or when the operating system removes files. Some protected session, result, or bookmark assets may be retained temporarily so active or pending records remain usable.",
    ]},
    {title: "8. How We Disclose Information", body: [
      "We disclose information to authorized schools and educators as described above, to other students through the social features you use and the privacy choices you make, and to vendors that help operate the service.",
      "Our vendors include infrastructure and authentication providers such as Google Firebase, transactional email providers such as Resend, payment providers such as Stripe, Apple, and Google, and app distribution or diagnostic services used in a released product. They may process data only for contracted services, and we require them to provide the same or equivalent protection described in this Policy as applicable to the information they process.",
      "We may disclose information to comply with law or legal process, protect users or the service, investigate fraud or abuse, enforce agreements, or complete a merger, financing, reorganization, or sale subject to appropriate protections.",
    ]},
    {title: "9. What We Do Not Do", body: [
      "We do not sell personal information or student data. We do not use student information for targeted advertising, permit third-party behavioral advertising in student accounts, or publish individual test answers publicly. We do not use school-connected education records for unrelated commercial profiling.",
    ]},
    {title: "10. Children and Minors", body: [
      "Direct-to-consumer accounts are not intended for children under 13. If a child under 13 uses Drill Instructor, it must be through a school-authorized or parent- or guardian-authorized arrangement permitted by law. A child should not create an independent account without that authorization.",
      "For school-authorized educational use, we may rely on a school to provide required authorization where the law permits. We use children's information to provide the educational service, not for targeted advertising or sale. Contact us if you believe a child is using the service without proper authorization.",
    ]},
    {title: "11. Payments and Communications", body: [
      "Payment providers send us subscription and transaction status needed to grant access, preserve purchase history, handle renewals or upgrades, and respond to billing events. Their own policies govern data they collect directly.",
      "We send transactional messages such as verification and password-reset emails, welcome messages, subscription and access-code confirmations, assignment or security notices when enabled, and support correspondence. Required service messages are not marketing messages. Any marketing message will include controls required by law.",
    ]},
    {title: "12. Retention", body: [
      "We retain information only as long as reasonably needed to operate the service, maintain canonical learning and purchase records, fulfill school instructions, secure accounts, resolve disputes, enforce agreements, and meet legal obligations. Retention varies by record and relationship.",
      "Account and learning records may remain while an account is active. School assignment and audit records may follow school, contractual, or legal requirements. Billing, fraud-prevention, and security records may be retained after account deletion. Deleted data may remain in protected backups until ordinary deletion cycles complete.",
    ]},
    {title: "13. Account and Data Deletion", body: [
      "You may initiate deletion from your profile in the app or at drillinstructorprep.com/account-deletion. We verify a web request through the account email before deletion. Completed deletion removes the account and associated personal data that we are not required or permitted to retain.",
      "Deleting your account does not cancel an externally billed Apple App Store or Google Play subscription; cancel it with the billing provider. If a school controls an education record, we may coordinate with the school or retain that record in a restricted or de-identified form as legally appropriate.",
    ]},
    {title: "14. Your Choices and Requests", body: [
      "You can update supported profile information and privacy settings, change who may challenge you, block or unblock accounts, manage downloaded content, and cancel a subscription through its billing provider. Some profile changes require email verification.",
      "Depending on your location, you may request access, correction, deletion, restriction, or a copy of certain information. We may verify your identity and authority. Requests about school-controlled education records may be referred to the school.",
    ]},
    {title: "15. Security", body: [
      "We use reasonable administrative, technical, and organizational safeguards, including authenticated access and permission checks, designed to protect information. No device, network, or cloud system is completely secure, so we cannot guarantee absolute security.",
    ]},
    {title: "16. International Processing", body: [
      "Information may be processed or stored in the United States and other countries where we or our providers operate. Those countries may have different data-protection laws. Where required, we use measures designed to protect information transferred internationally.",
    ]},
    {title: "17. Changes to This Policy", body: [
      "We may revise this Policy as the service changes. If a change is material, we will provide notice where required. The revision date above shows when this version became effective.",
    ]},
    {title: "18. Contact", body: [
      "Privacy questions and requests may be sent to Davola Technologies LLC at support@drillinstructorprep.com. Account deletion is also available at drillinstructorprep.com/account-deletion.",
    ]},
  ],
};

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

module.exports = async (data, context) => {
  const {code, testType, userId} = data;

  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "User not authenticated");
  }

  if (!code || !testType || !userId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required parameters");
  }

  const codeRef = admin.database().ref(`accessCodes/${testType}/${code}`);
  const userRef = admin.database().ref(`users/${userId}/`+
    `${testType + "AccessCode"}`);

  try {
    // Fetch the access code data
    const snapshot = await codeRef.once("value");
    const codeData = snapshot.val();

    if (!codeData) {
      throw new functions.https.HttpsError("not-found", "Code not found");
    }

    if (codeData.used === true) {
      throw new functions.https.HttpsError("already-exists",
          "Code already used");
    }

    // Set duration based on code length
    let durationDays;
    switch (code.length) {
      case 10: durationDays = 31; break;
      case 12: durationDays = 93; break;
      case 16: durationDays = 372; break;
      default:
        throw new functions.https.HttpsError("invalid-argument",
            "Invalid code length");
    }

    const now = new Date();
    const activationDate = now.toISOString();
    const expirationDate = new Date(
        now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Hash license (this mimics what you'd previously do on the client)
    const secretSalt = process.env.LICENSE_SALT;
    if (!secretSalt) {
      throw new Error("LICENSE_SALT is not configured");
    }
    const payload = `${testType}|${activationDate}|${expirationDate}|${userId}`;
    const licenseHash = crypto
        .createHmac("sha256", secretSalt)
        .update(payload)
        .digest("hex");

    // Mark code as used
    await codeRef.update({
      used: true,
      assignedTo: userId,
      usedAt: new Date().toISOString(),
    });

    // Write user license data
    await userRef.set({
      code,
      testType,
      activationDate,
      expirationDate,
      licenseHash,
    });

    // Return license info
    return {
      status: "success",
      plan: testType,
      activationDate,
      expirationDate,
      licenseHash,
    };
  } catch (error) {
    console.error("verifyAccessCode error:", error.message);
    throw new functions.https.HttpsError("internal", error.message);
  }
};

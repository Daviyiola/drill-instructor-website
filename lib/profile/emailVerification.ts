export interface VerificationEmailResponse {
  ok: true;
  emailVerified: boolean;
  emailSent: boolean;
  email?: string;
}

export function verificationRequestError(error: unknown) {
  const detail = error as {status?: number; code?: string; message?: string};
  if (
    detail.status === 429 ||
    detail.code === "VERIFICATION_EMAIL_RATE_LIMITED" ||
    detail.message === "VERIFICATION_EMAIL_RATE_LIMITED"
  ) {
    return "Please wait one minute before requesting another verification email.";
  }
  return detail.message || "Unable to send the verification email. Please try again.";
}

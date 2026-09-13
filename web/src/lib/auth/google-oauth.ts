export const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function buildGoogleSignInOptions(origin: string) {
  return {
    redirectTo: new URL("/auth/callback", origin).toString(),
    scopes: GOOGLE_DRIVE_READONLY_SCOPE,
    queryParams: {
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    },
  };
}

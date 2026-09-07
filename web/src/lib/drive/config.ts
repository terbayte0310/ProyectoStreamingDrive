const requiredVariables = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
] as const;

type DriveConfig = {
  clientId: string;
  clientSecret: string;
  rootFolderId: string;
};

export function getDriveConfig(): DriveConfig {
  const missing = requiredVariables.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error("La configuración local de Google Drive está incompleta.");
  }

  return {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!,
  };
}

/**
 * Canonical types for the iCloud Bridge integration.
 * The encrypted blob in integrations.access_token_enc is JSON-stringified IcloudBridgeCredsBlob.
 */

export interface IcloudBridgeCredsBlob {
  bridgeUrl: string; // http://<tailnet-ip-or-hostname>:7878 — host:port only, no path
  hmacSecret: string; // 64-char hex (32 bytes)
}

export interface IcloudBridgeHealth {
  status: "connected" | "icloud_not_ready" | "bridge_offline";
  bridge?: { up: boolean; version: string; port: number };
  icloud?: {
    signed_in: boolean;
    apple_id?: string;
    drive_dir_exists: boolean;
    bird_running: boolean;
    optimise_storage: boolean;
  };
  warnings?: string[];
}

export type ProbeErrorCode =
  | "BRIDGE_UNREACHABLE"
  | "BAD_SIGNATURE"
  | "ICLOUD_NOT_SIGNED_IN"
  | "OPTIMISE_STORAGE_ON"
  | "BIRD_NOT_RUNNING"
  | "INVALID_URL"
  | "INVALID_SECRET"
  | "TIMEOUT"
  | "UNEXPECTED";

export interface ProbeResult {
  ok: boolean;
  health?: IcloudBridgeHealth;
  code?: ProbeErrorCode;
  message?: string;
}

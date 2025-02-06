import { constants, access, lstatSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fromEnv } from "@aws-sdk/credential-providers";
import { getLogger } from "@logtape/logtape";
import { Disk } from "flydrive";
import { FSDriver } from "flydrive/drivers/fs";
import { S3Driver } from "flydrive/drivers/s3";
import type { DriverContract } from "flydrive/types";

const logger = getLogger(["hollo", "storage"]);

export type DriveDisk = "fs" | "s3";

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
export const assetPath = Bun.env["FS_ASSET_PATH"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
const region = Bun.env["S3_REGION"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
const bucket = Bun.env["S3_BUCKET"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
const endpointUrl = Bun.env["S3_ENDPOINT_URL"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
const accessKeyId = Bun.env["AWS_ACCESS_KEY_ID"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
const secretAccessKey = Bun.env["AWS_SECRET_ACCESS_KEY"];

// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
let driveDisk = Bun.env["DRIVE_DISK"];
if (!driveDisk) {
  logger.warn(
    "DRIVE_DISK is not configured; defaults to 's3'.  " +
    "The DRIVE_DISK environment variable will be mandatory in the future versions.",
  );
  driveDisk = "s3";
} else if (!["fs", "s3"].includes(driveDisk)) {
  throw new Error(`Unknown DRIVE_DISK value: '${driveDisk}'`);
}
export const DRIVE_DISK: DriveDisk =
  driveDisk === "fs" || driveDisk === "s3" ? driveDisk : "s3";

const assetUrlBase =
  // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
  Bun.env["ASSET_URL_BASE"] ??
  // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
  (driveDisk === "s3" ? Bun.env["S3_URL_BASE"] : undefined);
if (driveDisk !== "fs" && assetUrlBase == null)
  throw new Error("ASSET_URL_BASE is required unless DRIVE_DISK=fs.");
// biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
if (driveDisk === "s3" && Bun.env["ASSET_URL_BASE"] == null) {
  logger.warn("S3_URL_BASE is deprecated; use ASSET_URL_BASE instead.");
}

export function getAssetUrl(path: string, base: URL | string): string {
  if (assetUrlBase == null || assetUrlBase.trim() === "") {
    return new URL(`/assets/${path.replace(/^\/+/, "")}`, base).href;
  }
  return `${assetUrlBase.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

let driver: DriverContract;
switch (DRIVE_DISK) {
  case "fs":
    if (!assetPath) {
      throw new Error("FS_ASSET_PATH is required");
    }
    if (!lstatSync(assetPath).isDirectory()) {
      throw new Error(`Asset path must point to a directory: ${assetPath}`);
    }
    access(
      assetPath,
      constants.F_OK | constants.R_OK | constants.W_OK,
      (err) => {
        if (err) {
          throw new Error(`${assetPath} must be readable and writable`);
        }
      },
    );

    driver = new FSDriver({
      location: isAbsolute(assetPath)
        ? assetPath
        : // @ts-ignore: Don't know why, but TS can't find ImportMeta.dir on CI
        join(dirname(import.meta.dir), assetPath),
      visibility: "public",
    });
    break;
  case "s3":
    if (bucket == null) throw new Error("S3_BUCKET is required");
    if (accessKeyId == null) throw new Error("AWS_ACCESS_KEY_ID is required");
    if (secretAccessKey == null)
      throw new Error("AWS_SECRET_ACCESS_KEY is required");

    driver = new S3Driver({
      credentials: fromEnv(),
      region: region == null || region === "" ? "auto" : region,
      endpoint: endpointUrl,
      bucket: bucket,
      // biome-ignore lint/complexity/useLiteralKeys: tsc complains about this (TS4111)
      forcePathStyle: Bun.env["S3_FORCE_PATH_STYLE"] === "true",
      visibility: "public",
    });
    break;
  default:
    throw new Error(`Unknown DRIVE_DISK value: '${DRIVE_DISK}'`);
}

export const disk = new Disk(driver);

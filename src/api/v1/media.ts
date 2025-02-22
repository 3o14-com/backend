import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import mime from "mime";
import sharp from "sharp";
import { db } from "../../db";
import { serializeMedium } from "../../entities/medium";
import { makeVideoScreenshot, uploadThumbnail } from "../../media";
import { type Variables, scopeRequired, tokenRequired } from "../../oauth";
import { media } from "../../schema";
import { disk, getAssetUrl } from "../../storage";
import { isUuid, uuidv7 } from "../../uuid";

const app = new Hono<{ Variables: Variables }>();

export async function postMedia(c: Context<{ Variables: Variables }>) {
  const owner = c.get("token").accountOwner;
  if (owner == null) {
    return c.json({ error: "This method requires an authenticated user" }, 422);
  }

  const form = await c.req.formData();
  const file = form.get("file");

  // Debugging: Log what we get
  console.log("Received file:", file, "Type:", typeof file);

  if (!file) {
    return c.json({ error: "file is required" }, 422);
  }

  let imageData: Uint8Array;
  let fileType: string;

  // Handle different possible types of 'file'
  if (file instanceof File) {
    // Case 1: File object (raw data already present)
    imageData = new Uint8Array(await file.arrayBuffer());
    fileType = file.type || "image/jpeg";
    console.log("File is a File instance - size:", file.size, "type:", file.type);
  } else if (file && typeof file === "object" && "uri" in file) {
    // Case 2: Mobile file object with uri (fetch the data)
    const mobileFile = file as { uri: string; type?: string; name?: string };
    console.log("File is a mobile file object:", mobileFile);

    // Fetch the file content from the URI
    try {
      const response = await fetch(mobileFile.uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch file from URI: ${response.statusText}`);
      }
      const blob = await response.blob();
      imageData = new Uint8Array(await blob.arrayBuffer());
      fileType = mobileFile.type || blob.type || "image/jpeg";
    } catch (error) {
      console.error("Fetch error:", error);
      return c.json({ error: "Failed to fetch file from URI", details: error.message }, 422);
    }
  } else if (typeof file === "string") {
    // Case 3: Raw binary data as a string (unlikely but supported)
    imageData = Buffer.from(file, "binary"); // Use Buffer for raw binary data
    fileType = "image/jpeg"; // Default type
    console.log("File is a string - length:", file.length);
  } else {
    console.log("Unexpected file format:", file);
    return c.json({ error: "Invalid file format" }, 422);
  }

  // Process the file content
  const id = uuidv7();
  let imageBytes: Uint8Array = imageData;

  // Handle video thumbnail if applicable
  if (fileType.startsWith("video/")) {
    imageBytes = await makeVideoScreenshot(imageData);
  }

  const image = sharp(imageBytes);
  const fileMetadata = await image.metadata();

  const content = new Uint8Array(imageData); // Use original data for storage
  const extension = mime.getExtension(fileType);
  if (!extension) {
    return c.json({ error: "Unsupported media type" }, 400);
  }

  const sanitizedExt = extension.replace(/[/\\]/g, "");
  const path = `media/${id}/original.${sanitizedExt}`;

  try {
    await disk.put(path, content, {
      contentType: fileType,
      contentLength: content.byteLength,
      visibility: "public",
    });
  } catch (error) {
    console.error("Failed to save media file:", error);
    return c.json({ error: "Failed to save media file" }, 500);
  }

  const url = getAssetUrl(path, c.req.url);
  const description = form.get("description")?.toString();

  const result = await db
    .insert(media)
    .values({
      id,
      type: fileType,
      url,
      width: fileMetadata.width ?? 0, // Default to 0 if undefined
      height: fileMetadata.height ?? 0, // Default to 0 if undefined
      description,
      ...(await uploadThumbnail(id, image, c.req.url)),
    })
    .returning();

  if (result.length < 1) {
    return c.json({ error: "Failed to insert media" }, 500);
  }

  return c.json(serializeMedium(result[0]));
}

app.post("/", tokenRequired, scopeRequired(["write:media"]), postMedia);

app.get("/:id", async (c) => {
  const mediumId = c.req.param("id");
  if (!isUuid(mediumId)) return c.json({ error: "Not found" }, 404);
  const medium = await db.query.media.findFirst({
    where: eq(media.id, mediumId),
  });
  if (medium == null) return c.json({ error: "Not found" }, 404);
  return c.json(serializeMedium(medium));
});

app.put("/:id", tokenRequired, scopeRequired(["write:media"]), async (c) => {
  const mediumId = c.req.param("id");
  if (!isUuid(mediumId)) return c.json({ error: "Not found" }, 404);
  let description: string | undefined;
  try {
    const json = await c.req.json();
    description = json.description;
  } catch (e) {
    const form = await c.req.formData();
    description = form.get("description")?.toString();
  }
  if (description == null) {
    return c.json({ error: "description is required" }, 422);
  }
  const result = await db
    .update(media)
    .set({ description })
    .where(eq(media.id, mediumId))
    .returning();
  if (result.length < 1) return c.json({ error: "Not found" }, 404);
  return c.json(serializeMedium(result[0]));
});

export default app;

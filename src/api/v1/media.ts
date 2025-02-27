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
  if (!owner) {
    return c.json({ error: "This method requires an authenticated user" }, 422);
  }

  const form = await c.req.formData();
  const file = form.get("file");

  console.log("Received file:", file, "Type:", typeof file);

  if (!file) {
    return c.json({ error: "file is required" }, 422);
  }

  let imageData: Uint8Array;
  let fileType: string;

  try {
    if (file instanceof Blob) {
      // Handle Blob (including File)
      imageData = new Uint8Array(await file.arrayBuffer());
      fileType = file.type || "image/jpeg";
      console.log("File is a Blob - size:", file.size, "type:", fileType);
    } else if (typeof file === "object" && "uri" in file) {
      // Handle mobile file object with URI
      const mobileFile = file as { uri: string; type?: string };
      console.log("File is a mobile file object:", mobileFile);

      const response = await fetch(mobileFile.uri);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

      const blob = await response.blob();
      imageData = new Uint8Array(await blob.arrayBuffer());
      fileType = mobileFile.type || blob.type || "image/jpeg";
    } else if (typeof file === "string") {
      // Handle raw binary string (unlikely)
      imageData = Buffer.from(file, "binary");
      fileType = "image/jpeg";
    } else {
      console.error("Unsupported file format:", file);
      return c.json({ error: "Invalid file format" }, 422);
    }

    // Validate MIME type and extension
    const extension = mime.getExtension(fileType);
    if (!extension) {
      return c.json({ error: "Unsupported media type" }, 400);
    }

    // Generate UUID and process media
    const id = uuidv7();
    const sanitizedExt = extension.replace(/[/\\]/g, "");
    const path = `media/${id}/original.${sanitizedExt}`;

    // Handle video thumbnail if necessary
    let processedImage = imageData;
    if (fileType.startsWith("video/")) {
      processedImage = await makeVideoScreenshot(imageData);
    }

    // Save original file
    await disk.put(path, processedImage, {
      contentType: fileType,
      visibility: "public",
    });

    const url = getAssetUrl(path, c.req.url);
    const description = form.get("description")?.toString();

    // Upload thumbnail and insert into DB
    const thumbnailData = await uploadThumbnail(id, sharp(processedImage), c.req.url);
    const [result] = await db.insert(media).values({
      id,
      type: fileType,
      url,
      width: (await sharp(processedImage).metadata()).width || 0,
      height: (await sharp(processedImage).metadata()).height || 0,
      description,
      ...thumbnailData,
    }).returning();

    return c.json(serializeMedium(result));
  } catch (error) {
    console.error("Error processing media:", error);
    return c.json({ error: "Failed to process media", details: error.message }, 500);
  }
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

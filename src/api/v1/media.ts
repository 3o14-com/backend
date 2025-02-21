import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import mime from "mime";
import sharp from "sharp";
import { db } from "../../db";
import { serializeMedium } from "../../entities/medium";
import { uploadThumbnail } from "../../media";
import { type Variables, scopeRequired, tokenRequired } from "../../oauth";
import { media } from "../../schema";
import { disk, getAssetUrl } from "../../storage";
import { isUuid, uuidv7 } from "../../uuid";

const app = new Hono<{ Variables: Variables }>();

export async function postMedia(c: Context<{ Variables: Variables }>) {
  const owner = c.get("token").accountOwner;
  if (owner == null) {
    console.log("No authenticated user, token:", c.get("token"));
    return c.json({ error: "This method requires an authenticated user" }, 422);
  }

  try {
    const form = await c.req.formData();
    const file = form.get("file");
    const description = form.get("description");
    console.log("FormData - file:", file);
    console.log("FormData - description:", description);

    if (!file) {
      return c.json({ error: "file is required" }, 422);
    }

    let fileData: File;
    if (file instanceof File) {
      fileData = file;
      console.log("File is a File instance - size:", fileData.size, "type:", fileData.type);
    } else if (typeof file === "string") {
      // Hono might return raw binary data as a string
      console.log("File is a string (raw data?), length:", file.length);
      const blob = new Blob([file], { type: "image/jpeg" });
      fileData = new File([blob], "upload.jpg", { type: "image/jpeg" });
    } else if (file && typeof file === "object" && "uri" in file) {
      // Hono might return the mobile file object directly
      console.log("File is a mobile file object:", file);
      return c.json({ error: "Server doesn’t support URI fetching - raw data expected" }, 422);
    } else {
      console.log("Unexpected file format:", file);
      return c.json({ error: "Invalid file format" }, 422);
    }

    const id = uuidv7();
    const imageData = new Uint8Array(await fileData.arrayBuffer());

    const fileType = fileData.type || "image/jpeg";
    const extension = mime.getExtension(fileType);
    if (!extension) {
      return c.json({ error: "Unsupported media type" }, 400);
    }

    const sanitizedExt = extension.replace(/[/\\]/g, "");
    const path = `media/${id}/original.${sanitizedExt}`;

    await disk.put(path, imageData, {
      contentType: fileType,
      contentLength: imageData.byteLength,
      visibility: "public",
    });

    const url = getAssetUrl(path, c.req.url);

    const image = sharp(imageData);
    const fileMetadata = await image.metadata();

    const result = await db
      .insert(media)
      .values({
        id,
        type: fileType,
        url,
        width: fileMetadata.width ?? 0,
        height: fileMetadata.height ?? 0,
        description: description?.toString() || null,
        ...(await uploadThumbnail(id, image, c.req.url)),
      })
      .returning();

    if (result.length < 1) {
      throw new Error("Failed to insert media record");
    }

    const response = serializeMedium(result[0]);
    console.log("Returning response:", response);
    return c.json(response);
  } catch (error) {
    console.error("Upload error:", error instanceof Error ? error.stack : error);
    return c.json(
      { error: "Failed to process upload", details: error.message },
      500
    );
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

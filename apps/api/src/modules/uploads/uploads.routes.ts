import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { env } from "../../config/env.js";

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const uploadsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolvePharmacy];

  // POST /api/v1/uploads/prescription
  // Accepts: multipart/form-data with a single file field
  // Returns: upload record + a 1-hour signed URL for immediate use
  app.post("/prescription", { preHandler }, async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ success: false, error: "No file provided" });
    }

    if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
      data.file.resume(); // drain so the multipart connection closes cleanly
      return reply.status(415).send({
        success: false,
        error:   "Unsupported file type. Allowed: JPEG, PNG, WebP, PDF",
      });
    }

    const ext         = path.extname(data.filename) || ".bin";
    const storagePath = `${req.pharmacyId}/prescriptions/${randomUUID()}${ext}`;
    const fileBuffer  = await data.toBuffer();

    // Magic-byte check: verify actual file content against the declared MIME type.
    // A client can lie about mimetype in the multipart header — e.g. send an .exe
    // with mimetype "image/jpeg". Magic bytes cannot be faked without also breaking
    // the format, so this check is the reliable server-side gate.
    const detected = await fileTypeFromBuffer(fileBuffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      return reply.status(415).send({
        success: false,
        error:   "File content does not match its declared type. Only JPEG, PNG, WebP, and PDF are accepted.",
      });
    }

    const { error: uploadError } = await app.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: detected.mime, upsert: false });

    if (uploadError) {
      app.log.error({ err: uploadError }, "[storage] prescription upload failed");
      return reply.status(500).send({ success: false, error: "File upload failed" });
    }

    const { data: signedData } = await app.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    const upload = await app.prisma.upload.create({
      data: {
        pharmacyId: req.pharmacyId,
        type:       "PRESCRIPTION",
        fileName:   data.filename,
        fileUrl:    storagePath,          // store path, not URL — signed on read
        fileSize:   fileBuffer.byteLength,
        mimeType:   detected.mime,
      },
    });

    return reply.status(201).send({
      success: true,
      data:    { ...upload, signedUrl: signedData?.signedUrl ?? null },
    });
  });

  // GET /api/v1/uploads?type=PRESCRIPTION
  // Returns all uploads for this pharmacy with fresh 1-hour signed URLs.
  app.get("/", { preHandler }, async (req, reply) => {
    const { type } = req.query as Record<string, string>;

    const uploads = await app.prisma.upload.findMany({
      where:   { pharmacyId: req.pharmacyId, ...(type ? { type: type as never } : {}) },
      orderBy: { createdAt: "desc" },
      take:    50,
    });

    if (uploads.length === 0) {
      return reply.send({ success: true, data: [] });
    }

    // Batch all signed URL requests in a single Supabase API call.
    const { data: signedUrls } = await app.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUrls(uploads.map((u) => u.fileUrl), SIGNED_URL_TTL_SECONDS);

    const signedMap = new Map(
      (signedUrls ?? []).map((s) => [s.path, s.signedUrl]),
    );

    return reply.send({
      success: true,
      data:    uploads.map((u) => ({ ...u, signedUrl: signedMap.get(u.fileUrl) ?? null })),
    });
  });
};

export default uploadsRoutes;

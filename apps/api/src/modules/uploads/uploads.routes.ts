import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { env } from "../../config/env.js";
import type { UploadType } from "@pharmacy/database";

const SIGNED_URL_TTL_SECONDS  = 3600;         // 1 hour
const MAX_PRESCRIPTION_BYTES  = 5 * 1024 * 1024;  // 5 MB
const MAX_DOCUMENT_PDF_BYTES  = 15 * 1024 * 1024; // 15 MB — supplier invoice PDFs run larger than prescription photos

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const PDF_ONLY_MIME_TYPES = new Set(["application/pdf"]);

// Shared by every upload route below: validate size, verify magic bytes against
// the declared MIME type, push the buffer to Supabase Storage, and record the
// Upload row. Each route only differs in storage subfolder, UploadType, and
// which MIME types it accepts.
async function storeUpload(
  app:         FastifyInstance,
  req:         FastifyRequest,
  reply:       FastifyReply,
  opts: {
    data:         Awaited<ReturnType<FastifyRequest["file"]>>;
    folder:       string;
    type:         UploadType;
    allowedMimes: Set<string>;
    maxBytes:     number;
  },
) {
  const { data, folder, type, allowedMimes, maxBytes } = opts;
  if (!data) {
    return reply.status(400).send({ success: false, error: "No file provided" });
  }

  if (!allowedMimes.has(data.mimetype)) {
    data.file.resume(); // drain so the multipart connection closes cleanly
    return reply.status(415).send({
      success: false,
      error:   `Unsupported file type. Allowed: ${[...allowedMimes].join(", ")}`,
    });
  }

  const ext         = path.extname(data.filename) || ".bin";
  const storagePath = `${req.pharmacyId}/${folder}/${randomUUID()}${ext}`;
  const fileBuffer  = await data.toBuffer();

  if (fileBuffer.byteLength > maxBytes) {
    return reply.status(413).send({
      success: false,
      error:   `File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    });
  }

  // Magic-byte check: verify actual file content against the declared MIME type.
  // A client can lie about mimetype in the multipart header — e.g. send an .exe
  // with mimetype "image/jpeg". Magic bytes cannot be faked without also breaking
  // the format, so this check is the reliable server-side gate.
  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected || !allowedMimes.has(detected.mime)) {
    return reply.status(415).send({
      success: false,
      error:   `File content does not match its declared type. Allowed: ${[...allowedMimes].join(", ")}.`,
    });
  }

  const { error: uploadError } = await app.supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, { contentType: detected.mime, upsert: false });

  if (uploadError) {
    app.log.error({ err: uploadError }, `[storage] ${folder} upload failed`);
    return reply.status(500).send({ success: false, error: "File upload failed" });
  }

  const { data: signedData } = await app.supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  const upload = await app.prisma.upload.create({
    data: {
      pharmacyId: req.pharmacyId,
      type,
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
}

const uploadsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolvePharmacy];

  // POST /api/v1/uploads/prescription
  // Accepts: multipart/form-data with a single file field
  // Returns: upload record + a 1-hour signed URL for immediate use
  app.post("/prescription", { preHandler }, async (req, reply) => {
    const data = await req.file();
    return storeUpload(app, req, reply, {
      data, folder: "prescriptions", type: "PRESCRIPTION",
      allowedMimes: ALLOWED_MIME_TYPES, maxBytes: MAX_PRESCRIPTION_BYTES,
    });
  });

  // POST /api/v1/uploads/pharmacy-logo
  // Pharmacy logo — images only, 2 MB max.
  app.post("/pharmacy-logo", { preHandler }, async (req, reply) => {
    const data = await req.file();
    return storeUpload(app, req, reply, {
      data, folder: "pharmacy-logos", type: "LOGO",
      allowedMimes: new Set(["image/jpeg", "image/png", "image/webp"]),
      maxBytes: 2 * 1024 * 1024,
    });
  });

  // POST /api/v1/uploads/pharmacy-document
  // Compliance document scans (Drug License, GST cert, etc.) — PDF or image, 5 MB.
  app.post("/pharmacy-document", { preHandler }, async (req, reply) => {
    const data = await req.file();
    return storeUpload(app, req, reply, {
      data, folder: "pharmacy-documents", type: "PHARMACY_DOCUMENT",
      allowedMimes: ALLOWED_MIME_TYPES, maxBytes: MAX_DOCUMENT_PDF_BYTES,
    });
  });

  // POST /api/v1/uploads/grn-pdf
  // Attaches a supplier invoice PDF to a GRN that's being drafted from it.
  // PDF-only — the bulk-import flow only attempts text extraction on PDFs.
  app.post("/grn-pdf", { preHandler }, async (req, reply) => {
    const data = await req.file();
    return storeUpload(app, req, reply, {
      data, folder: "grn-pdfs", type: "GRN_PDF",
      allowedMimes: PDF_ONLY_MIME_TYPES, maxBytes: MAX_DOCUMENT_PDF_BYTES,
    });
  });

  // POST /api/v1/uploads/po-pdf
  // Attaches a supplier quote/order PDF to a PO that's being drafted from it.
  app.post("/po-pdf", { preHandler }, async (req, reply) => {
    const data = await req.file();
    return storeUpload(app, req, reply, {
      data, folder: "po-pdfs", type: "PURCHASE_ORDER_PDF",
      allowedMimes: PDF_ONLY_MIME_TYPES, maxBytes: MAX_DOCUMENT_PDF_BYTES,
    });
  });

  // GET /api/v1/uploads/:id/signed-url
  // Returns a fresh 1-hour signed URL for a single upload (used by prescription detail view).
  app.get("/:id/signed-url", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const upload = await app.prisma.upload.findFirst({
      where:  { id, pharmacyId: req.pharmacyId },
      select: { fileUrl: true, fileName: true, mimeType: true },
    });
    if (!upload) return reply.status(404).send({ success: false, error: "Upload not found" });

    const { data: signedData } = await app.supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUrl(upload.fileUrl, SIGNED_URL_TTL_SECONDS);

    return reply.send({
      success: true,
      data: { signedUrl: signedData?.signedUrl ?? null, fileName: upload.fileName, mimeType: upload.mimeType },
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

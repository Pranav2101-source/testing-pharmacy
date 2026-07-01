import type { FastifyPluginAsync } from "fastify";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { mkdir, stat, unlink } from "fs/promises";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { join, extname } from "path";
import { randomBytes } from "crypto";
import { fileTypeFromBuffer } from "file-type";
import type { FileTypeResult } from "file-type";
import { authenticate, requireRole } from "../../middleware/auth.js";
import type { JwtPayload } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { SupportService } from "./support.service.js";
import { AppError } from "../../lib/AppError.js";
import { registerConn, removeConn } from "./support.sse.js";
import {
  createTicketSchema,
  updateStatusSchema,
  addMessageSchema,
  listTicketsQuerySchema,
  createAgentSchema,
  assignTicketSchema,
} from "./support.schema.js";

const UPLOAD_DIR = join(process.cwd(), "uploads", "support");
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB — accommodates screen recordings

// Extension → accepted MIME types. Anything outside this list is rejected:
// executables, HTML/SVG (stored-XSS vectors), archives, etc. have no legitimate
// place in a support ticket.
const ALLOWED_UPLOADS: Record<string, string[]> = {
  ".jpg":  ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png":  ["image/png"],
  ".gif":  ["image/gif"],
  ".webp": ["image/webp"],
  ".mp4":  ["video/mp4"],
  ".webm": ["video/webm"],
  ".pdf":  ["application/pdf"],
};

// Ground-truth MIME types based on magic bytes, not the client-supplied Content-Type.
const ALLOWED_DETECTED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4",  "video/webm",
  "application/pdf",
]);

// Inserts a Transform into a pipeline that sniffs the first chunk for the real
// file type without buffering the whole stream. The `result` Promise resolves
// once the first chunk flows through — always before `pipeline()` settles.
function createMagicByteDetector(): { transform: Transform; result: Promise<FileTypeResult | undefined> } {
  let settle!: (r: FileTypeResult | undefined) => void;
  const result  = new Promise<FileTypeResult | undefined>((res) => { settle = res; });
  let checked   = false;

  const transform = new Transform({
    transform(chunk: Buffer, _, done) {
      if (!checked) {
        checked = true;
        void fileTypeFromBuffer(chunk)
          .then((ft) => { settle(ft); done(null, chunk); })
          .catch((err: Error) => done(err));
      } else {
        done(null, chunk);
      }
    },
    flush(done) {
      if (!checked) settle(undefined); // empty or zero-byte stream
      done();
    },
  });

  return { transform, result };
}

const supportRoutes: FastifyPluginAsync = async (app) => {
  const service = new SupportService(app);

  // Ensure upload directory exists on startup
  await mkdir(UPLOAD_DIR, { recursive: true });

  const auth         = [authenticate, resolvePharmacy];
  const agentAuth    = [authenticate, requireRole("SUPPORT_AGENT", "PLATFORM_ADMIN")];
  const adminAuth    = [authenticate, requireRole("PLATFORM_ADMIN")];
  const anyAuth      = [authenticate];

  // ── GET /categories ─────────────────────────────────────────────────────────

  app.get("/categories", { preHandler: anyAuth }, async (_req, reply) => {
    const categories = await service.listCategories();
    return reply.send({ success: true, data: categories });
  });

  // ── GET /pharmacies ─────────────────────────────────────────────────────────

  app.get("/pharmacies", { preHandler: adminAuth }, async (_req, reply) => {
    const pharmacies = await app.prisma.pharmacy.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ success: true, data: pharmacies });
  });

  // ── GET /stats ───────────────────────────────────────────────────────────────

  app.get("/stats", { preHandler: agentAuth }, async (_req, reply) => {
    const stats = await service.stats();
    return reply.send({ success: true, data: stats });
  });

  // ── POST /tickets ─────────────────────────────────────────────────────────────
  // Only pharmacy users raise tickets.

  app.post("/tickets", { preHandler: [authenticate] }, async (req, reply) => {
    const input  = createTicketSchema.parse(req.body);
    
    let pharmacyId: string;
    
    if (req.user.role === "PLATFORM_ADMIN" || req.user.role === "SUPPORT_AGENT") {
      if (!input.pharmacyId) {
        throw AppError.badRequest("pharmacyId is required for support staff creating tickets");
      }
      pharmacyId = input.pharmacyId;
    } else {
      // Pharmacy user
      if (!req.user.pharmacyId) {
        throw AppError.unauthorized("Pharmacy context could not be resolved");
      }
      pharmacyId = req.user.pharmacyId;
    }

    const ticket = await service.createTicket(pharmacyId, req.user.sub, input);

    return reply.status(201).send({ success: true, data: ticket });
  });

  // ── GET /tickets ──────────────────────────────────────────────────────────────
  // Role-aware: support staff see all; pharmacy users see own.

  app.get("/tickets", { preHandler: anyAuth }, async (req, reply) => {
    const query   = listTicketsQuerySchema.parse(req.query);
    const tickets = await service.listTickets(req.user.sub, req.user.role, query);
    return reply.send({ success: true, data: tickets });
  });

  // ── GET /tickets/:id ──────────────────────────────────────────────────────────

  app.get("/tickets/:id", { preHandler: anyAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await service.getTicket(id, req.user.sub, req.user.role);
    return reply.send({ success: true, data: ticket });
  });

  // ── PATCH /tickets/:id/status ─────────────────────────────────────────────────

  app.patch("/tickets/:id/status", { preHandler: agentAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateStatusSchema.parse(req.body);
    const ticket = await service.updateStatus(id, req.user.sub, req.user.role, input);
    return reply.send({ success: true, data: ticket });
  });

  // ── POST /tickets/:id/messages ────────────────────────────────────────────────

  app.post("/tickets/:id/messages", { preHandler: anyAuth }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const input   = addMessageSchema.parse(req.body);
    const message = await service.addMessage(id, req.user.sub, req.user.role, input);
    return reply.status(201).send({ success: true, data: message });
  });

  // ── POST /tickets/:id/attachments ─────────────────────────────────────────────
  // Accepts multipart: file + optional messageId field.

  app.post("/tickets/:id/attachments", { preHandler: anyAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    // Authorize BEFORE consuming the upload stream — a cross-pharmacy user gets
    // a 403 without a single byte ever being written to disk.
    await service.getTicket(id, req.user.sub, req.user.role);

    const parts = req.parts({ limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 } });

    let storedName:   string | null = null;
    let originalName  = "";
    let mimeType      = "";
    let wasTruncated  = false;
    let messageId: string | undefined;
    let detectedType  = Promise.resolve<FileTypeResult | undefined>(undefined);

    // Iterate ALL parts (no early break): multipart field order is not
    // guaranteed, so a messageId field sent after the file must still be read.
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "messageId" && typeof part.value === "string" && part.value) {
          messageId = part.value;
        }
        continue;
      }

      // Extra file parts beyond the first: drain so the stream completes, ignore.
      if (storedName) {
        part.file.resume();
        continue;
      }

      const ext     = extname(part.filename ?? "").toLowerCase();
      const allowed = ALLOWED_UPLOADS[ext];
      if (!allowed || !allowed.includes(part.mimetype)) {
        part.file.resume(); // drain before erroring so the connection closes cleanly
        throw AppError.badRequest(
          `File type not allowed. Accepted formats: ${Object.keys(ALLOWED_UPLOADS).join(", ")}`,
        );
      }

      originalName = part.filename;
      mimeType     = part.mimetype;
      storedName   = `${randomBytes(12).toString("hex")}-${Date.now()}${ext}`;

      // Stream straight to disk — never buffer the (up to 25 MB) file in memory.
      // magicDetect sniffs the first chunk for the real file type without buffering.
      const { transform: magicDetect, result: typeResult } = createMagicByteDetector();
      detectedType = typeResult;
      await pipeline(part.file, magicDetect, createWriteStream(join(UPLOAD_DIR, storedName)));
      wasTruncated = part.file.truncated;
    }

    if (!storedName) throw AppError.badRequest("No file uploaded");

    const storedPath = join(UPLOAD_DIR, storedName);

    // busboy silently truncates streams at the size limit rather than erroring —
    // a truncated video/PDF is corrupt, so reject and clean up the partial file.
    if (wasTruncated) {
      await unlink(storedPath).catch(() => { /* best-effort cleanup */ });
      throw AppError.badRequest(
        `File exceeds the ${Math.floor(MAX_ATTACHMENT_SIZE / (1024 * 1024))} MB limit`,
      );
    }

    // Magic-byte validation: runs after pipeline() so the Transform has already seen
    // the first chunk. If the detected type is absent or not in the allow-list we
    // delete the file immediately — it was never accessible while this request was live.
    const detected = await detectedType;
    if (!detected || !ALLOWED_DETECTED_MIME.has(detected.mime)) {
      await unlink(storedPath).catch(() => { /* best-effort cleanup */ });
      throw AppError.badRequest(
        "File content does not match its declared format. Only images, videos, and PDFs are accepted.",
      );
    }

    const { size: fileSize } = await stat(storedPath);

    const fileType = mimeType.startsWith("image/")
      ? "IMAGE"
      : mimeType.startsWith("video/")
        ? "VIDEO"
        : "DOCUMENT";

    let attachment;
    try {
      attachment = await service.addAttachment(id, req.user.sub, req.user.role, {
        fileName:  originalName,
        fileUrl:   `/api/support/attachments/${storedName}`,
        fileSize,
        mimeType,
        fileType:  fileType as "IMAGE" | "VIDEO" | "DOCUMENT",
        messageId: messageId || undefined,
      });
    } catch (err) {
      // DB write failed — remove the orphaned file so the upload dir can't fill
      // with unreferenced (and now unreachable) blobs.
      await unlink(storedPath).catch(() => { /* best-effort cleanup */ });
      throw err;
    }

    return reply.status(201).send({ success: true, data: attachment });
  });

  // ── GET /attachments/:filename ────────────────────────────────────────────────
  // Serve uploaded files. Access is ticket-scoped: support staff see everything,
  // pharmacy users only files attached to their own pharmacy's tickets.

  app.get("/attachments/:filename", { preHandler: anyAuth }, async (req, reply) => {
    const { filename } = req.params as { filename: string };

    // Reject (rather than sanitize) any filename containing path traversal or
    // unexpected characters — stored names are always hex-timestamp-ext.
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!safe || safe !== filename || safe.includes("..")) {
      return reply.status(404).send({ success: false, error: "File not found" });
    }

    // Tenant authorization — throws 403 for cross-pharmacy access, 404 if the
    // file has no DB record (e.g. orphaned or guessed filename).
    const attachment = await service.getAttachmentForUser(safe, req.user.sub, req.user.role);

    const full = join(UPLOAD_DIR, safe);
    if (!existsSync(full)) {
      return reply.status(404).send({ success: false, error: "File not found" });
    }

    // Images/videos render inline in the ticket UI; everything else (incl. PDF)
    // downloads as an attachment so browsers never execute embedded content in
    // the API's origin. nosniff stops MIME-sniffing a crafted file into HTML.
    const isInline = attachment.mimeType.startsWith("image/") || attachment.mimeType.startsWith("video/");
    const downloadName = attachment.fileName.replace(/["\r\n]/g, "");

    reply.header("Content-Type", attachment.mimeType);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${downloadName}"`);
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(createReadStream(full));
  });

  // ── PATCH /tickets/:id/assign ─────────────────────────────────────────────────

  app.patch("/tickets/:id/assign", { preHandler: agentAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = assignTicketSchema.parse(req.body);
    const ticket = await service.assignTicket(id, req.user.role, input);
    return reply.send({ success: true, data: ticket });
  });

  // ── GET /agents ───────────────────────────────────────────────────────────────

  app.get("/agents", { preHandler: adminAuth }, async (_req, reply) => {
    const agents = await service.listAgents();
    return reply.send({ success: true, data: agents });
  });

  // ── POST /agents ──────────────────────────────────────────────────────────────

  app.post("/agents", { preHandler: adminAuth }, async (req, reply) => {
    const input = createAgentSchema.parse(req.body);
    const agent = await service.createAgent(input);
    return reply.status(201).send({ success: true, data: agent });
  });

  // ── PATCH /agents/:id ─────────────────────────────────────────────────────────

  app.patch("/agents/:id", { preHandler: adminAuth }, async (req, reply) => {
    const { id }     = req.params as { id: string };
    const { isActive } = req.body as { isActive: boolean };
    const agent       = await service.toggleAgent(id, !!isActive);
    return reply.send({ success: true, data: agent });
  });

  // ── GET /stream ───────────────────────────────────────────────────────────────
  // Server-Sent Events endpoint for real-time ticket updates. Auth via query param
  // because the browser's EventSource API does not support custom headers.

  app.get("/stream", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    let payload: JwtPayload;
    try {
      payload = app.jwt.verify<JwtPayload>(token);
    } catch {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    if (payload.type !== "access") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const dbUser = await app.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: { tokenVersion: true, isActive: true },
    });
    if (!dbUser?.isActive || dbUser.tokenVersion !== payload.tokenVersion) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    // Disable idle timeout — this is a long-lived streaming connection.
    req.raw.setTimeout(0);
    reply.raw.setTimeout(0);

    reply.raw.setHeader("Content-Type",      "text/event-stream");
    reply.raw.setHeader("Cache-Control",     "no-cache");
    reply.raw.setHeader("Connection",        "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // disable nginx proxy buffering
    reply.raw.flushHeaders();

    const connId = registerConn(payload.sub, payload.role, reply.raw);

    // Heartbeat every 25 s keeps the connection alive through load balancers
    // and browsers that would otherwise close an idle SSE stream.
    const heartbeat = setInterval(() => {
      try { reply.raw.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ connId })}\n\n`);

    await new Promise<void>((resolve) => {
      req.raw.on("close", () => {
        clearInterval(heartbeat);
        removeConn(connId);
        resolve();
      });
    });
  });
};

export default supportRoutes;

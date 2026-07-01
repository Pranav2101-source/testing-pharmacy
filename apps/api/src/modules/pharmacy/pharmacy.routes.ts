import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { AppError } from "../../lib/AppError.js";
import { env } from "../../config/env.js";

// Signed URLs are 24 h — pharmacy logo/docs don't change frequently,
// so long TTL avoids re-signing on every page load.
const SIGNED_URL_TTL = 86_400; // 24 hours

const storedDocSchema = z.object({
  id:              z.string(),
  title:           z.string(),
  docNumber:       z.string(),
  expiryDate:      z.string(),
  fileName:        z.string().nullable(),
  fileStoragePath: z.string().nullable(),
  status:          z.enum(["pending", "uploaded", "expired"]),
  required:        z.boolean().optional(),
});

const updatePharmacySchema = z.object({
  name:        z.string().min(1).max(200),
  address:     z.string().max(500).optional(),
  city:        z.string().max(100).optional(),
  state:       z.string().max(100).optional(),
  pincode:     z.string().max(10).optional(),
  phone:       z.string().max(20).optional(),
  email:       z.string().email().optional().or(z.literal("")),
  gstin:       z.string().max(20).optional(),
  drugLicense: z.string().max(100).optional(),
  logoUrl:     z.string().max(500).optional().nullable(),
});

// Separate schema for documents-only patch — no name required
const patchDocumentsSchema = z.object({
  documents: z.array(storedDocSchema),
});

// ─── Shared: sign logo + batch-sign document files ────────────────────────────

async function signPharmacyAssets(
  app: Parameters<FastifyPluginAsync>[0],
  logoUrl: string | null,
  docs: Array<{ id: string; fileStoragePath: string | null; [k: string]: unknown }>,
) {
  const [logoResult, docResult] = await Promise.all([
    // Logo: single signed URL (skip if no logo stored)
    logoUrl
      ? app.supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).createSignedUrl(logoUrl, SIGNED_URL_TTL)
      : Promise.resolve({ data: null }),

    // Documents: batch sign all file paths in one call
    (() => {
      const paths = docs.map((d) => d.fileStoragePath).filter(Boolean) as string[];
      return paths.length > 0
        ? app.supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
        : Promise.resolve({ data: [] });
    })(),
  ]);

  const logoSignedUrl = logoResult.data?.signedUrl ?? null;

  const urlMap = new Map(
    ((docResult as { data: { path: string; signedUrl: string }[] | null }).data ?? []).map(
      (s) => [s.path, s.signedUrl],
    ),
  );

  const signedDocs = docs.map((d) => ({
    ...d,
    fileSignedUrl: d.fileStoragePath ? (urlMap.get(d.fileStoragePath) ?? null) : null,
  }));

  return { logoSignedUrl, signedDocs };
}

const pharmacyRoutes: FastifyPluginAsync = async (app) => {
  const auth  = [authenticate, resolvePharmacy];
  const owner = [authenticate, requireOwner, resolvePharmacy];

  // GET /api/pharmacy — full profile with signed logo + document URLs
  app.get("/", { preHandler: auth }, async (req, reply) => {
    const pharmacy = await app.prisma.pharmacy.findUnique({
      where:  { id: req.pharmacyId },
      select: {
        id: true, name: true, slug: true,
        address: true, city: true, state: true, pincode: true,
        phone: true, email: true, gstin: true,
        drugLicense: true, isActive: true, logoUrl: true, documents: true,
      },
    });
    if (!pharmacy) throw AppError.notFound("Pharmacy not found");

    const rawDocs = (pharmacy.documents ?? []) as Array<{
      id: string; fileStoragePath: string | null; [k: string]: unknown
    }>;

    // Logo + doc signed URLs in parallel — JWT generation, no network round-trip
    const { logoSignedUrl, signedDocs } = await signPharmacyAssets(app, pharmacy.logoUrl, rawDocs);

    return reply.send({
      success: true,
      data: { ...pharmacy, logoSignedUrl, documents: signedDocs },
    });
  });

  // PUT /api/pharmacy — full profile update (name required)
  app.put("/", { preHandler: owner }, async (req, reply) => {
    const body = updatePharmacySchema.parse(req.body);

    const updated = await app.prisma.pharmacy.update({
      where: { id: req.pharmacyId },
      data:  {
        name:        body.name,
        address:     body.address,
        city:        body.city,
        state:       body.state,
        pincode:     body.pincode,
        phone:       body.phone,
        email:       body.email || null,
        gstin:       body.gstin,
        drugLicense: body.drugLicense,
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      },
      select: {
        id: true, name: true, address: true, city: true, state: true,
        pincode: true, phone: true, email: true, gstin: true,
        drugLicense: true, logoUrl: true,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        pharmacyId: req.pharmacyId,
        userId:     req.user.sub,
        action:     "UPDATE",
        entity:     "Pharmacy",
        entityId:   req.pharmacyId,
        newData:    updated as unknown as Parameters<typeof app.prisma.auditLog.create>[0]["data"]["newData"],
        ipAddress:  req.ip,
        userAgent:  req.headers["user-agent"]?.slice(0, 500),
      },
    });

    return reply.send({ success: true, data: updated });
  });

  // PATCH /api/pharmacy/documents — documents-only update, no name required.
  // Used by DocumentsPage so it doesn't need to know the current pharmacy name.
  app.patch("/documents", { preHandler: owner }, async (req, reply) => {
    const { documents } = patchDocumentsSchema.parse(req.body);

    await app.prisma.pharmacy.update({
      where: { id: req.pharmacyId },
      data:  { documents: documents as never },
      select: { id: true },
    });

    return reply.send({ success: true });
  });
};

export default pharmacyRoutes;

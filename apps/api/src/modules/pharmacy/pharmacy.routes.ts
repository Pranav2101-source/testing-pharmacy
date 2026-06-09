import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { AppError } from "../../lib/AppError.js";

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
  fssai:       z.string().max(50).optional().or(z.literal("")).optional(),
  logoUrl:     z.string().max(500).optional().nullable(),
});

const pharmacyRoutes: FastifyPluginAsync = async (app) => {
  const auth  = [authenticate, resolvePharmacy];
  const owner = [authenticate, requireOwner, resolvePharmacy];

  // GET /api/pharmacy — fetch current pharmacy's profile
  app.get("/", { preHandler: auth }, async (req, reply) => {
    const pharmacy = await app.prisma.pharmacy.findUnique({
      where:  { id: req.pharmacyId },
      select: {
        id: true, name: true, slug: true,
        address: true, city: true, state: true, pincode: true,
        phone: true, email: true, gstin: true,
        drugLicense: true, isActive: true,
      },
    });
    if (!pharmacy) throw AppError.notFound("Pharmacy not found");
    // Attach fssai from invoice settings if stored there, or return empty
    return reply.send({ success: true, data: pharmacy });
  });

  // PUT /api/pharmacy — owner can update profile
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
      },
      select: {
        id: true, name: true, address: true, city: true, state: true,
        pincode: true, phone: true, email: true, gstin: true,
        drugLicense: true,
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
};

export default pharmacyRoutes;

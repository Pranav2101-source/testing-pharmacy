import { z } from "zod";

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
});

export const registerSchema = z.object({
  pharmacyName: z.string().min(2).max(100),
  ownerName:    z.string().min(2).max(100),
  email:        z.string().email(),
  password:     z.string().min(8).max(64),
  phone:        z.string().regex(/^[6-9]\d{9}$/, "Invalid Indian phone number"),
  gstin:        z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/).optional(),
  drugLicense:  z.string().optional(),
  address:      z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  pincode:      z.string().regex(/^\d{6}$/).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token:       z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8).max(64, "Password must be 8–64 characters"),
});

export type LoginInput          = z.infer<typeof loginSchema>;
export type RegisterInput        = z.infer<typeof registerSchema>;
export type RefreshInput         = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput  = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput   = z.infer<typeof resetPasswordSchema>;

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterTenantInput = {
  pharmacyName: string;
  ownerName: string;
  email: string;
  password: string;
  phone: string;
  gstin?: string;
  drugLicense?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName: string;
};

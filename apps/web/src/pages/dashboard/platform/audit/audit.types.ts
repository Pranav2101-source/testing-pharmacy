export type AuditModule =
  | "AUTH"
  | "TENANTS"
  | "SUBSCRIPTIONS"
  | "SUPPORT"
  | "SETTINGS"
  | "SYSTEM"
  | "ANALYTICS"
  | "AUDIT"
  | "BILLING"
  | "INVENTORY";

export type AuditSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type AuditStatus = "SUCCESS" | "FAILED" | "PENDING";

export interface AuditLogItem {
  id: string;
  pharmacyId: string | null;
  userId: string | null;
  userEmail: string | null;
  module: AuditModule;
  action: string;
  entity: string;
  entityId: string | null;
  resourceName: string | null;
  oldData: any | null;
  newData: any | null;
  ipAddress: string | null;
  userAgent: string | null;
  severity: AuditSeverity;
  status: AuditStatus;
  requestId: string | null;
  createdAt: string;
  
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;

  pharmacy?: {
    id: string;
    name: string;
  } | null;
}

export interface AuditLogResponse {
  success: boolean;
  data: {
    items: AuditLogItem[];
    total: number;
  };
}

export interface AuditKPIs {
  totalEvents: number;
  failedActions: number;
  securityAlerts: number;
  loginEvents: number;
}

export interface AuditKPIResponse {
  success: boolean;
  data: AuditKPIs;
}

export interface AuditTimelineResponse {
  success: boolean;
  data: AuditLogItem[];
}

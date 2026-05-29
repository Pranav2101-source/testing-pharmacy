export type InvoiceSettingsConfig = {
  branding: {
    logoUrl: string | null;
    pharmacyNameStyle: "normal" | "bold" | "italic";
    colorTheme: string; // hex
    fontSize: number;
    fontFamily: string;
  };
  layout: {
    size: "A4" | "thermal_58" | "thermal_80";
    view: "compact" | "detailed";
    border: boolean;
    headerAlign: "left" | "center" | "right";
    footerAlign: "left" | "center" | "right";
  };
  fields: {
    customerName: boolean;
    customerPhone: boolean;
    doctorName: boolean;
    hsnCode: boolean;
    batchNumber: boolean;
    expiryDate: boolean;
    discount: boolean;
    gst: boolean;
    qrCode: boolean;
    terms: boolean;
    signature: boolean;
  };
  footer: {
    thankYouMessage: string;
    returnPolicy: string;
    storeTiming: string;
    whatsappNumber: string;
    socialLinks: string[];
  };
  payment: {
    showUpiQr: boolean;
    upiId: string;
    paymentMethods: string[];
    autoPaidStamp: boolean;
  };
  print: {
    thermalWidth: "58mm" | "80mm";
    margin: number;
    autoPrint: boolean;
    copies: number;
    preview: boolean;
  };
  numbering: {
    prefix: string;
    financialYear: boolean;
    currentSequence: number;
  };
  localization: {
    language: "en" | "hi";
    currencySymbol: string;
    dateFormat: string;
  };
};

export const defaultInvoiceSettings: InvoiceSettingsConfig = {
  branding: {
    logoUrl: null,
    pharmacyNameStyle: "bold",
    colorTheme: "#1a56db",
    fontSize: 12,
    fontFamily: "Inter",
  },
  layout: {
    size: "A4",
    view: "detailed",
    border: true,
    headerAlign: "center",
    footerAlign: "center",
  },
  fields: {
    customerName: true,
    customerPhone: true,
    doctorName: true,
    hsnCode: true,
    batchNumber: true,
    expiryDate: true,
    discount: true,
    gst: true,
    qrCode: false,
    terms: true,
    signature: false,
  },
  footer: {
    thankYouMessage: "Thank you for visiting.",
    returnPolicy: "Medicines once sold will not be returned.",
    storeTiming: "",
    whatsappNumber: "",
    socialLinks: [],
  },
  payment: {
    showUpiQr: false,
    upiId: "",
    paymentMethods: ["CASH", "UPI"],
    autoPaidStamp: true,
  },
  print: {
    thermalWidth: "80mm",
    margin: 8,
    autoPrint: false,
    copies: 1,
    preview: true,
  },
  numbering: {
    prefix: "INV",
    financialYear: true,
    currentSequence: 1,
  },
  localization: {
    language: "en",
    currencySymbol: "₹",
    dateFormat: "DD/MM/YYYY",
  },
};

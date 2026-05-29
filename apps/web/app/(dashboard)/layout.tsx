import Link from "next/link";

const navItems = [
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/inventory", label: "Inventory" },
  { href: "/dashboard/suppliers", label: "Suppliers" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/staff", label: "Staff" },
  { href: "/dashboard/settings/invoice", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r flex flex-col">
        <div className="px-4 py-5 border-b">
          <span className="font-bold text-brand-500 text-lg">Checkup Pharmacy</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-brand-50 hover:text-brand-500 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

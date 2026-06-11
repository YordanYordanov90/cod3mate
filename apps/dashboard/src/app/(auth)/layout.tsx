import { AuthInfoPanel } from "@/components/auth/auth-info-panel";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AuthInfoPanel />
      <section className="flex min-h-[min(100vh,48rem)] flex-col bg-background lg:min-h-screen">
        {children}
      </section>
    </div>
  );
}
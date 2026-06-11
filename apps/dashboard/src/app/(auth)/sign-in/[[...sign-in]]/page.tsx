import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8 sm:py-14">
      <header className="mb-8 w-full max-w-sm text-center stagger">
        <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Access the QA dashboard
        </p>
      </header>
      <div className="fade-up w-full max-w-sm" style={{ animationDelay: "120ms" }}>
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "bg-transparent shadow-none border-0 p-0 gap-6",
              header: "hidden",
              footer: "bg-transparent",
            },
          }}
        />
      </div>
    </div>
  );
}
import "./globals.css";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Self-hosted by next/font, so there is no render-blocking font request. globals.css keeps a
 *  system stack as `--font-sans` in case the font ever fails to load. */
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata={title:"Trading Journal Pro",description:"Private trading journal and analytics platform"};

export default async function RootLayout({children}:{children:React.ReactNode}) {
  if (!isSupabaseConfigured) {
    return (
      <html lang="en" className={inter.variable} suppressHydrationWarning>
        <body>
          <main className="auth-page">
            <div className="auth-card card card-pad">
              <div className="auth-logo">T</div>
              <h1>Supabase is not configured</h1>
              <p className="muted">Create a <code>.env.local</code> file in the project root with your project credentials, then restart the dev server.</p>
              <pre className="input" style={{whiteSpace:"pre-wrap",marginTop:14,fontSize:11}}>{`NEXT_PUBLIC_SUPABASE_URL=your-project-url\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key`}</pre>
              <p className="muted" style={{fontSize:11}}>Then run <code>supabase/schema.sql</code> in the Supabase SQL editor and keep the <code>trade-screenshots</code> bucket private.</p>
            </div>
          </main>
        </body>
      </html>
    );
  }

  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
  // Optional: the profile row supplies the display name the topbar greets you with.
  const {data:profile}=user?await supabase.from("profiles").select("display_name").eq("id",user.id).maybeSingle():{data:null};
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell email={user?.email??""} name={profile?.display_name??undefined}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}

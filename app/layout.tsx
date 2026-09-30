import "./globals.css";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { CacheSeed } from "@/components/cache-seed";
import { ThemeProvider } from "@/components/theme-provider";
import { createClient } from "@/lib/supabase/server";
import { loadSeed } from "@/lib/seed";
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

  const supabase=await createClient();
  // The layout re-renders on every navigation, so its work is on the critical path of every page.
  // `getClaims` checks the session against the cached signing keys rather than calling the auth
  // server, and the display name comes out of the token's own metadata — which is where the settings
  // page writes it. The profile row is only read for an account whose name was saved before the
  // metadata was kept in sync, so the common case is one call and no database query at all.
  const {data:claimsData}=await supabase.auth.getClaims();
  const claims=claimsData?.claims as {sub?:string;email?:string;user_metadata?:{display_name?:unknown}}|undefined;
  let name=typeof claims?.user_metadata?.display_name==="string"?claims.user_metadata.display_name:undefined;
  if(claims?.sub&&!name){
    const {data:profile}=await supabase.from("profiles").select("display_name").eq("id",claims.sub).maybeSingle();
    name=profile?.display_name??undefined;
  }
  // The rows every page reads, read here so they travel with the HTML instead of being fetched by
  // the browser after hydration — which is what made a cold page show its numbers last. Only for a
  // signed-in render: the rows are behind RLS, and an anonymous visitor is on the way to /login, so
  // asking for them there would be eight refused queries for a page that shows none of them.
  const seed=claims?.sub?await loadSeed():{};
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <CacheSeed seed={seed}>
            <AppShell email={claims?.email??""} name={name}>{children}</AppShell>
          </CacheSeed>
        </ThemeProvider>
      </body>
    </html>
  );
}

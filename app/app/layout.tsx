import type { Metadata } from "next";
import AuthProvider from "@/components/app/AuthProvider";

export const metadata: Metadata = {
  title: "Drill Instructor App",
  description: "The Drill Instructor student and educator workspace.",
};

export default function StudentAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
